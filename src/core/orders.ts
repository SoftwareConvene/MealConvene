// Orders: the rules the product is sold on live here.
//
// 1. Everyone on an order has the same limit, and the server enforces it.
// 2. A person's identity on an order is their personal link. Nobody types a
//    name, so nobody can order as someone else or open a second limit.
// 3. Each order keeps its own copy of the menu, so editing a restaurant never
//    changes what somebody already picked.

import { HttpError } from '../api/router.ts';
import { all, one, insert, run, update, nowIso, tx, parseJson } from '../db/db.ts';
import { parseMenu } from './menu.ts';
import { token } from './auth.ts';
import { cleanName } from './roster.ts';
// One copy of the pricing rules, shared with the student's browser.
import { unitPrice, validateSelection, counted, withinLimit, fmt, foodBudget } from '../../web/js/pricing.js';

export type Option = { id: string; name: string; price_cents: number };
export type Group = { id: string; name: string; min_select: number; max_select: number; options: Option[] };
export type MenuItem = { id: string; name: string; price_cents: number; category: string | null; position: number; groups: Group[] };
export type CartLineIn = { menuItemId: string; optionIds: string[]; qty: number; note?: string };

const MAX_LINES = 30;
/** A ceiling on an order's headcount, so a leaked team link can't be flooded with names. */
const MAX_PEOPLE = 150;

export function isOpen(o: any): boolean {
  return o.status === 'open' && (!o.deadline || new Date(o.deadline).getTime() > Date.now());
}

export function getOrder(orderId: string): any {
  const o = one('SELECT * FROM meal_order WHERE id=?', orderId);
  if (!o) throw new HttpError(404, 'not_found', 'No such order.');
  return o;
}

// ---------------------------------------------------------------- menu ---

export function menuFor(orderId: string): MenuItem[] {
  const items = all('SELECT id, name, price_cents, category, position FROM menu_item WHERE order_id=? ORDER BY position', orderId);
  const groups = all(
    `SELECT g.* FROM option_group g JOIN menu_item m ON m.id = g.menu_item_id
     WHERE m.order_id=? ORDER BY g.position`, orderId);
  const options = all(
    `SELECT o.* FROM menu_option o JOIN option_group g ON g.id = o.group_id JOIN menu_item m ON m.id = g.menu_item_id
     WHERE m.order_id=? ORDER BY o.position`, orderId);
  const optsBy = new Map<string, Option[]>();
  for (const o of options) {
    const list = optsBy.get(o.group_id) ?? [];
    list.push({ id: o.id, name: o.name, price_cents: o.price_cents });
    optsBy.set(o.group_id, list);
  }
  const groupsBy = new Map<string, Group[]>();
  for (const g of groups) {
    const list = groupsBy.get(g.menu_item_id) ?? [];
    list.push({ id: g.id, name: g.name, min_select: g.min_select, max_select: g.max_select, options: optsBy.get(g.id) ?? [] });
    groupsBy.set(g.menu_item_id, list);
  }
  return items.map((i) => ({ ...i, groups: groupsBy.get(i.id) ?? [] }));
}

// -------------------------------------------------------------- create ---

export type NewOrder = {
  restaurant_id: string;
  title: string;
  limit_cents: number;
  count_cushion?: boolean;
  cushion_pct?: number;
  deadline?: string | null;
  person_ids?: string[];
  /** Let people type their own name on the team link. Default on. */
  allow_join?: boolean;
};

export function createOrder(organizerId: string, input: NewOrder): string {
  const r = one('SELECT * FROM restaurant WHERE id=?', input.restaurant_id);
  if (!r) throw new HttpError(400, 'no_restaurant', 'Pick a restaurant.');
  if (!r.prices_confirmed) {
    throw new HttpError(409, 'prices_unconfirmed',
      `Check ${r.name}'s prices against your store first. The limit is only as accurate as the prices.`);
  }
  const title = String(input.title ?? '').trim().slice(0, 80);
  if (!title) throw new HttpError(400, 'no_title', 'Give the order a name, like "Saturday build lunch".');
  const limit = Number(input.limit_cents);
  if (!Number.isInteger(limit) || limit <= 0 || limit > 100_000) throw new HttpError(400, 'bad_limit', 'Set a per-person limit between $0.01 and $1,000.');
  const pct = input.cushion_pct ?? 10;
  if (!Number.isInteger(pct) || pct < 0 || pct > 50) throw new HttpError(400, 'bad_cushion', 'The cushion must be a whole number from 0 to 50.');
  const deadline = parseDeadline(input.deadline);

  const { items, errors } = parseMenu(r.menu_text);
  if (errors.length) throw new HttpError(409, 'menu_errors', `${r.name}'s menu has problems. Fix them on the Restaurants page first.`, errors);

  const people = uniquePeople(input.person_ids);
  const allowJoin = input.allow_join !== false;
  if (!people.length && !allowJoin) {
    throw new HttpError(400, 'no_people', 'Pick who is eating, or let people add their own names.');
  }

  return tx(() => {
    const orderId = insert('meal_order', {
      restaurant_id: r.id, title,
      restaurant_name: r.store_label ? `${r.name} (${r.store_label})` : r.name,
      restaurant_kind: r.kind,
      allow_notes: r.allow_notes,
      limit_cents: limit,
      count_cushion: input.count_cushion !== false,
      cushion_pct: pct,
      deadline,
      status: 'open',
      fill_token: token(24),
      team_token: token(12),
      allow_join: allowJoin,
      created_by: organizerId,
      created_at: nowIso(),
    });
    items.forEach((it, i) => {
      const itemId = insert('menu_item', { order_id: orderId, name: it.name, price_cents: it.price_cents, category: it.category, position: i });
      it.groups.forEach((g, gi) => {
        const gid = insert('option_group', { menu_item_id: itemId, name: g.name, min_select: g.min, max_select: g.max, position: gi });
        g.options.forEach((o, oi) => insert('menu_option', { group_id: gid, name: o.name, price_cents: o.price_cents, position: oi }));
      });
    });
    for (const p of people) addInvite(orderId, p);
    return orderId;
  });
}

function parseDeadline(value: any): string | null {
  if (value === null || value === undefined || value === '') return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) throw new HttpError(400, 'bad_deadline', 'That closing time is not a date.');
  return d.toISOString();
}

function uniquePeople(ids: any): any[] {
  const list = Array.isArray(ids) ? [...new Set(ids.map(String))] : [];
  return list.map((pid) => one('SELECT * FROM person WHERE id=? AND active=1', pid)).filter(Boolean);
}

function addInvite(orderId: string, person: any): void {
  if (one('SELECT 1 AS x FROM invite WHERE order_id=? AND person_id=?', orderId, person.id)) return;
  insert('invite', { order_id: orderId, person_id: person.id, person_name: person.name, token: token(18), status: 'pending' });
}

export function addPeople(orderId: string, personIds: string[]): number {
  getOrder(orderId);
  const people = uniquePeople(personIds);
  tx(() => { for (const p of people) addInvite(orderId, p); });
  return people.length;
}

/** Remove someone from an order. Their picks go with them. */
export function removeInvite(orderId: string, inviteId: string): void {
  const inv = one('SELECT * FROM invite WHERE id=? AND order_id=?', inviteId, orderId);
  if (!inv) throw new HttpError(404, 'not_found', 'That person is not on this order.');
  run('DELETE FROM invite WHERE id=?', inviteId);
}

export function updateOrder(orderId: string, patch: any): void {
  const o = getOrder(orderId);
  const out: Record<string, any> = {};
  if (patch.status !== undefined) {
    if (!['open', 'closed'].includes(patch.status)) throw new HttpError(400, 'bad_status', 'Status is open or closed.');
    out.status = patch.status;
  }
  if (patch.title !== undefined) {
    const t = String(patch.title).trim().slice(0, 80);
    if (!t) throw new HttpError(400, 'no_title', 'The order needs a name.');
    out.title = t;
  }
  if (patch.limit_cents !== undefined) {
    const l = Number(patch.limit_cents);
    if (!Number.isInteger(l) || l <= 0 || l > 100_000) throw new HttpError(400, 'bad_limit', 'Set a per-person limit between $0.01 and $1,000.');
    out.limit_cents = l;
  }
  if (patch.count_cushion !== undefined) out.count_cushion = !!patch.count_cushion;
  if (patch.allow_join !== undefined) out.allow_join = !!patch.allow_join;
  if (patch.cushion_pct !== undefined) {
    const p = Number(patch.cushion_pct);
    if (!Number.isInteger(p) || p < 0 || p > 50) throw new HttpError(400, 'bad_cushion', 'The cushion must be a whole number from 0 to 50.');
    out.cushion_pct = p;
  }
  if (patch.deadline !== undefined) out.deadline = parseDeadline(patch.deadline);
  // Reopening an order whose deadline has passed would reopen nothing.
  if (out.status === 'open' && patch.deadline === undefined && o.deadline && new Date(o.deadline).getTime() <= Date.now()) {
    out.deadline = null;
  }
  update('meal_order', orderId, out);
}

export function rotateFillToken(orderId: string): string {
  getOrder(orderId);
  const t = token(24);
  update('meal_order', orderId, { fill_token: t });
  return t;
}

// ------------------------------------------------------- the student side ---

function inviteByToken(t: string): any {
  const inv = one('SELECT * FROM invite WHERE token=?', String(t ?? ''));
  if (!inv) throw new HttpError(404, 'not_found', 'This link is not valid. Ask your coach for your link.');
  return inv;
}

export function studentView(t: string) {
  const inv = inviteByToken(t);
  const o = getOrder(inv.order_id);
  // Opening a personal link claims the name, so the team link can't hand it to anyone else.
  if (!inv.claimed_at) update('invite', inv.id, { claimed_at: nowIso() });
  const lines = all('SELECT menu_item_id, option_ids, qty, note FROM cart_line WHERE invite_id=? ORDER BY position', inv.id);
  return {
    order: {
      title: o.title,
      restaurant: o.restaurant_name,
      limit_cents: o.limit_cents,
      count_cushion: !!o.count_cushion,
      cushion_pct: o.cushion_pct,
      food_budget_cents: foodBudget({ ...o, count_cushion: !!o.count_cushion }),
      deadline: o.deadline,
      allow_notes: !!o.allow_notes,
    },
    open: isOpen(o),
    name: inv.person_name,
    status: inv.status,
    menu: menuFor(o.id),
    lines: lines.map((l) => ({ menuItemId: l.menu_item_id, optionIds: parseJson(l.option_ids, []), qty: l.qty, note: l.note ?? '' })),
  };
}

/** Replace this person's picks. The whole cart is checked against the limit before anything is written. */
export function saveCart(t: string, rawLines: any): { subtotal_cents: number; counted_cents: number } {
  const inv = inviteByToken(t);
  const o = getOrder(inv.order_id);
  if (!isOpen(o)) throw new HttpError(409, 'closed', 'Ordering has closed for this order.');
  if (!Array.isArray(rawLines)) throw new HttpError(400, 'bad_cart', 'The cart was not readable. Reload and try again.');
  if (rawLines.length > MAX_LINES) throw new HttpError(400, 'too_many', `That's more than ${MAX_LINES} different items.`);
  if (rawLines.length === 0) throw new HttpError(400, 'empty', 'Pick something first, or press "Not eating this time".');

  const menu = new Map(menuFor(o.id).map((m) => [m.id, m]));
  let subtotal = 0;
  const clean: { menuItemId: string; optionIds: string[]; qty: number; note: string | null }[] = [];
  for (const l of rawLines as CartLineIn[]) {
    const item = menu.get(String(l?.menuItemId));
    if (!item) throw new HttpError(400, 'bad_item', 'Something in your cart is not on this menu. Reload the page.');
    const qty = Number(l.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 20) throw new HttpError(400, 'bad_qty', `${item.name}: quantity must be 1 to 20.`);
    const optionIds = Array.isArray(l.optionIds) ? l.optionIds.map(String) : [];
    const bad = validateSelection(item, optionIds);
    if (bad) throw new HttpError(400, 'bad_options', `${item.name}: ${bad}`);
    subtotal += unitPrice(item, optionIds) * qty;
    const note = o.allow_notes ? String(l.note ?? '').trim().slice(0, 120) || null : null;
    clean.push({ menuItemId: item.id, optionIds: orderedOptionIds(item, optionIds), qty, note });
  }
  const order = { ...o, count_cushion: !!o.count_cushion };
  if (!withinLimit(subtotal, order)) {
    throw new HttpError(400, 'over_limit',
      `That's ${fmt(counted(subtotal, order) - o.limit_cents)} over the ${fmt(o.limit_cents)} limit.`);
  }

  tx(() => {
    run('DELETE FROM cart_line WHERE invite_id=?', inv.id);
    clean.forEach((l, i) => insert('cart_line', {
      invite_id: inv.id, menu_item_id: l.menuItemId, option_ids: JSON.stringify(l.optionIds), qty: l.qty, note: l.note, position: i,
    }));
    update('invite', inv.id, { status: 'ordered', submitted_at: nowIso() });
  });
  return { subtotal_cents: subtotal, counted_cents: counted(subtotal, order) };
}

export function skip(t: string): void {
  const inv = inviteByToken(t);
  const o = getOrder(inv.order_id);
  if (!isOpen(o)) throw new HttpError(409, 'closed', 'Ordering has closed for this order.');
  tx(() => {
    run('DELETE FROM cart_line WHERE invite_id=?', inv.id);
    update('invite', inv.id, { status: 'skipped', submitted_at: nowIso() });
  });
}

/** Options in menu order (group, then option), so every copy of the same pick looks the same. */
function orderedOptionIds(item: MenuItem, ids: string[]): string[] {
  const chosen = new Set(ids);
  return item.groups.flatMap((g) => g.options.filter((o) => chosen.has(o.id)).map((o) => o.id));
}

// ------------------------------------------------------------ team link ---

function orderByTeamToken(t: string): any {
  const o = one('SELECT * FROM meal_order WHERE team_token=?', String(t ?? ''));
  if (!o) throw new HttpError(404, 'not_found', 'This order link is not valid. Ask your coach for a new one.');
  return o;
}

/** The names on an order, for the "tap your name" page. Names only: no picks, no totals. */
export function teamView(t: string) {
  const o = orderByTeamToken(t);
  const people = all('SELECT id, person_name, claimed_at FROM invite WHERE order_id=? ORDER BY person_name COLLATE NOCASE', o.id);
  return {
    order: { title: o.title, restaurant: o.restaurant_name, deadline: o.deadline },
    open: isOpen(o),
    can_join: isOpen(o) && !!o.allow_join,
    people: people.map((p) => ({ id: p.id, name: p.person_name, taken: !!p.claimed_at })),
  };
}

/**
 * Hand a person their personal link from the team link, exactly once. After
 * that, only someone holding the personal link (their own browser remembers
 * it) can open that order, so a teammate tapping the wrong name gets refused.
 */
export function claim(t: string, inviteId: string): { token: string } {
  const o = orderByTeamToken(t);
  const inv = one('SELECT * FROM invite WHERE id=? AND order_id=?', String(inviteId ?? ''), o.id);
  if (!inv) throw new HttpError(404, 'not_found', 'That name is not on this order.');
  // Compare-and-set, so two taps at the same moment can't both win.
  const r = run('UPDATE invite SET claimed_at=? WHERE id=? AND claimed_at IS NULL', nowIso(), inv.id);
  if (Number(r.changes) !== 1) {
    throw new HttpError(409, 'taken', `${inv.person_name} has already been picked. If that's you, open this on the device you used before, or ask your coach for your personal link.`);
  }
  return { token: inv.token };
}

/**
 * Someone types their own name on the team link. They join the order (and the
 * roster, so next time their name is there to tap) with the name already
 * claimed by this device.
 *
 * A name already on this order is refused: if it's really them, they tap it in
 * the list. That stops one person reusing a name; it can't stop them inventing
 * a second one, so self-joined names are flagged to the coach, who can remove them.
 */
export function join(t: string, rawName: any): { token: string } {
  const o = orderByTeamToken(t);
  if (!isOpen(o)) throw new HttpError(409, 'closed', 'Ordering has closed for this order.');
  if (!o.allow_join) throw new HttpError(403, 'no_join', 'Your coach adds names for this order. Ask them to add you.');
  const name = cleanName(rawName);
  if (name.length < 2 || !/[\p{L}]/u.test(name)) throw new HttpError(400, 'bad_name', 'Type your first name and last initial.');
  const count = one('SELECT COUNT(*) AS n FROM invite WHERE order_id=?', o.id).n;
  if (count >= MAX_PEOPLE) throw new HttpError(409, 'full', 'This order is full. Ask your coach.');

  return tx(() => {
    let person = one('SELECT * FROM person WHERE lower(name)=lower(?)', name);
    if (person && one('SELECT 1 AS x FROM invite WHERE order_id=? AND person_id=?', o.id, person.id)) {
      throw new HttpError(409, 'name_on_order', `${person.name} is already on this order. If that's you, tap your name in the list. If it's someone else with your name, add your last initial.`);
    }
    if (!person) {
      const pid = insert('person', { name, active: 1, created_at: nowIso() });
      person = { id: pid, name };
    } else if (!person.active) {
      update('person', person.id, { active: 1 });
    }
    const tok = token(18);
    insert('invite', {
      order_id: o.id, person_id: person.id, person_name: person.name, token: tok, status: 'pending',
      claimed_at: nowIso(), self_joined: 1,
    });
    return { token: tok };
  });
}

/** Coach's fix for "someone tapped my name": release it and issue a new personal link. */
export function resetClaim(orderId: string, inviteId: string): void {
  const inv = one('SELECT * FROM invite WHERE id=? AND order_id=?', inviteId, orderId);
  if (!inv) throw new HttpError(404, 'not_found', 'That person is not on this order.');
  update('invite', inv.id, { claimed_at: null, token: token(18) });
}

// ---------------------------------------------------------- the summary ---

export type PersonLine = { item: string; category: string | null; options: string[]; qty: number; note: string | null; cents: number };
export type Person = {
  invite_id: string; name: string; status: string; token: string; submitted_at: string | null; claimed: boolean; self_joined: boolean;
  lines: PersonLine[]; subtotal_cents: number; counted_cents: number; over: boolean;
};
export type ConsolidatedLine = {
  item_id: string;
  category: string | null;
  item: string;
  options: { group: string; name: string }[];
  qty: number;
  note: string | null;
  /** Who this line feeds, for sorting the bags at pickup. */
  who: string[];
  unit_cents: number;
};

export function summaryFor(orderId: string) {
  const o = getOrder(orderId);
  const order = { ...o, count_cushion: !!o.count_cushion };
  const menu = menuFor(orderId);
  const items = new Map(menu.map((m) => [m.id, m]));
  const optInfo = new Map<string, { group: string; name: string }>();
  for (const m of menu) for (const g of m.groups) for (const op of g.options) optInfo.set(op.id, { group: g.name, name: op.name });

  const invites = all('SELECT * FROM invite WHERE order_id=? ORDER BY person_name COLLATE NOCASE', orderId);
  const lines = all(
    `SELECT c.* FROM cart_line c JOIN invite i ON i.id = c.invite_id WHERE i.order_id=? ORDER BY c.position`, orderId);
  const linesBy = new Map<string, any[]>();
  for (const l of lines) linesBy.set(l.invite_id, [...(linesBy.get(l.invite_id) ?? []), l]);

  const people: Person[] = [];
  const merged = new Map<string, ConsolidatedLine & { position: number }>();
  let total = 0;
  for (const inv of invites) {
    const p: Person = {
      invite_id: inv.id, name: inv.person_name, status: inv.status, token: inv.token, submitted_at: inv.submitted_at, claimed: !!inv.claimed_at, self_joined: !!inv.self_joined,
      lines: [], subtotal_cents: 0, counted_cents: 0, over: false,
    };
    for (const l of linesBy.get(inv.id) ?? []) {
      const item = items.get(l.menu_item_id);
      if (!item) continue;
      const ids: string[] = parseJson(l.option_ids, []);
      const unit = unitPrice(item, ids);
      const opts = ids.map((id) => optInfo.get(id)).filter((x): x is { group: string; name: string } => !!x);
      p.lines.push({ item: item.name, category: item.category, options: opts.map((x) => x.name), qty: l.qty, note: l.note, cents: unit * l.qty });
      p.subtotal_cents += unit * l.qty;

      // Identical picks merge into one line with a quantity. A line with a note
      // never merges: "no onions" on a line of five would reach the kitchen as
      // an instruction for all five, or for none.
      const key = l.note ? `note:${l.id}` : `${item.id}|${ids.join(',')}`;
      const c = merged.get(key) ?? {
        item_id: item.id, category: item.category, item: item.name, options: opts, qty: 0, note: l.note ?? null, who: [], unit_cents: unit, position: item.position,
      };
      c.qty += l.qty;
      c.who.push(l.qty > 1 ? `${inv.person_name} ×${l.qty}` : inv.person_name);
      merged.set(key, c);
    }
    p.counted_cents = counted(p.subtotal_cents, order);
    // Raised if the organizer lowered the limit after this person saved.
    p.over = p.subtotal_cents > 0 && !withinLimit(p.subtotal_cents, order);
    total += p.subtotal_cents;
    people.push(p);
  }

  const consolidated = [...merged.values()]
    .sort((a, b) => a.position - b.position || a.options.map((x) => x.name).join().localeCompare(b.options.map((x) => x.name).join()))
    .map(({ position: _p, ...rest }) => rest);

  const counts = { pending: 0, ordered: 0, skipped: 0 } as Record<string, number>;
  for (const p of people) counts[p.status]++;
  return { people, consolidated, total_cents: total, counts };
}

/**
 * What the cart-fill extension reads. Item and option NAMES only: the
 * restaurant's site knows nothing of our ids. No tokens and nothing about the
 * people beyond the first-name labels the coach already sees.
 */
export function manifestFor(fillToken: string) {
  const o = one('SELECT * FROM meal_order WHERE fill_token=?', String(fillToken ?? ''));
  if (!o) throw new HttpError(404, 'not_found', 'This cart-fill link is no longer valid. Copy a fresh one from the order page.');
  const s = summaryFor(o.id);
  const menu = new Map(menuFor(o.id).map((m) => [m.id, m]));
  return {
    format: 'mealconvene.fill/1',
    order: { title: o.title, restaurant: o.restaurant_name, kind: o.restaurant_kind, status: o.status },
    lines: s.consolidated.map((c, i) => {
      const chosen = new Set(c.options.map((x) => `${x.group}\u0000${x.name}`));
      return {
        // Stable for this order's contents, so a ticked line stays ticked across page loads.
        key: `${i}:${c.category ?? ''}:${c.item}:${c.options.map((x) => x.name).join(',')}:${c.qty}`,
        category: c.category, item: c.item, options: c.options, qty: c.qty, note: c.note, who: c.who,
        // Every group with every option, chosen or not. Restaurants pre-tick
        // defaults, and the extension has to untick the ones nobody picked.
        groups: (menu.get(c.item_id)?.groups ?? []).map((g) => ({
          name: g.name, min: g.min_select, max: g.max_select,
          options: g.options.map((op) => ({ name: op.name, chosen: chosen.has(`${g.name}\u0000${op.name}`) })),
        })),
      };
    }),
    total_cents: s.total_cents,
  };
}

export function csvFor(orderId: string): string {
  const s = summaryFor(orderId);
  const esc = (v: any) => {
    let t = String(v ?? '');
    // A cell starting with = + - @ runs as a formula in Excel and Sheets.
    if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
    return `"${t.replace(/"/g, '""')}"`;
  };
  const rows = [['Person', 'Status', 'Section', 'Item', 'Options', 'Qty', 'Note', 'Line total']];
  for (const p of s.people) {
    if (!p.lines.length) rows.push([p.name, p.status, '', '', '', '', '', '']);
    for (const l of p.lines) rows.push([p.name, p.status, l.category ?? '', l.item, l.options.join('; '), String(l.qty), l.note ?? '', (l.cents / 100).toFixed(2)]);
  }
  return rows.map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';
}

export function listOrders() {
  return all(
    `SELECT o.id, o.title, o.restaurant_name, o.status, o.deadline, o.limit_cents, o.created_at,
       (SELECT COUNT(*) FROM invite i WHERE i.order_id=o.id) AS people,
       (SELECT COUNT(*) FROM invite i WHERE i.order_id=o.id AND i.status='ordered') AS ordered,
       (SELECT COUNT(*) FROM invite i WHERE i.order_id=o.id AND i.status='skipped') AS skipped
     FROM meal_order o ORDER BY o.created_at DESC`,
  ).map((o) => ({ ...o, open: isOpen(o) }));
}

export function deleteOrder(orderId: string): void {
  getOrder(orderId);
  run('DELETE FROM meal_order WHERE id=?', orderId);
}
