#!/usr/bin/env node
// Transcription mot à mot -> words.json  ({ language, engine, words: [{ w, s, e }] }, temps source en secondes)
//
//   node scripts/transcribe.mjs <projet> [--engine auto|whisper-cpp|whisper|openai|elevenlabs] [--lang fr] [--model ...]
//
// Moteurs :
//   whisper-cpp : binaire `whisper-cli` (ou `whisper-cpp`) + modèle ggml (WHISPER_MODEL=/chemin/ggml-large-v3-turbo.bin)
//   whisper     : `pip install openai-whisper` (CLI `whisper`, --word_timestamps)
//   openai      : OPENAI_API_KEY (whisper-1, timestamps par mot)
//   elevenlabs  : ELEVENLABS_API_KEY (scribe_v1, timestamps par mot — excellent en français)
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { resolveProject, readProject, parseArgs } from '../engine/lib/project.mjs';
import { ffmpeg, run } from '../engine/lib/ffmpeg.mjs';

const has = (bin) => { try { execFileSync(process.platform === 'win32' ? 'where' : 'which', [bin], { stdio: 'ignore' }); return true; } catch { return false; } };

const clean = (w) => String(w).replace(/\s+/g, ' ').trim();

async function viaWhisperCpp(wav, { lang, model }) {
  const bin = ['whisper-cli', 'whisper-cpp', 'main'].find(has);
  model ||= process.env.WHISPER_MODEL;
  if (!model || !fs.existsSync(model)) throw new Error('whisper.cpp : définis WHISPER_MODEL (chemin du modèle ggml)');
  const out = path.join(os.tmpdir(), `wcpp-${Date.now()}`);
  // -ml 1 -sow : un segment par mot (astuce classique pour les timestamps mot à mot)
  await run(bin, ['-m', model, '-f', wav, '-l', lang, '-ml', '1', '-sow', '-oj', '-of', out]);
  const j = JSON.parse(fs.readFileSync(`${out}.json`, 'utf8'));
  return j.transcription
    .map((x) => ({ w: clean(x.text), s: x.offsets.from / 1000, e: x.offsets.to / 1000 }))
    .filter((x) => x.w);
}

async function viaWhisperPy(wav, { lang, model }) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'whisper-'));
  await run('whisper', [wav, '--model', model || 'turbo', '--language', lang, '--word_timestamps', 'True', '--output_format', 'json', '--output_dir', out], { quiet: false });
  const j = JSON.parse(fs.readFileSync(path.join(out, path.basename(wav).replace(/\.\w+$/, '.json')), 'utf8'));
  return j.segments.flatMap((sg) => (sg.words || []).map((w) => ({ w: clean(w.word), s: w.start, e: w.end }))).filter((x) => x.w);
}

async function viaOpenAI(mp3, { lang, model }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY manquant');
  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync(mp3)], { type: 'audio/mpeg' }), 'audio.mp3');
  fd.append('model', model || 'whisper-1');
  fd.append('language', lang);
  fd.append('response_format', 'verbose_json');
  fd.append('timestamp_granularities[]', 'word');
  const r = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: fd });
  if (!r.ok) throw new Error(`OpenAI ${r.status}: ${await r.text()}`);
  const j = await r.json();
  // whisper-1 renvoie les mots sans ponctuation : on la récupère depuis le texte complet
  return attachPunctuation(j.words.map((w) => ({ w: clean(w.word), s: w.start, e: w.end })), j.text);
}

async function viaElevenLabs(mp3, { lang, model }) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error('ELEVENLABS_API_KEY manquant');
  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync(mp3)], { type: 'audio/mpeg' }), 'audio.mp3');
  fd.append('model_id', model || 'scribe_v1');
  fd.append('language_code', lang);
  fd.append('timestamps_granularity', 'word');
  fd.append('tag_audio_events', 'false');
  const r = await fetch('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': key }, body: fd });
  if (!r.ok) throw new Error(`ElevenLabs ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return j.words.filter((w) => w.type === 'word').map((w) => ({ w: clean(w.text), s: w.start, e: w.end })).filter((x) => x.w);
}

function attachPunctuation(words, text) {
  if (!text) return words;
  const toks = text.split(/\s+/).filter(Boolean);
  const norm = (x) => x.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');
  let j = 0;
  return words.map((w) => {
    for (let k = j; k < Math.min(toks.length, j + 4); k++) {
      if (norm(toks[k]) === norm(w.w)) { j = k + 1; return { ...w, w: toks[k] }; }
    }
    return w;
  });
}

const ENGINES = {
  'whisper-cpp': { ok: () => ['whisper-cli', 'whisper-cpp'].some(has) && !!process.env.WHISPER_MODEL, fn: viaWhisperCpp, input: 'wav' },
  whisper: { ok: () => has('whisper'), fn: viaWhisperPy, input: 'wav' },
  elevenlabs: { ok: () => !!process.env.ELEVENLABS_API_KEY, fn: viaElevenLabs, input: 'mp3' },
  openai: { ok: () => !!process.env.OPENAI_API_KEY, fn: viaOpenAI, input: 'mp3' },
};

const args = parseArgs(process.argv.slice(2));
const dir = resolveProject(args._[0]);
const project = readProject(dir);
const src = project.sources[args.source || 'main'];
if (!src) throw new Error('Aucune source "main" dans project.json');
const file = path.resolve(dir, typeof src === 'string' ? src : src.file);
const lang = args.lang || project.language || 'fr';

let name = args.engine || 'auto';
if (name === 'auto') name = Object.keys(ENGINES).find((k) => ENGINES[k].ok());
if (!name || !ENGINES[name]) {
  console.error('✗ Aucun moteur de transcription disponible. Options :\n  - brew install whisper-cpp + WHISPER_MODEL=/chemin/ggml-large-v3-turbo.bin\n  - pip install openai-whisper\n  - export ELEVENLABS_API_KEY=… ou OPENAI_API_KEY=…');
  process.exit(1);
}
const eng = ENGINES[name];
fs.mkdirSync(path.join(dir, 'cache'), { recursive: true });
const audio = path.join(dir, 'cache', eng.input === 'wav' ? 'stt.wav' : 'stt.mp3');
console.log(`▶ transcription (${name}, ${lang}) de ${path.relative(process.cwd(), file)}…`);
await ffmpeg(eng.input === 'wav'
  ? ['-i', file, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', audio]
  : ['-i', file, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', audio]);
const t0 = Date.now();
const words = (await eng.fn(audio, { lang, model: args.model })).map((w) => ({ w: w.w, s: +w.s.toFixed(3), e: +Math.max(w.e, w.s + 0.05).toFixed(3) }));
fs.writeFileSync(path.join(dir, 'words.json'), JSON.stringify({ language: lang, engine: name, createdAt: new Date().toISOString(), words }, null, 1));
console.log(`✓ ${words.length} mots en ${((Date.now() - t0) / 1000).toFixed(1)}s → words.json`);
