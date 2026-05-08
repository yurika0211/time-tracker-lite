import initSqlJs, { type Database } from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

const DB_STORAGE_KEY = 'ttl.sqlite';
const DB_SCHEMA_KEY = 'ttl.schema';

export async function openDatabase(): Promise<Database> {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const saved = localStorage.getItem(DB_STORAGE_KEY);
  const db = saved ? new SQL.Database(base64ToBytes(saved)) : new SQL.Database();
  ensureSchema(db);
  return db;
}

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

export function persistDatabase(db: Database): void {
  const bytes = db.export();
  localStorage.setItem(DB_STORAGE_KEY, bytesToBase64(bytes));
}

export function clearPersistedDatabase(): void {
  localStorage.removeItem(DB_STORAGE_KEY);
}

function ensureSchema(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
  db.run(`INSERT OR IGNORE INTO kv(key, value) VALUES ('${DB_SCHEMA_KEY}', '1')`);
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
