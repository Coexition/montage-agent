// Runtime navigateur : charge la spec, prépare la timeline et dessine une frame sur un canvas.
// Utilisé à la fois par le rendu headless (render.html) et la preview live (preview.html).

import Components, { helpers } from './components.js';
import { resolveFormat, buildTimeline, mapWords, resolveTiming, findSay } from './timeline.js';
import { enterExit } from './anim.js';

const DEFAULT_THEME = {
  fonts: { display: '"Inter Display", Inter, "Helvetica Neue", Arial, sans-serif', body: 'Inter, "Helvetica Neue", Arial, sans-serif', mono: '"DejaVu Sans Mono", Menlo, monospace' },
  colors: { bg: '#0b0b0f', text: '#ffffff', accent: '#2f7bff', accent2: '#ffd400', card: '#ffffff', cardText: '#0b0b0f', danger: '#ff3b30' },
  radius: 32,
  captions: { size: 78, y: '72%', maxWords: 3, uppercase: false, highlight: '#ffd400' },
};

function deepMerge(a, b) {
  if (!b) return a;
  const out = Array.isArray(a) ? [...a] : { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && a?.[k] && typeof a[k] === 'object' ? deepMerge(a[k], v) : v;
  }
  return out;
}

async function getJSON(url, fallback = null) {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return fallback;
    return await r.json();
  } catch {
    return fallback;
  }
}

export async function createEngine({ canvas, base = '/project', styleBase = '/style', bust = Date.now(), variant = null } = {}) {
  const sources = (await getJSON(`${base}/cache/sources.json`, {})) || {};
  const wordsDoc = await getJSON(`${base}/words.json`, null);
  const srcWords = Array.isArray(wordsDoc) ? wordsDoc : wordsDoc?.words || [];
  const style = (await getJSON(`${base}/style.json`, null)) || (await getJSON(`${styleBase}/style.json`, {})) || {};

  const mod = await import(`${base}/source/spec.js?v=${bust}`);
  let spec = mod.default;
  if (typeof spec === 'function') spec = await spec({ words: srcWords, sources, helpers, findSay });

  // variations : surcharge de thème et/ou patch de la spec (planche de comparaison de styles)
  if (variant?.patch) spec = (await variant.patch(spec, { helpers })) || spec;

  if (spec.cuts === 'auto' || (!spec.cuts && spec.autocut !== false)) {
    const auto = await getJSON(`${base}/source/cuts.json`, null);
    spec.cuts = auto?.cuts || auto || undefined;
    // variations : surcharge de thème et/ou patch de la spec (planche de comparaison de styles)
  if (variant?.patch) spec = (await variant.patch(spec, { helpers })) || spec;

  if (spec.cuts === 'auto') spec.cuts = undefined;
  }

  const theme = deepMerge(deepMerge(deepMerge(DEFAULT_THEME, style.theme || style), spec.theme), variant?.theme);
  const fmt = resolveFormat(spec);
  const scale = Number(new URLSearchParams(location.search).get('scale') || 1);
  const W = fmt.width;
  const H = fmt.height;
  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(H * scale);
  const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: false });

  const main = sources[spec.source || 'main'] || Object.values(sources)[0] || { duration: spec.duration || 10 };
  const tl = buildTimeline(spec, main.duration);
  const duration = tl.duration;
  const words = mapWords(tl, srcWords);
  const fps = fmt.fps;
  const totalFrames = Math.max(1, Math.round(duration * fps));

  // ----- polices -----
  for (const f of theme.fonts.files || []) {
    try {
      const ff = new FontFace(f.family, `url(${f.src.startsWith('http') ? f.src : `${base}/${f.src}`})`, { weight: f.weight || 'normal', style: f.style || 'normal' });
      document.fonts.add(await ff.load());
    } catch (e) {
      console.warn('font', f, e);
    }
  }
  const font = (weight, size, family = theme.fonts.display) => `${weight} ${Math.round(size)}px ${family}`;
  await Promise.all([400, 500, 600, 700, 800, 900].flatMap((w) => [document.fonts.load(font(w, 40, theme.fonts.display)), document.fonts.load(font(w, 40, theme.fonts.body))])).catch(() => {});

  // ----- éléments -----
  const rawEls = (spec.elements || spec.layers || []).filter(Boolean).filter((e) => !e.disabled);
  const elements = rawEls.map((el, i) => {
    const comp = Components[el.type];
    if (!comp) console.warn(`Composant inconnu : ${el.type}`);
    const { at, end } = resolveTiming(el, words, duration);
    if (el.zooms) for (const z of el.zooms) z._at = resolveTiming(z, words, duration).at;
    if (el.times) el.times = el.times.map((x) => resolveTiming({ at: x }, words, duration).at);
    return { ...el, _i: i, _at: at, _end: end, _comp: comp, z: el.z ?? i };
  }).sort((a, b) => a.z - b.z);

  const sfx = (spec.sfx || []).map((x) => ({ ...x, at: resolveTiming(x, words, duration).at }));
  // sfx automatiques attachés aux éléments ({ sfx: 'pop' })
  for (const el of elements) if (el.sfx) sfx.push({ file: el.sfx.includes('/') ? el.sfx : `assets/sfx/${el.sfx}.mp3`, at: el._at + (el.sfxOffset || 0), gain: el.sfxGain ?? 0.6 });

  // ----- caches -----
  const imgCache = new Map();
  function img(src) {
    if (!src) return Promise.resolve(null);
    if (!imgCache.has(src)) {
      const url = /^(https?:|data:|\/)/.test(src) ? src : `${base}/${src}`;
      const p = new Promise((res) => {
        const im = new Image();
        im.crossOrigin = 'anonymous';
        im.onload = () => res(im);
        im.onerror = () => { console.warn('image introuvable', url); res(null); };
        im.src = url;
      }).then(async (im) => {
        if (im && !/\.svg/i.test(url)) {
          try { return await createImageBitmap(im); } catch { return im; }
        }
        return im;
      });
      imgCache.set(src, p);
    }
    return imgCache.get(src);
  }

  const frameCache = new Map();
  const MAX_FRAMES = 150;
  function loadFrame(id, idx) {
    const key = `${id}:${idx}`;
    let p = frameCache.get(key);
    if (p) {
      frameCache.delete(key);
      frameCache.set(key, p);
      return p;
    }
    const dir = sources[id]?.dir || `frames/${id}`;
    p = fetch(`${base}/${dir}/${String(idx).padStart(6, '0')}.jpg`)
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => (b ? createImageBitmap(b) : null))
      .catch(() => null);
    frameCache.set(key, p);
    while (frameCache.size > MAX_FRAMES) {
      const k = frameCache.keys().next().value;
      frameCache.get(k).then((bm) => bm?.close?.());
      frameCache.delete(k);
    }
    return p;
  }
  function frame(id, time) {
    const src = sources[id];
    if (!src || time == null) return Promise.resolve(null);
    const count = src.frames || Math.floor(src.duration * src.fps);
    const idx = Math.max(1, Math.min(count, Math.floor(time * src.fps + 1e-6) + 1));
    for (let k = 1; k <= 6; k++) if (idx + k <= count) loadFrame(id, idx + k);
    return loadFrame(id, idx);
  }

  // ----- pages de sous-titres -----
  const pageCache = new Map();
  function captionPages(cs) {
    const key = JSON.stringify([cs.maxWords, cs.maxChars, cs.gap]);
    if (pageCache.has(key)) return pageCache.get(key);
    const maxWords = cs.maxWords ?? 3;
    const maxChars = cs.maxChars ?? 18;
    const pages = [];
    let cur = [];
    const flush = () => {
      if (!cur.length) return;
      pages.push({ words: cur, s: cur[0].s, e: cur[cur.length - 1].e });
      cur = [];
    };
    words.forEach((w, i) => {
      const prev = words[i - 1];
      const chars = cur.reduce((a, x) => a + x.w.length + 1, 0) + w.w.length;
      if (cur.length && (cur.length >= maxWords || chars > maxChars || w.s - prev.e > (cs.gap ?? 0.4))) flush();
      cur.push(w);
      if (/[.!?…]$/.test(w.w)) flush();
    });
    flush();
    // chaque page reste affichée jusqu'à la suivante (pas de trous courts)
    pages.forEach((p, i) => {
      const next = pages[i + 1];
      p.e = next ? Math.min(next.s, p.e + 0.5) : p.e + 0.4;
    });
    pageCache.set(key, pages);
    return pages;
  }

  const px = (v) => (typeof v === 'string' && v.endsWith('%') ? (parseFloat(v) / 100) * W : v);
  const py = (v) => (typeof v === 'string' && v.endsWith('%') ? (parseFloat(v) / 100) * H : v);

  function stateFor(el, t) {
    const dur = el._end - el._at;
    const local = t - el._at;
    return { t, local, dur, p: Math.min(1, Math.max(0, local / dur)), W, H, theme, words, tl, px, py, font, img, frame, captionPages, helpers, fps, duration, el };
  }

  async function renderTime(t) {
    const active = elements.filter((el) => el._comp && t >= el._at && t < el._end);
    const states = active.map((el) => stateFor(el, t));
    await Promise.all(active.map((el, i) => el._comp.prepare?.(el, states[i])));

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.filter = 'none';
    ctx.fillStyle = theme.colors.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);

    // tremblement global (type: 'shake')
    let shx = 0;
    let shy = 0;
    for (let i = 0; i < active.length; i++) {
      if (active[i].type !== 'shake') continue;
      const s = states[i];
      const amp = (active[i].amount ?? 18) * (1 - s.p);
      shx += helpers.wiggle(t, 9, amp, 1);
      shy += helpers.wiggle(t, 11, amp, 7);
    }
    if (shx || shy) ctx.translate(shx, shy);

    for (let i = 0; i < active.length; i++) {
      const el = active[i];
      if (el.type === 'shake') continue;
      const s = states[i];
      const st = enterExit(s.local, s.dur, el);
      if (st.alpha <= 0.001) continue;
      ctx.save();
      ctx.globalAlpha = st.alpha * (el.opacity ?? 1);
      if (st.blur > 0.5) ctx.filter = `blur(${st.blur.toFixed(1)}px)`;
      const [ax, ay] = el._comp.anchor ? el._comp.anchor(el, s) : [W / 2, H / 2];
      let rot = st.rot + ((el.rotate || 0) * Math.PI) / 180;
      let dy = st.dy;
      if (el.float) dy += helpers.wiggle(s.local, 0.4, el.float === true ? 10 : el.float, el._i);
      if (st.dx || dy || st.scale !== 1 || rot || el.scale) {
        ctx.translate(ax + st.dx, ay + dy);
        if (rot) ctx.rotate(rot);
        const sc = st.scale * (el.scale || 1);
        ctx.scale(sc, sc);
        ctx.translate(-ax, -ay);
      }
      if (st.reveal < 1) {
        ctx.beginPath();
        // wipe gauche -> droite centré sur l'ancre de l'élément
        ctx.rect(ax - W / 2, -H, W * st.reveal, H * 3);
        ctx.clip();
      }
      try {
        el._comp.draw(ctx, el, s);
      } catch (e) {
        console.error(`Erreur dans ${el.type}#${el._i}:`, e);
      }
      ctx.restore();
    }
  }

  return {
    canvas,
    ctx,
    spec,
    theme,
    tl,
    words,
    srcWords,
    sources,
    elements,
    W,
    H,
    fps,
    scale,
    duration,
    totalFrames,
    renderTime,
    renderFrame: (f) => renderTime(f / fps),
    info: () => ({
      width: canvas.width,
      height: canvas.height,
      fps,
      duration,
      totalFrames,
      segments: tl.segments,
      source: spec.source || 'main',
      sfx,
      music: spec.music || null,
      audio: spec.audio || {},
      words: words.map(({ w, s, e, srcS, srcE }) => ({ w, s: +s.toFixed(3), e: +e.toFixed(3), srcS, srcE })),
      elements: elements.map((e) => ({ i: e._i, type: e.type, at: +e._at.toFixed(3), end: +e._end.toFixed(3), label: e.label || e.text || e.title || '' })),
      title: spec.title || '',
    }),
  };
}
