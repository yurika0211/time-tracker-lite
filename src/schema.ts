// ── SQLite Schema Definition & Migration Engine ──
// Reference: docs/requirements/sqlite-schema-sketch.md
// Task A2: Upgrade SQLite structure to business tables

import type { Database } from 'sql.js';

export const CURRENT_SCHEMA_VERSION = 2;

// ── Migration Type ──

interface Migration {
  version: number;
  name: string;
  apply: (db: Database) => void;
}

// ── DDL Fragments ──

const DDL = {
  migrations: `
    CREATE TABLE IF NOT EXISTS migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL,
      checksum TEXT
    )
  `,

  clients: `
    CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      is_archived INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `,

  projects: `
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      client_id TEXT,
      color TEXT,
      billable_default INTEGER NOT NULL DEFAULT 0,
      is_archived INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (client_id) REFERENCES clients(id)
    )
  `,

  tags: `
    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `,

  time_entries: `
    CREATE TABLE IF NOT EXISTS time_entries (
      id TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      project_id TEXT,
      billable INTEGER NOT NULL DEFAULT 0,
      started_at INTEGER NOT NULL,
      ended_at INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      source TEXT NOT NULL DEFAULT 'timer',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    )
  `,

  time_entry_tags: `
    CREATE TABLE IF NOT EXISTS time_entry_tags (
      entry_id TEXT NOT NULL,
      tag_id TEXT NOT NULL,
      PRIMARY KEY (entry_id, tag_id),
      FOREIGN KEY (entry_id) REFERENCES time_entries(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id)
    )
  `,

  active_timer: `
    CREATE TABLE IF NOT EXISTS active_timer (
      id TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      project_id TEXT,
      billable INTEGER NOT NULL DEFAULT 0,
      started_at INTEGER NOT NULL,
      segment_started_at INTEGER,
      elapsed_ms INTEGER NOT NULL DEFAULT 0,
      running INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `,

  settings: `
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `,

  indexes: `
    CREATE INDEX IF NOT EXISTS idx_time_entries_started_at ON time_entries(started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_time_entries_project_id ON time_entries(project_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_time_entry_tags_tag_id ON time_entry_tags(tag_id);
    CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name);
    CREATE INDEX IF NOT EXISTS idx_projects_name ON projects(name);
    CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(name);
  `
};

// ── Migration Registry ──

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'create_business_tables',
    apply(db) {
      db.run(DDL.clients);
      db.run(DDL.projects);
      db.run(DDL.tags);
      db.run(DDL.time_entries);
      db.run(DDL.time_entry_tags);
      db.run(DDL.active_timer);
      db.run(DDL.settings);
      db.run(DDL.indexes);
    }
  },

  {
    version: 2,
    name: 'migrate_old_kv_data',
    apply(db) {
      // Check if old kv table exists and has app.state data
      const hasKv = tableExists(db, 'kv');
      if (!hasKv) return;

      const stmt = db.prepare("SELECT value FROM kv WHERE key = 'app.state'");
      let oldState: string | null = null;
      try {
        if (stmt.step()) {
          const row = stmt.getAsObject() as { value?: string };
          if (typeof row.value === 'string') {
            oldState = row.value;
          }
        }
      } finally {
        stmt.free();
      }

      if (!oldState) return;

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(oldState) as Record<string, unknown>;
      } catch {
        return; // corrupt data, skip migration
      }

      const now = Date.now();

      // ── Migrate projects ──
      const projects = Array.isArray(parsed.projects) ? parsed.projects : [];
      const projectNameToId = new Map<string, string>();
      const defaultProjects = ['Inbox', '设计', '开发', '会议', '学习'];

      for (const name of projects) {
        if (typeof name !== 'string' || !name.trim()) continue;
        const clean = name.trim();
        const id = makeStableId('project', clean);
        projectNameToId.set(clean, id);
        db.run(
          `INSERT OR IGNORE INTO projects (id, name, client_id, color, billable_default, is_archived, created_at, updated_at)
           VALUES (?, ?, NULL, NULL, 0, 0, ?, ?)`,
          [id, clean, now, now]
        );
      }

      // Ensure default projects exist even if old state had none
      for (const name of defaultProjects) {
        if (!projectNameToId.has(name)) {
          const id = makeStableId('project', name);
          projectNameToId.set(name, id);
          db.run(
            `INSERT OR IGNORE INTO projects (id, name, client_id, color, billable_default, is_archived, created_at, updated_at)
             VALUES (?, ?, NULL, NULL, 0, 0, ?, ?)`,
            [id, name, now, now]
          );
        }
      }

      // ── Migrate entries ──
      const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
      const tagNameToId = new Map<string, string>();

      for (const entry of entries) {
        if (!isRecord(entry)) continue;
        const id = String(entry.id ?? '');
        if (!id.trim()) continue;

        // Derive project_id from project name
        const projectName = String(entry.project ?? 'Inbox').trim() || 'Inbox';
        let projectId: string | null = projectNameToId.get(projectName) ?? null;

        const desc = String(entry.description ?? '未命名任务').trim() || '未命名任务';
        const billable = Boolean(entry.billable);
        const startedAt = toTimestamp(entry.startedAt);
        const endedAt = toTimestamp(entry.endedAt);
        const durationMs = normalizeDuration(entry.durationMs, startedAt, endedAt);

        if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)) continue;

        db.run(
          `INSERT OR IGNORE INTO time_entries
           (id, description, project_id, billable, started_at, ended_at, duration_ms, source, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'timer', ?, ?)`,
          [id, desc, projectId, billable ? 1 : 0, startedAt, endedAt, durationMs, now, now]
        );

        // ── Migrate tags ──
        const tags = parseTagList(entry.tags);
        for (const tagName of tags) {
          if (!tagName.trim()) continue;
          const clean = tagName.trim();

          if (!tagNameToId.has(clean)) {
            const tagId = makeStableId('tag', clean);
            tagNameToId.set(clean, tagId);
            db.run(
              `INSERT OR IGNORE INTO tags (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
              [tagId, clean, now, now]
            );
          }

          const tagId = tagNameToId.get(clean)!;
          db.run(
            `INSERT OR IGNORE INTO time_entry_tags (entry_id, tag_id) VALUES (?, ?)`,
            [id, tagId]
          );
        }
      }

      // ── Migrate active timer ──
      if (isRecord(parsed.active)) {
        const a = parsed.active as Record<string, unknown>;
        const aId = String(a.id ?? '');
        if (aId.trim()) {
          const projectName = String(a.project ?? 'Inbox').trim() || 'Inbox';
          const aProjectId = projectNameToId.get(projectName) ?? null;
          const aDesc = String(a.description ?? '未命名任务').trim() || '未命名任务';
          const aBillable = Boolean(a.billable);
          const aStartedAt = toTimestamp(a.startedAt);
          const aSegStartedAt = toTimestamp(a.segmentStartedAt);
          const aElapsed = Math.max(0, Number(a.elapsedMs) || 0);
          const aRunning = Boolean(a.running);

          if (Number.isFinite(aStartedAt)) {
            db.run(
              `INSERT OR REPLACE INTO active_timer
               (id, description, project_id, billable, started_at, segment_started_at, elapsed_ms, running, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                aId, aDesc, aProjectId, aBillable ? 1 : 0,
                aStartedAt, Number.isFinite(aSegStartedAt) ? aSegStartedAt : null,
                aElapsed, aRunning ? 1 : 0, now, now
              ]
            );
          }
        }
      }

      // Mark migration in settings
      db.run(
        `INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('migrated_from_kv', '1', ?)`,
        [now]
      );
    }
  }
];

// ── Public API ──

/** Apply all pending migrations and ensure schema is current */
export function ensureSchema(db: Database): void {
  // Bootstrap: create migrations table first (always)
  db.run(DDL.migrations);

  // Bootstrap: create legacy kv table if not present (backward compat)
  db.run(`CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);

  const applied = getAppliedVersions(db);
  let maxVersion = applied.length > 0 ? Math.max(...applied) : 0;

  for (const migration of MIGRATIONS) {
    if (migration.version > maxVersion) {
      migration.apply(db);
      recordMigration(db, migration.version, migration.name);
      maxVersion = migration.version;
    }
  }
}

/** Check if the old kv → new table migration has already run */
export function isKvMigrationDone(db: Database): boolean {
  const stmt = db.prepare("SELECT value FROM settings WHERE key = 'migrated_from_kv'");
  try {
    if (!stmt.step()) return false;
    const row = stmt.getAsObject() as { value?: string };
    return row.value === '1';
  } finally {
    stmt.free();
  }
}

// ── Internal Helpers ──

function getAppliedVersions(db: Database): number[] {
  const versions: number[] = [];
  const stmt = db.prepare('SELECT version FROM migrations ORDER BY version ASC');
  try {
    while (stmt.step()) {
      const row = stmt.getAsObject() as { version?: number };
      if (typeof row.version === 'number') {
        versions.push(row.version);
      }
    }
  } finally {
    stmt.free();
  }
  return versions;
}

function recordMigration(db: Database, version: number, name: string): void {
  db.run(
    'INSERT INTO migrations (version, name, applied_at, checksum) VALUES (?, ?, ?, NULL)',
    [version, name, Date.now()]
  );
}

function tableExists(db: Database, name: string): boolean {
  const stmt = db.prepare(
    "SELECT count(*) AS cnt FROM sqlite_master WHERE type='table' AND name = ?"
  );
  try {
    stmt.bind([name]);
    if (stmt.step()) {
      const row = stmt.getAsObject() as { cnt?: number };
      return (row.cnt ?? 0) > 0;
    }
    return false;
  } finally {
    stmt.free();
  }
}

/** Deterministic ID from a type prefix and name — stable across migrations */
function makeStableId(prefix: string, name: string): string {
  let hash = 0;
  const s = `${prefix}:${name}`;
  for (let i = 0; i < s.length; i++) {
    const chr = s.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return `${prefix}_${Math.abs(hash).toString(36).padStart(6, '0')}`;
}

function toTimestamp(value: unknown): number {
  if (value === null || value === undefined || value === '') return NaN;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const ts = Date.parse(value);
    return Number.isFinite(ts) ? ts : NaN;
  }
  return NaN;
}

function normalizeDuration(value: unknown, startedAt: number, endedAt: number): number {
  const explicit = Number(value);
  if (Number.isFinite(explicit) && explicit >= 0) return explicit;
  if (Number.isFinite(startedAt) && Number.isFinite(endedAt)) {
    return Math.max(0, endedAt - startedAt);
  }
  return 0;
}

function parseTagList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(v => String(v).trim()).filter(Boolean);
  }
  if (typeof value !== 'string') return [];
  return value.split(/[，,]/).map(t => t.trim()).filter(Boolean);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
