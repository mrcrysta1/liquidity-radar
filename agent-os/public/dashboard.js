/* Agent OS Control Center dashboard — CR-P0-009 (CL-UI).
   Renders only the status data produced by the Agent Status Monitor (/api/state);
   no status is guessed in the browser. */
'use strict';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html !== undefined) n.textContent = html;
  return n;
};
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const STATUS_CLASS = { BUSY: 'busy', REST: 'rest', BLOCKED: 'blocked', UNKNOWN: 'unknown' };
const TASK_CLASS = (s) => {
  const u = String(s || '').toUpperCase();
  if (['BLOCKED', 'FAIL', 'FAILED', 'REOPENED'].includes(u)) return 'blocked';
  if (['COMPLETED', 'DONE'].includes(u)) return 'completed';
  if (['IN_PROGRESS', 'SELF_TESTING', 'SELF_VERIFICATION', 'REFACTORING', 'RETESTING', 'PASS', 'PR', 'PRODUCTION', 'PRODUCTION_TEST', 'FIXING'].includes(u)) return 'active';
  return 'pending';
};

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return esc(iso);
  return d.toLocaleString();
}
function timeAgo(iso) {
  if (!iso) return '—';
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return '—';
  const s = Math.max(0, Math.floor((Date.now() - d) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return s + 's ago';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  return h + 'h ' + (m % 60) + 'm ago';
}

function renderPills(agents) {
  const counts = { BUSY: 0, REST: 0, BLOCKED: 0, UNKNOWN: 0 };
  for (const a of agents) counts[a.status] = (counts[a.status] || 0) + 1;
  const host = $('os-status-pills');
  host.replaceChildren();
  for (const [k, v] of Object.entries(counts)) {
    const pill = el('span', 'os-pill os-pill--' + k.toLowerCase(), `${k} ${v}`);
    host.appendChild(pill);
  }
}

function renderAgents(agents) {
  const host = $('os-agents');
  host.replaceChildren();
  if (!agents || agents.length === 0) {
    host.appendChild(el('div', 'os-empty', 'No agent records available.'));
    return;
  }
  for (const a of agents) {
    const card = el('div', 'os-agent-card');
    const top = el('div', 'os-agent-top');

    const nameWrap = el('div');
    nameWrap.appendChild(el('div', 'os-agent-name', a.name));
    nameWrap.appendChild(el('div', 'os-agent-id', a.id + ' · ' + (a.role || '')));
    top.appendChild(nameWrap);

    const badge = el('span', 'os-status-badge ' + STATUS_CLASS[a.status] || 'unknown', a.status);
    top.appendChild(badge);

    const dot = el('span', 'os-session-dot' + (a.sessionOpen ? '' : ' closed'));
    dot.title = a.sessionOpen ? 'Agent launch window open' : 'No live session';
    top.appendChild(dot);
    card.appendChild(top);

    const rows = el('div', 'os-agent-rows');
    rows.appendChild(kv('task id', a.taskId || '—'));
    rows.appendChild(kv('task', a.taskName || '—'));
    if (a.registry) rows.appendChild(kv('registry', a.registry.status + (a.registry.pr ? ' · PR #' + a.registry.pr : '')));
    rows.appendChild(kv('started', timeAgo(a.startedAt)));
    rows.appendChild(kv('last activity', timeAgo(a.lastActivity)));
    card.appendChild(rows);

    const notes = [];
    if (a.note) notes.push(a.note);
    if (a.sourceWarnings && a.sourceWarnings.length) notes.push(...a.sourceWarnings);
    if (a.sourceErrors && a.sourceErrors.length) notes.push(...a.sourceErrors);
    if (notes.length) {
      const note = el('div', 'os-note', notes.join(' · '));
      note.style.color = a.sourceErrors && a.sourceErrors.length ? '' : undefined;
      note.className = a.sourceErrors && a.sourceErrors.length ? 'os-err-line' : 'os-note';
      card.appendChild(note);
    }
    host.appendChild(card);
  }
}

function kv(k, v) {
  const row = el('div');
  row.appendChild(el('span', 'os-k', k + ': '));
  row.appendChild(document.createTextNode(v));
  return row;
}

/* used in second chunk */
function toast(msg) {
  const t = $('os-toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(window.__osToastTimer);
  window.__osToastTimer = setTimeout(() => { t.hidden = true; }, 2200);
}
const group = (label, num) => {
  const c = el('div', 'os-stat-card');
  c.appendChild(el('div', 'os-stat-num', String(num)));
  c.appendChild(el('div', 'os-stat-label', label));
  return c;
};

function renderOverview(data) {
  const host = $('os-overview');
  host.replaceChildren();
  if (!data) { host.appendChild(el('div', 'os-empty', 'No project data available.')); return; }
  const s = data.overview?.stats || {};
  const ph = data.project?.phase;
  const latest = data.overview?.latestPr;
  const prod = data.overview?.production || {};

  host.appendChild(group('Active tasks', s.active || 0));
  host.appendChild(group('Completed', s.completed || 0));
  host.appendChild(group('Pending', s.pending || 0));
  host.appendChild(group('Reopened', s.reopened || 0));

  const phaseCard = el('div', 'os-stat-card os-overview-wide');
  phaseCard.appendChild(el('div', 'os-stat-num', ph ? 'Phase ' + ph.num : '—'));
  phaseCard.appendChild(el('div', 'os-stat-label', ph ? esc(ph.name) + ' · ' + ph.state : 'phase unknown'));
  host.appendChild(phaseCard);

  const prCard = el('div', 'os-stat-card os-overview-wide');
  prCard.appendChild(el('div', 'os-stat-num', latest ? '#' + latest.pr : '—'));
  prCard.appendChild(el('div', 'os-stat-label', latest ? esc(latest.id || '') + ' ' + (latest.status || '') : 'latest PR'));
  host.appendChild(prCard);

  const prodCard = el('div', 'os-stat-card os-overview-wide');
  prodCard.appendChild(el('div', 'os-stat-num', prod.deploying ? prod.deploying : prod.deployed ? prod.deployed : '—'));
  prodCard.appendChild(el('div', 'os-stat-label', 'production ' + (prod.deploying ? 'deploying' : prod.deployed ? 'deployed' : '—')));
  host.appendChild(prodCard);
}

function renderTasks(tasks) {
  const host = $('os-tasklist');
  const count = $('os-task-count');
  host.replaceChildren();
  const list = Array.isArray(tasks) ? tasks : [];
  count.textContent = String(list.length);
  if (list.length === 0) { host.appendChild(el('div', 'os-empty', 'No tasks in the registry.')); return; }
  for (const t of list) {
    const row = el('div', 'os-task');
    const id = el('div', 'os-task-id', t.id || '?');
    row.appendChild(id);
    const body = el('div', 'os-task-title');
    body.textContent = t.title || '—';
    const meta = el('div', 'os-task-agent', 'agent: ' + (t.agentName || t.agentId || '—') + (t.branch ? ' · ' + t.branch : ''));
    body.appendChild(meta);
    row.appendChild(body);
    const st = el('span', 'os-task-status ' + TASK_CLASS(t.status), t.status || 'UNKNOWN');
    row.appendChild(st);
    host.appendChild(row);
  }
}

function renderFooter(data) {
  const src = data.source || {};
  const git = data.git || {};
  $('os-updated').textContent = new Date().toLocaleTimeString();
  $('os-source').textContent = 'source: ' + (src.present ? 'agent-status/status.json' : (src.error || 'missing'));
  $('os-git').textContent = 'git: ' + (git.branch || '—') + (git.commit ? ' @ ' + git.commit : '') + (git.clean === false ? ' (dirty)' : '');
  const errHost = $('os-error');
  const problems = [
    ...(src.errors || []),
    ...(src.present === false ? ['status.json missing — agents shown as UNKNOWN (not guessed)'] : []),
  ];
  if (problems.length) {
    errHost.textContent = '⚠ ' + problems.join(' · ');
    errHost.hidden = false;
  } else {
    errHost.hidden = true;
  }
}
let AUTO_REFRESH_MS = 15000;

function applyOpacity(val) {
  const v = Number(val);
  document.documentElement.style.setProperty('--os-op', String((v || 92) / 100));
  localStorage?.setItem('os.opacity', String(v));
}

function setPanel(visible) {
  $('os-panel').hidden = !visible;
  $('os-compact').hidden = visible;
}

function updateCompactDots(data) {
  const dots = $('os-compact-dots');
  const map = { BUSY: '●', REST: '●', BLOCKED: '●', UNKNOWN: '○' };
  const colors = { BUSY: '#fdb27a', REST: '#7fd8a8', BLOCKED: '#ff9a9a', UNKNOWN: '#c3cbe0' };
  const frag = document.createDocumentFragment();
  (data?.agents || []).forEach((a) => {
    const s = document.createElement('span');
    s.textContent = map[a.status] || '○';
    s.style.color = colors[a.status] || '#c3cbe0';
    s.title = a.id + ' · ' + a.status;
    frag.appendChild(s);
    frag.appendChild(document.createTextNode(' '));
  });
  dots.replaceChildren(frag);
}

async function refresh() {
  const refreshBtn = $('os-refresh');
  refreshBtn.classList.add('os-active');
  try {
    const res = await fetch('/api/state', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const payload = await res.json();
    if (!payload || payload.ok !== true || !payload.data) throw new Error('malformed state');
    const data = payload.data;

    renderPills(data.agents);
    renderAgents(data.agents);
    renderOverview(data);
    renderTasks(data.taskRegistry?.tasks);
    renderFooter(data);
    updateCompactDots(data);
    $('os-updated').textContent = new Date().toLocaleTimeString();
  } catch (err) {
    const errHost = $('os-error');
    errHost.textContent = '⚠ refresh failed: ' + err.message;
    errHost.hidden = false;
    $('os-agents').replaceChildren(el('div', 'os-error-block', 'Could not reach /api/state — is the control center server running?'));
  } finally {
    refreshBtn.classList.remove('os-active');
  }
}

function startAuto() {
  clearInterval(window.__osAutoTimer);
  window.__osAutoTimer = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, AUTO_REFRESH_MS);
}

function setAuto(on) {
  $('os-auto-toggle').classList.toggle('os-active', on);
  localStorage?.setItem('os.auto', on ? '1' : '0');
  if (on) startAuto();
  else clearInterval(window.__osAutoTimer);
}

function wireControls() {
  $('os-refresh').addEventListener('click', () => refresh());

  $('os-auto-toggle').addEventListener('click', () => {
    const next = !$('os-auto-toggle').classList.contains('os-active');
    setAuto(next);
    toast(next ? 'Auto-refresh on (15s)' : 'Auto-refresh off');
  });

  $('os-pin-toggle').addEventListener('click', () => {
    const pinned = $('os-root').classList.toggle('pinned');
    localStorage?.setItem('os.pinned', pinned ? '1' : '0');
    if (window.opener && window.opener !== window) window.focus?.();
    toast(pinned ? 'Pinned on top (within browser desktop)' : 'Unpinned');
  });

  $('os-collapse').addEventListener('click', () => {
    setPanel(false);
    localStorage?.setItem('os.compact', '1');
    toast('Collapsed — click the bar to expand');
  });
  $('os-compact-expand').addEventListener('click', () => {
    setPanel(true);
    localStorage?.setItem('os.compact', '0');
  });
  $('os-compact-dots').addEventListener('click', () => {
    setPanel(true);
    localStorage?.setItem('os.compact', '0');
  });

  $('os-opacity').addEventListener('input', (e) => {
    applyOpacity(e.target.value);
  });
}

function init() {
  applyOpacity(localStorage?.getItem('os.opacity') || $('os-opacity').value);
  const savedAuto = localStorage?.getItem('os.auto') === '1';
  $('os-auto-toggle').classList.toggle('os-active', savedAuto);
  const pinned = localStorage?.getItem('os.pinned') === '1';
  if (pinned) $('os-root').classList.add('pinned');

  // desktop=1 (launched via START-DASHBOARD.bat) starts collapsed-ish compact by default? keep expanded for clarity.
  if (localStorage?.getItem('os.compact') === '1') setPanel(false);

  wireControls();
  refresh();
  setAuto(savedAuto);
}

if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', init);
else init();