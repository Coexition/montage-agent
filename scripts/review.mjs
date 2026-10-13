#!/usr/bin/env node
// CLI de review pour l'agent : lire les retours du studio et y répondre.
//
//   node scripts/review.mjs prompt  <projet> [--all]        prompt markdown (= bouton "Copy prompt")
//   node scripts/review.mjs list    <projet> [--all]        liste courte
//   node scripts/review.mjs resolve <projet> <id> "réponse"  marque résolu + réponse affichée dans le studio (✦)
//   node scripts/review.mjs reopen  <projet> <id>
//   node scripts/review.mjs add     <projet> --at 12.3 "texte"   (ajout manuel)
import { resolveProject, readFeedback, listVersions, parseArgs } from '../engine/lib/project.mjs';
import { buildPrompt, updateItem, addItem } from '../engine/lib/feedback.mjs';
import { fmtTime } from '../engine/timeline.js';

const args = parseArgs(process.argv.slice(2));
const [cmd, proj, ...rest] = args._;
if (!cmd || !proj) {
  console.log('usage: node scripts/review.mjs <prompt|list|resolve|reopen|add> <projet> ...');
  process.exit(1);
}
const dir = resolveProject(proj);
const versions = listVersions(dir);
const latest = versions[versions.length - 1]?.v ?? null;

if (cmd === 'prompt') {
  console.log(buildPrompt(dir, { includeResolved: !!args.all }));
} else if (cmd === 'list') {
  const items = readFeedback(dir).items.filter((x) => args.all || x.status !== 'resolved');
  if (!items.length) console.log('Aucun retour ouvert.');
  for (const it of items) {
    console.log(`${it.status === 'resolved' ? '✓' : '○'} ${it.id}  ${it.kind.padEnd(7)} ${fmtTime(it.at)}${it.end != null ? '→' + fmtTime(it.end) : ''}  v${it.version ?? '?'}  ${it.text || it.quote}`);
    if (it.response) console.log(`    ✦ ${it.response}`);
  }
} else if (cmd === 'resolve') {
  const [id, ...resp] = rest;
  const it = updateItem(dir, id, { status: 'resolved', response: resp.join(' ') || args.response || '', resolvedIn: args.in ? Number(args.in) : latest != null ? latest + 1 : 1 });
  console.log(`✓ ${it.id} résolu${it.response ? ` — ✦ ${it.response}` : ''}`);
} else if (cmd === 'reopen') {
  const it = updateItem(dir, rest[0], { status: 'open' });
  console.log(`○ ${it.id} rouvert`);
} else if (cmd === 'add') {
  const it = addItem(dir, { kind: args.kind || 'comment', at: Number(args.at || 0), end: args.end != null ? Number(args.end) : null, text: rest.join(' '), version: latest, author: 'agent' });
  console.log(`+ ${it.id}`);
} else {
  console.error(`commande inconnue : ${cmd}`);
  process.exit(1);
}
