// Bibliothèque de composants. Chaque composant :
//   prepare?(el, s) : async — charge les ressources (frames, images) pour l'instant t
//   draw(ctx, el, s) : sync  — dessine l'élément. Les transformations d'entrée/sortie
//                       (pop, slide, fade...) sont appliquées par le runtime autour de anchor(el, s).
//   anchor?(el, s)   : [x, y] centre de la transformation d'entrée/sortie.
//
// s = { t, local, dur, p, W, H, theme, words, tl, st, px, py, font, img(src), frame(id, time), helpers }

import { E, clamp, lerp, spring, roundRect, wrapText, fitFont, withAlpha, fmtNumber, wiggle, invLerp } from './anim.js';
import { outToSrc, segmentAt, fmtTime } from './timeline.js';

const C = {};
export default C;

// ---------- utilitaires de dessin ----------

export function drawCover(ctx, img, x, y, w, h, { fit = 'cover', focus = [0.5, 0.5], zoom = 1, mirror = false } = {}) {
  if (!img) return;
  const iw = img.width || img.videoWidth;
  const ih = img.height || img.videoHeight;
  if (!iw || !ih) return;
  const scale = (fit === 'contain' ? Math.min(w / iw, h / ih) : Math.max(w / iw, h / ih)) * zoom;
  const dw = iw * scale;
  const dh = ih * scale;
  const dx = x + (w - dw) * focus[0];
  const dy = y + (h - dh) * focus[1];
  ctx.save();
  if (fit !== 'contain') {
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
  }
  if (mirror) {
    ctx.translate(x * 2 + w, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(img, dx, dy, dw, dh);
  ctx.restore();
}

function box(el, s, def) {
  const b = el.box || def || [0, 0, s.W, s.H];
  return [s.px(b[0]), s.py(b[1]), s.px(b[2]), s.py(b[3])];
}

function shadowOn(ctx, sh, theme) {
  if (sh === false) return;
  const d = sh || theme.shadow || { blur: 40, y: 16, color: 'rgba(0,0,0,0.35)' };
  ctx.shadowColor = d.color;
  ctx.shadowBlur = d.blur;
  ctx.shadowOffsetY = d.y || 0;
}
function shadowOff(ctx) {
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

// Texte riche : **mot** => couleur accent. Dessine une ligne centrée/alignée.
function drawRichLine(ctx, words, x, y, align, color, accent, opts = {}) {
  const space = ctx.measureText(' ').width;
  const parts = words.map((w) => {
    const acc = /\*\*/.test(w);
    const txt = w.replace(/\*\*/g, '');
    return { txt, acc, w: ctx.measureText(txt).width };
  });
  const total = parts.reduce((a, p) => a + p.w, 0) + space * (parts.length - 1);
  let cx = align === 'left' ? x : align === 'right' ? x - total : x - total / 2;
  const prevAlign = ctx.textAlign;
  ctx.textAlign = 'left';
  parts.forEach((p, i) => {
    const wp = opts.wordProgress ? opts.wordProgress(i) : 1;
    if (wp <= 0) { cx += p.w + space; return; }
    ctx.save();
    if (wp < 1) {
      ctx.globalAlpha *= clamp(wp * 2);
      const sc = lerp(0.6, 1, spring(wp * 0.4, { stiffness: 300, damping: 15 }));
      ctx.translate(cx + p.w / 2, y);
      ctx.scale(sc, sc);
      ctx.translate(-(cx + p.w / 2), -y);
    }
    if (opts.stroke) {
      ctx.lineJoin = 'round';
      ctx.lineWidth = opts.stroke.width;
      ctx.strokeStyle = opts.stroke.color;
      ctx.strokeText(p.txt, cx, y);
    }
    ctx.fillStyle = p.acc ? accent : color;
    ctx.fillText(p.txt, cx, y);
    ctx.restore();
    cx += p.w + space;
  });
  ctx.textAlign = prevAlign;
  return total;
}

// ---------- composants ----------

C.background = {
  draw(ctx, el, s) {
    const { W, H, theme } = s;
    if (el.gradient) {
      const a = ((el.angle ?? 160) * Math.PI) / 180;
      const g = ctx.createLinearGradient(
        W / 2 - (Math.cos(a) * W) / 2, H / 2 - (Math.sin(a) * H) / 2,
        W / 2 + (Math.cos(a) * W) / 2, H / 2 + (Math.sin(a) * H) / 2,
      );
      el.gradient.forEach((c, i) => g.addColorStop(i / (el.gradient.length - 1), c));
      ctx.fillStyle = g;
    } else ctx.fillStyle = el.color || theme.colors.bg;
    ctx.fillRect(0, 0, W, H);
    if (el.grid) {
      ctx.strokeStyle = withAlpha(theme.colors.text, el.gridAlpha ?? 0.05);
      ctx.lineWidth = 2;
      const step = el.grid === true ? 90 : el.grid;
      const off = (s.t * 20) % step;
      for (let x = -step + off; x < W + step; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      for (let y = -step + off; y < H + step; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    }
    if (el.vignette !== false && el.vignette) {
      const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, H * 0.75);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, `rgba(0,0,0,${el.vignette === true ? 0.45 : el.vignette})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
  },
};

// Caméra / rush principal synchronisé à la timeline (prend en compte les cuts).
// Clip : b-roll d'une autre source, temps local (start + local * speed).
function videoTime(el, s) {
  if (el.type === 'clip') return (el.start || 0) + s.local * (el.rate || 1);
  return outToSrc(s.tl, s.t);
}
function videoZoom(el, s) {
  let z = el.zoom || 1;
  // punch-in alterné à chaque jump-cut : dynamise les cuts agressifs
  if (el.punch) {
    const i = segmentAt(s.tl, s.t);
    const amt = typeof el.punch === 'number' ? el.punch : 1.12;
    z *= i % 2 === 1 ? amt : 1;
  }
  for (const zm of el.zooms || []) {
    const at = zm._at ?? zm.at;
    const d = zm.dur ?? 0.5;
    const hold = zm.hold ?? 1.5;
    const sc = zm.scale ?? 1.25;
    if (s.t < at) continue;
    const k = s.t - at;
    let f;
    if (k < d) f = E.outExpo(k / d);
    else if (k < d + hold) f = 1;
    else if (k < d * 2 + hold) f = 1 - E.inOutCubic((k - d - hold) / d);
    else f = 0;
    z *= lerp(1, sc, f);
  }
  return z;
}
C.camera = C.clip = {
  async prepare(el, s) {
    const time = videoTime(el, s);
    el._img = await s.frame(el.source || 'main', time);
  },
  anchor(el, s) {
    const [x, y, w, h] = box(el, s);
    return [x + w / 2, y + h / 2];
  },
  draw(ctx, el, s) {
    const [x, y, w, h] = box(el, s);
    const r = el.radius ?? 0;
    ctx.save();
    if (el.shadow) shadowOn(ctx, el.shadow === true ? null : el.shadow, s.theme);
    if (r || el.shadow) {
      roundRect(ctx, x, y, w, h, r);
      ctx.fillStyle = '#000';
      ctx.fill();
      shadowOff(ctx);
      ctx.clip();
    }
    if (el._img) drawCover(ctx, el._img, x, y, w, h, { fit: el.fit, focus: el.focus, zoom: videoZoom(el, s), mirror: el.mirror });
    else {
      ctx.fillStyle = '#111';
      ctx.fillRect(x, y, w, h);
    }
    ctx.restore();
    if (el.border) {
      ctx.lineWidth = el.border.width || 6;
      ctx.strokeStyle = el.border.color || s.theme.colors.accent;
      roundRect(ctx, x, y, w, h, r);
      ctx.stroke();
    }
  },
};

C.image = {
  async prepare(el, s) {
    el._img = await s.img(el.src);
  },
  anchor(el, s) {
    return [s.px(el.x ?? s.W / 2), s.py(el.y ?? s.H / 2)];
  },
  draw(ctx, el, s) {
    const img = el._img;
    if (!img) return;
    const cx = s.px(el.x ?? s.W / 2);
    const cy = s.py(el.y ?? s.H / 2);
    let w = s.px(el.w ?? (el.h ? (s.py(el.h) * img.width) / img.height : 400));
    let h = s.py(el.h ?? (w * img.height) / img.width);
    let zoom = 1;
    if (el.kenburns) zoom = lerp(1, 1.12, s.p);
    const x = cx - w / 2;
    const y = cy - h / 2;
    ctx.save();
    if (el.bg || el.shadow) {
      if (el.shadow !== false) shadowOn(ctx, el.shadow === true ? null : el.shadow, s.theme);
      roundRect(ctx, x - (el.pad || 0), y - (el.pad || 0), w + 2 * (el.pad || 0), h + 2 * (el.pad || 0), (el.radius || 0) + (el.pad || 0));
      ctx.fillStyle = el.bg || 'rgba(0,0,0,0)';
      ctx.fill();
      shadowOff(ctx);
    }
    if (el.radius) {
      roundRect(ctx, x, y, w, h, el.radius);
      ctx.clip();
    }
    drawCover(ctx, img, x, y, w, h, { fit: el.fit || 'contain', zoom, focus: el.focus });
    ctx.restore();
  },
};

C.text = {
  anchor(el, s) {
    return [s.px(el.x ?? s.W / 2), s.py(el.y ?? s.H * 0.3)];
  },
  draw(ctx, el, s) {
    const { theme } = s;
    const x = s.px(el.x ?? s.W / 2);
    const y = s.py(el.y ?? s.H * 0.3);
    const align = el.align || 'center';
    const maxW = s.px(el.maxWidth ?? s.W * 0.86);
    const weight = el.weight ?? 800;
    const family = el.font || theme.fonts.display;
    const text = el.uppercase ?? theme.text?.uppercase ? String(el.text).toUpperCase() : String(el.text);
    const size = fitFont(ctx, text, (sz) => s.font(weight, sz, family), el.size ?? 96, maxW, el.maxLines ?? 3);
    const lines = wrapText(ctx, text, maxW);
    const lh = size * (el.lineHeight ?? 1.08);
    ctx.textBaseline = 'middle';
    const top = y - ((lines.length - 1) * lh) / 2;
    const color = el.color || theme.colors.text;
    const accent = el.accent || theme.colors.accent;
    // fond "pill"
    if (el.bg) {
      const pad = el.padding ?? size * 0.35;
      const widths = lines.map((l) => ctx.measureText(l.join(' ').replace(/\*\*/g, '')).width);
      const bw = Math.max(...widths) + pad * 2;
      const bh = lines.length * lh + pad * 1.2;
      const bx = align === 'left' ? x - pad : align === 'right' ? x - bw + pad : x - bw / 2;
      ctx.save();
      shadowOn(ctx, el.shadow, theme);
      roundRect(ctx, bx, top - lh / 2 - pad * 0.6, bw, bh, el.radius ?? theme.radius ?? 28);
      ctx.fillStyle = el.bg === true ? theme.colors.card : el.bg;
      ctx.fill();
      ctx.restore();
    } else if (el.shadow !== false) {
      ctx.shadowColor = 'rgba(0,0,0,0.45)';
      ctx.shadowBlur = 24;
      ctx.shadowOffsetY = 6;
    }
    const totalWords = lines.reduce((a, l) => a + l.length, 0);
    let wi = 0;
    const stagger = el.stagger ?? (el.in === 'words' ? 0.08 : 0);
    lines.forEach((ln, i) => {
      const base = wi;
      const wordProgress = stagger ? (k) => clamp((s.local - (base + k) * stagger) / 0.3) : null;
      drawRichLine(ctx, ln, x, top + i * lh, align, color, accent, {
        stroke: el.stroke,
        wordProgress,
      });
      wi += ln.length;
    });
    void totalWords;
    shadowOff(ctx);
  },
};

// Sous-titres karaoké, calés mot à mot sur la transcription.
C.captions = {
  draw(ctx, el, s) {
    const { theme } = s;
    const cs = { ...(theme.captions || {}), ...el };
    const pages = s.captionPages(cs);
    const page = pages.find((p) => s.t >= p.s && s.t < p.e);
    if (!page) return;
    const size = cs.size ?? 78;
    const family = cs.font || theme.fonts.display;
    ctx.font = s.font(cs.weight ?? 900, size, family);
    ctx.textBaseline = 'middle';
    const maxW = s.W * (cs.maxWidth ?? 0.86);
    const words = page.words.map((w) => (cs.uppercase ? w.w.toUpperCase() : w.w));
    // wrap
    const space = ctx.measureText(' ').width + (cs.stroke !== false ? (cs.strokeWidth ?? 14) * 0.6 : 0) + (cs.wordGap ?? 10);
    const lines = [[]];
    let lw = 0;
    words.forEach((w, i) => {
      const ww = ctx.measureText(w).width;
      if (lines[lines.length - 1].length && lw + space + ww > maxW) {
        lines.push([]);
        lw = 0;
      }
      lines[lines.length - 1].push(i);
      lw += (lw ? space : 0) + ww;
    });
    const lh = size * 1.15;
    const y0 = s.py(cs.y ?? s.H * 0.72) - ((lines.length - 1) * lh) / 2;
    const pageIn = clamp((s.t - page.s) / 0.12);
    lines.forEach((ln, li) => {
      const widths = ln.map((i) => ctx.measureText(words[i]).width);
      const total = widths.reduce((a, b) => a + b, 0) + space * (ln.length - 1);
      let x = s.W / 2 - total / 2;
      ln.forEach((i, k) => {
        const wd = page.words[i];
        const active = s.t >= wd.s && s.t < (page.words[i + 1]?.s ?? page.e);
        const spoken = s.t >= wd.s;
        const y = y0 + li * lh;
        const w = widths[k];
        ctx.save();
        let sc = cs.pop === false ? 1 : lerp(0.85, 1, E.outBack(pageIn));
        if (active && cs.pop !== false) sc *= lerp(1.18, 1.08, clamp((s.t - wd.s) / 0.15));
        ctx.translate(x + w / 2, y);
        ctx.scale(sc, sc);
        ctx.globalAlpha *= pageIn;
        if (active && cs.highlightBg) {
          roundRect(ctx, -w / 2 - 14, -size * 0.58, w + 28, size * 1.16, 16);
          ctx.fillStyle = cs.highlightBg;
          ctx.fill();
        }
        ctx.textAlign = 'center';
        if (cs.stroke !== false) {
          ctx.lineJoin = 'round';
          ctx.lineWidth = cs.strokeWidth ?? 14;
          ctx.strokeStyle = cs.strokeColor ?? 'rgba(0,0,0,0.9)';
          ctx.strokeText(words[i], 0, 0);
        }
        const isKey = wd.key || (cs.keywords || []).some((k2) => words[i].toLowerCase().includes(k2.toLowerCase()));
        ctx.fillStyle = active && !cs.highlightBg
          ? cs.highlight ?? theme.colors.accent
          : isKey ? cs.keyColor ?? theme.colors.accent2 ?? theme.colors.accent
          : spoken || cs.dimUnspoken === false ? cs.color ?? '#fff' : withAlpha(cs.color ?? '#ffffff', 0.55);
        ctx.fillText(words[i], 0, 0);
        ctx.restore();
        x += w + space;
      });
    });
  },
};

// Compteur animé : "106,3 s"
C.counter = {
  anchor(el, s) {
    return [s.px(el.x ?? s.W / 2), s.py(el.y ?? s.H * 0.25)];
  },
  draw(ctx, el, s) {
    const { theme } = s;
    const x = s.px(el.x ?? s.W / 2);
    const y = s.py(el.y ?? s.H * 0.25);
    const cd = el.countDur ?? Math.min(1.2, s.dur * 0.6);
    const k = (el.ease ? E[el.ease] : E.outExpo)(clamp(s.local / cd));
    const v = lerp(el.from ?? 0, el.to, k);
    const num = (el.prefix || '') + fmtNumber(v, el.decimals ?? 0, el.locale);
    const size = el.size ?? 200;
    ctx.textBaseline = 'alphabetic';
    ctx.font = s.font(el.weight ?? 900, size, el.font || theme.fonts.display);
    const nw = ctx.measureText(num).width;
    ctx.font = s.font(el.weight ?? 900, size * 0.62, el.font || theme.fonts.display);
    const sw = el.suffix ? ctx.measureText(' ' + el.suffix).width : 0;
    const left = x - (nw + sw) / 2;
    ctx.textAlign = 'left';
    ctx.font = s.font(el.weight ?? 900, size, el.font || theme.fonts.display);
    ctx.fillStyle = el.color || theme.colors.text;
    if (el.shadow !== false) { ctx.shadowColor = 'rgba(0,0,0,0.25)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 10; }
    ctx.fillText(num, left, y + size * 0.35);
    if (el.suffix) {
      ctx.font = s.font(el.weight ?? 900, size * 0.62, el.font || theme.fonts.display);
      ctx.fillStyle = el.suffixColor || theme.colors.accent;
      ctx.fillText(' ' + el.suffix, left + nw, y + size * 0.35);
    }
    shadowOff(ctx);
    if (el.label) {
      ctx.textAlign = 'center';
      ctx.font = s.font(600, size * 0.22, theme.fonts.body);
      ctx.fillStyle = el.labelColor || withAlpha(theme.colors.text, 0.7);
      ctx.fillText(el.label, x, y + size * 0.75);
    }
  },
};

// Badge "▶ Remotion" (logo + nom)
C.badge = {
  async prepare(el, s) {
    if (el.logo) el._img = await s.img(el.logo);
  },
  anchor(el, s) {
    return [s.px(el.x ?? s.W / 2), s.py(el.y ?? s.H * 0.12)];
  },
  draw(ctx, el, s) {
    const { theme } = s;
    const x = s.px(el.x ?? s.W / 2);
    const y = s.py(el.y ?? s.H * 0.12);
    const size = el.size ?? 48;
    ctx.font = s.font(el.weight ?? 700, size, el.font || theme.fonts.body);
    const tw = ctx.measureText(el.text || '').width;
    const ls = el._img ? size * 1.15 : 0;
    const gap = el._img ? size * 0.35 : 0;
    const pad = size * 0.55;
    const w = tw + ls + gap + pad * 2;
    const h = size * 1.9;
    ctx.save();
    if (el.bg !== false) {
      shadowOn(ctx, el.shadow, theme);
      roundRect(ctx, x - w / 2, y - h / 2, w, h, h / 2);
      ctx.fillStyle = el.bg || theme.colors.card;
      ctx.fill();
      shadowOff(ctx);
    }
    if (el._img) drawCover(ctx, el._img, x - w / 2 + pad, y - ls / 2, ls, ls, { fit: 'contain' });
    ctx.fillStyle = el.color || theme.colors.cardText || theme.colors.text;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(el.text || '', x - w / 2 + pad + ls + gap, y + 2);
    ctx.restore();
  },
};

// Carte / panneau (fond arrondi + titre + sous-titre + logo)
C.card = {
  async prepare(el, s) {
    if (el.logo) el._img = await s.img(el.logo);
  },
  anchor(el, s) {
    const [x, y, w, h] = box(el, s, [s.W * 0.08, s.H * 0.3, s.W * 0.84, s.H * 0.3]);
    return [x + w / 2, y + h / 2];
  },
  draw(ctx, el, s) {
    const { theme } = s;
    const [x, y, w, h] = box(el, s, [s.W * 0.08, s.H * 0.3, s.W * 0.84, s.H * 0.3]);
    ctx.save();
    shadowOn(ctx, el.shadow, theme);
    roundRect(ctx, x, y, w, h, el.radius ?? theme.radius ?? 36);
    ctx.fillStyle = el.bg || theme.colors.card;
    ctx.fill();
    shadowOff(ctx);
    if (el.border) {
      ctx.lineWidth = 4;
      ctx.strokeStyle = el.border === true ? theme.colors.accent : el.border;
      ctx.stroke();
    }
    const pad = el.pad ?? 48;
    let ty = y + pad;
    if (el._img) {
      const ls = el.logoSize ?? 96;
      drawCover(ctx, el._img, x + pad, ty, ls, ls, { fit: 'contain' });
      ty += ls + 24;
    }
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    const tc = el.color || theme.colors.cardText || theme.colors.text;
    if (el.title) {
      const sz = el.titleSize ?? 64;
      ctx.font = s.font(800, sz, theme.fonts.display);
      ctx.fillStyle = tc;
      const lines = wrapText(ctx, el.title, w - pad * 2);
      lines.forEach((l) => {
        drawRichLine(ctx, l, x + pad, ty + sz / 2, 'left', tc, theme.colors.accent);
        ty += sz * 1.1;
      });
      ty += 12;
    }
    if (el.text) {
      const sz = el.textSize ?? 40;
      ctx.font = s.font(500, sz, theme.fonts.body);
      ctx.fillStyle = withAlpha(tc, 0.75);
      wrapText(ctx, el.text, w - pad * 2).forEach((l) => {
        drawRichLine(ctx, l, x + pad, ty + sz / 2, 'left', withAlpha(tc, 0.75), theme.colors.accent);
        ty += sz * 1.3;
      });
    }
    if (el.value != null) {
      const sz = el.valueSize ?? 120;
      ctx.font = s.font(900, sz, theme.fonts.display);
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = el.valueColor || theme.colors.accent;
      ctx.textAlign = 'right';
      ctx.fillText(String(el.value), x + w - pad, y + h - pad);
    }
    ctx.restore();
  },
};

// Comparatif en barres horizontales animées
C.bars = {
  async prepare(el, s) {
    for (const it of el.items) if (it.logo) it._img = await s.img(it.logo);
  },
  anchor(el, s) {
    const [x, y, w, h] = box(el, s, [s.W * 0.08, s.H * 0.28, s.W * 0.84, s.H * 0.36]);
    return [x + w / 2, y + h / 2];
  },
  draw(ctx, el, s) {
    const { theme } = s;
    const [x, y, w, h] = box(el, s, [s.W * 0.08, s.H * 0.28, s.W * 0.84, s.H * 0.36]);
    const n = el.items.length;
    const max = el.max ?? Math.max(...el.items.map((i) => i.value));
    const rowH = h / n;
    const barH = rowH * 0.42;
    const labelSize = el.labelSize ?? rowH * 0.2;
    el.items.forEach((it, i) => {
      const delay = (el.stagger ?? 0.15) * i;
      const k = E.outExpo(clamp((s.local - delay) / (el.growDur ?? 0.9)));
      const ry = y + i * rowH;
      const a = clamp((s.local - delay) / 0.2);
      ctx.save();
      ctx.globalAlpha *= a;
      // label
      ctx.font = s.font(700, labelSize, theme.fonts.body);
      ctx.fillStyle = el.labelColor || theme.colors.text;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      let lx = x;
      if (it._img) {
        drawCover(ctx, it._img, x, ry + rowH * 0.18 - labelSize * 0.6, labelSize * 1.2, labelSize * 1.2, { fit: 'contain' });
        lx += labelSize * 1.5;
      }
      ctx.fillText(it.label, lx, ry + rowH * 0.18);
      // barre
      const by = ry + rowH * 0.36;
      roundRect(ctx, x, by, w, barH, barH / 2);
      ctx.fillStyle = withAlpha(theme.colors.text, 0.1);
      ctx.fill();
      const bw = Math.max(barH, (w * it.value * k) / max);
      roundRect(ctx, x, by, bw, barH, barH / 2);
      ctx.fillStyle = it.color || (i === (el.highlight ?? -1) ? theme.colors.accent : theme.colors.accent2 || theme.colors.accent);
      ctx.fill();
      // valeur
      const disp = it.display ?? fmtNumber(it.value * k, el.decimals ?? 1) + (el.unit ? ' ' + el.unit : '');
      ctx.font = s.font(900, barH * 0.62, theme.fonts.display);
      const tw = ctx.measureText(disp).width;
      const inside = bw > tw + 50;
      ctx.fillStyle = inside ? '#fff' : el.valueColor || el.labelColor || theme.colors.text;
      ctx.textAlign = inside ? 'right' : 'left';
      ctx.fillText(disp, inside ? x + bw - 24 : x + bw + 20, by + barH / 2 + 2);
      ctx.restore();
    });
  },
};

// Barre de progression + chrono + compteur de frames (style "fenêtre de rendu")
C.progress = {
  anchor(el, s) {
    const [x, y, w, h] = box(el, s, [s.W * 0.1, s.H * 0.5, s.W * 0.8, 40]);
    return [x + w / 2, y + h / 2];
  },
  draw(ctx, el, s) {
    const { theme } = s;
    const [x, y, w, h] = box(el, s, [s.W * 0.1, s.H * 0.5, s.W * 0.8, 40]);
    const k = (el.ease ? E[el.ease] : E.inOutQuad)(clamp(s.local / (el.fillDur ?? s.dur * 0.9)));
    roundRect(ctx, x, y, w, h, h / 2);
    ctx.fillStyle = withAlpha(theme.colors.text, 0.12);
    ctx.fill();
    roundRect(ctx, x, y, Math.max(h, w * k), h, h / 2);
    ctx.fillStyle = el.color || theme.colors.accent;
    ctx.fill();
    ctx.font = s.font(700, el.textSize ?? h * 0.9, theme.fonts.mono || 'monospace');
    ctx.fillStyle = el.textColor || theme.colors.text;
    ctx.textBaseline = 'top';
    if (el.frames) {
      ctx.textAlign = 'left';
      ctx.fillText(`Frame ${Math.round(el.frames * k)} / ${el.frames}`, x, y + h + 16);
    }
    if (el.time) {
      ctx.textAlign = 'right';
      ctx.fillText(fmtTime(el.time * k, false), x + w, y + h + 16);
    }
    if (el.label) {
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(el.label, x, y - 14);
    }
  },
};

// Flèche (courbe) qui se dessine
C.arrow = {
  draw(ctx, el, s) {
    const { theme } = s;
    const [x1, y1] = [s.px(el.from[0]), s.py(el.from[1])];
    const [x2, y2] = [s.px(el.to[0]), s.py(el.to[1])];
    const curve = el.curve ?? 0.3;
    const mx = (x1 + x2) / 2 - (y2 - y1) * curve;
    const my = (y1 + y2) / 2 + (x2 - x1) * curve;
    const k = E.outCubic(clamp(s.local / (el.drawDur ?? 0.45)));
    const N = 40;
    const pt = (u) => [
      (1 - u) * (1 - u) * x1 + 2 * (1 - u) * u * mx + u * u * x2,
      (1 - u) * (1 - u) * y1 + 2 * (1 - u) * u * my + u * u * y2,
    ];
    ctx.save();
    ctx.strokeStyle = el.color || theme.colors.accent;
    ctx.fillStyle = el.color || theme.colors.accent;
    ctx.lineWidth = el.width ?? 12;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (el.dashed) ctx.setLineDash([24, 20]);
    ctx.beginPath();
    for (let i = 0; i <= N * k; i++) {
      const [px, py] = pt(i / N);
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    if (k > 0.95 && el.head !== false) {
      const [ax, ay] = pt(1);
      const [bx, by] = pt(0.95);
      const ang = Math.atan2(ay - by, ax - bx);
      const hs = el.headSize ?? (el.width ?? 12) * 3.2;
      ctx.beginPath();
      ctx.moveTo(ax + Math.cos(ang) * hs * 0.3, ay + Math.sin(ang) * hs * 0.3);
      ctx.lineTo(ax - Math.cos(ang - 0.5) * hs, ay - Math.sin(ang - 0.5) * hs);
      ctx.lineTo(ax - Math.cos(ang + 0.5) * hs, ay - Math.sin(ang + 0.5) * hs);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  },
};

// Entourage (cercle "fait main" ou rectangle) qui se dessine
C.circle = C.highlight = {
  draw(ctx, el, s) {
    const { theme } = s;
    const cx = s.px(el.x);
    const cy = s.py(el.y);
    const w = s.px(el.w ?? 300);
    const h = s.py(el.h ?? 200);
    const k = E.outCubic(clamp(s.local / (el.drawDur ?? 0.5)));
    ctx.save();
    ctx.strokeStyle = el.color || theme.colors.accent;
    ctx.lineWidth = el.width ?? 10;
    ctx.lineCap = 'round';
    if (el.shape === 'rect' || el.type === 'highlight') {
      const per = 2 * (w + h);
      ctx.setLineDash([per * k, per]);
      roundRect(ctx, cx - w / 2, cy - h / 2, w, h, el.radius ?? 24);
      if (el.fill) { ctx.fillStyle = el.fill; ctx.globalAlpha *= k; ctx.fill(); ctx.globalAlpha /= k || 1; }
      ctx.stroke();
    } else {
      ctx.beginPath();
      const turns = 1.08 * k;
      for (let i = 0; i <= 80 * turns; i++) {
        const a = -Math.PI / 2 + (i / 80) * Math.PI * 2;
        const wob = 1 + 0.03 * Math.sin(i * 0.4);
        const px = cx + Math.cos(a) * (w / 2) * wob;
        const py = cy + Math.sin(a) * (h / 2) * wob;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.stroke();
    }
    ctx.restore();
  },
};

C.flash = {
  draw(ctx, el, s) {
    ctx.fillStyle = el.color || '#fff';
    ctx.globalAlpha *= (el.opacity ?? 0.9) * (1 - E.outCubic(clamp(s.local / s.dur)));
    ctx.fillRect(0, 0, s.W, s.H);
  },
};

C.rect = {
  anchor(el, s) {
    const [x, y, w, h] = box(el, s);
    return [x + w / 2, y + h / 2];
  },
  draw(ctx, el, s) {
    const [x, y, w, h] = box(el, s);
    roundRect(ctx, x, y, w, h, el.radius ?? 0);
    ctx.fillStyle = el.color || s.theme.colors.card;
    ctx.fill();
  },
};

C.emoji = {
  anchor(el, s) {
    return [s.px(el.x ?? s.W / 2), s.py(el.y ?? s.H * 0.4)];
  },
  draw(ctx, el, s) {
    const x = s.px(el.x ?? s.W / 2);
    const y = s.py(el.y ?? s.H * 0.4);
    const size = el.size ?? 180;
    ctx.save();
    ctx.translate(x, y);
    if (el.wobble !== false) ctx.rotate(wiggle(s.local, 1.2, 0.12, el.seed || 1));
    ctx.font = `${size}px "Noto Color Emoji", "Apple Color Emoji", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(el.char || el.text, 0, 0);
    ctx.restore();
  },
};

// Tampon "SECRET" qui s'écrase à l'écran
C.stamp = {
  anchor(el, s) {
    return [s.px(el.x ?? s.W / 2), s.py(el.y ?? s.H * 0.4)];
  },
  draw(ctx, el, s) {
    const { theme } = s;
    const x = s.px(el.x ?? s.W / 2);
    const y = s.py(el.y ?? s.H * 0.4);
    const size = el.size ?? 110;
    const k = clamp(s.local / 0.22);
    const sc = lerp(2.6, 1, E.inCubic(k)) * (k >= 1 ? 1 + 0.04 * Math.exp(-(s.local - 0.22) * 12) * Math.sin((s.local - 0.22) * 60) : 1);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(((el.angle ?? -8) * Math.PI) / 180);
    ctx.scale(sc, sc);
    ctx.globalAlpha *= clamp(k * 2);
    ctx.font = s.font(900, size, theme.fonts.display);
    const tw = ctx.measureText(el.text).width;
    const pad = size * 0.3;
    const color = el.color || theme.colors.danger || '#ff3b30';
    ctx.strokeStyle = color;
    ctx.lineWidth = size * 0.09;
    roundRect(ctx, -tw / 2 - pad, -size * 0.65, tw + pad * 2, size * 1.3, size * 0.15);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(el.text, 0, size * 0.04);
    ctx.restore();
  },
};

// Liste à puces qui apparaissent une par une
C.list = {
  anchor(el, s) {
    return [s.px(el.x ?? s.W * 0.1) + s.W * 0.4, s.py(el.y ?? s.H * 0.3)];
  },
  draw(ctx, el, s) {
    const { theme } = s;
    const x = s.px(el.x ?? s.W * 0.1);
    let y = s.py(el.y ?? s.H * 0.3);
    const size = el.size ?? 56;
    el.items.forEach((it, i) => {
      const at = Array.isArray(el.times) ? el.times[i] - (el._at || 0) : i * (el.stagger ?? 0.35);
      const k = clamp((s.local - at) / 0.35);
      if (k <= 0) { y += size * 1.6; return; }
      ctx.save();
      ctx.globalAlpha *= k;
      ctx.translate(lerp(-60, 0, E.outExpo(k)), 0);
      ctx.font = s.font(800, size, theme.fonts.display);
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillStyle = el.iconColor || theme.colors.accent;
      ctx.fillText(el.icon || '✓', x, y);
      ctx.fillStyle = el.color || theme.colors.text;
      ctx.shadowColor = 'rgba(0,0,0,0.4)';
      ctx.shadowBlur = 16;
      drawRichLine(ctx, String(it).split(/\s+/), x + size * 1.2, y, 'left', el.color || theme.colors.text, theme.colors.accent);
      ctx.restore();
      y += size * 1.6;
    });
  },
};

// Tremblement global : géré par le runtime (aucun dessin)
C.shake = { draw() {} };

// Escape hatch : dessin sur mesure, défini directement dans spec.js
C.custom = {
  async prepare(el, s) {
    if (el.prepare) await el.prepare(s);
  },
  draw(ctx, el, s) {
    el.draw(ctx, s);
  },
};

export const helpers = { E, clamp, lerp, spring, roundRect, wrapText, fitFont, withAlpha, fmtNumber, wiggle, invLerp, drawCover, drawRichLine };
