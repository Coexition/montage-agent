#!/usr/bin/env node
// CLI de review pour l'agent : lire les retours du studio et y répondre.
//
//   node scripts/review.mjs prompt  <projet> [--all]        prompt markdown (= bouton "Copy prompt")
//   node scripts/review.mjs list    <projet> [--all]        liste courte
//   node scripts/review.mjs resolve <projet> <id> "réponse"  marque résolu + réponse affichée dans le studio (✦)
//   node scripts/review.mjs reopen  <projet> <id>
//   node scripts/review.mjs add     <projet> --at 12.3 "texte"   (ajout manuel)
//   node scripts/review.mjs watch   <projet>                 écoute le bouton "Envoyer à Claude" du studio :
//                                                           1 ligne "SEND <id> …" par envoi (à lancer avec Monitor)
//   node scripts/review.mjs status  <projet> <working|done|idle> ["message"] [--request <id>]
//                                                           état affiché dans le studio pendant le travail
import { resolveProject, readFeedback, listVersions, parseArgs } from '../engine/lib/project.mjs';
import { buildPrompt, updateItem, addItem, readRequests, updateRequest, writeAgent } from '../engine/lib/feedback.mjs';
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
} else if (cmd === 'watch') {
  // heartbeat (le studio affiche "Claude connecté") + une ligne par nouvel envoi, y compris ceux faits hors ligne
  const beat = () => writeAgent(dir, { beat: new Date().toISOString(), pid: process.pid });
  writeAgent(dir, { state: 'idle', message: '' });
  beat();
  setInterval(beat, 10000);
  const seen = new Set();
  const check = () => {
    for (const r of readRequests(dir).requests) {
      if (r.status !== 'pending' || seen.has(r.id)) continue;
      seen.add(r.id);
      updateRequest(dir, r.id, { status: 'received' });
      console.log(`SEND ${r.id} — ${r.items.length} retour(s) sur v${r.version ?? '?'} → node scripts/review.mjs prompt ${proj}`);
    }
  };
  check();
  setInterval(check, 1000);
  const bye = () => { writeAgent(dir, { beat: null, state: 'idle' }); process.exit(0); };
  process.on('SIGINT', bye);
  process.on('SIGTERM', bye);
} else if (cmd === 'status') {
  const [state, ...msg] = rest;
  writeAgent(dir, { state, message: msg.join(' ') });
  const reqs = readRequests(dir).requests;
  const rid = args.request || reqs.filter((r) => r.status !== 'done').pop()?.id;
  if (rid && (state === 'working' || state === 'done')) updateRequest(dir, rid, { status: state });
  console.log(`agent : ${state}${msg.length ? ' — ' + msg.join(' ') : ''}`);
} else {
  console.error(`commande inconnue : ${cmd}`);
  process.exit(1);
}
