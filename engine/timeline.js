// Timeline isomorphe (Node + navigateur).
// Convertit les "cuts" d'une spec (segments gardés du rush) en une timeline de sortie,
// et fournit les conversions temps-source <-> temps-sortie.

export const FORMATS = {
  '9:16': { width: 1080, height: 1920 },
  '16:9': { width: 1920, height: 1080 },
  '1:1': { width: 1080, height: 1080 },
  '4:5': { width: 1080, height: 1350 },
};

export function resolveFormat(spec) {
  const f = FORMATS[spec.format || '9:16'] || FORMATS['9:16'];
  return {
    width: spec.width || f.width,
    height: spec.height || f.height,
    fps: spec.fps || 30,
  };
}

/**
 * spec.cuts = [{ from, to, speed? }]  (secondes dans le rush source principal)
 * spec.speed = multiplicateur global (ex: 1.1)
 * Si pas de cuts : tout le rush (sourceDuration) est gardé.
 */
export function buildTimeline(spec, sourceDuration = 0) {
  const globalSpeed = spec.speed || 1;
  let cuts = Array.isArray(spec.cuts) && spec.cuts.length
    ? spec.cuts.map((c) => (Array.isArray(c) ? { from: c[0], to: c[1] } : c))
    : [{ from: 0, to: sourceDuration || spec.duration || 0 }];
  cuts = cuts
    .filter((c) => c.to > c.from)
    .sort((a, b) => a.from - b.from);

  const segments = [];
  let out = 0;
  for (const c of cuts) {
    const speed = (c.speed || 1) * globalSpeed;
    const len = (c.to - c.from) / speed;
    segments.push({ srcIn: c.from, srcOut: c.to, outStart: out, outEnd: out + len, speed });
    out += len;
  }
  const duration = spec.duration || out;
  return { segments, duration, speed: globalSpeed };
}

/** temps de sortie -> temps source (null si hors timeline) */
export function outToSrc(tl, t) {
  const segs = tl.segments;
  if (!segs.length) return t;
  for (const s of segs) {
    if (t < s.outEnd || s === segs[segs.length - 1]) {
      const local = Math.max(0, Math.min(t, s.outEnd) - s.outStart);
      return Math.min(s.srcOut, s.srcIn + local * s.speed);
    }
  }
  return null;
}

/** index du segment actif à un temps de sortie */
export function segmentAt(tl, t) {
  const segs = tl.segments;
  for (let i = 0; i < segs.length; i++) if (t < segs[i].outEnd) return i;
  return Math.max(0, segs.length - 1);
}

/** temps source -> temps de sortie (null si coupé) */
export function srcToOut(tl, src) {
  for (const s of tl.segments) {
    if (src >= s.srcIn && src <= s.srcOut) return s.outStart + (src - s.srcIn) / s.speed;
  }
  return null;
}

/**
 * Mots (temps source) -> mots (temps sortie). Les mots coupés disparaissent.
 * words: [{ w, s, e }]
 */
export function mapWords(tl, words = []) {
  const res = [];
  for (const wd of words) {
    const mid = (wd.s + wd.e) / 2;
    const seg = tl.segments.find((s) => mid >= s.srcIn && mid <= s.srcOut);
    if (!seg) continue;
    const s = seg.outStart + (Math.max(wd.s, seg.srcIn) - seg.srcIn) / seg.speed;
    const e = seg.outStart + (Math.min(wd.e, seg.srcOut) - seg.srcIn) / seg.speed;
    res.push({ ...wd, s, e, srcS: wd.s, srcE: wd.e });
  }
  return res;
}

const norm = (x) =>
  String(x)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9%]+/g, ' ')
    .trim();

/**
 * Trouve le temps (sortie) où une phrase est prononcée.
 * say: "cent six secondes", occurrence: 1-based
 */
export function findSay(words, say, occurrence = 1, after = 0) {
  const target = norm(say).split(' ').filter(Boolean);
  if (!target.length) return null;
  const toks = words.map((w) => norm(w.w));
  let seen = 0;
  for (let i = 0; i < toks.length; i++) {
    if (words[i].s < after) continue;
    let ok = true;
    let j = 0;
    let k = i;
    while (j < target.length && k < toks.length) {
      const parts = toks[k].split(' ').filter(Boolean);
      for (const p of parts) {
        if (p !== target[j]) { ok = false; break; }
        j++;
        if (j >= target.length) break;
      }
      if (!ok) break;
      k++;
    }
    if (ok && j >= target.length) {
      seen++;
      if (seen === occurrence) return { s: words[i].s, e: words[Math.min(k, words.length - 1)].e, index: i };
    }
  }
  return null;
}

/**
 * Résout le timing d'un élément : at / dur / end peuvent être
 *  - un nombre (secondes de sortie)
 *  - { say: "phrase", occurrence?, offset? }  -> calé sur la parole
 *  - "end" pour dur -> jusqu'à la fin de la vidéo
 */
export function resolveTiming(el, words, duration) {
  const resolvePoint = (v, edge = 's') => {
    if (v == null) return null;
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v)) return parseFloat(v);
    if (typeof v === 'object' && v.say) {
      const hit = findSay(words, v.say, v.occurrence || 1);
      if (!hit) return null;
      return (v.edge === 'end' ? hit.e : hit[edge]) + (v.offset || 0);
    }
    return null;
  };
  let at = resolvePoint(el.at);
  if (at == null) at = 0;
  let end;
  if (el.dur === 'end' || el.end === 'end') end = duration;
  else if (el.end != null) end = resolvePoint(el.end, 's'); // fin = début de la phrase citée ({ edge: 'end' } pour la fin)
  else if (typeof el.dur === 'number') end = at + el.dur;
  else if (el.at && typeof el.at === 'object' && el.at.say) {
    const hit = findSay(words, el.at.say, el.at.occurrence || 1);
    end = hit ? Math.max(hit.e + 0.6, at + 1.2) : at + 2;
  } else end = at + 2;
  if (end == null) end = at + 2;
  return { at, end: Math.min(end, duration + 0.001) };
}

export function fmtTime(t, ms = true) {
  t = Math.max(0, t || 0);
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return ms
    ? `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`
    : `${m}:${String(Math.floor(s)).padStart(2, '0')}`;
}
