import '../styles.css';

import { clearPersistedDatabase, deleteKey, openDatabase, persistDatabase, readJson, writeJson } from './db';
import { makeDefaultState, makeId, normalizeProjects, normalizeState, parseTags } from './domain/state';
import type { ActiveTimer, AppState, Filters, TimeEntry } from './types';

const APP_STATE_KEY = 'app.state';

const els = {
  form: getEl<HTMLFormElement>('timerForm'),
  descriptionInput: getEl<HTMLInputElement>('descriptionInput'),
  projectSelect: getEl<HTMLSelectElement>('projectSelect'),
  newProjectInput: getEl<HTMLInputElement>('newProjectInput'),
  addProjectBtn: getEl<HTMLButtonElement>('addProjectBtn'),
  tagsInput: getEl<HTMLInputElement>('tagsInput'),
  billableInput: getEl<HTMLInputElement>('billableInput'),
  startBtn: getEl<HTMLButtonElement>('startBtn'),
  pauseBtn: getEl<HTMLButtonElement>('pauseBtn'),
  resumeBtn: getEl<HTMLButtonElement>('resumeBtn'),
  stopBtn: getEl<HTMLButtonElement>('stopBtn'),
  elapsedDisplay: getEl<HTMLDivElement>('elapsedDisplay'),
  timerStatus: getEl<HTMLSpanElement>('timerStatus'),
  timerMeta: getEl<HTMLParagraphElement>('timerMeta'),
  todayTotal: getEl<HTMLElement>('todayTotal'),
  weekTotal: getEl<HTMLElement>('weekTotal'),
  runningCount: getEl<HTMLElement>('runningCount'),
  entryCount: getEl<HTMLElement>('entryCount'),
  projectChips: getEl<HTMLDivElement>('projectChips'),
  entriesBody: getEl<HTMLTableSectionElement>('entriesBody'),
  searchInput: getEl<HTMLInputElement>('searchInput'),
  filterProjectSelect: getEl<HTMLSelectElement>('filterProjectSelect'),
  clearDataBtn: getEl<HTMLButtonElement>('clearDataBtn'),
  exportCsvBtn: getEl<HTMLButtonElement>('exportCsvBtn')
};

let db: Awaited<ReturnType<typeof openDatabase>>;
let state: AppState = makeDefaultState();
let tickHandle: number | null = null;

void boot().catch(error => {
  console.error('Failed to boot app:', error);
});

function getEl<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) {
    throw new Error(`Missing element: ${id}`);
  }
  return node as T;
}

function getCurrentFormData() {
  return {
    description: els.descriptionInput.value.trim() || '未命名任务',
    project: els.projectSelect.value || 'Inbox',
    tags: parseTags(els.tagsInput.value),
    billable: els.billableInput.checked
  };
}

function persistState(): void {
  writeJson(db, APP_STATE_KEY, state);
  persistDatabase(db);
}

function loadState(): AppState {
  const raw = readJson<unknown>(db, APP_STATE_KEY);
  return normalizeState(raw);
}

function pushFormDataToActive(): void {
  if (!state.active) return;
  const data = getCurrentFormData();
  state.active.description = data.description;
  state.active.project = data.project;
  state.active.tags = data.tags;
  state.active.billable = data.billable;
  persistState();
}

function createActiveTimer(): void {
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
  persistState();
  ensureTick();
  render();
}

function getSegmentStartedAt(active: ActiveTimer): number {
  return active.segmentStartedAt ?? active.startedAt;
}

function pauseActiveTimer(): void {
  if (!state.active || !state.active.running) return;
  const now = Date.now();
  state.active.elapsedMs += now - getSegmentStartedAt(state.active);
  state.active.segmentStartedAt = null;
  state.active.running = false;
  persistState();
  render();
}

function resumeActiveTimer(): void {
  if (!state.active || state.active.running) return;
  state.active.segmentStartedAt = Date.now();
  state.active.running = true;
  persistState();
  ensureTick();
  render();
}

function stopActiveTimer(): void {
  if (!state.active) return;
  pushFormDataToActive();
  const now = Date.now();
  const elapsed = state.active.running
    ? state.active.elapsedMs + (now - getSegmentStartedAt(state.active))
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
  persistState();
  render();
}

function addProject(name: string): void {
  const clean = String(name || '').trim();
  if (!clean) return;
  state.projects = normalizeProjects([...state.projects, clean], state.entries, state.active, state.filters.project);
  els.projectSelect.value = clean;
  persistState();
  render();
}

function deleteEntry(id: string): void {
  state.entries = state.entries.filter(entry => entry.id !== id);
  persistState();
  render();
}

function clearData(): void {
  const ok = confirm('确定清空所有项目、计时和记录吗？');
  if (!ok) return;
  clearPersistedDatabase();
  deleteKey(db, APP_STATE_KEY);
  state = makeDefaultState();
  persistState();
  syncFormFromState();
  render();
}

function exportCsv(): void {
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
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return [hours, minutes, seconds]
    .map((value, index) => (index === 0 ? String(value) : String(value).padStart(2, '0')))
    .join(':');
}

function formatShortDateTime(ts: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(ts)).replace(',', '');
}

function formatClock(ts: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(ts));
}

function dayStart(date = new Date()): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function weekStart(date = new Date()): Date {
  const result = dayStart(date);
  const day = result.getDay();
  const diff = (day + 6) % 7;
  result.setDate(result.getDate() - diff);
  return result;
}

function rangeOverlap(startA: number, endA: number, startB: number, endB: number): number {
  const start = Math.max(startA, startB);
  const end = Math.min(endA, endB);
  return Math.max(0, end - start);
}

function sumDuration(entries: Array<Pick<TimeEntry, 'startedAt' | 'endedAt'>>, start: number, end: number): number {
  return entries.reduce((total, entry) => total + rangeOverlap(entry.startedAt, entry.endedAt, start, end), 0);
}

function getCurrentElapsed(): number {
  if (!state.active) return 0;
  return state.active.running
    ? state.active.elapsedMs + (Date.now() - getSegmentStartedAt(state.active))
    : state.active.elapsedMs;
}

function currentActiveAsPseudoEntry(): Array<Pick<TimeEntry, 'startedAt' | 'endedAt'>> {
  if (!state.active) return [];
  return [{ startedAt: state.active.startedAt, endedAt: Date.now() }];
}

function getFilteredEntries(): TimeEntry[] {
  const query = state.filters.query.toLowerCase();
  const project = state.filters.project;
  return state.entries.filter(entry => {
    const matchesProject = project === 'all' || entry.project === project;
    const text = `${entry.description} ${entry.project} ${entry.tags.join(' ')}`.toLowerCase();
    const matchesQuery = !query || text.includes(query);
    return matchesProject && matchesQuery;
  });
}

function buildProjectSummary(): Array<{ project: string; durationMs: number }> {
  const summary = new Map<string, number>();
  state.entries.forEach(entry => {
    summary.set(entry.project, (summary.get(entry.project) || 0) + entry.durationMs);
  });
  return [...summary.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([project, durationMs]) => ({ project, durationMs }));
}

function renderProjects(): void {
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
      persistState();
      render();
    });
    els.projectChips.appendChild(button);
  });
}

function renderEntries(): void {
  const entries = getFilteredEntries();
  els.entriesBody.innerHTML = '';

  if (!entries.length) {
    const template = document.getElementById('emptyTemplate') as HTMLTemplateElement | null;
    if (template) {
      els.entriesBody.appendChild(template.content.cloneNode(true));
    }
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
    button.addEventListener('click', () => {
      const id = (button as HTMLButtonElement).dataset.delete;
      if (id) deleteEntry(id);
    });
  });
}

function renderTags(tags: string[], billable: boolean): string {
  const pieces: string[] = [];
  if (billable) pieces.push('<span class="badge billable">计费</span>');
  tags.forEach(tag => {
    pieces.push(`<span class="badge">#${escapeHtml(tag)}</span>`);
  });
  return pieces.length ? pieces.join(' ') : '<span class="entry-sub">无标签</span>';
}

function syncFormFromState(): void {
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

function renderTimer(): void {
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

function renderStats(): void {
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

function render(): void {
  renderProjects();
  renderTimer();
  renderStats();
  renderEntries();
}

function ensureTick(): void {
  if (tickHandle !== null) return;
  tickHandle = window.setInterval(() => {
    if (state.active?.running) {
      renderTimer();
      renderStats();
    }
  }, 1000);
}

function escapeHtml(value: string): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function bindEvents(): void {
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
    persistState();
    renderEntries();
  });

  els.filterProjectSelect.addEventListener('change', () => {
    state.filters.project = els.filterProjectSelect.value;
    persistState();
    render();
  });

  els.descriptionInput.addEventListener('input', pushFormDataToActive);
  els.projectSelect.addEventListener('change', pushFormDataToActive);
  els.tagsInput.addEventListener('input', pushFormDataToActive);
  els.billableInput.addEventListener('change', pushFormDataToActive);

  els.clearDataBtn.addEventListener('click', clearData);
  els.exportCsvBtn.addEventListener('click', exportCsv);

  window.addEventListener('keydown', event => {
    const target = event.target as HTMLElement | null;
    if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;
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
}

async function boot(): Promise<void> {
  db = await openDatabase();
  state = loadState();
  persistState();
  bindEvents();
  syncFormFromState();
  render();
  ensureTick();
}
