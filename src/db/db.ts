// Thin data layer over node:sqlite. Same shape as TeamConvene's.

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, '..', '..');
const DB_PATH = process.env.MC_DB ?? join(ROOT, 'data', 'mealconvene.db');

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

export function migrate(): void {
  db.exec(readFileSync(join(here, 'schema.sql'), 'utf8'));
  ensureColumns();
}

/**
 * CREATE TABLE IF NOT EXISTS never adds a column to a table that already
 * exists. These are the columns added after a database was first created.
 */
function ensureColumns(): void {
  const additions: [string, string, string][] = [
    ['meal_order', 'allow_join', 'INTEGER NOT NULL DEFAULT 1'],
    ['invite', 'self_joined', 'INTEGER NOT NULL DEFAULT 0'],
  ];
  for (const [table, column, ddl] of additions) {
    const cols = all(`PRAGMA table_info(${table})`);
    if (!cols.length || cols.some((c) => c.name === column)) continue;
    run(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}

export function id(): string { return randomUUID(); }

export function nowIso(): string { return new Date().toISOString(); }

export function run(sql: string, ...params: any[]) {
  return db.prepare(sql).run(...normalize(params));
}

export function all(sql: string, ...params: any[]): any[] {
  return db.prepare(sql).all(...normalize(params)) as any[];
}

export function one(sql: string, ...params: any[]): any | undefined {
  return db.prepare(sql).get(...normalize(params)) as any | undefined;
}

/** node:sqlite binds only null, number, bigint, string and Uint8Array. */
function normalize(params: any[]): any[] {
  return params.map((p) => {
    if (p === undefined || p === null) return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    if (p instanceof Date) return p.toISOString();
    if (typeof p === 'object' && !(p instanceof Uint8Array)) return JSON.stringify(p);
    return p;
  });
}

/** Insert an object as a row and return its id. */
export function insert(table: string, row: Record<string, any>): string {
  const rowId = row.id ?? id();
  const full = { id: rowId, ...row };
  const cols = Object.keys(full);
  run(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, ...cols.map((c) => full[c]));
  return rowId;
}

/** Update named columns on one row. Columns not named are left alone. */
export function update(table: string, rowId: string, patch: Record<string, any>): void {
  const cols = Object.keys(patch);
  if (!cols.length) return;
  run(`UPDATE ${table} SET ${cols.map((c) => `${c}=?`).join(', ')} WHERE id=?`, ...cols.map((c) => patch[c]), rowId);
}

export function parseJson<T = any>(value: any, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') return value as T;
  try { return JSON.parse(String(value)) as T; } catch { return fallback; }
}

/** Run a function inside a transaction. Rolls back on any throw. */
export function tx<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
