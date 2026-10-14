// Feedback du studio : stockage local (reviews/feedback.json) + génération du prompt pour l'agent.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readFeedback, writeFeedback, listVersions, readProject, ROOT } from './project.mjs';
import { fmtTime } from '../timeline.js';

export const newId = () => 'fb_' + crypto.randomBytes(3).toString('hex');

export function addItem(dir, item) {
  const fb = readFeedback(dir);
  const it = {
    id: newId(),
    kind: item.kind || 'comment',
    version: item.version ?? null,
    at: item.at ?? 0,
    end: item.end ?? null,
    srcAt: item.srcAt ?? null,
    srcEnd: item.srcEnd ?? null,
    quote: item.quote || '',
    text: item.text || '',
    attachments: item.attachments || [],
    status: 'open',
    createdAt: new Date().toISOString(),
    author: item.author || 'user',
  };
  fb.items.push(it);
  writeFeedback(dir, fb);
  return it;
}

export function updateItem(dir, id, patch) {
  const fb = readFeedback(dir);
  const it = fb.items.find((x) => x.id === id || x.id === `fb_${id}`);
  if (!it) throw new Error(`Feedback ${id} introuvable`);
  for (const k of ['text', 'status', 'response', 'resolvedIn', 'at', 'end', 'quote', 'kind', 'attachments']) if (k in patch) it[k] = patch[k];
  if (patch.status === 'resolved' && !it.resolvedAt) it.resolvedAt = new Date().toISOString();
  if (patch.status === 'open') { delete it.resolvedAt; }
  writeFeedback(dir, fb);
  return it;
}

export function deleteItem(dir, id) {
  const fb = readFeedback(dir);
  fb.items = fb.items.filter((x) => x.id !== id);
  writeFeedback(dir, fb);
}

export function saveAttachment(dir, dataUrl, name) {
  const m = /^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(dataUrl);
  if (!m) throw new Error('dataUrl image attendu');
  const rel = `reviews/attachments/${name || newId()}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
  fs.mkdirSync(path.join(dir, 'reviews/attachments'), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), Buffer.from(m[2], 'base64'));
  return rel;
}

const KIND_LABEL = { comment: 'Commentaire', cut: 'Cut', idea: 'Idées' };

export function buildPrompt(dir, { version, includeResolved = false } = {}) {
  const project = readProject(dir);
  const versions = listVersions(dir);
  const v = version ?? versions[versions.length - 1]?.v;
  const rel = (p) => path.relative(process.cwd(), path.join(dir, p)) || '.';
  const relDir = path.relative(ROOT, dir);
  const items = readFeedback(dir).items.filter((x) => includeResolved || x.status !== 'resolved');
  const lines = [];
  lines.push(`# Feedback studio — ${project.name}${v ? ` (v${v})` : ''}`);
  lines.push('');
  lines.push(`Projet : \`${relDir}\` · Spec : \`${relDir}/source/spec.js\`${v ? ` · Vidéo revue : \`${relDir}/output/v${v}.mp4\`` : ''}`);
  lines.push('');
  if (!items.length) {
    lines.push('Aucun feedback ouvert.');
    return lines.join('\n');
  }
  lines.push(`Utilise le skill short-editing. Applique chacun des ${items.length} retours ci-dessous, puis :`);
  lines.push(`1. re-rends : \`node engine/render.mjs ${relDir}\` et vérifie la planche contact dans \`${relDir}/screenshots/\``);
  lines.push(`2. pour chaque retour traité : \`node scripts/review.mjs resolve ${relDir} <id> "<ce que tu as changé, 1-2 phrases>"\``);
  lines.push(`3. si un retour exprime une préférence durable (style, rythme, typo, animations) → mets à jour \`.claude/skills/short-editing/style.md\` et/ou \`style.json\``);
  lines.push('');
  lines.push('Les temps "@" sont ceux de la version revue ; les temps "source" sont dans le rush (stables entre versions, utiles pour les cuts).');
  items.forEach((it, i) => {
    lines.push('');
    const ver = it.version ? ` (v${it.version})` : '';
    if (it.kind === 'cut') {
      lines.push(`## ${i + 1}. ✂️ Cut @ ${fmtTime(it.at)} → ${fmtTime(it.end ?? it.at)}${ver} — id \`${it.id}\``);
    } else {
      lines.push(`## ${i + 1}. ${KIND_LABEL[it.kind] || it.kind} @ ${fmtTime(it.at)}${it.end != null ? ` → ${fmtTime(it.end)}` : ''}${ver} — id \`${it.id}\``);
    }
    if (it.quote) lines.push(`> « ${it.quote} »${it.srcAt != null ? `  (source ${fmtTime(it.srcAt)}${it.srcEnd != null ? `–${fmtTime(it.srcEnd)}` : ''})` : ''}`);
    else if (it.srcAt != null) lines.push(`(source ${fmtTime(it.srcAt)})`);
    if (it.kind === 'cut') lines.push(it.text ? `Supprimer ce passage. ${it.text}` : 'Supprimer ce passage du montage (retirer ces temps source des cuts).');
    else if (it.kind === 'idea') lines.push(it.text ? `Propose des idées : ${it.text}` : 'Propose 3 idées de motion design plus fortes pour ce passage, implémente la meilleure et décris les autres dans ta réponse.');
    else if (it.text) lines.push(it.text);
    if (it.attachments?.length) lines.push(`Pièces jointes (frame annotée, regarde-la) : ${it.attachments.map((a) => `\`${relDir}/${a}\``).join(', ')}`);
    if (it.status === 'resolved' && it.response) lines.push(`✦ déjà traité : ${it.response}`);
  });
  void rel;
  return lines.join('\n');
}

// ---- Envoi direct à l'agent (bouton "Envoyer à Claude") ----
// reviews/requests.json : file des envois du studio. cache/agent.json : présence + état de l'agent (heartbeat).
const requestsFile = (dir) => path.join(dir, 'reviews/requests.json');
const agentFile = (dir) => path.join(dir, 'cache/agent.json');

export function readRequests(dir) {
  try { return JSON.parse(fs.readFileSync(requestsFile(dir), 'utf8')); } catch { return { requests: [] }; }
}

function writeRequests(dir, data) {
  fs.mkdirSync(path.join(dir, 'reviews'), { recursive: true });
  fs.writeFileSync(requestsFile(dir), JSON.stringify(data, null, 2));
}

/** Crée une demande avec tous les retours ouverts. status : pending → working → done */
export function sendRequest(dir, { version } = {}) {
  const items = readFeedback(dir).items.filter((x) => x.status !== 'resolved').map((x) => x.id);
  if (!items.length) throw new Error('Aucun retour ouvert à envoyer');
  const data = readRequests(dir);
  const req = { id: 'rq_' + crypto.randomBytes(3).toString('hex'), version: version ?? null, items, status: 'pending', createdAt: new Date().toISOString() };
  data.requests.push(req);
  writeRequests(dir, data);
  return req;
}

export function updateRequest(dir, id, patch) {
  const data = readRequests(dir);
  const req = data.requests.find((r) => r.id === id);
  if (!req) throw new Error(`Demande ${id} introuvable`);
  Object.assign(req, patch, { updatedAt: new Date().toISOString() });
  writeRequests(dir, data);
  return req;
}

export function readAgent(dir) {
  let a = {};
  try { a = JSON.parse(fs.readFileSync(agentFile(dir), 'utf8')); } catch {}
  const online = !!a.beat && Date.now() - Date.parse(a.beat) < 30000;
  const reqs = readRequests(dir).requests;
  return { online, state: a.state || 'idle', message: a.message || '', pending: reqs.filter((r) => r.status === 'pending').length, last: reqs[reqs.length - 1] || null };
}

export function writeAgent(dir, patch) {
  let a = {};
  try { a = JSON.parse(fs.readFileSync(agentFile(dir), 'utf8')); } catch {}
  fs.mkdirSync(path.dirname(agentFile(dir)), { recursive: true });
  fs.writeFileSync(agentFile(dir), JSON.stringify({ ...a, ...patch }, null, 2));
}
