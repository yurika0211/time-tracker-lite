/* ======== 领域实体 ======== */

export interface Client {
  id: string;
  name: string;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Project {
  id: string;
  name: string;
  clientId: string | null;
  color: string | null;
  billableDefault: boolean;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Tag {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface Settings {
  defaultBillable: boolean;
  defaultProject: string | null;
  weekStartDay: number; // 0=Sunday, 1=Monday
}

/* ======== 项目元数据（当前存在 AppState 中，与 string[] projects 配套） ======== */

export interface ProjectMeta {
  archived?: boolean;
  color?: string;
  defaultBillable?: boolean;
}

/* ======== 运行时状态 ======== */

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
  projectMeta: Record<string, ProjectMeta>;
  entries: TimeEntry[];
  active: ActiveTimer | null;
  filters: Filters;
}
