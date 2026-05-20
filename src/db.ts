/**
 * db.ts — SQLite 存储层
 *
 * 职责：
 * 1. 打开/持久化 SQLite 数据库（sql.js → localStorage）
 * 2. 管理 schema 版本迁移（migrations 表追踪）
 * 3. 提供旧版 kv 接口兼容（逐步废弃）
 * 4. 提供新版业务表接口
 */

import initSqlJs, { type Database } from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

const DB_STORAGE_KEY = 'ttl.sqlite';
const APP_STATE_KEY = 'app.state';
const SCHEMA_VERSION_KEY = 'ttl.schema';

// ───────────────────── 公开接口 ─────────────────────

export async function openDatabase(): Promise<Database> {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const saved = localStorage.getItem(DB_STORAGE_KEY);
  const db = saved ? new SQL.Database(base64ToBytes(saved)) : new SQL.Database();
  migrateSchema(db);
  return db;
}

export function persistDatabase(db: Database): void {
  const bytes = db.export();
  localStorage.setItem(DB_STORAGE_KEY, bytesToBase64(bytes));
}

export function clearPersistedDatabase(): void {
  localStorage.removeItem(DB_STORAGE_KEY);
}

// ─────────────── 旧版 kv 兼容接口（逐步废弃） ───────────────

export function readJson<T>(db: Database, key: string): T | null {
  const stmt = db.prepare('SELECT value FROM kv WHERE key = ?');
  stmt.bind([key]);
  try {
    if (!stmt.step()) return null;
    const row = stmt.getAsObject() as { value?: string };
    if (typeof row.value !== 'string') return null;
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  } finally {
    stmt.free();
  }
}

export function writeJson<T>(db: Database, key: string, value: T): void {
  const stmt = db.prepare(
    'INSERT INTO kv(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );
  stmt.run([key, JSON.stringify(value)]);
  stmt.free();
}

export function deleteKey(db: Database, key: string): void {
  const stmt = db.prepare('DELETE FROM kv WHERE key = ?');
  stmt.run([key]);
  stmt.free();
}

// ─────────────── Schema 版本管理 ───────────────

interface Migration {
  version: number;
  name: string;
  apply: (db: Database) => void;
}

const CURRENT_SCHEMA_VERSION = 2;

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial-kv',
    apply: (db) => {
      db.run(`
        CREATE TABLE IF NOT EXISTS kv (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `);
    },
  },
  {
    version: 2,
    name: 'business-tables',
    apply: (db) => {
      // clients
      db.run(`
        CREATE TABLE IF NOT EXISTS clients (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          is_archived INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);
      db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_name ON clients(name)`);

      // projects
      db.run(`
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
      `);
      db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_name ON projects(name)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_projects_client_id ON projects(client_id)`);

      // tags
      db.run(`
        CREATE TABLE IF NOT EXISTS tags (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);
      db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_name ON tags(name)`);

      // time_entries
      db.run(`
        CREATE TABLE IF NOT EXISTS time_entries (
          id TEXT PRIMARY KEY,
          description TEXT NOT NULL DEFAULT '',
          project_id TEXT,
          client_id TEXT,
          billable INTEGER NOT NULL DEFAULT 0,
          started_at INTEGER NOT NULL,
          ended_at INTEGER,
          duration_ms INTEGER NOT NULL DEFAULT 0,
          source TEXT NOT NULL DEFAULT 'timer',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (project_id) REFERENCES projects(id),
          FOREIGN KEY (client_id) REFERENCES clients(id)
        )
      `);
      db.run(
        `CREATE INDEX IF NOT EXISTS idx_time_entries_started_at ON time_entries(started_at DESC)`
      );
      db.run(
        `CREATE INDEX IF NOT EXISTS idx_time_entries_project_id ON time_entries(project_id, started_at DESC)`
      );
      db.run(
        `CREATE INDEX IF NOT EXISTS idx_time_entries_client_id ON time_entries(client_id, started_at DESC)`
      );

      // time_entry_tags
      db.run(`
        CREATE TABLE IF NOT EXISTS time_entry_tags (
          entry_id TEXT NOT NULL,
          tag_id TEXT NOT NULL,
          PRIMARY KEY (entry_id, tag_id),
          FOREIGN KEY (entry_id) REFERENCES time_entries(id) ON DELETE CASCADE,
          FOREIGN KEY (tag_id) REFERENCES tags(id)
        )
      `);
      db.run(
        `CREATE INDEX IF NOT EXISTS idx_time_entry_tags_tag_id ON time_entry_tags(tag_id)`
      );

      // active_timer — 单例表，只允许一行
      db.run(`
        CREATE TABLE IF NOT EXISTS active_timer (
          id TEXT PRIMARY KEY CHECK (id = 'singleton'),
          description TEXT NOT NULL DEFAULT '',
          project_id TEXT,
          client_id TEXT,
          billable INTEGER NOT NULL DEFAULT 0,
          started_at INTEGER NOT NULL,
          segment_started_at INTEGER,
          elapsed_ms INTEGER NOT NULL DEFAULT 0,
          running INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (project_id) REFERENCES projects(id),
          FOREIGN KEY (client_id) REFERENCES clients(id)
        )
      `);

      // settings
      db.run(`
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);

      // migrations
      db.run(`
        CREATE TABLE IF NOT EXISTS migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at INTEGER NOT NULL,
          checksum TEXT
        )
      `);
    },
  },
];

function migrateSchema(db: Database): void {
  // 确保 migrations 表存在（可能在 V1 之前的极端情况）
  db.run(`
    CREATE TABLE IF NOT EXISTS migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL,
      checksum TEXT
    )
  `);

  // 查询已应用的版本
  const applied = new Set<number>();
  try {
    const stmt = db.prepare('SELECT version FROM migrations ORDER BY version');
    while (stmt.step()) {
      applied.add(stmt.getAsObject().version as number);
    }
    stmt.free();
  } catch {
    // migrations 表为空
  }

  // 按序应用未执行的迁移
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    migration.apply(db);

    const insertStmt = db.prepare(
      'INSERT INTO migrations (version, name, applied_at, checksum) VALUES (?, ?, ?, ?)'
    );
    insertStmt.run([migration.version, migration.name, Date.now(), null]);
    insertStmt.free();
  }

  // ── V1 → V2 数据迁移 ──
  if (!applied.has(2)) {
    migrateKvToBusinessTables(db);
  }
}

// ─────────────── V1 → V2 数据迁移 ───────────────

function migrateKvToBusinessTables(db: Database): void {
  const raw = readJson<Record<string, unknown>>(db, APP_STATE_KEY);
  if (!raw) return;

  const now = Date.now();

  // --- 1. 迁移 projects ---
  const oldProjects: string[] = Array.isArray(raw.projects)
    ? (raw.projects as string[]).map((s) => String(s).trim()).filter(Boolean)
    : ['Inbox'];

  const projectIdMap = new Map<string, string>();
  const projStmt = db.prepare(
    'INSERT OR IGNORE INTO projects (id, name, client_id, color, billable_default, is_archived, created_at, updated_at) VALUES (?, ?, NULL, NULL, 0, 0, ?, ?)'
  );
  for (const name of oldProjects) {
    const id = makeDeterministicId('proj', name);
    projStmt.run([id, name, now, now]);
    projectIdMap.set(name, id);
  }
  projStmt.free();

  // --- 2. 收集所有标签 ---
  const allTagNames = new Set<string>();
  const entries: Array<Record<string, unknown>> = Array.isArray(raw.entries)
    ? (raw.entries as Array<Record<string, unknown>>)
    : [];
  for (const entry of entries) {
    const tags = parseRawTags(entry.tags);
    tags.forEach((t) => allTagNames.add(t));
  }
  if (raw.active && typeof raw.active === 'object') {
    const tags = parseRawTags((raw.active as Record<string, unknown>).tags);
    tags.forEach((t) => allTagNames.add(t));
  }

  // --- 3. 迁移 tags ---
  const tagIdMap = new Map<string, string>();
  const tagStmt = db.prepare(
    'INSERT OR IGNORE INTO tags (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)'
  );
  for (const name of allTagNames) {
    if (!name) continue;
    const id = makeDeterministicId('tag', name);
    tagStmt.run([id, name, now, now]);
    tagIdMap.set(name, id);
  }
  tagStmt.free();

  // --- 4. 迁移 time_entries ---
  const entryStmt = db.prepare(`
    INSERT INTO time_entries (id, description, project_id, client_id, billable, started_at, ended_at, duration_ms, source, created_at, updated_at)
    VALUES (?, ?, ?, NULL, ?, ?, ?, ?, 'timer', ?, ?)
  `);
  const entryTagStmt = db.prepare(
    'INSERT OR IGNORE INTO time_entry_tags (entry_id, tag_id) VALUES (?, ?)'
  );

  for (const entry of entries) {
    const id = String(entry.id ?? '');
    const description =
      String(entry.description ?? '未命名任务').trim() || '未命名任务';
    const projectName =
      String(entry.project ?? 'Inbox').trim() || 'Inbox';
    const projectId =
      projectIdMap.get(projectName) ?? projectIdMap.get('Inbox') ?? '';
    const billable = Boolean(entry.billable) ? 1 : 0;
    const startedAt = toTimestamp(entry.startedAt);
    const endedAt = toTimestamp(entry.endedAt);
    const durationMs =
      Number(entry.durationMs) || Math.max(0, endedAt - startedAt);

    if (!id || !Number.isFinite(startedAt) || !Number.isFinite(endedAt))
      continue;

    entryStmt.run([
      id,
      description,
      projectId,
      billable,
      startedAt,
      Number.isFinite(endedAt) ? endedAt : null,
      durationMs,
      now,
      now,
    ]);

    const tags = parseRawTags(entry.tags);
    for (const tagName of tags) {
      const tagId = tagIdMap.get(tagName);
      if (tagId) entryTagStmt.run([id, tagId]);
    }
  }
  entryStmt.free();
  entryTagStmt.free();

  // --- 5. 迁移 active_timer ---
  if (raw.active && typeof raw.active === 'object') {
    const active = raw.active as Record<string, unknown>;
    const activeId = String(active.id ?? '');
    const description =
      String(active.description ?? '未命名任务').trim() || '未命名任务';
    const projectName =
      String(active.project ?? 'Inbox').trim() || 'Inbox';
    const projectId =
      projectIdMap.get(projectName) ?? projectIdMap.get('Inbox') ?? '';
    const billable = Boolean(active.billable) ? 1 : 0;
    const startedAt = toTimestamp(active.startedAt);
    const segmentStartedAt = toTimestamp(active.segmentStartedAt);
    const elapsedMs = Math.max(0, Number(active.elapsedMs) || 0);
    const running = Boolean(active.running) ? 1 : 0;

    if (activeId && Number.isFinite(startedAt)) {
      const atStmt = db.prepare(`
        INSERT OR REPLACE INTO active_timer
          (id, description, project_id, client_id, billable, started_at, segment_started_at, elapsed_ms, running, created_at, updated_at)
        VALUES ('singleton', ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)
      `);
      atStmt.run([
        description,
        projectId,
        billable,
        startedAt,
        Number.isFinite(segmentStartedAt) ? segmentStartedAt : null,
        elapsedMs,
        running,
        now,
        now,
      ]);
      atStmt.free();
    }
  }

  // --- 6. 迁移 settings ---
  const filters = raw.filters as Record<string, unknown> | undefined;
  if (filters && typeof filters === 'object') {
    const settingStmt = db.prepare(
      'INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)'
    );
    settingStmt.run(['filters', JSON.stringify(filters), now]);
    settingStmt.free();
  }

  // 标记 schema 版本
  const verStmt = db.prepare(
    'INSERT OR REPLACE INTO kv(key, value) VALUES (?, ?)'
  );
  verStmt.run([SCHEMA_VERSION_KEY, String(CURRENT_SCHEMA_VERSION)]);
  verStmt.free();
}

// ─────────────── 新版业务表查询接口 ───────────────

export function getAllProjects(
  db: Database
): Array<{
  id: string;
  name: string;
  clientId: string | null;
  color: string | null;
  billableDefault: boolean;
  isArchived: boolean;
}> {
  const stmt = db.prepare(
    'SELECT id, name, client_id, color, billable_default, is_archived FROM projects ORDER BY name'
  );
  const results: Array<{
    id: string;
    name: string;
    clientId: string | null;
    color: string | null;
    billableDefault: boolean;
    isArchived: boolean;
  }> = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as {
      id: string;
      name: string;
      client_id: string | null;
      color: string | null;
      billable_default: number;
      is_archived: number;
    };
    results.push({
      id: row.id,
      name: row.name,
      clientId: row.client_id,
      color: row.color,
      billableDefault: row.billable_default === 1,
      isArchived: row.is_archived === 1,
    });
  }
  stmt.free();
  return results;
}

export function getAllTags(
  db: Database
): Array<{ id: string; name: string }> {
  const stmt = db.prepare('SELECT id, name FROM tags ORDER BY name');
  const results: Array<{ id: string; name: string }> = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as { id: string; name: string };
    results.push({ id: row.id, name: row.name });
  }
  stmt.free();
  return results;
}

export function getActiveTimer(
  db: Database
): Record<string, unknown> | null {
  const stmt = db.prepare('SELECT * FROM active_timer WHERE id = ?');
  stmt.bind(['singleton']);
  try {
    if (!stmt.step()) return null;
    return stmt.getAsObject() as Record<string, unknown>;
  } finally {
    stmt.free();
  }
}

export function getAllTimeEntries(
  db: Database
): Array<Record<string, unknown>> {
  const stmt = db.prepare(`
    SELECT te.*, p.name AS project_name
    FROM time_entries te
    LEFT JOIN projects p ON te.project_id = p.id
    ORDER BY te.started_at DESC
  `);
  const results: Array<Record<string, unknown>> = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject() as Record<string, unknown>);
  }
  stmt.free();
  return results;
}

export function getEntryTags(
  db: Database,
  entryId: string
): Array<{ tagId: string; tagName: string }> {
  const stmt = db.prepare(`
    SELECT tet.tag_id, t.name AS tag_name
    FROM time_entry_tags tet
    JOIN tags t ON tet.tag_id = t.id
    WHERE tet.entry_id = ?
  `);
  stmt.bind([entryId]);
  const results: Array<{ tagId: string; tagName: string }> = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as {
      tag_id: string;
      tag_name: string;
    };
    results.push({ tagId: row.tag_id, tagName: row.tag_name });
  }
  stmt.free();
  return results;
}

// ─────────────── 工具函数 ───────────────

function makeDeterministicId(prefix: string, name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    const chr = name.charCodeAt(i);
    hash = (hash << 5) - hash + chr;
    hash |= 0;
  }
  return `${prefix}_${Math.abs(hash).toString(36)}`;
}

function parseRawTags(tags: unknown): string[] {
  if (Array.isArray(tags)) {
    return tags.map((t) => String(t).trim()).filter(Boolean);
  }
  if (typeof tags === 'string') {
    return tags
      .split(/[,，、]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function toTimestamp(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const num = Number(value);
    return Number.isFinite(num) ? num : Date.now();
  }
  return Date.now();
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
