#!/usr/bin/env node
// Rendu : spec.js -> Chrome headless (canvas) -> H.264 -> MP4.
//
//   node engine/render.mjs projects/demo                 rendu complet -> output/vN.mp4
//   node engine/render.mjs projects/demo --draft         demi-résolution, rapide
//   node engine/render.mjs projects/demo --workers 6     N Chrome en parallèle (chacun une tranche)
//   node engine/render.mjs projects/demo --still 1.2,4   stills JPEG -> screenshots/
//   node engine/render.mjs projects/demo --contact 15    planche contact -> screenshots/
//   node engine/render.mjs projects/demo --info          infos timeline (JSON)
//   node engine/render.mjs projects/demo --variations source/variations.js --at 3.2
//                                                        planche de N variantes de style au même instant
//
// Deux modes d'encodage :
//   h264 : WebCodecs VideoEncoder dans Chrome (Chrome système), flux Annex B concaténé puis
//          muxé par ffmpeg en -c copy. Aucun ré-encodage : c'est le chemin rapide.
//   raw  : fallback quand Chrome n'a pas H.264 (Chromium open source) : pixels RGBA -> ffmpeg libx264.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { createServer, listen, readBody } from './lib/server.mjs';
import { findChrome, CHROME_ARGS } from './lib/chrome.mjs';
import { ffmpeg, FFMPEG } from './lib/ffmpeg.mjs';
import { resolveProject, readProject, nextVersion, parseArgs, ENGINE_DIR, SKILL_DIR, ensureDirs } from './lib/project.mjs';
import { prepareProject } from './prepare.mjs';
import { buildAudio } from './audio.mjs';

const log = (...a) => console.log(...a);

export async function startEngineServer(dir, extraRoutes = []) {
  const sinks = new Map(); // name -> handler(buffer)
  const server = createServer({
    mounts: { '/engine': ENGINE_DIR, '/project': dir, '/style': SKILL_DIR },
    routes: [
      ...extraRoutes,
      ['POST', /^\/__out\/(.+)$/, async (req, res, m) => {
        const body = await readBody(req);
        const sink = sinks.get(m[1]);
        if (!sink) { res.writeHead(404); return res.end('no sink'); }
        await sink(body);
        res.writeHead(200);
        res.end('ok');
      }],
    ],
  });
  const port = await listen(server);
  return { server, port, sinks, url: `http://127.0.0.1:${port}` };
}

export async function launchChrome(opts = {}) {
  const executablePath = opts.chrome || findChrome();
  if (!executablePath) throw new Error('Aucun Chrome trouvé. Installe Google Chrome ou définis CHROME_PATH.');
  const browser = await chromium.launch({ executablePath, headless: true, args: CHROME_ARGS });
  return { browser, executablePath };
}

async function openPage(browser, url, onLog) {
  const ctx = await browser.newContext({ deviceScaleFactor: 1, viewport: { width: 400, height: 400 } });
  const page = await ctx.newPage();
  page.on('console', (m) => onLog?.(m.text(), m.type()));
  page.on('pageerror', (e) => console.error('  [page]', e.message));
  await page.goto(url);
  await page.waitForFunction(() => typeof window.__init === 'function');
  return page;
}

function writeTo(stream, buf) {
  // le callback de write() n'est appelé qu'une fois les données passées à ffmpeg : backpressure naturelle
  return new Promise((resolve, reject) => stream.write(buf, (err) => (err ? reject(err) : resolve())));
}

export async function render(projectArg, opts = {}) {
  const t0 = Date.now();
  const dir = resolveProject(projectArg);
  ensureDirs(dir);
  const project = readProject(dir);
  if (Object.keys(project.sources).length) await prepareProject(dir, { log });

  const scale = opts.draft ? 0.5 : Number(opts.scale || 1);
  const srv = await startEngineServer(dir);
  const { browser, executablePath } = await launchChrome(opts);
  const pageUrl = `${srv.url}/engine/render.html?scale=${scale}`;
  const logs = new Map();
  const onLog = (text, type) => {
    if (text.startsWith('__progress ')) {
      const [, w, done, total] = text.split(' ');
      logs.set(w, [Number(done), Number(total)]);
      return;
    }
    if (/Failed to load resource/.test(text) && !opts.verbose) return;
    if (type === 'error' || type === 'warning' || opts.verbose) console.log(`  [chrome:${type}] ${text}`);
  };
  try {
    const first = await openPage(browser, pageUrl, onLog);
    const info = await first.evaluate(() => window.__init());

    if (opts.info) {
      console.log(JSON.stringify({ ...info, words: info.words.length }, null, 2));
      return info;
    }

    // ---- variations de style ----
    if (opts.variations) {
      const rel = path.relative(dir, path.resolve(dir, opts.variations)).split(path.sep).join('/');
      const at = Number(opts.at ?? info.duration / 3);
      const data = await first.evaluate(([t, u]) => window.__variations(t, u), [at, `/project/${rel}`]);
      const f = path.join(dir, 'screenshots', `variations-${at.toFixed(1)}.jpg`);
      fs.writeFileSync(f, Buffer.from(data.split(',')[1], 'base64'));
      log(`  → ${path.relative(process.cwd(), f)}`);
      return { files: [f] };
    }

    // ---- stills / planche contact ----
    if (opts.still || opts.contact) {
      const shots = path.join(dir, 'screenshots');
      const files = [];
      if (opts.still) {
        const times = String(opts.still).split(',').map(Number);
        for (const t of times) {
          const data = await first.evaluate((tt) => window.__still(tt), t);
          const f = path.join(shots, `still-${t.toFixed(2)}.jpg`);
          fs.writeFileSync(f, Buffer.from(data.split(',')[1], 'base64'));
          files.push(f);
        }
      }
      if (opts.contact) {
        const f = await contactSheet(first, info, dir, opts.contact === true ? 15 : Number(opts.contact) || 15, opts.contactName || 'contact');
        files.push(f);
      }
      files.forEach((f) => log(`  → ${path.relative(process.cwd(), f)}`));
      return { files };
    }

    // ---- rendu vidéo ----
    const version = opts.version ? Number(opts.version) : nextVersion(dir);
    const work = path.join(dir, 'cache/render', `v${version}`);
    fs.rmSync(work, { recursive: true, force: true });
    fs.mkdirSync(work, { recursive: true });

    const codec = opts.codec === 'raw' ? null : await first.evaluate(([w, h, f]) => window.__probe(w, h, f), [info.width, info.height, info.fps]);
    const mode = codec ? 'h264' : 'raw';
    if (opts.codec === 'h264' && !codec) throw new Error("Ce Chrome n'a pas l'encodeur H.264 WebCodecs (utilise Google Chrome ou --codec raw)");
    const maxWorkers = Math.max(1, Math.min(os.cpus().length, 8));
    const workers = Math.max(1, Math.min(Number(opts.workers || Math.min(4, maxWorkers)), Math.ceil(info.totalFrames / 30)));
    log(`▶ ${project.name} v${version} — ${info.width}x${info.height} @ ${info.fps}fps, ${info.duration.toFixed(2)}s (${info.totalFrames} frames)`);
    log(`  mode ${mode}${codec ? ` (${codec})` : ' (ffmpeg libx264)'} · ${workers} worker(s) · ${path.basename(executablePath)}`);

    // tranches contiguës
    const per = Math.ceil(info.totalFrames / workers);
    const ranges = Array.from({ length: workers }, (_, i) => [i * per, Math.min(info.totalFrames, (i + 1) * per)]).filter(([a, b]) => b > a);
    const pages = [first];
    for (let i = 1; i < ranges.length; i++) {
      const p = await openPage(browser, pageUrl, onLog);
      await p.evaluate(() => window.__init());
      pages.push(p);
    }

    const ffprocs = [];
    ranges.forEach((_, i) => {
      if (mode === 'h264') {
        const f = path.join(work, `seg-${i}.h264`);
        fs.writeFileSync(f, '');
        srv.sinks.set(`seg-${i}.h264`, async (buf) => fs.appendFileSync(f, buf));
      } else {
        const seg = path.join(work, `seg-${i}.mp4`);
        const p = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${info.width}x${info.height}`, '-r', String(info.fps), '-i', '-',
          '-c:v', 'libx264', '-preset', opts.draft ? 'ultrafast' : opts.preset || 'veryfast', '-crf', String(opts.crf || 20), '-pix_fmt', 'yuv420p', '-threads', String(Math.max(1, Math.floor(os.cpus().length / ranges.length))), seg], { stdio: ['pipe', 'ignore', 'inherit'] });
        const done = new Promise((res, rej) => p.on('close', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg worker ${i} exit ${c}`)))));
        ffprocs.push({ p, done, seg });
        srv.sinks.set(`raw-${i}`, (buf) => writeTo(p.stdin, buf));
      }
    });

    const timer = setInterval(() => {
      let d = 0;
      for (const [a] of logs.values()) d += a;
      const pct = ((d / info.totalFrames) * 100).toFixed(0);
      const el = (Date.now() - t0) / 1000;
      process.stdout.write(`\r  rendu ${pct}% · ${d}/${info.totalFrames} frames · ${(d / Math.max(0.1, el)).toFixed(0)} fps   `);
    }, 500);

    // audio en parallèle du rendu vidéo
    const voice = info.source && fs.existsSync(path.join(dir, 'cache', `${info.source}.wav`)) ? path.join(dir, 'cache', `${info.source}.wav`) : null;
    const audioFile = path.join(work, 'audio.m4a');
    const audioP = buildAudio(dir, info, voice, audioFile);

    const bitrate = Number(opts.bitrate || (opts.draft ? 4e6 : 10e6));
    try {
      await Promise.all(pages.map((p, i) => p.evaluate((o) => window.__render(o), { start: ranges[i][0], end: ranges[i][1], worker: i, mode, codec, bitrate })));
    } finally {
      clearInterval(timer);
    }
    process.stdout.write('\n');
    const tRender = (Date.now() - t0) / 1000;

    const outDir = path.join(dir, 'output');
    const outFile = opts.out ? path.resolve(opts.out) : path.join(outDir, `v${version}.mp4`);
    await audioP;
    if (mode === 'h264') {
      const all = path.join(work, 'video.h264');
      fs.writeFileSync(all, '');
      for (let i = 0; i < ranges.length; i++) fs.appendFileSync(all, fs.readFileSync(path.join(work, `seg-${i}.h264`)));
      // le flux H.264 brut n'a pas de timestamps : ffmpeg ≥ 8 perd alors l'audio avec -shortest → on les génère (pas de B-frames)
      const setts = `setts=pts=N*(1/${info.fps})/TB:dts=N*(1/${info.fps})/TB`;
      await ffmpeg(['-f', 'h264', '-r', String(info.fps), '-i', all, '-i', audioFile, '-map', '0:v', '-map', '1:a', '-c', 'copy', '-bsf:v', setts, '-movflags', '+faststart', '-shortest', outFile]);
    } else {
      ffprocs.forEach((f) => f.p.stdin.end());
      await Promise.all(ffprocs.map((f) => f.done));
      const list = path.join(work, 'list.txt');
      fs.writeFileSync(list, ffprocs.map((f) => `file '${f.seg}'`).join('\n'));
      await ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-i', audioFile, '-map', '0:v', '-map', '1:a', '-c', 'copy', '-movflags', '+faststart', '-shortest', outFile]);
    }

    // poster + métadonnées + transcription alignée sur la sortie (pour le studio)
    const posterT = Math.min(info.duration * 0.15, 1.5);
    await ffmpeg(['-ss', String(posterT), '-i', outFile, '-frames:v', '1', '-q:v', '3', outFile.replace(/\.mp4$/, '.jpg')]).catch(() => {});
    const total = (Date.now() - t0) / 1000;
    const size = fs.statSync(outFile).size;
    const meta = {
      version, renderedAt: new Date().toISOString(), duration: info.duration, fps: info.fps, width: info.width, height: info.height,
      format: info.width < info.height ? '9:16' : info.width === info.height ? '1:1' : '16:9',
      mode, codec, workers: ranges.length, renderSeconds: +total.toFixed(2), videoSeconds: +tRender.toFixed(2), size,
      elements: info.elements, segments: info.segments.length, draft: !!opts.draft, title: info.title,
    };
    if (!opts.out) {
      fs.writeFileSync(path.join(outDir, `v${version}.json`), JSON.stringify(meta, null, 2));
      fs.writeFileSync(path.join(outDir, `v${version}.words.json`), JSON.stringify(info.words));
    }
    if (opts.contact !== false && !opts['no-contact'] && !opts.out) {
      await contactSheet(first, info, dir, 15, `contact-v${version}`).catch((e) => console.warn('  contact:', e.message));
    }
    if (!opts.keep) fs.rmSync(work, { recursive: true, force: true });
    log(`✓ ${path.relative(process.cwd(), outFile)} — ${(size / 1e6).toFixed(1)} Mo — rendu en ${total.toFixed(1)}s (${(info.totalFrames / tRender).toFixed(0)} fps)`);
    return { outFile, meta };
  } finally {
    await browser.close();
    srv.server.close();
  }
}

async function contactSheet(page, info, dir, n, name) {
  const times = Array.from({ length: n }, (_, i) => +(((i + 0.5) / n) * info.duration).toFixed(2));
  const data = await page.evaluate(([t]) => window.__contact(t, 5, 270), [times]);
  const f = path.join(dir, 'screenshots', `${name}.jpg`);
  fs.writeFileSync(f, Buffer.from(data.split(',')[1], 'base64'));
  return f;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('render.mjs')) {
  const args = parseArgs(process.argv.slice(2));
  if (!args._[0]) {
    console.log('usage: node engine/render.mjs <projet> [--draft] [--workers N] [--still t1,t2] [--contact N] [--info] [--codec h264|raw]');
    process.exit(1);
  }
  render(args._[0], args).catch((e) => {
    console.error('✗', e.message);
    process.exit(1);
  });
}
