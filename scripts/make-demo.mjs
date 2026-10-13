#!/usr/bin/env node
// Génère projects/demo : un faux rush 9:16 (mire animée + "bips" de parole), une transcription
// mot à mot factice et des logos SVG. Sert de test de bout en bout sans vraie caméra.
import fs from 'node:fs';
import path from 'node:path';
import { ffmpeg } from '../engine/lib/ffmpeg.mjs';
import { ROOT, ensureDirs } from '../engine/lib/project.mjs';

const dir = path.join(ROOT, 'projects/demo');
ensureDirs(dir);
fs.mkdirSync(path.join(dir, 'assets/sfx'), { recursive: true });

const TEXT = `Tout le monde parle de Remotion et HyperFrames pour le montage vidéo avec l'IA. euh
J'ai benchmarké les trois. Remotion a pris cent six secondes. C'est presque aussi long que la vidéo.
HyperFrames cinquante trois secondes. Mon moteur actuel huit virgule cinq secondes.
Juste Chrome, un canvas et WebCodecs. C'est douze fois plus rapide. Lien en commentaire.`;

// --- transcription factice : ~2.6 mots/s, avec des silences à couper ---
const words = [];
let t = 0.6;
for (const raw of TEXT.split(/\s+/).filter(Boolean)) {
  const len = 0.18 + Math.min(0.5, raw.length * 0.035);
  words.push({ w: raw, s: +t.toFixed(3), e: +(t + len).toFixed(3) });
  t += len + 0.08;
  if (/[.!?]$/.test(raw)) t += 0.9; // long silence en fin de phrase -> autocut
  if (raw === 'euh') t += 0.7;
}
const duration = +(t + 0.8).toFixed(2);
fs.writeFileSync(path.join(dir, 'words.json'), JSON.stringify({ language: 'fr', engine: 'demo', words }, null, 2));

// --- audio : un bip par mot (fréquence variable) ---
const exprs = words.map((w, i) => `between(t,${w.s},${w.e})*sin(2*PI*${180 + (i % 5) * 30}*t)*0.4`).join('+');
fs.writeFileSync(path.join(dir, 'cache/demo-audio.txt'), `aevalsrc='${exprs}':s=48000:d=${duration}`);

console.log(`demo : ${words.length} mots, ${duration}s`);
const wav = path.join(dir, 'cache/demo-audio.wav');
await ffmpeg(['-filter_complex_script', path.join(dir, 'cache/demo-audio.txt'), '-ac', '2', wav]);
await ffmpeg([
  '-f', 'lavfi', '-i', `testsrc2=s=1080x1920:r=30:d=${duration}`,
  '-i', wav,
  '-vf', "hue=s=0.35,drawbox=x=340:y=560:w=400:h=520:color=0xf2d0b0@0.9:t=fill,drawtext=text='RUSH CAMERA %{pts\\:hms}':x=60:y=1700:fontsize=56:fontcolor=white:box=1:boxcolor=black@0.5",
  '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
  path.join(dir, 'footage/rush.mp4'),
]);
// sfx : pop + whoosh synthétiques
await ffmpeg(['-f', 'lavfi', '-i', "aevalsrc='sin(2*PI*(900-3000*t)*t)*exp(-25*t)*0.8':s=48000:d=0.25", path.join(dir, 'assets/sfx/pop.mp3')]);
await ffmpeg(['-f', 'lavfi', '-i', 'anoisesrc=d=0.45:c=pink:a=0.5', '-af', 'afade=t=in:d=0.2,afade=t=out:st=0.2:d=0.25,highpass=f=600', path.join(dir, 'assets/sfx/whoosh.mp3')]);

const logo = (color, letter) => `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><rect width="256" height="256" rx="64" fill="${color}"/><text x="128" y="172" font-family="Inter, Arial" font-weight="900" font-size="140" text-anchor="middle" fill="#fff">${letter}</text></svg>`;
fs.writeFileSync(path.join(dir, 'assets/remotion.svg'), `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><rect width="256" height="256" rx="64" fill="#0b84f3"/><path d="M96 70 L190 128 L96 186 Z" fill="#fff"/></svg>`);
fs.writeFileSync(path.join(dir, 'assets/hyperframes.svg'), logo('#7c3aed', 'H'));
fs.writeFileSync(path.join(dir, 'assets/chrome.svg'), logo('#16a34a', 'C'));

if (!fs.existsSync(path.join(dir, 'project.json'))) {
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify({ name: 'short-moteur-vs-remotion', format: '9:16', sources: { main: 'footage/rush.mp4' } }, null, 2));
}
console.log('✓ projects/demo prêt (footage, words.json, assets). Lance : node scripts/autocut.mjs demo && node engine/render.mjs demo');
