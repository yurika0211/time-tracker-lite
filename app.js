const STORAGE_KEYS = {
  projects: 'ttl.projects',
  entries: 'ttl.entries',
  active: 'ttl.active',
  filters: 'ttl.filters'
};

const DEFAULT_PROJECTS = ['Inbox', '设计', '开发', '会议', '学习'];

const els = {
  form: document.getElementById('timerForm'),
  descriptionInput: document.getElementById('descriptionInput'),
  projectSelect: document.getElementById('projectSelect'),
  newProjectInput: document.getElementById('newProjectInput'),
  addProjectBtn: document.getElementById('addProjectBtn'),
  tagsInput: document.getElementById('tagsInput'),
  billableInput: document.getElementById('billableInput'),
  startBtn: document.getElementById('startBtn'),
  pauseBtn: document.getElementById('pauseBtn'),
  resumeBtn: document.getElementById('resumeBtn'),
  stopBtn: document.getElementById('stopBtn'),
  elapsedDisplay: document.getElementById('elapsedDisplay'),
  timerStatus: document.getElementById('timerStatus'),
  timerMeta: document.getElementById('timerMeta'),
  todayTotal: document.getElementById('todayTotal'),
  weekTotal: document.getElementById('weekTotal'),
  runningCount: document.getElementById('runningCount'),
  entryCount: document.getElementById('entryCount'),
  projectChips: document.getElementById('projectChips'),
  entriesBody: document.getElementById('entriesBody'),
  searchInput: document.getElementById('searchInput'),
  filterProjectSelect: document.getElementById('filterProjectSelect'),
  clearDataBtn: document.getElementById('clearDataBtn'),
  exportCsvBtn: document.getElementById('exportCsvBtn')
};

const state = {
  projects: loadJson(STORAGE_KEYS.projects, DEFAULT_PROJECTS),
  entries: loadJson(STORAGE_KEYS.entries, []),
  active: loadJson(STORAGE_KEYS.active, null),
  filters: loadJson(STORAGE_KEYS.filters, { query: '', project: 'all' })
};

state.projects = normalizeProjects(state.projects);
state.entries = normalizeEntries(state.entries);
state.active = normalizeActive(state.active);
state.filters = normalizeFilters(state.filters);

let tickHandle = null;

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return structuredClone(fallback);
    return JSON.parse(raw);
  } catch {
    return structuredClone(fallback);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEYS.projects, JSON.stringify(state.projects));
  localStorage.setItem(STORAGE_KEYS.entries, JSON.stringify(state.entries));
  localStorage.setItem(STORAGE_KEYS.active, JSON.stringify(state.active));
  localStorage.setItem(STORAGE_KEYS.filters, JSON.stringify(state.filters));
}

function normalizeProjects(projects) {
  const list = Array.isArray(projects) ? projects : [];
  const cleaned = list
    .map(item => String(item || '').trim())
    .filter(Boolean);
  return [...new Set([ ...DEFAULT_PROJECTS, ...cleaned ])];
}

function normalizeEntries(entries) {
  if (!Array.isArray(entries)) return [];
  return entries
    .map(entry => ({
      id: entry.id || makeId(),
      description: String(entry.description || '未命名任务').trim() || '未命名任务',
      project: String(entry.project || 'Inbox').trim() || 'Inbox',
      tags: Array.isArray(entry.tags)
        ? entry.tags.map(tag => String(tag).trim()).filter(Boolean)
        : parseTags(entry.tags),
      billable: Boolean(entry.billable),
      startedAt: toTimestamp(entry.startedAt),
      endedAt: toTimestamp(entry.endedAt),
      durationMs: Number(entry.durationMs) || 0
    }))
    .filter(entry => Number.isFinite(entry.startedAt) && Number.isFinite(entry.endedAt));
}

function normalizeActive(active) {
  if (!active) return null;
  const startedAt = toTimestamp(active.startedAt);
  const segmentStartedAt = toTimestamp(active.segmentStartedAt);
  const elapsedMs = Number(active.elapsedMs) || 0;
  return {
    id: active.id || makeId(),
    description: String(active.description || '未命名任务').trim() || '未命名任务',
    project: String(active.project || 'Inbox').trim() || 'Inbox',
    tags: Array.isArray(active.tags)
      ? active.tags.map(tag => String(tag).trim()).filter(Boolean)
      : parseTags(active.tags),
    billable: Boolean(active.billable),
    startedAt: Number.isFinite(startedAt) ? startedAt : Date.now(),
    segmentStartedAt: Number.isFinite(segmentStartedAt) ? segmentStartedAt : null,
    elapsedMs: Math.max(0, elapsedMs),
    running: Boolean(active.running)
  };
}

function normalizeFilters(filters) {
  const query = String(filters?.query || '').trim();
  const project = String(filters?.project || 'all').trim() || 'all';
  return { query, project };
}

function makeId() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toTimestamp(value) {
  if (value === null || value === undefined || value === '') return NaN;
  const ts = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(ts) ? ts : NaN;
}

function parseTags(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map(tag => String(tag).trim()).filter(Boolean);
  }
  return String(value)
    .split(/[，,]/)
    .map(tag => tag.trim())
    .filter(Boolean);
}

function getCurrentFormData() {
  return {
    description: els.descriptionInput.value.trim() || '未命名任务',
    project: els.projectSelect.value || 'Inbox',
    tags: parseTags(els.tagsInput.value),
    billable: els.billableInput.checked
  };
}

function pushFormDataToActive() {
  if (!state.active) return;
  const data = getCurrentFormData();
  state.active.description = data.description;
  state.active.project = data.project;
  state.active.tags = data.tags;
  state.active.billable = data.billable;
  saveState();
}

function createActiveTimer() {
  const data = getCurrentFormData();
  const now = Date.now();
  state.active = {
    id: makeId(),
    description: data.description,
    project: data.project,
    tags: data.tags,
    billable: data.billable,
    startedAt: now,
    segmentStartedAt: now,
    elapsedMs: 0,
    running: true
  };
  saveState();
  ensureTick();
  render();
}

function pauseActiveTimer() {
  if (!state.active || !state.active.running) return;
  const now = Date.now();
  state.active.elapsedMs += now - state.active.segmentStartedAt;
  state.active.segmentStartedAt = null;
  state.active.running = false;
  saveState();
  render();
}

function resumeActiveTimer() {
  if (!state.active || state.active.running) return;
  state.active.segmentStartedAt = Date.now();
  state.active.running = true;
  saveState();
  ensureTick();
  render();
}

function stopActiveTimer() {
  if (!state.active) return;
  pushFormDataToActive();
  const now = Date.now();
  const elapsed = state.active.running
    ? state.active.elapsedMs + (now - state.active.segmentStartedAt)
    : state.active.elapsedMs;

  state.entries.unshift({
    id: state.active.id,
    description: state.active.description,
    project: state.active.project,
    tags: state.active.tags,
    billable: state.active.billable,
    startedAt: state.active.startedAt,
    endedAt: now,
    durationMs: elapsed
  });

  state.active = null;
  saveState();
  render();
}

function addProject(name) {
  const clean = String(name || '').trim();
  if (!clean) return;
  if (!state.projects.includes(clean)) {
    state.projects.push(clean);
    state.projects.sort((a, b) => a.localeCompare(b, 'zh-CN'));
    saveState();
  }
  els.projectSelect.value = clean;
  els.filterProjectSelect.value = state.filters.project === 'all' ? 'all' : state.filters.project;
  render();
}

function deleteEntry(id) {
  state.entries = state.entries.filter(entry => entry.id !== id);
  saveState();
  render();
}

function clearData() {
  const ok = confirm('确定清空所有项目、计时和记录吗？');
  if (!ok) return;
  state.projects = [...DEFAULT_PROJECTS];
  state.entries = [];
  state.active = null;
  state.filters = { query: '', project: 'all' };
  localStorage.removeItem(STORAGE_KEYS.projects);
  localStorage.removeItem(STORAGE_KEYS.entries);
  localStorage.removeItem(STORAGE_KEYS.active);
  localStorage.removeItem(STORAGE_KEYS.filters);
  syncFormFromState();
  render();
}

function exportCsv() {
  const rows = [
    ['任务', '项目', '标签', '开始时间', '结束时间', '时长(秒)', '计费'],
    ...state.entries.map(entry => [
      entry.description,
      entry.project,
      entry.tags.join(' | '),
      new Date(entry.startedAt).toISOString(),
      new Date(entry.endedAt).toISOString(),
      Math.round(entry.durationMs / 1000),
      entry.billable ? '是' : '否'
    ])
  ];

  const csv = rows
    .map(row => row.map(cell => `"${String(cell).replaceAll('"', '""')}"`).join(','))
    .join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `time-tracker-lite-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return [hours, minutes, seconds]
    .map((value, index) => (index === 0 ? String(value) : String(value).padStart(2, '0')))
    .join(':');
}

function formatShortDateTime(ts) {
  const date = new Date(ts);
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date).replace(',', '');
}

function formatClock(ts) {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(ts));
}

function dayStart(date = new Date()) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function weekStart(date = new Date()) {
  const result = dayStart(date);
  const day = result.getDay();
  const diff = (day + 6) % 7;
  result.setDate(result.getDate() - diff);
  return result;
}

function rangeOverlap(startA, endA, startB, endB) {
  const start = Math.max(startA, startB);
  const end = Math.min(endA, endB);
  return Math.max(0, end - start);
}

function sumDuration(entries, start, end) {
  return entries.reduce((total, entry) => total + rangeOverlap(entry.startedAt, entry.endedAt, start, end), 0);
}

function getCurrentElapsed() {
  if (!state.active) return 0;
  return state.active.running
    ? state.active.elapsedMs + (Date.now() - state.active.segmentStartedAt)
    : state.active.elapsedMs;
}

function getFilteredEntries() {
  const query = state.filters.query.toLowerCase();
  const project = state.filters.project;
  return state.entries.filter(entry => {
    const matchesProject = project === 'all' || entry.project === project;
    const text = `${entry.description} ${entry.project} ${entry.tags.join(' ')}`.toLowerCase();
    const matchesQuery = !query || text.includes(query);
    return matchesProject && matchesQuery;
  });
}

function buildProjectSummary() {
  const summary = new Map();
  state.entries.forEach(entry => {
    summary.set(entry.project, (summary.get(entry.project) || 0) + entry.durationMs);
  });
  return [...summary.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([project, durationMs]) => ({ project, durationMs }));
}

function renderProjects() {
  els.projectSelect.innerHTML = '';
  els.filterProjectSelect.innerHTML = '';

  const filterAll = document.createElement('option');
  filterAll.value = 'all';
  filterAll.textContent = '全部项目';
  els.filterProjectSelect.appendChild(filterAll);

  state.projects.forEach(project => {
    const opt = document.createElement('option');
    opt.value = project;
    opt.textContent = project;
    els.projectSelect.appendChild(opt);

    const filterOpt = document.createElement('option');
    filterOpt.value = project;
    filterOpt.textContent = project;
    els.filterProjectSelect.appendChild(filterOpt);
  });

  els.projectSelect.value = state.active?.project || state.projects[0] || 'Inbox';
  els.filterProjectSelect.value = state.filters.project;

  const summary = buildProjectSummary();
  els.projectChips.innerHTML = '';

  if (!summary.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.style.padding = '18px 0 0';
    empty.style.textAlign = 'left';
    empty.innerHTML = '<p>暂无记录，创建第一条后这里会显示常用项目和累计时长。</p>';
    els.projectChips.appendChild(empty);
    return;
  }

  summary.slice(0, 8).forEach(item => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `project-chip${state.filters.project === item.project ? ' active' : ''}`;
    button.innerHTML = `<strong>${escapeHtml(item.project)}</strong><span>${formatDuration(item.durationMs)}</span>`;
    button.addEventListener('click', () => {
      state.filters.project = item.project;
      saveState();
      render();
    });
    els.projectChips.appendChild(button);
  });
}

function renderEntries() {
  const entries = getFilteredEntries();
  els.entriesBody.innerHTML = '';

  if (!entries.length) {
    const template = document.getElementById('emptyTemplate');
    els.entriesBody.appendChild(template.content.cloneNode(true));
    return;
  }

  entries.forEach(entry => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div class="entry-title">${escapeHtml(entry.description)}</div>
        <div class="entry-sub">${entry.billable ? '计费任务' : '非计费任务'}</div>
      </td>
      <td><span class="badge project">${escapeHtml(entry.project)}</span></td>
      <td>${renderTags(entry.tags, entry.billable)}</td>
      <td>
        <div class="entry-sub">${formatShortDateTime(entry.startedAt)} → ${formatShortDateTime(entry.endedAt)}</div>
        <div class="entry-sub">${formatClock(entry.startedAt)} - ${formatClock(entry.endedAt)}</div>
      </td>
      <td><strong>${formatDuration(entry.durationMs)}</strong></td>
      <td>
        <div class="row-actions">
          <button class="text-link" type="button" data-delete="${entry.id}">删除</button>
        </div>
      </td>
    `;
    els.entriesBody.appendChild(tr);
  });

  els.entriesBody.querySelectorAll('[data-delete]').forEach(button => {
    button.addEventListener('click', () => deleteEntry(button.dataset.delete));
  });
}

function renderTags(tags, billable) {
  const pieces = [];
  if (billable) pieces.push('<span class="badge billable">计费</span>');
  (tags || []).forEach(tag => {
    pieces.push(`<span class="badge">#${escapeHtml(tag)}</span>`);
  });
  return pieces.length ? pieces.join(' ') : '<span class="entry-sub">无标签</span>';
}

function syncFormFromState() {
  const active = state.active;
  els.descriptionInput.value = active?.description || '';
  els.tagsInput.value = active?.tags?.join(', ') || '';
  els.billableInput.checked = Boolean(active?.billable);
  if (active?.project && state.projects.includes(active.project)) {
    els.projectSelect.value = active.project;
  } else {
    els.projectSelect.value = state.projects[0] || 'Inbox';
  }
  els.searchInput.value = state.filters.query;
  els.filterProjectSelect.value = state.filters.project;
}

function renderTimer() {
  const active = state.active;
  const elapsed = getCurrentElapsed();
  els.elapsedDisplay.textContent = formatDuration(elapsed);

  els.startBtn.disabled = Boolean(active);
  els.pauseBtn.disabled = !active || !active.running;
  els.resumeBtn.disabled = !active || active.running;
  els.stopBtn.disabled = !active;

  if (!active) {
    els.timerStatus.className = 'status-pill';
    els.timerStatus.textContent = '未开始';
    els.timerMeta.textContent = '还没有开始任何计时。';
    return;
  }

  if (active.running) {
    els.timerStatus.className = 'status-pill running';
    els.timerStatus.textContent = '进行中';
  } else {
    els.timerStatus.className = 'status-pill paused';
    els.timerStatus.textContent = '已暂停';
  }

  const tagText = active.tags.length ? ` · ${active.tags.map(tag => `#${tag}`).join(' ')}` : '';
  const billableText = active.billable ? ' · 计费任务' : '';
  els.timerMeta.textContent = `${active.description} / ${active.project}${tagText}${billableText}`;
}

function renderStats() {
  const now = new Date();
  const today = dayStart(now).getTime();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  const week = weekStart(now).getTime();
  const nextWeek = new Date(week);
  nextWeek.setDate(nextWeek.getDate() + 7);

  const todayMs = sumDuration([...state.entries, ...currentActiveAsPseudoEntry()], today, tomorrow.getTime());
  const weekMs = sumDuration([...state.entries, ...currentActiveAsPseudoEntry()], week, nextWeek.getTime());

  els.todayTotal.textContent = formatDuration(todayMs);
  els.weekTotal.textContent = formatDuration(weekMs);
  els.runningCount.textContent = state.active ? '1' : '0';
  els.entryCount.textContent = String(state.entries.length);
}

function currentActiveAsPseudoEntry() {
  if (!state.active) return [];
  const now = Date.now();
  return [{
    startedAt: state.active.startedAt,
    endedAt: now,
    durationMs: getCurrentElapsed()
  }];
}

function render() {
  renderProjects();
  renderTimer();
  renderStats();
  renderEntries();
}

function ensureTick() {
  if (tickHandle) return;
  tickHandle = setInterval(() => {
    if (state.active?.running) {
      renderTimer();
      renderStats();
    }
  }, 1000);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

els.form.addEventListener('submit', event => {
  event.preventDefault();
  if (state.active) {
    pushFormDataToActive();
    render();
    return;
  }
  createActiveTimer();
});

els.pauseBtn.addEventListener('click', pauseActiveTimer);
els.resumeBtn.addEventListener('click', resumeActiveTimer);
els.stopBtn.addEventListener('click', stopActiveTimer);
els.addProjectBtn.addEventListener('click', () => addProject(els.newProjectInput.value));
els.newProjectInput.addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    event.preventDefault();
    addProject(els.newProjectInput.value);
    els.newProjectInput.value = '';
  }
});

els.searchInput.addEventListener('input', () => {
  state.filters.query = els.searchInput.value.trim();
  saveState();
  renderEntries();
});

els.filterProjectSelect.addEventListener('change', () => {
  state.filters.project = els.filterProjectSelect.value;
  saveState();
  render();
});

els.descriptionInput.addEventListener('input', pushFormDataToActive);
els.projectSelect.addEventListener('change', pushFormDataToActive);
els.tagsInput.addEventListener('input', pushFormDataToActive);
els.billableInput.addEventListener('change', pushFormDataToActive);

els.clearDataBtn.addEventListener('click', clearData);
els.exportCsvBtn.addEventListener('click', exportCsv);

window.addEventListener('keydown', event => {
  if (event.target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName)) return;
  if (event.code === 'Space') {
    event.preventDefault();
    if (!state.active) {
      createActiveTimer();
    } else if (state.active.running) {
      pauseActiveTimer();
    } else {
      resumeActiveTimer();
    }
  }
});

function boot() {
  syncFormFromState();
  render();
  ensureTick();
}

boot();
