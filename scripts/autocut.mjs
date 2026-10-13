#!/usr/bin/env node
// Cuts agressifs pour shorts : supprime chaque silence (et les "euh") à partir de words.json.
// Écrit source/cuts.json, utilisé par la spec via `cuts: 'auto'`.
//
//   node scripts/autocut.mjs <projet> [--gap 0.25] [--pad 0.06] [--fillers] [--silencedetect]
import fs from 'node:fs';
import path from 'node:path';
import { resolveProject, parseArgs, readProject } from '../engine/lib/project.mjs';
import { run, FFMPEG, probe } from '../engine/lib/ffmpeg.mjs';

const FILLERS = /^(euh+|heu+|hum+|bah|ben|uh+|um+|hmm+|mmh+)[.,!?…]*$/i;

export function cutsFromWords(words, { gap = 0.25, pad = 0.06, fillers = true, duration = Infinity } = {}) {
  const kept = words.filter((w) => !(fillers && FILLERS.test(w.w.trim())));
  const cuts = [];
  for (const w of kept) {
    const from = Math.max(0, w.s - pad);
    const to = Math.min(duration, w.e + pad);
    const last = cuts[cuts.length - 1];
    if (last && from - last.to < gap) last.to = Math.max(last.to, to);
    else cuts.push({ from, to });
  }
  return cuts.map((c) => ({ from: +c.from.toFixed(3), to: +c.to.toFixed(3) }));
}

async function cutsFromSilence(file, { noise = -32, minSilence = 0.3, pad = 0.06, duration }) {
  const { err } = await run(FFMPEG, ['-hide_banner', '-i', file, '-af', `silencedetect=noise=${noise}dB:d=${minSilence}`, '-f', 'null', '-']);
  const sil = [];
  let start = null;
  for (const line of err.split('\n')) {
    const a = /silence_start: ([\d.]+)/.exec(line);
    const b = /silence_end: ([\d.]+)/.exec(line);
    if (a) start = Number(a[1]);
    if (b && start != null) { sil.push([start, Number(b[1])]); start = null; }
  }
  if (start != null) sil.push([start, duration]);
  const cuts = [];
  let cur = 0;
  for (const [s, e] of sil) {
    if (s - cur > 0.05) cuts.push({ from: +Math.max(0, cur - pad).toFixed(3), to: +Math.min(duration, s + pad).toFixed(3) });
    cur = e;
  }
  if (duration - cur > 0.05) cuts.push({ from: +Math.max(0, cur - pad).toFixed(3), to: +duration.toFixed(3) });
  return cuts;
}

if (process.argv[1]?.endsWith('autocut.mjs')) {
  const args = parseArgs(process.argv.slice(2));
  const dir = resolveProject(args._[0]);
  const project = readProject(dir);
  const mainRel = project.sources.main;
  const mainFile = mainRel ? path.resolve(dir, typeof mainRel === 'string' ? mainRel : mainRel.file) : null;
  const duration = mainFile ? probe(mainFile).duration : Infinity;
  const wordsFile = path.join(dir, 'words.json');
  let cuts;
  let methodName;
  if (fs.existsSync(wordsFile) && !args.silencedetect) {
    const doc = JSON.parse(fs.readFileSync(wordsFile, 'utf8'));
    const words = Array.isArray(doc) ? doc : doc.words;
    cuts = cutsFromWords(words, { gap: Number(args.gap ?? 0.25), pad: Number(args.pad ?? 0.06), fillers: args.fillers !== 'false', duration });
    methodName = 'words';
  } else {
    if (!mainFile) throw new Error('Pas de words.json ni de source main');
    cuts = await cutsFromSilence(mainFile, { noise: Number(args.noise ?? -32), minSilence: Number(args.min ?? 0.3), pad: Number(args.pad ?? 0.06), duration });
    methodName = 'silencedetect';
  }
  const kept = cuts.reduce((a, c) => a + c.to - c.from, 0);
  fs.mkdirSync(path.join(dir, 'source'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'source/cuts.json'), JSON.stringify({ method: methodName, cuts }, null, 1));
  console.log(`✓ ${cuts.length} segments gardés · ${kept.toFixed(1)}s / ${Number.isFinite(duration) ? duration.toFixed(1) : '?'}s (−${Number.isFinite(duration) ? (duration - kept).toFixed(1) : '?'}s de silences) → source/cuts.json`);
}
