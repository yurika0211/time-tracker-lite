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
  tagAutocomplete: getEl<HTMLDivElement>('tagAutocomplete'),
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
  exportCsvBtn: getEl<HTMLButtonElement>('exportCsvBtn'),
  // Tab elements
  tabs: document.querySelectorAll<HTMLButtonElement>('.tab'),
  viewTiming: getEl<HTMLElement>('viewTiming'),
  viewTags: getEl<HTMLElement>('viewTags'),
  viewReports: getEl<HTMLElement>('viewReports'),
  // Tag management
  tagList: getEl<HTMLDivElement>('tagList'),
  tagSearchInput: getEl<HTMLInputElement>('tagSearchInput'),
  tagTotalBadge: getEl<HTMLElement>('tagTotalBadge'),
  // Reports
  reportProjectSummary: getEl<HTMLDivElement>('reportProjectSummary'),
  reportDailyTrend: getEl<HTMLDivElement>('reportDailyTrend'),
  reportExportCsvBtn: getEl<HTMLButtonElement>('reportExportCsvBtn'),
  reportStartDate: getEl<HTMLInputElement>('reportStartDate'),
  reportEndDate: getEl<HTMLInputElement>('reportEndDate'),
  applyCustomRange: getEl<HTMLButtonElement>('applyCustomRange'),
  customRange: getEl<HTMLElement>('customRange'),
  rangeBtns: document.querySelectorAll<HTMLButtonElement>('.range-btn')
};

let db: Awaited<ReturnType<typeof openDatabase>>;
let state: AppState = makeDefaultState();
let tickHandle: number | null = null;
let currentView: 'timing' | 'tags' | 'reports' = 'timing';
let currentRange: 'today' | 'week' | 'month' | 'custom' = 'week';

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

  downloadCsv(rows, `time-tracker-lite-${new Date().toISOString().slice(0, 10)}.csv`);
}

function downloadCsv(rows: string[][], filename: string): void {
  const csv = rows
    .map(row => row.map(cell => `"${String(cell).replaceAll('"', '""')}"`).join(','))
    .join('\n');

  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
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

function monthStart(date = new Date()): Date {
  const result = dayStart(date);
  result.setDate(1);
  return result;
}

function getRangeBoundaries(range: string, customStart?: string, customEnd?: string): { start: number; end: number } {
  const now = new Date();
  let start: Date;
  let end: Date;

  switch (range) {
    case 'today':
      start = dayStart(now);
      end = new Date(now);
      end.setDate(end.getDate() + 1);
      end = dayStart(end);
      break;
    case 'month':
      start = monthStart(now);
      end = new Date(now);
      end.setMonth(end.getMonth() + 1);
      end.setDate(0);
      end = dayStart(end);
      end.setDate(end.getDate() + 1);
      break;
    case 'custom':
      start = customStart ? dayStart(new Date(customStart)) : weekStart(now);
      end = customEnd ? dayStart(new Date(customEnd)) : dayStart(now);
      end.setDate(end.getDate() + 1);
      break;
    case 'week':
    default:
      start = weekStart(now);
      end = new Date(start);
      end.setDate(end.getDate() + 7);
      break;
  }

  return { start: start.getTime(), end: end.getTime() };
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

// ========================================================================
//  Collect all tags across entries + active timer
// ========================================================================

function getAllTags(): Map<string, number> {
  const counts = new Map<string, number>();
  const seen = new Set<string>();

  state.entries.forEach(entry => {
    entry.tags.forEach(tag => {
      if (tag && !seen.has(`${entry.id}:${tag}`)) {
        seen.add(`${entry.id}:${tag}`);
        counts.set(tag, (counts.get(tag) || 0) + 1);
      }
    });
  });

  // Active timer tags also count if any exist
  if (state.active) {
    state.active.tags.forEach(tag => {
      if (tag) {
        counts.set(tag, (counts.get(tag) || 0) + 1);
      }
    });
  }

  return counts;
}

function getTagsForAutocomplete(): string[] {
  return [...getAllTags().keys()].sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

// ========================================================================
//  Tag management actions
// ========================================================================

function renameTag(oldName: string, newName: string): void {
  const clean = newName.trim();
  if (!clean || clean === oldName) return;

  state.entries.forEach(entry => {
    entry.tags = entry.tags.map(tag => (tag === oldName ? clean : tag));
  });

  if (state.active) {
    state.active.tags = state.active.tags.map(tag => (tag === oldName ? clean : tag));
  }

  persistState();
  renderTagsView();
  renderEntries();
  syncFormFromState();
  renderTagAutocomplete();
}

function mergeTag(source: string, target: string): void {
  if (!source || !target || source === target) return;

  state.entries.forEach(entry => {
    entry.tags = entry.tags
      .map(tag => (tag === source ? target : tag))
      .filter((tag, idx, arr) => tag === target ? arr.indexOf(tag) === idx : true);
  });

  if (state.active) {
    state.active.tags = state.active.tags
      .map(tag => (tag === source ? target : tag))
      .filter((tag, idx, arr) => tag === target ? arr.indexOf(tag) === idx : true);
  }

  persistState();
  renderTagsView();
  renderEntries();
  syncFormFromState();
  renderTagAutocomplete();
}

function deleteTag(tagName: string): void {
  state.entries.forEach(entry => {
    entry.tags = entry.tags.filter(tag => tag !== tagName);
  });

  if (state.active) {
    state.active.tags = state.active.tags.filter(tag => tag !== tagName);
  }

  persistState();
  renderTagsView();
  renderEntries();
  syncFormFromState();
  renderTagAutocomplete();
}

// ========================================================================
//  Tag autocomplete
// ========================================================================

let autocompleteHighlightIndex = -1;

function renderTagAutocomplete(): void {
  const input = els.tagsInput;
  const container = els.tagAutocomplete;
  const value = input.value;
  // Get the last partial tag being typed (after the last comma)
  const parts = value.split(/[，,]/);
  const currentPart = parts[parts.length - 1].trim().toLowerCase();

  if (!currentPart || !input.matches(':focus')) {
    container.classList.remove('active');
    container.innerHTML = '';
    autocompleteHighlightIndex = -1;
    return;
  }

  const existingTags = new Set(
    parts.slice(0, -1)
      .map(p => p.trim().toLowerCase())
      .filter(Boolean)
  );

  const allTags = getTagsForAutocomplete();
  const matches = allTags.filter(tag =>
    tag.toLowerCase().includes(currentPart) &&
    !existingTags.has(tag.toLowerCase())
  );

  if (!matches.length) {
    container.classList.remove('active');
    container.innerHTML = '';
    autocompleteHighlightIndex = -1;
    return;
  }

  container.classList.add('active');
  container.innerHTML = matches.slice(0, 8).map((tag, idx) =>
    `<div class="tag-autocomplete-item${idx === 0 ? ' highlighted' : ''}" data-tag="${escapeHtml(tag)}">
      <span>${escapeHtml(tag)}</span>
      <span class="tag-count">${getAllTags().get(tag) || 0} 次</span>
    </div>`
  ).join('');

  autocompleteHighlightIndex = 0;

  container.querySelectorAll('.tag-autocomplete-item').forEach(item => {
    item.addEventListener('mousedown', (e: Event) => {
      e.preventDefault();
      const tag = (e.currentTarget as HTMLElement).dataset.tag || '';
      applyAutocompleteTag(tag);
    });
  });
}

function applyAutocompleteTag(tag: string): void {
  const input = els.tagsInput;
  const value = input.value;
  const parts = value.split(/[，,]/);
  parts[parts.length - 1] = tag;
  input.value = parts.join(', ') + ', ';
  input.focus();
  els.tagAutocomplete.classList.remove('active');
  autocompleteHighlightIndex = -1;
  pushFormDataToActive();
}

// ========================================================================
//  Tag management view rendering
// ========================================================================

function renderTagsView(): void {
  const allTags = getAllTags();
  const query = els.tagSearchInput.value.trim().toLowerCase();
  els.tagTotalBadge.textContent = `${allTags.size} 个标签`;

  const sorted = [...allTags.entries()]
    .sort((a, b) => b[1] - a[1])
    .filter(([name]) => !query || name.toLowerCase().includes(query));

  els.tagList.innerHTML = '';

  if (!sorted.length) {
    els.tagList.innerHTML = `<div class="empty-state"><h3>${query ? '没有匹配的标签' : '还没有标签'}</h3><p>${query ? '试试其他关键词' : '在计时时添加标签，它们会出现在这里。'}</p></div>`;
    return;
  }

  sorted.forEach(([name, count]) => {
    const row = document.createElement('div');
    row.className = 'tag-row';
    row.innerHTML = `
      <div class="tag-row-info">
        <span class="tag-row-name">#${escapeHtml(name)}</span>
        <span class="tag-row-count">${count} 次</span>
      </div>
      <div class="tag-row-actions">
        <button class="btn ghost tag-rename-btn" type="button" data-tag="${escapeHtml(name)}">重命名</button>
        <button class="btn ghost tag-merge-btn" type="button" data-tag="${escapeHtml(name)}">合并到…</button>
        <button class="btn ghost danger tag-delete-btn" type="button" data-tag="${escapeHtml(name)}">删除</button>
      </div>
    `;
    els.tagList.appendChild(row);
  });

  // Bind tag action buttons
  els.tagList.querySelectorAll('.tag-rename-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tag = (btn as HTMLButtonElement).dataset.tag || '';
      showRenameModal(tag);
    });
  });

  els.tagList.querySelectorAll('.tag-merge-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tag = (btn as HTMLButtonElement).dataset.tag || '';
      showMergeModal(tag);
    });
  });

  els.tagList.querySelectorAll('.tag-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tag = (btn as HTMLButtonElement).dataset.tag || '';
      showDeleteModal(tag);
    });
  });

  renderTagAutocomplete();
}

// ========================================================================
//  Tag modals
// ========================================================================

function showRenameModal(oldName: string): void {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box">
      <h3>重命名标签</h3>
      <p>将 <strong>#${escapeHtml(oldName)}</strong> 重命名为：</p>
      <input id="renameInput" type="text" value="${escapeHtml(oldName)}" placeholder="新标签名称" />
      <div class="modal-actions">
        <button class="btn ghost" id="renameCancelBtn" type="button">取消</button>
        <button class="btn primary" id="renameConfirmBtn" type="button">确认重命名</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const input = overlay.querySelector<HTMLInputElement>('#renameInput')!;
  const cancel = overlay.querySelector<HTMLButtonElement>('#renameCancelBtn')!;
  const confirm = overlay.querySelector<HTMLButtonElement>('#renameConfirmBtn')!;

  input.focus();
  input.select();

  const close = () => overlay.remove();

  cancel.addEventListener('click', close);
  confirm.addEventListener('click', () => {
    const newName = input.value.trim();
    if (newName && newName !== oldName) {
      renameTag(oldName, newName);
    }
    close();
  });

  input.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') confirm.click();
    if (e.key === 'Escape') close();
  });

  overlay.addEventListener('click', (e: MouseEvent) => {
    if (e.target === overlay) close();
  });
}

function showMergeModal(source: string): void {
  const allTags = getTagsForAutocomplete().filter(t => t !== source);

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box">
      <h3>合并标签</h3>
      <p>将 <strong>#${escapeHtml(source)}</strong> 合并到：</p>
      <select id="mergeSelect">
        ${allTags.map(t => `<option value="${escapeHtml(t)}">#${escapeHtml(t)}</option>`).join('')}
      </select>
      <p class="entry-sub">合并后 <strong>#${escapeHtml(source)}</strong> 将被移除，所有条目中的该标签将替换为目标标签。</p>
      <div class="modal-actions">
        <button class="btn ghost" id="mergeCancelBtn" type="button">取消</button>
        <button class="btn primary" id="mergeConfirmBtn" type="button">确认合并</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const cancel = overlay.querySelector<HTMLButtonElement>('#mergeCancelBtn')!;
  const confirm = overlay.querySelector<HTMLButtonElement>('#mergeConfirmBtn')!;
  const select = overlay.querySelector<HTMLSelectElement>('#mergeSelect')!;

  const close = () => overlay.remove();

  cancel.addEventListener('click', close);
  confirm.addEventListener('click', () => {
    const target = select.value;
    if (target) {
      mergeTag(source, target);
    }
    close();
  });

  overlay.addEventListener('click', (e: MouseEvent) => {
    if (e.target === overlay) close();
  });
}

function showDeleteModal(tagName: string): void {
  const count = getAllTags().get(tagName) || 0;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box">
      <h3>删除标签</h3>
      <p>确定删除标签 <strong>#${escapeHtml(tagName)}</strong>？</p>
      <p class="entry-sub">该标签将从 <strong>${count}</strong> 条记录中移除。此操作不可撤销。</p>
      <div class="modal-actions">
        <button class="btn ghost" id="deleteCancelBtn" type="button">取消</button>
        <button class="btn danger" id="deleteConfirmBtn" type="button">确认删除</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const cancel = overlay.querySelector<HTMLButtonElement>('#deleteCancelBtn')!;
  const confirm = overlay.querySelector<HTMLButtonElement>('#deleteConfirmBtn')!;

  const close = () => overlay.remove();

  cancel.addEventListener('click', close);
  confirm.addEventListener('click', () => {
    deleteTag(tagName);
    close();
  });

  overlay.addEventListener('click', (e: MouseEvent) => {
    if (e.target === overlay) close();
  });
}

// ========================================================================
//  Reports
// ========================================================================

function getReportEntries(): TimeEntry[] {
  const { start, end } = getRangeBoundaries(currentRange, els.reportStartDate.value, els.reportEndDate.value);
  return state.entries.filter(entry => {
    return entry.startedAt < end && entry.endedAt > start;
  });
}

function renderReports(): void {
  const { start, end } = getRangeBoundaries(currentRange, els.reportStartDate.value, els.reportEndDate.value);
  const entries = getReportEntries();

  // Project summary
  const projectMap = new Map<string, number>();
  let totalMs = 0;
  entries.forEach(entry => {
    const dur = rangeOverlap(entry.startedAt, entry.endedAt, start, end);
    projectMap.set(entry.project, (projectMap.get(entry.project) || 0) + dur);
    totalMs += dur;
  });

  const projectRows = [...projectMap.entries()]
    .sort((a, b) => b[1] - a[1]);

  if (!projectRows.length) {
    els.reportProjectSummary.innerHTML = `<div class="empty-state"><h3>该时段没有记录</h3></div>`;
  } else {
    const maxMs = projectRows[0][1];
    let html = `<table class="report-project-table">
      <thead><tr><th>项目</th><th>时长</th><th>占比</th></tr></thead>
      <tbody>`;
    projectRows.forEach(([project, dur]) => {
      const pct = totalMs > 0 ? (dur / totalMs * 100) : 0;
      const barWidth = maxMs > 0 ? (dur / maxMs * 100) : 0;
      html += `<tr>
        <td><strong>${escapeHtml(project)}</strong></td>
        <td>${formatDuration(dur)}</td>
        <td>
          <div style="display:flex;align-items:center;gap:8px;justify-content:flex-end;">
            <div class="report-project-bar" style="width:${barWidth.toFixed(0)}%"></div>
            <span style="font-size:13px;color:var(--muted);min-width:44px;text-align:right;">${pct.toFixed(1)}%</span>
          </div>
        </td>
      </tr>`;
    });
    html += `</tbody></table>
      <p style="margin:12px 0 0;font-size:13px;color:var(--muted);">合计：${formatDuration(totalMs)}</p>`;
    els.reportProjectSummary.innerHTML = html;
  }

  // Daily trend
  renderDailyTrend(start, end, entries);
}

function renderDailyTrend(rangeStart: number, rangeEnd: number, entries: TimeEntry[]): void {
  const dayMs = 24 * 60 * 60 * 1000;
  const days: Array<{ date: Date; total: number }> = [];

  let cursor = dayStart(new Date(rangeStart));
  const endDate = dayStart(new Date(rangeEnd));

  while (cursor < endDate) {
    const dayEnd = new Date(cursor);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const dayStartMs = cursor.getTime();
    const dayEndMs = dayEnd.getTime();

    const dayTotal = entries.reduce((sum, entry) => {
      return sum + rangeOverlap(entry.startedAt, entry.endedAt, dayStartMs, dayEndMs);
    }, 0);

    days.push({ date: new Date(cursor), total: dayTotal });
    cursor = dayEnd;
  }

  if (!days.length) {
    els.reportDailyTrend.innerHTML = `<div class="empty-state" style="padding:24px 0;"><h3>无数据</h3></div>`;
    return;
  }

  const maxTotal = Math.max(...days.map(d => d.total), 1);
  const format = new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' });

  let html = '';
  days.forEach(day => {
    const pct = (day.total / maxTotal) * 100;
    const height = Math.max(pct, 2);
    html += `<div class="bar-chart-column">
      <span class="bar-chart-value">${day.total > 0 ? formatDuration(day.total) : ''}</span>
      <div class="bar-chart-bar" style="height:${height.toFixed(0)}%"></div>
      <span class="bar-chart-label">${format.format(day.date)}</span>
    </div>`;
  });

  els.reportDailyTrend.innerHTML = html;
}

function exportReportCsv(): void {
  const { start, end } = getRangeBoundaries(currentRange, els.reportStartDate.value, els.reportEndDate.value);
  const entries = getReportEntries();

  const rows = [
    ['任务', '项目', '标签', '开始时间', '结束时间', '时长(秒)', '时长', '计费'],
    ...entries.map(entry => {
      const overlap = rangeOverlap(entry.startedAt, entry.endedAt, start, end);
      return [
        entry.description,
        entry.project,
        entry.tags.join(' | '),
        new Date(entry.startedAt).toISOString(),
        new Date(entry.endedAt).toISOString(),
        Math.round(overlap / 1000),
        formatDuration(overlap),
        entry.billable ? '是' : '否'
      ];
    })
  ];

  const rangeLabel = currentRange === 'custom'
    ? `${els.reportStartDate.value}-${els.reportEndDate.value}`
    : currentRange;

  downloadCsv(rows, `time-tracker-report-${rangeLabel}-${new Date().toISOString().slice(0, 10)}.csv`);
}

// ========================================================================
//  Tab switching
// ========================================================================

function switchView(view: 'timing' | 'tags' | 'reports'): void {
  currentView = view;

  els.tabs.forEach(tab => {
    tab.classList.toggle('tab-active', tab.dataset.tab === view);
  });

  els.viewTiming.classList.toggle('hidden', view !== 'timing');
  els.viewTags.classList.toggle('hidden', view !== 'tags');
  els.viewReports.classList.toggle('hidden', view !== 'reports');

  if (view === 'tags') {
    renderTagsView();
  } else if (view === 'reports') {
    renderReports();
  }
}

// ========================================================================
//  Render
// ========================================================================

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

  if (currentView === 'tags') {
    renderTagsView();
  } else if (currentView === 'reports') {
    renderReports();
  }
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

// ========================================================================
//  Event binding
// ========================================================================

function bindEvents(): void {
  // Timer controls
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

  // Search & filter
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

  // Form sync to active timer
  els.descriptionInput.addEventListener('input', pushFormDataToActive);
  els.projectSelect.addEventListener('change', pushFormDataToActive);
  els.tagsInput.addEventListener('input', () => {
    pushFormDataToActive();
    renderTagAutocomplete();
  });
  els.tagsInput.addEventListener('blur', () => {
    // Delay to allow mousedown on autocomplete to fire first
    setTimeout(() => {
      els.tagAutocomplete.classList.remove('active');
    }, 200);
  });
  els.tagsInput.addEventListener('focus', () => {
    renderTagAutocomplete();
  });
  els.tagsInput.addEventListener('keydown', (event: KeyboardEvent) => {
    const container = els.tagAutocomplete;
    if (!container.classList.contains('active')) return;

    const items = container.querySelectorAll<HTMLElement>('.tag-autocomplete-item');
    if (!items.length) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      autocompleteHighlightIndex = (autocompleteHighlightIndex + 1) % items.length;
      items.forEach((item, idx) => item.classList.toggle('highlighted', idx === autocompleteHighlightIndex));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      autocompleteHighlightIndex = (autocompleteHighlightIndex - 1 + items.length) % items.length;
      items.forEach((item, idx) => item.classList.toggle('highlighted', idx === autocompleteHighlightIndex));
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      const highlighted = container.querySelector('.highlighted') as HTMLElement | null;
      if (highlighted) {
        event.preventDefault();
        applyAutocompleteTag(highlighted.dataset.tag || '');
      }
    } else if (event.key === 'Escape') {
      container.classList.remove('active');
    }
  });

  els.billableInput.addEventListener('change', pushFormDataToActive);

  // Global actions
  els.clearDataBtn.addEventListener('click', clearData);
  els.exportCsvBtn.addEventListener('click', exportCsv);

  // Tab switching
  els.tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const view = tab.dataset.tab as 'timing' | 'tags' | 'reports';
      switchView(view);
    });
  });

  // Tag search
  els.tagSearchInput.addEventListener('input', () => renderTagsView());

  // Reports range buttons
  els.rangeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      currentRange = btn.dataset.range as 'today' | 'week' | 'month' | 'custom';
      els.rangeBtns.forEach(b => b.classList.toggle('range-active', b.dataset.range === currentRange));
      els.customRange.classList.toggle('hidden', currentRange !== 'custom');

      // Set default dates for custom range
      if (currentRange === 'custom') {
        const now = new Date();
        const weekAgo = weekStart(now);
        els.reportStartDate.value = weekAgo.toISOString().slice(0, 10);
        els.reportEndDate.value = now.toISOString().slice(0, 10);
      }

      renderReports();
    });
  });

  els.applyCustomRange.addEventListener('click', () => {
    if (els.reportStartDate.value && els.reportEndDate.value) {
      renderReports();
    }
  });

  els.reportExportCsvBtn.addEventListener('click', exportReportCsv);

  // Edit dialog
  els.editForm.addEventListener('submit', event => {
    event.preventDefault();
    saveEditedEntry();
  });
  els.editCloseBtn.addEventListener('click', closeEditDialog);
  els.editCancelBtn.addEventListener('click', closeEditDialog);
  els.editDialog.addEventListener('click', event => {
    if (event.target === els.editDialog) closeEditDialog();
  });
  els.editDialog.addEventListener('cancel', () => { editTargetId = null; });
  els.editStartedAt.addEventListener('input', updateEditDurationPreview);
  els.editEndedAt.addEventListener('input', updateEditDurationPreview);

  // Keyboard shortcuts
  window.addEventListener('keydown', event => {
    const target = event.target as HTMLElement | null;
    if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;

    if (event.code === 'Space') {
      // Only in timing view
      if (currentView !== 'timing') return;
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
