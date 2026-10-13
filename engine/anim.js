// Helpers d'animation déterministes (aucun état, uniquement f(t)).

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, x) => clamp((x - a) / (b - a));
export const mapRange = (x, a, b, c, d, ease = E.linear) => lerp(c, d, ease(invLerp(a, b, x)));

export const E = {
  linear: (t) => t,
  inQuad: (t) => t * t,
  outQuad: (t) => 1 - (1 - t) * (1 - t),
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inCubic: (t) => t * t * t,
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outQuart: (t) => 1 - Math.pow(1 - t, 4),
  outExpo: (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  inOutExpo: (t) =>
    t === 0 ? 0 : t === 1 ? 1 : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2,
  outBack: (t, s = 1.70158) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2),
  outElastic: (t) => {
    if (t === 0 || t === 1) return t;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
  },
};

/** Ressort amorti analytique : 0 -> 1, déterministe. */
export function spring(t, { stiffness = 170, damping = 14, mass = 1 } = {}) {
  if (t <= 0) return 0;
  const w0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
  }
  return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
}

/** Bruit pseudo-aléatoire déterministe [0,1) */
export function rand(seed) {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** Petit tremblement organique */
export function wiggle(t, freq = 2, amp = 1, seed = 1) {
  return (
    amp *
    (Math.sin(t * freq * 6.283 + seed) * 0.6 + Math.sin(t * freq * 2.7 * 6.283 + seed * 3.1) * 0.4)
  );
}

/**
 * Calcule l'état d'entrée/sortie d'un élément.
 * Retourne { alpha, dx, dy, scale, rot, blur, reveal } à appliquer.
 */
export function enterExit(local, dur, el = {}) {
  const inName = el.in ?? 'pop';
  const outName = el.out ?? 'fade';
  const inDur = el.inDur ?? 0.35;
  const outDur = el.outDur ?? 0.25;
  const st = { alpha: 1, dx: 0, dy: 0, scale: 1, rot: 0, blur: 0, reveal: 1 };
  const apply = (name, p, dir) => {
    // p : 0 = invisible, 1 = posé
    switch (name) {
      case 'none':
        break;
      case 'fade':
        st.alpha *= p;
        break;
      case 'pop': {
        const s = dir > 0 ? spring(p * inDur, { stiffness: 260, damping: 16 }) : E.outCubic(p);
        st.scale *= lerp(0.4, 1, s);
        st.alpha *= clamp(p * 3);
        break;
      }
      case 'zoom':
        st.scale *= lerp(1.6, 1, E.outExpo(p));
        st.alpha *= clamp(p * 2);
        break;
      case 'up':
      case 'slide-up':
        st.dy += lerp(140, 0, E.outExpo(p));
        st.alpha *= clamp(p * 2);
        break;
      case 'down':
      case 'slide-down':
        st.dy += lerp(-140, 0, E.outExpo(p));
        st.alpha *= clamp(p * 2);
        break;
      case 'left':
        st.dx += lerp(-400, 0, E.outExpo(p));
        st.alpha *= clamp(p * 2);
        break;
      case 'right':
        st.dx += lerp(400, 0, E.outExpo(p));
        st.alpha *= clamp(p * 2);
        break;
      case 'blur':
        st.blur += lerp(30, 0, E.outCubic(p));
        st.alpha *= p;
        break;
      case 'spin':
        st.rot += lerp(-0.6, 0, E.outBack(p));
        st.scale *= lerp(0.2, 1, E.outBack(p));
        st.alpha *= clamp(p * 3);
        break;
      case 'type':
      case 'wipe':
        st.reveal *= E.outCubic(p);
        break;
      default:
        st.alpha *= p;
    }
  };
  if (local < inDur) apply(inName, clamp(local / inDur), 1);
  const rem = dur - local;
  if (rem < outDur && outName !== 'none' && el.out !== false) apply(outName, clamp(rem / outDur), -1);
  return st;
}

export function roundRect(ctx, x, y, w, h, r = 0) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Découpe un texte en lignes pour une largeur max. Gère **mot** = accent. */
export function wrapText(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = [];
  const width = (arr) => ctx.measureText(arr.map((w) => w.replace(/\*\*/g, '')).join(' ')).width;
  for (const w of words) {
    const test = [...cur, w];
    if (cur.length && width(test) > maxWidth) {
      lines.push(cur);
      cur = [w];
    } else cur = test;
  }
  if (cur.length) lines.push(cur);
  return lines;
}

/** Ajuste la taille de police pour que le texte tienne dans maxWidth x maxLines */
export function fitFont(ctx, text, fontFn, size, maxWidth, maxLines = 3, min = 24) {
  let s = size;
  while (s > min) {
    ctx.font = fontFn(s);
    if (wrapText(ctx, text, maxWidth).length <= maxLines) break;
    s -= 4;
  }
  ctx.font = fontFn(s);
  return s;
}

export function withAlpha(color, a) {
  if (!color) return `rgba(0,0,0,${a})`;
  if (color.startsWith('#')) {
    let h = color.slice(1);
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h.slice(0, 6), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  return color;
}

/** Formate un nombre façon fr-FR : 106,3 */
export function fmtNumber(v, decimals = 0, locale = 'fr-FR') {
  return Number(v).toLocaleString(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
