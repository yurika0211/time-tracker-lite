export interface TimeEntry {
  id: string;
  description: string;
  project: string;
  tags: string[];
  billable: boolean;
  startedAt: number;
  endedAt: number;
  durationMs: number;
}

export interface ActiveTimer {
  id: string;
  description: string;
  project: string;
  tags: string[];
  billable: boolean;
  startedAt: number;
  segmentStartedAt: number | null;
  elapsedMs: number;
  running: boolean;
}

export interface Filters {
  query: string;
  project: string;
}

export interface AppState {
  projects: string[];
  entries: TimeEntry[];
  active: ActiveTimer | null;
  filters: Filters;
}
