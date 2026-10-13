#!/usr/bin/env node
// Crée un projet de montage à partir d'un rush.
//   node scripts/new-project.mjs <nom> <rush.mp4> [--format 9:16|16:9|1:1] [--lang fr]
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, ensureDirs, parseArgs } from '../engine/lib/project.mjs';

const args = parseArgs(process.argv.slice(2));
const [name, rush] = args._;
if (!name) {
  console.log('usage: node scripts/new-project.mjs <nom> <rush.mp4> [--format 9:16] [--lang fr]');
  process.exit(1);
}
const dir = path.join(ROOT, 'projects', name);
if (fs.existsSync(path.join(dir, 'project.json')) && !args.force) {
  console.error(`✗ projects/${name} existe déjà (--force pour écraser project.json)`);
  process.exit(1);
}
ensureDirs(dir);
fs.mkdirSync(path.join(dir, 'assets/sfx'), { recursive: true });
const sources = {};
if (rush) {
  const ext = path.extname(rush) || '.mp4';
  const dest = path.join(dir, 'footage', `rush${ext}`);
  if (args.link) fs.symlinkSync(path.resolve(rush), dest);
  else fs.copyFileSync(rush, dest);
  sources.main = `footage/rush${ext}`;
}
// sfx par défaut du skill
const sfxDir = path.join(ROOT, '.claude/skills/short-editing/assets/sfx');
if (fs.existsSync(sfxDir)) for (const f of fs.readdirSync(sfxDir)) fs.copyFileSync(path.join(sfxDir, f), path.join(dir, 'assets/sfx', f));

const format = args.format || '9:16';
fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify({ name, format, language: args.lang || 'fr', sources }, null, 2));
const tpl = path.join(ROOT, '.claude/skills/short-editing/templates/spec.js');
if (!fs.existsSync(path.join(dir, 'source/spec.js'))) {
  fs.writeFileSync(path.join(dir, 'source/spec.js'), fs.readFileSync(tpl, 'utf8').replace(/__FORMAT__/g, format));
}
console.log(`✓ projects/${name} créé.
Étapes suivantes :
  node scripts/transcribe.mjs ${name}      # words.json
  node scripts/autocut.mjs ${name}         # cuts agressifs -> source/cuts.json
  # écrire source/spec.js (motion design)
  node engine/render.mjs ${name}           # -> output/v1.mp4
  node studio/server.mjs ${name} --open    # review`);
