// Studio de review — vanilla JS, aucune dépendance.
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const api = async (url, opts = {}) => {
  const r = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }, body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body });
  if (!r.ok) throw new Error(await r.text());
  const ct = r.headers.get('content-type') || '';
  return ct.includes('json') ? r.json() : r.text();
};
const fmt = (t) => {
  t = Math.max(0, t || 0);
  const m = Math.floor(t / 60);
  return `${String(m).padStart(2, '0')}:${(t - m * 60).toFixed(2).padStart(5, '0')}`;
};
const fmtShort = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const video = $('#video');
const S = {
  project: null,
  version: null, // objet version courante
  words: [],
  feedback: [],
  filter: 'open',
  kind: 'comment',
  at: null, // temps verrouillé (sinon temps courant)
  end: null,
  quote: '',
  selRange: null, // [i0, i1] indices de mots
  attachments: [], // dataURLs
  drawing: false,
  tool: 'arrow',
  color: '#ff3b30',
  shapes: [],
  speeds: [1, 1.25, 1.5, 2, 0.5],
};

// ---------------------------------------------------------------- chargement
async function loadProject(keepVersion = true) {
  S.project = await api('/api/project');
  $('#projName').textContent = S.project.name;
  document.title = `${S.project.name} — Studio`;
  const sel = $('#versionSel');
  const vs = S.project.versions;
  sel.innerHTML = vs.map((v) => `<option value="${v.v}">v${v.v}${v.draft ? ' (draft)' : ''}</option>`).reverse().join('');
  const want = keepVersion && S.version ? vs.find((v) => v.v === S.version.v) : null;
  await selectVersion(want || vs[vs.length - 1] || null);
}

async function selectVersion(v) {
  S.version = v;
  $('#emptyState').hidden = !!v;
  $('#versionSel').value = v ? v.v : '';
  if (!v) {
    video.removeAttribute('src');
    renderMeta();
    return;
  }
  const t = video.currentTime || 0;
  video.src = `/project/${v.file}?t=${encodeURIComponent(v.renderedAt || '')}`;
  if (v.poster) video.poster = `/project/${v.poster}`;
  video.currentTime = Math.min(t, v.duration || t);
  fitPlayer();
  S.words = v.words ? await api(`/project/${v.words}?t=${Date.now()}`) : [];
  renderMeta();
  renderTranscript();
  renderTimeline();
  renderList();
}

function renderMeta() {
  const v = S.version;
  const parts = [`Format ${S.project.format}`];
  if (v) {
    parts.push(fmtShort(v.duration));
    const d = new Date(v.renderedAt);
    parts.push(`Rendered <b>${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</b>`);
    if (v.renderSeconds) parts.push(`${v.renderSeconds}s de rendu`);
    parts.push(`Feedback v${v.v}`);
  }
  $('#projMeta').innerHTML = parts.join(' · ');
}

async function loadFeedback() {
  const fb = await api('/api/feedback');
  S.feedback = fb.items || [];
  renderList();
  renderTimeline();
  markTranscript();
}

// ---------------------------------------------------------------- temps & mapping inter-versions
// Un retour fait sur v2 est affiché au bon endroit dans v3 grâce au temps source (stable).
function srcAtOut(t) {
  if (!S.words.length) return null;
  let best = null;
  for (const w of S.words) {
    if (w.s <= t + 0.001) best = w;
    else break;
  }
  if (!best) return S.words[0].srcS;
  if (t <= best.e) return best.srcS + (t - best.s) * ((best.srcE - best.srcS) / Math.max(0.01, best.e - best.s));
  return best.srcE + (t - best.e);
}
function outAtSrc(src) {
  if (src == null || !S.words.length) return null;
  for (const w of S.words) if (w.srcE >= src - 0.02) return w.s + Math.max(0, Math.min(w.e - w.s, src - w.srcS));
  return null;
}
function itemTime(it) {
  if (!S.version || it.version === S.version.v || it.srcAt == null) return it.at;
  return outAtSrc(it.srcAt) ?? it.at;
}
function itemEnd(it) {
  if (it.end == null) return null;
  if (!S.version || it.version === S.version.v || it.srcEnd == null) return it.end;
  return outAtSrc(it.srcEnd) ?? it.end;
}

// ---------------------------------------------------------------- transcription
function renderTranscript() {
  const box = $('#transcript');
  if (!S.words.length) {
    box.innerHTML = `<span class="none">Pas de transcription pour cette version (words.json absent).</span>`;
    return;
  }
  box.innerHTML = S.words.map((w, i) => `<span class="w" data-i="${i}">${esc(w.w)}</span>`).join(' ');
  markTranscript();
}
function markTranscript() {
  const spans = $$('#transcript .w');
  if (!spans.length) return;
  spans.forEach((s) => s.classList.remove('fb', 'cutw'));
  for (const it of S.feedback) {
    if (it.status === 'resolved') continue;
    const a = itemTime(it);
    const b = itemEnd(it) ?? a + 0.01;
    S.words.forEach((w, i) => {
      if (w.e > a && w.s < b) spans[i].classList.add(it.kind === 'cut' ? 'cutw' : 'fb');
    });
  }
}
let lastCur = -1;
function updateTranscriptCursor(t) {
  const spans = $$('#transcript .w');
  if (!spans.length) return;
  let cur = -1;
  for (let i = 0; i < S.words.length; i++) if (S.words[i].s <= t) cur = i;
  if (cur === lastCur) return;
  lastCur = cur;
  spans.forEach((s, i) => {
    s.classList.toggle('past', i < cur);
    s.classList.toggle('cur', i === cur);
  });
  if (cur >= 0 && !video.paused) {
    const el = spans[cur];
    const box = $('#transcript');
    const top = el.offsetTop - box.offsetTop;
    if (top < box.scrollTop + 20 || top > box.scrollTop + box.clientHeight - 60) box.scrollTo({ top: top - 50, behavior: 'smooth' });
  }
}
let justSelected = false;
$('#transcript').addEventListener('mouseup', () => {
  const sel = window.getSelection();
  const spans = $$('#transcript .w');
  if (!sel || sel.isCollapsed) return;
  const idx = spans.filter((s) => sel.containsNode(s, true)).map((s) => Number(s.dataset.i));
  if (idx.length < 1) return;
  const i0 = Math.min(...idx);
  const i1 = Math.max(...idx);
  S.selRange = [i0, i1];
  S.quote = S.words.slice(i0, i1 + 1).map((w) => w.w).join(' ');
  S.at = S.words[i0].s;
  S.end = S.words[i1].e;
  spans.forEach((s, i) => s.classList.toggle('sel', i >= i0 && i <= i1));
  sel.removeAllRanges();
  justSelected = true;
  setTimeout(() => (justSelected = false), 50);
  updateComposer();
  $('#fbText').focus();
});
$('#transcript').addEventListener('click', (e) => {
  const w = e.target.closest('.w');
  if (!w || justSelected || window.getSelection()?.toString()) return;
  if (S.selRange) clearSelection();
  seek(S.words[Number(w.dataset.i)].s + 0.001);
});
function clearSelection() {
  S.selRange = null;
  S.quote = '';
  S.at = null;
  S.end = null;
  $$('#transcript .w.sel').forEach((s) => s.classList.remove('sel'));
  updateComposer();
}

// ---------------------------------------------------------------- timeline
function renderTimeline() {
  const dur = S.version?.duration || video.duration || 1;
  const ticks = [];
  const step = dur > 120 ? 10 : dur > 40 ? 5 : 1;
  for (let t = step; t < dur; t += step) ticks.push(`<span style="left:${(t / dur) * 100}%"></span>`);
  $('#tlTicks').innerHTML = ticks.join('');
  const markers = [];
  const ranges = [];
  for (const it of S.feedback) {
    const a = itemTime(it);
    if (a == null || a > dur) continue;
    if (it.kind === 'cut' && it.status !== 'resolved') {
      const b = itemEnd(it) ?? a + 0.5;
      ranges.push(`<span title="Cut ${fmt(a)} → ${fmt(b)}" style="left:${(a / dur) * 100}%;width:${((b - a) / dur) * 100}%"></span>`);
    } else markers.push(`<span class="${it.status === 'resolved' ? 'res' : ''} ${it.kind}" data-id="${it.id}" title="${esc(it.text || it.quote)}" style="left:${(a / dur) * 100}%"></span>`);
  }
  if (S.at != null && S.end != null) ranges.push(`<span class="sel" style="left:${(S.at / dur) * 100}%;width:${((S.end - S.at) / dur) * 100}%"></span>`);
  $('#tlMarkers').innerHTML = markers.join('');
  $('#tlRanges').innerHTML = ranges.join('');
}
function updateHead() {
  const dur = video.duration || S.version?.duration || 1;
  const pct = (video.currentTime / dur) * 100;
  $('#tlHead').style.left = pct + '%';
  $('#tlProgress').style.width = pct + '%';
  $('#tCur').textContent = fmt(video.currentTime);
  $('#tDur').textContent = fmt(dur);
  if (S.at == null) $('#atVal').textContent = fmt(video.currentTime);
  updateTranscriptCursor(video.currentTime);
}
(() => {
  const track = $('#tlTrack');
  let dragging = false;
  const go = (e) => {
    const r = track.getBoundingClientRect();
    const k = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    seek(k * (video.duration || S.version?.duration || 0));
  };
  track.addEventListener('pointerdown', (e) => {
    const m = e.target.closest('.tl-markers span');
    if (m) { focusItem(m.dataset.id); return; }
    dragging = true;
    track.setPointerCapture(e.pointerId);
    go(e);
  });
  track.addEventListener('pointermove', (e) => dragging && go(e));
  track.addEventListener('pointerup', () => (dragging = false));
})();

// lecteur ajusté (contain) dans la zone disponible, quel que soit le format
function fitPlayer() {
  const area = $('#playerArea');
  const pad = 20;
  const W = area.clientWidth - pad * 2;
  const H = area.clientHeight - pad - 6;
  const ar = S.version ? S.version.width / S.version.height : 9 / 16;
  let w = Math.min(W, H * ar);
  let h = w / ar;
  const p = $('#player');
  p.style.width = `${w}px`;
  p.style.height = `${h}px`;
  p.style.left = `${(area.clientWidth - w) / 2}px`;
  p.style.top = `${pad}px`;
}
new ResizeObserver(fitPlayer).observe($('#playerArea'));

// ---------------------------------------------------------------- lecture
function seek(t) {
  video.currentTime = Math.max(0, Math.min(t, (video.duration || 1e9) - 0.001));
  updateHead();
}
function togglePlay() {
  if (!S.version) return;
  if (S.drawing) setDrawing(false);
  video.paused ? video.play() : video.pause();
}
video.addEventListener('play', () => { document.body.classList.add('playing'); $('#playIcon').innerHTML = '<path fill="currentColor" d="M6 5h4v14H6zm8 0h4v14h-4z"/>'; });
video.addEventListener('pause', () => { document.body.classList.remove('playing'); $('#playIcon').innerHTML = '<path fill="currentColor" d="M8 5v14l11-7z"/>'; });
video.addEventListener('loadedmetadata', () => { updateHead(); renderTimeline(); });
video.addEventListener('timeupdate', updateHead);
video.addEventListener('seeked', updateHead);
(function loop() { if (!video.paused) updateHead(); requestAnimationFrame(loop); })();
$('#playBtn').onclick = togglePlay;
$('#bigPlay').onclick = togglePlay;
video.onclick = togglePlay;
$('#restartBtn').onclick = () => { seek(0); video.play(); };
$('#speedBtn').onclick = () => {
  const i = (S.speeds.indexOf(video.playbackRate) + 1) % S.speeds.length;
  video.playbackRate = S.speeds[i];
  $('#speedBtn').textContent = `${S.speeds[i]}×`;
};
$('#muteBtn').onclick = () => {
  video.muted = !video.muted;
  $('#muteBtn').style.opacity = video.muted ? 0.4 : 1;
};
$('#versionSel').onchange = (e) => selectVersion(S.project.versions.find((v) => v.v === Number(e.target.value)));
$('#versionsBtn').onclick = () => $('#versionSel').showPicker?.() ?? $('#versionSel').focus();

// ---------------------------------------------------------------- dessin
const dc = $('#draw');
const dctx = dc.getContext('2d');
function sizeDraw() {
  const r = dc.getBoundingClientRect();
  dc.width = Math.round(r.width * devicePixelRatio);
  dc.height = Math.round(r.height * devicePixelRatio);
  paintShapes();
}
new ResizeObserver(sizeDraw).observe(dc);
function drawShape(ctx, sh, W, H) {
  const lw = Math.max(3, W * 0.008);
  ctx.strokeStyle = sh.color;
  ctx.fillStyle = sh.color;
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const P = (p) => [p[0] * W, p[1] * H];
  if (sh.tool === 'dot') {
    const [x, y] = P(sh.a);
    ctx.beginPath(); ctx.arc(x, y, lw * 2.4, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = lw * 0.6; ctx.strokeStyle = '#000'; ctx.stroke();
  } else if (sh.tool === 'rect') {
    const [x1, y1] = P(sh.a); const [x2, y2] = P(sh.b);
    ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
  } else if (sh.tool === 'arrow') {
    const [x1, y1] = P(sh.a); const [x2, y2] = P(sh.b);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    const ang = Math.atan2(y2 - y1, x2 - x1); const hs = lw * 4.5;
    ctx.beginPath(); ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - hs * Math.cos(ang - 0.45), y2 - hs * Math.sin(ang - 0.45));
    ctx.lineTo(x2 - hs * Math.cos(ang + 0.45), y2 - hs * Math.sin(ang + 0.45));
    ctx.closePath(); ctx.fill();
  } else if (sh.tool === 'pen') {
    ctx.beginPath();
    sh.pts.forEach((p, i) => { const [x, y] = P(p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();
  }
}
function paintShapes() {
  dctx.clearRect(0, 0, dc.width, dc.height);
  for (const sh of S.shapes) drawShape(dctx, sh, dc.width, dc.height);
}
function setDrawing(on) {
  S.drawing = on;
  document.body.classList.toggle('drawing', on);
  $('#drawTools').hidden = !on;
  $('#drawBtn').classList.toggle('on', on);
  if (on) video.pause();
}
$('#drawBtn').onclick = () => setDrawing(!S.drawing);
$('#drawTools').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.tool) { S.tool = b.dataset.tool; $$('#drawTools [data-tool]').forEach((x) => x.classList.toggle('on', x === b)); }
  if (b.dataset.color) { S.color = b.dataset.color; $$('#drawTools [data-color]').forEach((x) => x.classList.toggle('on', x === b)); }
  if (b.dataset.act === 'undo') { S.shapes.pop(); paintShapes(); }
  if (b.dataset.act === 'clear') { S.shapes = []; paintShapes(); }
});
(() => {
  let cur = null;
  const pos = (e) => { const r = dc.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
  dc.addEventListener('pointerdown', (e) => {
    if (!S.drawing) return;
    dc.setPointerCapture(e.pointerId);
    const p = pos(e);
    cur = { tool: S.tool, color: S.color, a: p, b: p, pts: [p] };
    S.shapes.push(cur);
    paintShapes();
  });
  dc.addEventListener('pointermove', (e) => {
    if (!cur) return;
    const p = pos(e);
    cur.b = p;
    if (cur.tool === 'pen') cur.pts.push(p);
    paintShapes();
  });
  dc.addEventListener('pointerup', () => {
    if (cur && cur.tool !== 'dot' && cur.tool !== 'pen' && Math.hypot(cur.b[0] - cur.a[0], cur.b[1] - cur.a[1]) < 0.01) S.shapes.pop();
    cur = null;
    paintShapes();
    if (S.shapes.length) $('#fbText').focus();
  });
})();
// capture : frame vidéo courante + annotations, en résolution native
function captureAnnotated() {
  const W = video.videoWidth || 1080;
  const H = video.videoHeight || 1920;
  const c = document.createElement('canvas');
  const scale = Math.min(1, 1280 / Math.max(W, H));
  c.width = Math.round(W * scale);
  c.height = Math.round(H * scale);
  const x = c.getContext('2d');
  x.drawImage(video, 0, 0, c.width, c.height);
  for (const sh of S.shapes) drawShape(x, sh, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.88);
}

// ---------------------------------------------------------------- composer
function setKind(k) {
  S.kind = k;
  $$('#kindTabs button').forEach((b) => b.classList.toggle('on', b.dataset.k === k));
  if (k === 'cut' && S.end == null) {
    S.at = S.at ?? video.currentTime;
    S.end = Math.min((video.duration || 1e9), S.at + 1);
  }
  updateComposer();
}
$('#kindTabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setKind(b.dataset.k); });
function updateComposer() {
  const isCut = S.kind === 'cut' || S.end != null;
  $('#atLabel').textContent = isCut ? 'From' : 'At';
  $('#atVal').textContent = fmt(S.at ?? video.currentTime);
  $('#atChip').classList.toggle('locked', S.at != null);
  $('#toLabel').hidden = $('#toChip').hidden = !isCut || S.end == null;
  if (S.end != null) $('#toVal').textContent = fmt(S.end);
  $('#quotePill').hidden = !S.quote;
  $('#quotePill').textContent = S.quote ? `« ${S.quote} »` : '';
  $('#fbText').placeholder = S.kind === 'cut' ? 'Pourquoi couper ? (optionnel)' : 'Describe what you want to change…';
  $('#attachRow').innerHTML = S.attachments.map((a, i) => `<div class="att"><img src="${a}"><button data-i="${i}">✕</button></div>`).join('');
  renderTimeline();
}
$('#attachRow').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { S.attachments.splice(Number(b.dataset.i), 1); updateComposer(); } });
$('#atChip').onclick = () => { S.at = S.at == null ? video.currentTime : null; if (S.at == null) { S.end = null; S.quote = ''; } updateComposer(); };
$('#toChip').onclick = () => { S.end = Math.max(S.at ?? 0, video.currentTime); updateComposer(); };
$('#fileIn').onchange = async (e) => {
  for (const f of e.target.files) S.attachments.push(await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); }));
  e.target.value = '';
  updateComposer();
};
document.addEventListener('paste', async (e) => {
  for (const it of e.clipboardData?.items || []) {
    if (it.type.startsWith('image/')) {
      const f = it.getAsFile();
      S.attachments.push(await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); }));
      updateComposer();
    }
  }
});

async function addFeedback(kindOverride) {
  const kind = kindOverride || S.kind;
  const text = $('#fbText').value.trim();
  if (!S.version) return toast('Aucune version à commenter');
  if (kind === 'comment' && !text && !S.shapes.length && !S.attachments.length) { $('#fbText').focus(); return; }
  const at = S.at ?? video.currentTime;
  let end = S.end;
  if (kind === 'cut' && end == null) end = at + 1;
  const attachments = [...S.attachments];
  if (S.shapes.length) attachments.unshift(captureAnnotated());
  const quote = S.quote || nearbyQuote(at, end);
  $('#addBtn').disabled = true;
  try {
    const it = await api('/api/feedback', {
      method: 'POST',
      body: { kind, text, at, end, quote, version: S.version.v, srcAt: srcAtOut(at), srcEnd: end != null ? srcAtOut(end) : null, attachments },
    });
    S.feedback.push(it);
    $('#fbText').value = '';
    S.attachments = [];
    S.shapes = [];
    paintShapes();
    setDrawing(false);
    clearSelection();
    setKind('comment');
    if (S.filter === 'resolved') setFilter('open');
    renderList();
    focusItem(it.id, false);
    markTranscript();
  } catch (e) {
    toast('Erreur : ' + e.message);
  } finally {
    $('#addBtn').disabled = false;
  }
}
function nearbyQuote(a, b) {
  if (!S.words.length) return '';
  const end = b ?? a;
  const ws = S.words.filter((w) => w.e >= a - 0.6 && w.s <= end + 0.6);
  return ws.slice(0, 12).map((w) => w.w).join(' ');
}
$('#addBtn').onclick = () => addFeedback();
$('#ideasBtn').onclick = () => addFeedback('idea');
$('#fbText').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); addFeedback(); }
  if (e.key === 'Escape') e.target.blur();
});

// ---------------------------------------------------------------- liste de feedback
function setFilter(f) {
  S.filter = f;
  $$('#filterTabs button').forEach((b) => b.classList.toggle('on', b.dataset.f === f));
  renderList();
}
$('#filterTabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setFilter(b.dataset.f); });

function renderList() {
  const all = S.feedback;
  const open = all.filter((x) => x.status !== 'resolved');
  $('#cOpen').textContent = open.length;
  $('#cRes').textContent = all.length - open.length;
  $('#cAll').textContent = all.length;
  $('#openCount').textContent = open.length;
  $('#sendBtn').classList.toggle('zero', !open.length);
  const items = (S.filter === 'open' ? open : S.filter === 'resolved' ? all.filter((x) => x.status === 'resolved') : all)
    .slice()
    .sort((a, b) => (itemTime(a) ?? 0) - (itemTime(b) ?? 0));
  if (!items.length) {
    $('#fbList').innerHTML = `<div class="fb-empty">${S.filter === 'open' ? 'Aucun retour ouvert.<br>Sélectionne des mots, dessine sur la frame (P) ou appuie sur C.' : 'Rien ici.'}</div>`;
    return;
  }
  const icon = { comment: '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="none" stroke="currentColor" stroke-width="2" d="M4 5h16v11H9l-5 4z"/></svg>', cut: '✂', idea: '✧' };
  $('#fbList').innerHTML = items.map((it) => {
    const t = itemTime(it);
    const e = itemEnd(it);
    const label = it.kind === 'cut' ? 'Cut' : it.kind === 'idea' ? 'Ideas' : 'Comment';
    return `<div class="fb ${it.status === 'resolved' ? 'resolved' : ''}" data-id="${it.id}">
      <button class="check" data-act="toggle" title="${it.status === 'resolved' ? 'Rouvrir' : 'Marquer résolu'}">✓</button>
      <div class="fb-head">
        <span class="kind ${it.kind}">${icon[it.kind] || ''} ${label}</span>
        <button class="tchip" data-act="seek">${fmtShort(t)}${e != null ? `–${fmtShort(e)}` : ''}</button>
        ${it.version && S.version && it.version !== S.version.v ? `<span class="vtag">v${it.version}</span>` : ''}
      </div>
      ${it.quote ? `<div class="quote">"${esc(it.quote)}"</div>` : ''}
      ${it.text ? `<div class="text">${esc(it.text)}</div>` : ''}
      ${it.attachments?.length ? `<div class="atts">${it.attachments.map((a) => `<img src="/project/${esc(a)}" data-act="zoom">`).join('')}</div>` : ''}
      ${it.response ? `<div class="resp"><span>${esc(it.response)}</span></div>` : ''}
      <button class="del" data-act="del" title="Supprimer">🗑</button>
    </div>`;
  }).join('');
}
$('#fbList').addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  const row = e.target.closest('.fb');
  if (!el || !row) return;
  const it = S.feedback.find((x) => x.id === row.dataset.id);
  const act = el.dataset.act;
  if (act === 'seek') { seek(itemTime(it)); }
  if (act === 'toggle') {
    const status = it.status === 'resolved' ? 'open' : 'resolved';
    Object.assign(it, await api(`/api/feedback/${it.id}`, { method: 'PATCH', body: { status } }));
    renderList(); renderTimeline(); markTranscript();
  }
  if (act === 'del' && confirm('Supprimer ce retour ?')) {
    await api(`/api/feedback/${it.id}`, { method: 'DELETE' });
    S.feedback = S.feedback.filter((x) => x !== it);
    renderList(); renderTimeline(); markTranscript();
  }
  if (act === 'zoom') {
    const lb = document.createElement('div');
    lb.className = 'lightbox';
    lb.innerHTML = `<img src="${el.src}">`;
    lb.onclick = () => lb.remove();
    document.body.appendChild(lb);
  }
});
function focusItem(id, doSeek = true) {
  const it = S.feedback.find((x) => x.id === id);
  if (!it) return;
  if (doSeek) seek(itemTime(it));
  const row = $(`.fb[data-id="${id}"]`);
  if (row) { row.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); row.classList.remove('flash'); void row.offsetWidth; row.classList.add('flash'); }
}

// ---------------------------------------------------------------- prompt / menu
async function copyPrompt() {
  const txt = await api(`/api/prompt${S.version ? `?v=${S.version.v}` : ''}`);
  try {
    await navigator.clipboard.writeText(txt);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = txt; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }
  toast('Prompt copié — colle-le dans Claude Code');
}

// ---------------------------------------------------------------- envoi direct à Claude
async function sendToClaude() {
  // un commentaire tapé (ou un dessin) pas encore ajouté part avec l'envoi
  if ($('#fbText').value.trim() || S.shapes.length) await addFeedback();
  const open = S.feedback.filter((x) => x.status !== 'resolved');
  if (!open.length) return toast('Aucun retour à envoyer — ajoute un commentaire (C)');
  try {
    await api('/api/send', { method: 'POST', body: { version: S.version?.v ?? null } });
  } catch (err) { return toast(err.message); }
  const b = $('#sendBtn');
  b.classList.add('done');
  setTimeout(() => b.classList.remove('done'), 1500);
  const a = await pollAgent();
  toast(a?.online
    ? `Envoyé ✦ Claude prépare la version suivante (${open.length} retour${open.length > 1 ? 's' : ''})`
    : 'Envoyé — Claude n\'est pas connecté : il le traitera dès que tu lui dis « écoute le studio »', null, 5000);
}
$('#sendBtn').onclick = sendToClaude;

async function pollAgent() {
  let a;
  try { a = await api('/api/agent'); } catch { return null; }
  const chip = $('#agentChip');
  const working = a.online && (a.state === 'working' || a.pending > 0 || a.last?.status === 'received');
  chip.className = `agent-chip ${a.online ? 'online' : ''} ${working ? 'working' : ''}`;
  chip.querySelector('span').textContent = !a.online
    ? (a.pending ? `Claude hors ligne · ${a.pending} envoi en attente` : 'Claude hors ligne')
    : working ? (a.message || 'Claude travaille…') : 'Claude connecté';
  chip.title = a.online ? 'Claude écoute ce studio : « Envoyer à Claude » déclenche la version suivante' : 'Dis à Claude « écoute le studio » dans Claude Code';
  return a;
}
pollAgent();
setInterval(pollAgent, 3000);
$('#moreBtn').onclick = (e) => { e.stopPropagation(); $('#moreMenu').hidden = !$('#moreMenu').hidden; };
document.addEventListener('click', () => ($('#moreMenu').hidden = true));
$('#moreMenu').addEventListener('click', async (e) => {
  const act = e.target.closest('button')?.dataset.act;
  if (act === 'preview') window.open('/preview', '_blank');
  if (act === 'download' && S.version) { const a = document.createElement('a'); a.href = `/project/${S.version.file}`; a.download = `${S.project.name}-v${S.version.v}.mp4`; a.click(); }
  if (act === 'copy-prompt') copyPrompt();
  if (act === 'show-prompt') { $('#promptPre').textContent = await api(`/api/prompt${S.version ? `?v=${S.version.v}` : ''}`); $('#promptDlg').showModal(); }
  if (act === 'render' || act === 'render-draft') {
    try { await api('/api/render', { method: 'POST', body: { draft: act === 'render-draft' } }); toast('Rendu lancé…', null, 0); }
    catch (err) { toast(err.message); }
  }
});

// ---------------------------------------------------------------- toast
let toastTimer;
function toast(msg, action, ms = 2600) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>`;
  if (action) { const b = document.createElement('button'); b.textContent = action.label; b.onclick = () => { action.run(); t.hidden = true; }; t.appendChild(b); }
  t.hidden = false;
  clearTimeout(toastTimer);
  if (ms) toastTimer = setTimeout(() => (t.hidden = true), ms);
}

// ---------------------------------------------------------------- live (SSE)
const es = new EventSource('/api/events');
es.addEventListener('feedback', () => loadFeedback());
es.addEventListener('render', async (e) => {
  const { version } = JSON.parse(e.data);
  const busy = S.drawing || /^(TEXTAREA|INPUT)$/.test(document.activeElement?.tagName);
  if (busy) return toast(`Nouveau rendu v${version} disponible`, { label: 'Charger', run: async () => { S.version = null; await loadProject(false); } }, 0);
  S.version = null;
  await loadProject(false);
  toast(`✦ v${version} chargée`, null, 4000);
});
es.addEventListener('render-progress', (e) => toast(`Rendu… ${JSON.parse(e.data).pct}%`, null, 0));
es.addEventListener('render-end', (e) => { if (JSON.parse(e.data).code) toast('Le rendu a échoué (voir le terminal)'); });

// ---------------------------------------------------------------- clavier
document.addEventListener('keydown', (e) => {
  const typing = /^(TEXTAREA|INPUT|SELECT)$/.test(document.activeElement?.tagName);
  if (typing) return;
  if (e.metaKey || e.ctrlKey) {
    if (e.key === 'Enter') { sendToClaude(); e.preventDefault(); return; }
    if (e.key === 'z' && S.drawing) { S.shapes.pop(); paintShapes(); e.preventDefault(); }
    return;
  }
  const fps = S.version?.fps || 30;
  const k = e.key;
  if (k === ' ') { e.preventDefault(); togglePlay(); }
  else if (k === 'c' || k === 'C') { e.preventDefault(); if (S.at == null) S.at = video.currentTime; video.pause(); updateComposer(); $('#fbText').focus(); }
  else if (k === 'p' || k === 'P') setDrawing(!S.drawing);
  else if (k === 'x' || k === 'X') setKind(S.kind === 'cut' ? 'comment' : 'cut');
  else if (k === 'i' || k === 'I') { S.at = video.currentTime; if (S.end != null && S.end < S.at) S.end = null; updateComposer(); }
  else if (k === 'o' || k === 'O') { S.end = video.currentTime; if (S.at == null || S.at > S.end) S.at = Math.max(0, S.end - 1); updateComposer(); }
  else if (k === 'm' || k === 'M') $('#muteBtn').click();
  else if (k === 'ArrowLeft') seek(video.currentTime - (e.shiftKey ? 1 : 1 / fps));
  else if (k === 'ArrowRight') seek(video.currentTime + (e.shiftKey ? 1 : 1 / fps));
  else if (k === 'j' || k === 'J') seek(video.currentTime - 2);
  else if (k === 'l' || k === 'L') seek(video.currentTime + 2);
  else if (k === 'Escape') { if (S.drawing) setDrawing(false); clearSelection(); }
  else if (S.drawing && 'arfd'.includes(k)) $(`#drawTools [data-tool="${{ a: 'arrow', r: 'rect', f: 'pen', d: 'dot' }[k]}"]`).click();
});

// ---------------------------------------------------------------- go
await loadProject(false);
await loadFeedback();
updateComposer();
