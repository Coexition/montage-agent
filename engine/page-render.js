// Côté page headless : rend une plage de frames et pousse le flux encodé vers Node.
import { createEngine } from './runtime.js';

const canvas = document.getElementById('c');
let engine;

window.__init = async () => {
  engine = await createEngine({ canvas });
  window.__engine = engine;
  return engine.info();
};

const H264_CODECS = ['avc1.640033', 'avc1.640032', 'avc1.64002A', 'avc1.4D0033', 'avc1.42E033'];

window.__probe = async (w, h, fps) => {
  if (typeof VideoEncoder === 'undefined') return null;
  for (const codec of H264_CODECS) {
    try {
      const cfg = { codec, width: w, height: h, framerate: fps, bitrate: 8e6, avc: { format: 'annexb' } };
      const r = await VideoEncoder.isConfigSupported(cfg);
      if (r.supported) return codec;
    } catch {}
  }
  return null;
};

async function post(name, body) {
  const r = await fetch(`/__out/${name}`, { method: 'POST', body });
  if (!r.ok) throw new Error(`POST ${name} -> ${r.status}`);
}

function progress(worker, done, total) {
  console.log(`__progress ${worker} ${done} ${total}`);
}

/** mode h264 : WebCodecs dans Chrome -> Annex B -> Node (concat + mux ffmpeg -c copy) */
async function renderH264({ start, end, worker, codec, bitrate }) {
  const { fps } = engine;
  const chunks = [];
  let bytes = 0;
  let err = null;
  const enc = new VideoEncoder({
    output: (chunk) => {
      const buf = new Uint8Array(chunk.byteLength);
      chunk.copyTo(buf);
      chunks.push(buf);
      bytes += buf.byteLength;
    },
    error: (e) => (err = e),
  });
  enc.configure({
    codec,
    width: canvas.width,
    height: canvas.height,
    framerate: fps,
    bitrate,
    bitrateMode: 'variable',
    latencyMode: 'quality',
    avc: { format: 'annexb' },
  });
  const flushChunks = async () => {
    if (!chunks.length) return;
    const blob = new Blob(chunks.splice(0));
    bytes = 0;
    await post(`seg-${worker}.h264`, blob);
  };
  const gop = fps * 2;
  for (let f = start; f < end; f++) {
    if (err) throw err;
    await engine.renderFrame(f);
    const vf = new VideoFrame(canvas, { timestamp: Math.round((f * 1e6) / fps), duration: Math.round(1e6 / fps) });
    enc.encode(vf, { keyFrame: (f - start) % gop === 0 });
    vf.close();
    while (enc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 0));
    if (bytes > 4e6) await flushChunks();
    if ((f - start) % 15 === 0) progress(worker, f - start, end - start);
  }
  await enc.flush();
  enc.close();
  if (err) throw err;
  await flushChunks();
  progress(worker, end - start, end - start);
}

/** mode raw : pixels RGBA -> ffmpeg (libx264) côté Node. Fallback si pas de H.264 dans Chrome. */
async function renderRaw({ start, end, worker }) {
  const ctx = engine.ctx;
  let inflight = Promise.resolve();
  for (let f = start; f < end; f++) {
    await engine.renderFrame(f);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    await inflight; // une requête en vol à la fois : préserve l'ordre
    inflight = post(`raw-${worker}`, new Blob([data]));
    if ((f - start) % 15 === 0) progress(worker, f - start, end - start);
  }
  await inflight;
  progress(worker, end - start, end - start);
}

window.__render = async (opts) => {
  if (opts.mode === 'h264') return renderH264(opts);
  return renderRaw(opts);
};

window.__still = async (t) => {
  await engine.renderTime(t);
  return canvas.toDataURL('image/jpeg', 0.9);
};

/** planche contact : n frames réparties, pour l'auto-review de l'agent */
window.__contact = async (times, cols = 5, thumbW = 270) => {
  const ratio = canvas.height / canvas.width;
  const th = Math.round(thumbW * ratio);
  const rows = Math.ceil(times.length / cols);
  const sheet = document.createElement('canvas');
  sheet.width = cols * thumbW;
  sheet.height = rows * (th + 34);
  const sx = sheet.getContext('2d');
  sx.fillStyle = '#111';
  sx.fillRect(0, 0, sheet.width, sheet.height);
  for (let i = 0; i < times.length; i++) {
    await engine.renderTime(times[i]);
    const x = (i % cols) * thumbW;
    const y = Math.floor(i / cols) * (th + 34);
    sx.drawImage(canvas, x, y, thumbW, th);
    sx.fillStyle = '#fff';
    sx.font = '600 20px Inter, sans-serif';
    const m = Math.floor(times[i] / 60);
    sx.fillText(`${m}:${(times[i] % 60).toFixed(1).padStart(4, '0')}`, x + 8, y + th + 24);
  }
  return sheet.toDataURL('image/jpeg', 0.85);
};

/** planche de variations : même instant, N variantes de style (choisir puis appliquer au skill) */
window.__variations = async (t, modUrl, cols = 3, thumbW = 360) => {
  const list = (await import(`${modUrl}?v=${Date.now()}`)).default;
  let ratio = 16 / 9;
  const thumbs = [];
  for (const v of list) {
    const c = document.createElement('canvas');
    const e = await createEngine({ canvas: c, variant: v });
    await e.renderTime(t);
    ratio = c.height / c.width;
    thumbs.push({ c, name: v.name || '' });
  }
  const th = Math.round(thumbW * ratio);
  const rows = Math.ceil(thumbs.length / cols);
  const sheet = document.createElement('canvas');
  sheet.width = cols * thumbW;
  sheet.height = rows * (th + 44);
  const sx = sheet.getContext('2d');
  sx.fillStyle = '#111';
  sx.fillRect(0, 0, sheet.width, sheet.height);
  thumbs.forEach(({ c, name }, i) => {
    const x = (i % cols) * thumbW;
    const y = Math.floor(i / cols) * (th + 44);
    sx.drawImage(c, x + 4, y + 4, thumbW - 8, th - 8);
    sx.fillStyle = '#fff';
    sx.font = '700 24px Inter, sans-serif';
    sx.fillText(`${i + 1}. ${name}`, x + 10, y + th + 30);
  });
  return sheet.toDataURL('image/jpeg', 0.88);
};
