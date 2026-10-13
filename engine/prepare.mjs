// Prépare les rushs : extraction des frames JPEG (décodage fait une seule fois, hors Chrome)
// et de l'audio principal. Écrit cache/sources.json lu par le runtime.
import fs from 'node:fs';
import path from 'node:path';
import { ffmpeg, probe } from './lib/ffmpeg.mjs';
import { readProject, ensureDirs } from './lib/project.mjs';

export async function prepareProject(dir, { force = false, maxSize = 1920, quality = 3, log = console.log } = {}) {
  ensureDirs(dir);
  const project = readProject(dir);
  const srcFile = path.join(dir, 'cache/sources.json');
  const existing = fs.existsSync(srcFile) ? JSON.parse(fs.readFileSync(srcFile, 'utf8')) : {};
  const out = {};
  for (const [id, rel] of Object.entries(project.sources)) {
    const file = path.resolve(dir, typeof rel === 'string' ? rel : rel.file);
    if (!fs.existsSync(file)) throw new Error(`Source ${id} introuvable : ${file}`);
    const st = fs.statSync(file);
    const prev = existing[id];
    const framesDir = path.join(dir, 'frames', id);
    const fpsWanted = (typeof rel === 'object' && rel.fps) || project.fps || null;
    if (!force && prev && prev.mtime === st.mtimeMs && prev.size === st.size && fs.existsSync(framesDir) && fs.readdirSync(framesDir).length >= prev.frames - 1) {
      out[id] = prev;
      continue;
    }
    const meta = probe(file);
    const fps = fpsWanted || Math.min(60, Math.round(meta.fps * 1000) / 1000);
    const t0 = Date.now();
    out[id] = { file: path.relative(dir, file), dir: `frames/${id}`, duration: meta.duration, fps, width: meta.width, height: meta.height, hasAudio: meta.hasAudio, mtime: st.mtimeMs, size: st.size };
    if (meta.hasVideo) {
      fs.rmSync(framesDir, { recursive: true, force: true });
      fs.mkdirSync(framesDir, { recursive: true });
      const big = Math.max(meta.width, meta.height);
      const scale = big > maxSize ? (meta.width >= meta.height ? `scale=${maxSize}:-2` : `scale=-2:${maxSize}`) : 'null';
      log(`  frames ${id} : ${meta.width}x${meta.height} @ ${fps}fps, ${meta.duration.toFixed(1)}s…`);
      await ffmpeg(['-i', file, '-vf', `fps=${fps},${scale}`, '-q:v', String(quality), '-threads', '0', path.join(framesDir, '%06d.jpg')]);
      out[id].frames = fs.readdirSync(framesDir).filter((f) => f.endsWith('.jpg')).length;
    } else out[id].frames = 0;
    if (meta.hasAudio) {
      const wav = path.join(dir, 'cache', `${id}.wav`);
      await ffmpeg(['-i', file, '-vn', '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s16le', wav]);
      out[id].audio = `cache/${id}.wav`;
    }
    log(`  ✓ ${id} préparé en ${((Date.now() - t0) / 1000).toFixed(1)}s (${out[id].frames} frames)`);
  }
  fs.writeFileSync(srcFile, JSON.stringify(out, null, 2));
  return out;
}
