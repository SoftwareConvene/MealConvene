// The roster and the saved restaurants.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpError } from '../api/router.ts';
import { all, one, insert, update, nowIso, tx } from '../db/db.ts';
import { parseMenu } from './menu.ts';

const here = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- people ---

const NAME_MAX = 40;

/** One space between words, trimmed, capped. The one rule for every name, typed by anyone. */
export const cleanName = (s: any) => String(s ?? '').trim().replace(/\s+/g, ' ').slice(0, NAME_MAX);

export function listPeople(includeInactive = false) {
  return all(`SELECT id, name, active, external_id FROM person ${includeInactive ? '' : 'WHERE active=1'} ORDER BY name COLLATE NOCASE`);
}

/** Add people from pasted text, one per line. A name already on the roster is skipped, not doubled. */
export function addPeople(text: string): { added: number; skipped: string[] } {
  const names = String(text ?? '').split(/\r?\n|,/).map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean);
  if (!names.length) throw new HttpError(400, 'no_names', 'Type at least one name.');
  const skipped: string[] = [];
  let added = 0;
  tx(() => {
    for (const raw of names) {
      const name = raw.slice(0, NAME_MAX);
      const existing = one('SELECT * FROM person WHERE lower(name)=lower(?)', name);
      if (existing) {
        if (!existing.active) { update('person', existing.id, { active: 1 }); added++; } else skipped.push(name);
        continue;
      }
      insert('person', { name, active: 1, created_at: nowIso() });
      added++;
    }
  });
  return { added, skipped };
}

export function updatePerson(personId: string, patch: any): void {
  const p = one('SELECT * FROM person WHERE id=?', personId);
  if (!p) throw new HttpError(404, 'not_found', 'No such person.');
  const out: Record<string, any> = {};
  if (patch.name !== undefined) {
    const name = String(patch.name).trim().replace(/\s+/g, ' ').slice(0, NAME_MAX);
    if (!name) throw new HttpError(400, 'no_name', 'A name cannot be blank.');
    const clash = one('SELECT id FROM person WHERE lower(name)=lower(?) AND id<>?', name, personId);
    if (clash) throw new HttpError(409, 'duplicate', `${name} is already on the roster.`);
    out.name = name;
  }
  // People are retired, never deleted: past orders still name them.
  if (patch.active !== undefined) out.active = !!patch.active;
  update('person', personId, out);
}

// ----------------------------------------------------------- restaurants ---

export const KINDS = ['subway', 'other'] as const;

export function template(kind: string): string {
  if (kind !== 'subway') return '';
  return readFileSync(join(here, 'templates', 'subway.txt'), 'utf8');
}

export function listRestaurants() {
  return all('SELECT * FROM restaurant ORDER BY name COLLATE NOCASE').map(shape);
}

export function getRestaurant(restaurantId: string) {
  const r = one('SELECT * FROM restaurant WHERE id=?', restaurantId);
  if (!r) throw new HttpError(404, 'not_found', 'No such restaurant.');
  return shape(r);
}

function shape(r: any) {
  const parsed = parseMenu(r.menu_text);
  return {
    ...r,
    allow_notes: !!r.allow_notes,
    prices_confirmed: !!r.prices_confirmed,
    item_count: parsed.items.length,
    errors: parsed.errors,
  };
}

function clean(input: any) {
  const name = String(input.name ?? '').trim().slice(0, 60);
  if (!name) throw new HttpError(400, 'no_name', 'Name the restaurant.');
  const kind = KINDS.includes(input.kind) ? input.kind : 'other';
  const menu = String(input.menu_text ?? '');
  if (menu.length > 100_000) throw new HttpError(400, 'too_long', 'That menu is too long.');
  return {
    name,
    kind,
    store_label: String(input.store_label ?? '').trim().slice(0, 80) || null,
    menu_text: menu,
    // Subway's site takes no free-text instructions, so a note would be dropped on the floor.
    allow_notes: kind === 'subway' ? false : input.allow_notes !== false,
    prices_confirmed: !!input.prices_confirmed,
  };
}

export function createRestaurant(input: any): string {
  const row = clean(input);
  if (!row.menu_text.trim()) row.menu_text = template(row.kind);
  // A menu that came from a template has guessed prices, whatever the box said.
  if (row.menu_text === template(row.kind) && row.kind !== 'other') row.prices_confirmed = false;
  return insert('restaurant', { ...row, created_at: nowIso(), updated_at: nowIso() });
}

export function updateRestaurant(restaurantId: string, input: any): void {
  getRestaurant(restaurantId);
  const row = clean(input);
  update('restaurant', restaurantId, { ...row, updated_at: nowIso() });
}
