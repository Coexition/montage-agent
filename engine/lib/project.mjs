// Conventions de dossiers d'un projet de montage.
//
// projects/<nom>/
//   project.json          { name, format, sources: { main: "footage/rush.mp4", ... } }
//   footage/              rushs bruts
//   assets/               logos, images, sfx/, fonts/
//   source/spec.js        LE montage (données + éventuels draw() custom)
//   source/cuts.json      cuts générés par autocut (cuts: 'auto')
//   style.json            (optionnel) surcharge du style du skill
//   words.json            transcription mot à mot (temps source)
//   frames/<source>/      frames JPEG extraites (cache de décodage)
//   cache/                audio.wav, sources.json, rendus intermédiaires
//   output/vN.mp4         rendus versionnés (+ vN.jpg poster, vN.json meta, vN.words.json)
//   reviews/feedback.json feedback du studio ; reviews/attachments/*.png
//   screenshots/          stills et planches contact pour l'auto-review
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const ENGINE_DIR = path.join(ROOT, 'engine');
export const SKILL_DIR = path.join(ROOT, '.claude/skills/short-editing');

export function resolveProject(arg) {
  if (!arg) throw new Error('Chemin du projet manquant (ex: projects/demo)');
  const candidates = [path.resolve(arg), path.join(ROOT, 'projects', arg)];
  for (const c of candidates) if (fs.existsSync(path.join(c, 'project.json')) || fs.existsSync(path.join(c, 'source/spec.js'))) return c;
  throw new Error(`Projet introuvable : ${arg}`);
}

export function readProject(dir) {
  const f = path.join(dir, 'project.json');
  const p = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
  p.name ||= path.basename(dir);
  p.sources ||= {};
  return p;
}

export function listVersions(dir) {
  const out = path.join(dir, 'output');
  if (!fs.existsSync(out)) return [];
  return fs.readdirSync(out)
    .map((f) => /^v(\d+)\.mp4$/.exec(f))
    .filter(Boolean)
    .map((m) => {
      const v = Number(m[1]);
      const metaFile = path.join(out, `v${v}.json`);
      const meta = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, 'utf8')) : {};
      return { v, file: `output/v${v}.mp4`, poster: fs.existsSync(path.join(out, `v${v}.jpg`)) ? `output/v${v}.jpg` : null, words: fs.existsSync(path.join(out, `v${v}.words.json`)) ? `output/v${v}.words.json` : null, ...meta };
    })
    .sort((a, b) => a.v - b.v);
}

export function nextVersion(dir) {
  const v = listVersions(dir);
  return v.length ? v[v.length - 1].v + 1 : 1;
}

export function ensureDirs(dir) {
  for (const d of ['assets', 'source', 'cache', 'output', 'reviews/attachments', 'screenshots', 'frames', 'footage']) fs.mkdirSync(path.join(dir, d), { recursive: true });
}

export function feedbackFile(dir) {
  return path.join(dir, 'reviews/feedback.json');
}

export function readFeedback(dir) {
  const f = feedbackFile(dir);
  if (!fs.existsSync(f)) return { items: [] };
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

export function writeFeedback(dir, data) {
  fs.mkdirSync(path.join(dir, 'reviews'), { recursive: true });
  fs.writeFileSync(feedbackFile(dir), JSON.stringify(data, null, 2));
}

export function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      if (v !== undefined) args[k] = v;
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) args[k] = argv[++i];
      else args[k] = true;
    } else args._.push(a);
  }
  return args;
}
