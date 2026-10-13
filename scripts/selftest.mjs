#!/usr/bin/env node
// Test de bout en bout : timeline, projet démo, autocut, rendu draft, vérification ffprobe.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { buildTimeline, outToSrc, srcToOut, mapWords, findSay, resolveTiming } from '../engine/timeline.js';
import { ROOT } from '../engine/lib/project.mjs';
import { probe } from '../engine/lib/ffmpeg.mjs';
import { render } from '../engine/render.mjs';

const ok = (m) => console.log(`  ✓ ${m}`);

// --- timeline ---
const tl = buildTimeline({ cuts: [{ from: 1, to: 3 }, { from: 5, to: 6, speed: 2 }], speed: 1 }, 10);
assert.equal(tl.duration, 2.5);
assert.equal(outToSrc(tl, 0.5), 1.5);
assert.equal(outToSrc(tl, 2.25), 5.5);
assert.equal(srcToOut(tl, 4), null);
const words = mapWords(tl, [{ w: 'cent', s: 1.2, e: 1.5 }, { w: 'coupé', s: 3.5, e: 4 }, { w: 'six', s: 5.2, e: 5.6 }]);
assert.deepEqual(words.map((w) => w.w), ['cent', 'six']);
assert.equal(findSay(words, 'Cent six').index, 0);
assert.equal(resolveTiming({ at: { say: 'six' }, dur: 1 }, words, tl.duration).at, words[1].s);
ok('timeline (cuts, vitesse, mapping des mots, say)');

// --- rendu démo ---
const demo = path.join(ROOT, 'projects/demo');
if (!fs.existsSync(path.join(demo, 'footage/rush.mp4'))) execFileSync(process.execPath, [path.join(ROOT, 'scripts/make-demo.mjs')], { stdio: 'inherit' });
execFileSync(process.execPath, [path.join(ROOT, 'scripts/autocut.mjs'), 'demo'], { stdio: 'inherit' });
const out = path.join(demo, 'cache/selftest.mp4');
const { meta } = await render('demo', { draft: true, out, workers: 2 });
const p = probe(out);
assert.ok(p.hasVideo && p.hasAudio, 'vidéo + audio');
assert.ok(Math.abs(p.duration - meta.duration) < 0.25, `durée ${p.duration} vs ${meta.duration}`);
assert.equal(p.width, 540);
ok(`rendu draft ${p.width}x${p.height} ${p.duration.toFixed(2)}s (mode ${meta.mode}, ${meta.renderSeconds}s)`);
fs.rmSync(out);
console.log('✓ selftest OK');
