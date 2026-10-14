#!/usr/bin/env node
// Studio de review : lecteur vidéo + transcription + feedback (commentaires, cuts, dessins)
// + "Envoyer à Claude" : les retours partent directement à l'agent qui écoute (scripts/review.mjs watch).
// "Copy prompt" reste disponible dans le menu ⋯ en secours.
//
//   node studio/server.mjs projects/demo [--port 4400] [--open]
//
// Tout est stocké en local dans le projet (reviews/feedback.json, reviews/attachments/).
import fs from 'node:fs';
import path from 'node:path';
import { spawn, exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer, listen, json, readJSON, sendFile } from '../engine/lib/server.mjs';
import { resolveProject, readProject, listVersions, readFeedback, parseArgs, ENGINE_DIR, SKILL_DIR, ROOT } from '../engine/lib/project.mjs';
import { addItem, updateItem, deleteItem, saveAttachment, buildPrompt, sendRequest, readAgent } from '../engine/lib/feedback.mjs';
import { buildAudio } from '../engine/audio.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export async function startStudio(projectArg, { port = 4400, open = false } = {}) {
  const dir = resolveProject(projectArg);
  fs.mkdirSync(path.join(dir, 'reviews/attachments'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'output'), { recursive: true });

  // ---- Server-Sent Events : nouveaux rendus, feedback modifié par l'agent, spec modifiée ----
  const clients = new Set();
  const emit = (type, data = {}) => {
    const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const c of clients) c.write(msg);
  };
  const debounce = (fn, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const watchers = [];
  const watch = (p, fn) => { try { watchers.push(fs.watch(p, { persistent: false }, fn)); } catch {} };
  let lastVersions = listVersions(dir).map((v) => v.v).join(',');
  watch(path.join(dir, 'output'), debounce(() => {
    const vs = listVersions(dir);
    const key = vs.map((v) => v.v).join(',');
    // on attend que les métadonnées soient écrites (fin du rendu)
    const last = vs[vs.length - 1];
    if (key !== lastVersions && last?.renderedAt) {
      lastVersions = key;
      emit('render', { version: last.v });
    }
  }, 600));
  watch(path.join(dir, 'reviews'), debounce(() => emit('feedback'), 200));
  watch(path.join(dir, 'source'), debounce(() => emit('spec'), 200));

  let renderProc = null;

  const api = [
    ['GET', /^\/api\/project$/, (req, res) => {
      const project = readProject(dir);
      json(res, {
        name: project.name,
        format: project.format || '9:16',
        dir: path.relative(ROOT, dir),
        versions: listVersions(dir),
        hasSpec: fs.existsSync(path.join(dir, 'source/spec.js')),
        rendering: !!renderProc,
      });
    }],
    ['GET', /^\/api\/feedback$/, (req, res) => json(res, readFeedback(dir))],
    ['POST', /^\/api\/feedback$/, async (req, res) => {
      const body = await readJSON(req);
      const attachments = [];
      for (const a of body.attachments || []) attachments.push(a.startsWith('data:') ? saveAttachment(dir, a) : a);
      json(res, addItem(dir, { ...body, attachments }));
    }],
    ['PATCH', /^\/api\/feedback\/([\w-]+)$/, async (req, res, m) => json(res, updateItem(dir, m[1], await readJSON(req)))],
    ['DELETE', /^\/api\/feedback\/([\w-]+)$/, (req, res, m) => { deleteItem(dir, m[1]); json(res, { ok: true }); }],
    ['GET', /^\/api\/prompt$/, (req, res, m, url) => {
      const v = url.searchParams.get('v');
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(buildPrompt(dir, { version: v ? Number(v) : undefined }));
    }],
    // envoi direct à l'agent : crée une demande dans reviews/requests.json
    ['POST', /^\/api\/send$/, async (req, res) => {
      const body = await readJSON(req);
      try { json(res, sendRequest(dir, { version: body.version })); } catch (e) { json(res, { error: e.message }, 400); }
    }],
    ['GET', /^\/api\/agent$/, (req, res) => json(res, readAgent(dir))],
    ['GET', /^\/api\/events$/, (req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write('event: hello\ndata: {}\n\n');
      clients.add(res);
      const ka = setInterval(() => res.write(': ka\n\n'), 20000);
      req.on('close', () => { clients.delete(res); clearInterval(ka); });
    }],
    // relance un rendu depuis le studio
    ['POST', /^\/api\/render$/, async (req, res) => {
      const body = await readJSON(req);
      if (renderProc) return json(res, { error: 'Rendu déjà en cours' }, 409);
      const args = [path.join(ENGINE_DIR, 'render.mjs'), dir];
      if (body.draft) args.push('--draft');
      renderProc = spawn(process.execPath, args, { cwd: ROOT, env: process.env });
      emit('render-start', { draft: !!body.draft });
      const onData = (d) => {
        const s = d.toString();
        const m = /rendu (\d+)%/.exec(s.split('\r').pop());
        if (m) emit('render-progress', { pct: Number(m[1]) });
        if (/✗|Error/.test(s)) emit('render-log', { line: s.trim().slice(-400) });
      };
      renderProc.stdout.on('data', onData);
      renderProc.stderr.on('data', (d) => { if (!/dbus|pid=/.test(d)) onData(d); });
      renderProc.on('close', (code) => { renderProc = null; emit('render-end', { code }); });
      json(res, { ok: true });
    }],
    // audio du montage pour la preview live (sans rendu vidéo)
    ['POST', /^\/api\/build-audio$/, async (req, res) => {
      const info = await readJSON(req);
      const out = path.join(dir, 'cache/preview-audio.m4a');
      const voice = path.join(dir, 'cache', `${info.source || 'main'}.wav`);
      await buildAudio(dir, { ...info, audio: { loudnorm: false } }, fs.existsSync(voice) ? voice : null, out);
      json(res, { url: `/project/cache/preview-audio.m4a?t=${Date.now()}` });
    }],
  ];

  const server = createServer({
    mounts: { '/engine': ENGINE_DIR, '/project': dir, '/style': SKILL_DIR, '/studio': path.join(HERE, 'public') },
    routes: [
      ['GET', /^\/$/, (req, res) => sendFile(req, res, path.join(HERE, 'public/index.html'))],
      ['GET', /^\/preview$/, (req, res) => sendFile(req, res, path.join(ENGINE_DIR, 'preview.html'))],
      ...api,
    ],
  });
  let actual;
  try {
    actual = await listen(server, Number(port), '127.0.0.1');
  } catch {
    actual = await listen(server, 0, '127.0.0.1');
  }
  const url = `http://localhost:${actual}`;
  console.log(`🎬 Studio — ${readProject(dir).name}`);
  console.log(`   ${url}            review + feedback`);
  console.log(`   ${url}/preview    preview live de spec.js (sans rendu)`);
  if (open) exec(`${process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open'} ${url}`);
  return { server, url, close: () => { watchers.forEach((w) => w.close()); server.close(); } };
}

if (process.argv[1]?.endsWith('server.mjs')) {
  const args = parseArgs(process.argv.slice(2));
  if (!args._[0]) {
    console.log('usage: node studio/server.mjs <projet> [--port 4400] [--open]');
    process.exit(1);
  }
  startStudio(args._[0], { port: args.port || 4400, open: !!args.open }).catch((e) => {
    console.error('✗', e.message);
    process.exit(1);
  });
}
