import type { ActiveTimer, AppState, Filters, TimeEntry } from '../types';

export const DEFAULT_PROJECTS: readonly string[] = ['Inbox', '设计', '开发', '会议', '学习'];

export function makeDefaultState(): AppState {
  return {
    projects: [...DEFAULT_PROJECTS],
    entries: [],
    active: null,
    filters: { query: '', project: 'all' }
  };
}

export function normalizeState(raw: unknown): AppState {
  const source = isRecord(raw) ? raw : {};
  const filters = normalizeFilters(source.filters);
  const entries = normalizeEntries(source.entries);
  const active = normalizeActive(source.active);
  const projects = normalizeProjects(source.projects, entries, active, filters.project);
  return { projects, entries, active, filters };
}

export function normalizeProjects(
  projects: unknown,
  entries: TimeEntry[],
  active: ActiveTimer | null,
  filterProject: string
): string[] {
  const seen = new Set<string>(DEFAULT_PROJECTS);
  const add = (value: unknown) => {
    if (typeof value !== 'string') return;
    const clean = value.trim();
    if (!clean) return;
    seen.add(clean);
  };

  if (Array.isArray(projects)) {
    projects.forEach(add);
  }
  entries.forEach(entry => add(entry.project));
  if (active) add(active.project);
  if (filterProject !== 'all') add(filterProject);

  const extras = [...seen].filter(name => !DEFAULT_PROJECTS.includes(name));
  extras.sort((a, b) => a.localeCompare(b, 'zh-CN'));
  return [...DEFAULT_PROJECTS, ...extras];
}

export function normalizeEntries(entries: unknown): TimeEntry[] {
  if (!Array.isArray(entries)) return [];
  return entries
    .map(entry => {
      const item = isRecord(entry) ? entry : {};
      const startedAt = toTimestamp(item.startedAt);
      const endedAt = toTimestamp(item.endedAt);
      return {
        id: typeof item.id === 'string' && item.id.trim() ? item.id : makeId(),
        description: String(item.description ?? '未命名任务').trim() || '未命名任务',
        project: String(item.project ?? 'Inbox').trim() || 'Inbox',
        tags: parseTags(item.tags),
        billable: Boolean(item.billable),
        startedAt: Number.isFinite(startedAt) ? startedAt : Date.now(),
        endedAt: Number.isFinite(endedAt) ? endedAt : Date.now(),
        durationMs: normalizeDuration(item.durationMs, startedAt, endedAt)
      } satisfies TimeEntry;
    })
    .filter(entry => Number.isFinite(entry.startedAt) && Number.isFinite(entry.endedAt));
}

export function normalizeActive(active: unknown): ActiveTimer | null {
  if (!isRecord(active)) return null;
  const startedAt = toTimestamp(active.startedAt);
  const segmentStartedAt = toTimestamp(active.segmentStartedAt);
  return {
    id: typeof active.id === 'string' && active.id.trim() ? active.id : makeId(),
    description: String(active.description ?? '未命名任务').trim() || '未命名任务',
    project: String(active.project ?? 'Inbox').trim() || 'Inbox',
    tags: parseTags(active.tags),
    billable: Boolean(active.billable),
    startedAt: Number.isFinite(startedAt) ? startedAt : Date.now(),
    segmentStartedAt: Number.isFinite(segmentStartedAt) ? segmentStartedAt : null,
    elapsedMs: Math.max(0, Number(active.elapsedMs) || 0),
    running: Boolean(active.running)
  };
}

export function normalizeFilters(filters: unknown): Filters {
  const source = isRecord(filters) ? filters : {};
  const query = String(source.query ?? '').trim();
  const project = String(source.project ?? 'all').trim() || 'all';
  return { query, project };
}

export function normalizeDuration(value: unknown, startedAt: number, endedAt: number): number {
  const explicit = Number(value);
  if (Number.isFinite(explicit) && explicit >= 0) return explicit;
  if (Number.isFinite(startedAt) && Number.isFinite(endedAt)) {
    return Math.max(0, endedAt - startedAt);
  }
  return 0;
}

export function makeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function toTimestamp(value: unknown): number {
  if (value === null || value === undefined || value === '') return NaN;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const ts = Date.parse(value);
    return Number.isFinite(ts) ? ts : NaN;
  }
  return NaN;
}

export function parseTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(item => String(item).trim()).filter(Boolean);
  }
  if (typeof value !== 'string') return [];
  return value
    .split(/[，,]/)
    .map(tag => tag.trim())
    .filter(Boolean);
}
