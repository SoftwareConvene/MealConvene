// Invariant tests. Each one is a claim MealConvene makes about itself; if one
// fails, that claim is no longer true. Run: npm test

import { readFileSync } from 'node:fs';
import { migrate, insert, nowIso, one, all, run } from '../src/db/db.ts';
import { parseMenu } from '../src/core/menu.ts';
import { createOrganizer, login, actorFor } from '../src/core/auth.ts';
import { addPeople as addToRoster, createRestaurant, updateRestaurant, getRestaurant, listPeople } from '../src/core/roster.ts';
import {
  createOrder, studentView, saveCart, skip, summaryFor, manifestFor, csvFor, updateOrder, teamView, claim, resetClaim, menuFor, join,
} from '../src/core/orders.ts';
import { counted, foodBudget, toCents, validateSelection, unitPrice } from '../web/js/pricing.js';

let passed = 0, failed = 0;
function check(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err: any) { failed++; console.log(`  FAIL ${name}\n       ${err.message}`); }
}
function assert(cond: any, msg: string) { if (!cond) throw new Error(msg); }
function eq(a: any, b: any, msg: string) { if (a !== b) throw new Error(`${msg} (got ${JSON.stringify(a)}, expected ${JSON.stringify(b)})`); }
function throws(fn: () => void, code: string, msg: string) {
  try { fn(); } catch (err: any) { if (err.code === code) return; throw new Error(`${msg}: threw ${err.code ?? err.message}, expected ${code}`); }
  throw new Error(`${msg}: did not throw`);
}

migrate();
const organizerId = createOrganizer('coach@example.invalid', 'Coach', 'demo12345');
addToRoster('Student 1\nStudent 2\nStudent 3\nCoach');
const people = listPeople();
const personIds = people.map((p: any) => p.id);
const subwayId = createRestaurant({ name: 'Subway', kind: 'subway', menu_text: '' });

function confirmPrices(rid: string, menuText?: string) {
  const r = getRestaurant(rid);
  updateRestaurant(rid, { ...r, menu_text: menuText ?? r.menu_text, prices_confirmed: true });
}
function newOrder(over: any = {}) {
  return createOrder(organizerId, { restaurant_id: subwayId, title: 'Build lunch', limit_cents: 1500, cushion_pct: 7, person_ids: personIds, ...over });
}
function tokenFor(orderId: string, name: string) {
  return one('SELECT token FROM invite WHERE order_id=? AND person_name=?', orderId, name).token;
}
function pick(orderId: string, item: string, choices: Record<string, string[]>, category = 'Sandwiches') {
  const m = menuFor(orderId).find((x) => x.name === item && x.category === category)!;
  const ids: string[] = [];
  for (const [g, names] of Object.entries(choices)) {
    const grp = m.groups.find((x) => x.name === g)!;
    for (const n of names) ids.push(grp.options.find((o) => o.name === n)!.id);
  }
  return { menuItemId: m.id, optionIds: ids };
}
const BMT6 = { Size: ['6 Inch'], Bread: ['Hearty Multigrain'], Toasting: ['Toasted'] };
const BMT12 = { Size: ['Footlong'], Bread: ['Artisan Italian'], Toasting: ['Toasted'], Veggies: ['Lettuce'] };

console.log('\nThe menu');

check('the Subway template parses with no errors', () => {
  const r = parseMenu(readFileSync(new URL('../src/core/templates/subway.txt', import.meta.url), 'utf8'));
  eq(r.errors.length, 0, 'errors');
  assert(r.items.length > 25, 'expected the full sandwich list');
});

check('trademark punctuation survives: B.M.T.® keeps its dots', () => {
  const r = parseMenu('Subs\nB.M.T.® – 7.49');
  eq(r.items[0].name, 'B.M.T.®', 'name');
  eq(r.items[0].price_cents, 749, 'price');
});

check('a section group applies to every item; an item group with the same name replaces it in place', () => {
  const r = parseMenu('Subs\n> Size (pick 1)\n- 6 Inch\n- Footlong +5.00\n> Bread (pick 1)\n- White\nA – 5.00\nB – 6.00\n> Size (pick 1)\n- 6 Inch\n- Footlong +6.00\nDrinks\nWater – 1.00');
  eq(r.items[0].groups.map((g) => g.name).join(), 'Size,Bread', 'A inherits');
  eq(r.items[1].groups[0].name, 'Size', 'override stays first');
  eq(r.items[1].groups[0].options[1].price_cents, 600, 'override price');
  eq(r.items[2].groups.length, 0, 'a new heading clears section groups');
});

check('group rules read correctly', () => {
  const g = parseMenu('X – 1\n> A (pick 2-3)\n- a\n- b\n- c\n> B (up to 2)\n- a\n> C (optional)\n- a').items[0].groups;
  eq(`${g[0].min}-${g[0].max}`, '2-3', 'pick 2-3');
  eq(`${g[1].min}-${g[1].max}`, '0-2', 'up to 2');
  eq(`${g[2].min}-${g[2].max}`, '0-1', 'optional');
});

check('a group that asks for more options than it lists is an error', () => {
  const r = parseMenu('X – 1\n> A (pick 2)\n- only one');
  assert(r.errors.some((e) => /asks for 2/.test(e.message)), JSON.stringify(r.errors));
});

check('the same item name may appear in two sections, but not twice in one', () => {
  eq(parseMenu('Subs\nTuna – 7\nWraps\nTuna – 8').errors.length, 0, 'two sections');
  assert(parseMenu('Subs\nTuna – 7\nTuna – 8').errors.length > 0, 'one section');
});

console.log('\nPrices and the limit');

check('dollars typed by a person become cents', () => {
  eq(toCents('15'), 1500, '15'); eq(toCents('$12.50'), 1250, '$12.50'); assert(Number.isNaN(toCents('twelve')), 'words');
});

check('the cushion rounds UP, so it never lets a cent slip over', () => {
  eq(counted(1001, { count_cushion: true, cushion_pct: 7 }), 1072, '10.01 * 1.07 = 10.7107');
  eq(counted(1001, { count_cushion: false, cushion_pct: 7 }), 1001, 'off');
});

check('the food budget shown to students never exceeds what the server allows', () => {
  for (const limit of [500, 999, 1500, 2000, 1234]) for (const pct of [0, 7, 10, 15, 33]) {
    const o = { count_cushion: true, cushion_pct: pct, limit_cents: limit };
    assert(counted(foodBudget(o), o) <= limit, `limit ${limit} pct ${pct}`);
  }
});

check('a selection must satisfy every group, and options must belong to the item', () => {
  const item = { price_cents: 500, groups: [{ id: 'g', name: 'Bread', min_select: 1, max_select: 1, options: [{ id: 'a', name: 'A', price_cents: 0 }, { id: 'b', name: 'B', price_cents: 100 }] }] };
  assert(validateSelection(item, []), 'missing required');
  assert(validateSelection(item, ['a', 'b']), 'too many');
  assert(validateSelection(item, ['zzz']), 'foreign option');
  assert(validateSelection(item, ['a', 'a']), 'duplicate');
  eq(validateSelection(item, ['b']), null, 'valid');
  eq(unitPrice(item, ['b']), 600, 'upcharge');
});

console.log('\nOrders');

check('no order can open on unchecked prices', () => {
  throws(() => newOrder(), 'prices_unconfirmed', 'template prices');
  confirmPrices(subwayId);
});

const orderId = newOrder();

check('an order keeps its own menu: editing the restaurant later changes nothing in it', () => {
  const before = menuFor(orderId).length;
  confirmPrices(subwayId, 'Subs\nOnly Thing – 1.00');
  eq(menuFor(orderId).length, before, 'menu unchanged');
  confirmPrices(subwayId, readFileSync(new URL('../src/core/templates/subway.txt', import.meta.url), 'utf8'));
});

check('the server enforces the limit, cushion included', () => {
  const t = tokenFor(orderId, 'Student 1');
  throws(() => saveCart(t, [{ ...pick(orderId, 'B.M.T.®', BMT12), qty: 2 }]), 'over_limit', 'two footlongs');
  const ok = saveCart(t, [{ ...pick(orderId, 'B.M.T.®', BMT12), qty: 1 }]);
  eq(ok.subtotal_cents, 1249, 'footlong price');
});

check('a cart that misses a required choice is refused', () => {
  const t = tokenFor(orderId, 'Student 2');
  throws(() => saveCart(t, [{ ...pick(orderId, 'B.M.T.®', { Size: ['6 Inch'], Toasting: ['Toasted'] }), qty: 1 }]), 'bad_options', 'no bread');
});

check('an item from a different order is refused', () => {
  const other = newOrder({ title: 'Other' });
  const foreign = pick(other, 'Tuna', BMT6);
  throws(() => saveCart(tokenFor(orderId, 'Student 2'), [{ ...foreign, qty: 1 }]), 'bad_item', 'foreign item');
  run('DELETE FROM meal_order WHERE id=?', other);
});

check('saving again replaces the cart instead of adding to it', () => {
  const t = tokenFor(orderId, 'Student 2');
  saveCart(t, [{ ...pick(orderId, 'B.M.T.®', BMT6), qty: 1 }]);
  saveCart(t, [{ ...pick(orderId, 'B.M.T.®', BMT6), qty: 1 }]);
  const inv = one('SELECT id FROM invite WHERE token=?', t);
  eq(all('SELECT * FROM cart_line WHERE invite_id=?', inv.id).length, 1, 'one line');
});

check('Subway orders drop notes: the site has nowhere to put them', () => {
  const t = tokenFor(orderId, 'Student 3');
  saveCart(t, [{ ...pick(orderId, 'B.M.T.®', BMT6), qty: 1, note: 'no onions' }]);
  const inv = one('SELECT id FROM invite WHERE token=?', t);
  eq(one('SELECT note FROM cart_line WHERE invite_id=?', inv.id).note, null, 'note');
});

check('identical picks merge into one line with a quantity, whatever order the options came in', () => {
  const s = summaryFor(orderId);
  const bmt6 = s.consolidated.find((c) => c.item === 'B.M.T.®' && c.options[0].name === '6 Inch')!;
  eq(bmt6.qty, 2, 'Student 2 + Student 3');
  eq(bmt6.who.join(), 'Student 2,Student 3', 'who');
});

check('lines with notes never merge', () => {
  const rid = createRestaurant({ name: 'Pizza', kind: 'other', menu_text: 'Slice – 3.00', prices_confirmed: true });
  const o = createOrder(organizerId, { restaurant_id: rid, title: 'Pizza', limit_cents: 2000, person_ids: personIds });
  const slice = menuFor(o)[0].id;
  saveCart(tokenFor(o, 'Student 1'), [{ menuItemId: slice, optionIds: [], qty: 1, note: 'no cheese' }]);
  saveCart(tokenFor(o, 'Student 2'), [{ menuItemId: slice, optionIds: [], qty: 1 }]);
  saveCart(tokenFor(o, 'Student 3'), [{ menuItemId: slice, optionIds: [], qty: 1 }]);
  const lines = summaryFor(o).consolidated;
  eq(lines.length, 2, 'two lines');
  eq(lines.find((l) => l.note)!.qty, 1, 'the noted slice stands alone');
  eq(lines.find((l) => !l.note)!.qty, 2, 'the plain ones merge');
});

check('skipping clears picks and says so', () => {
  const t = tokenFor(orderId, 'Coach');
  saveCart(t, [{ ...pick(orderId, 'B.M.T.®', BMT6), qty: 1 }]);
  skip(t);
  const s = summaryFor(orderId);
  const coach = s.people.find((p) => p.name === 'Coach')!;
  eq(coach.status, 'skipped', 'status'); eq(coach.lines.length, 0, 'lines');
});

check('a closed order takes no changes', () => {
  updateOrder(orderId, { status: 'closed' });
  throws(() => saveCart(tokenFor(orderId, 'Student 3'), [{ ...pick(orderId, 'B.M.T.®', BMT6), qty: 1 }]), 'closed', 'save');
  throws(() => skip(tokenFor(orderId, 'Student 3')), 'closed', 'skip');
  updateOrder(orderId, { status: 'open' });
});

check('a passed deadline closes the order by itself, and reopening clears it', () => {
  updateOrder(orderId, { deadline: new Date(Date.now() - 60_000).toISOString() });
  eq(studentView(tokenFor(orderId, 'Student 3')).open, false, 'closed by deadline');
  updateOrder(orderId, { status: 'open' });
  eq(studentView(tokenFor(orderId, 'Student 3')).open, true, 'reopened');
});

check('lowering the limit flags people already over it, without touching their picks', () => {
  updateOrder(orderId, { limit_cents: 1000 });
  const s = summaryFor(orderId);
  assert(s.people.find((p) => p.name === 'Student 1')!.over, 'Student 1 over');
  assert(!s.people.find((p) => p.name === 'Student 2')!.over, 'Student 2 fine');
  eq(s.people.find((p) => p.name === 'Student 1')!.lines.length, 1, 'picks kept');
  updateOrder(orderId, { limit_cents: 1500 });
});

console.log('\nWho is who');

check('the team link hands out each name exactly once', () => {
  const o = newOrder({ title: 'Claims' });
  const team = one('SELECT team_token FROM meal_order WHERE id=?', o).team_token;
  const s1 = teamView(team).people.find((p) => p.name === 'Student 1')!;
  const first = claim(team, s1.id);
  assert(first.token, 'first claim');
  throws(() => claim(team, s1.id), 'taken', 'second claim');
  eq(teamView(team).people.find((p) => p.name === 'Student 1')!.taken, true, 'shows taken');
});

check('opening a personal link claims the name, so the team link cannot reissue it', () => {
  const o = newOrder({ title: 'Claims 2' });
  const team = one('SELECT team_token FROM meal_order WHERE id=?', o).team_token;
  studentView(tokenFor(o, 'Student 2'));
  const s2 = teamView(team).people.find((p) => p.name === 'Student 2')!;
  throws(() => claim(team, s2.id), 'taken', 'claim after personal open');
});

check('a reset retires the old personal link and frees the name; picks are kept', () => {
  const o = newOrder({ title: 'Claims 3' });
  const team = one('SELECT team_token FROM meal_order WHERE id=?', o).team_token;
  const old = tokenFor(o, 'Student 3');
  saveCart(old, [{ ...pick(o, 'B.M.T.®', BMT6), qty: 1 }]);
  const inv = one('SELECT id FROM invite WHERE token=?', old);
  resetClaim(o, inv.id);
  throws(() => studentView(old), 'not_found', 'old link');
  const fresh = claim(team, inv.id).token;
  eq(studentView(fresh).lines.length, 1, 'picks kept');
});

check('the team view shows names only: no picks, no money, no links', () => {
  const o = newOrder({ title: 'Privacy' });
  const team = one('SELECT team_token FROM meal_order WHERE id=?', o).team_token;
  const text = JSON.stringify(teamView(team));
  for (const k of ['token', 'cents', 'lines', 'status']) assert(!text.includes(`"${k}`), `team view leaks ${k}`);
});

check('there is no way to get a second limit: one invite per person per order', () => {
  const o = newOrder({ title: 'Dup' });
  eq(all('SELECT * FROM invite WHERE order_id=?', o).length, personIds.length, 'one each');
  throws(() => insert('invite', { order_id: o, person_id: personIds[0], person_name: 'x', token: 'dup-token-x', status: 'pending' }), 'ERR_SQLITE_ERROR', 'unique (order, person)');
});

console.log('\nWhat leaves the building');

check('the cart-fill manifest carries names and choices, never a personal link', () => {
  const m = manifestFor(one('SELECT fill_token FROM meal_order WHERE id=?', orderId).fill_token);
  const text = JSON.stringify(m);
  for (const inv of all('SELECT token FROM invite WHERE order_id=?', orderId)) assert(!text.includes(inv.token), 'personal token in manifest');
  assert(!text.includes(one('SELECT team_token FROM meal_order WHERE id=?', orderId).team_token), 'team token in manifest');
});

check('the manifest lists every option per group, so pre-ticked defaults can be unticked', () => {
  const m = manifestFor(one('SELECT fill_token FROM meal_order WHERE id=?', orderId).fill_token);
  const line = m.lines[0];
  const veg = line.groups.find((g: any) => g.name === 'Veggies');
  assert(veg.options.length > 5, 'all veggies listed');
  eq(veg.options.filter((o: any) => o.chosen).length, line.options.filter((o: any) => o.group === 'Veggies').length, 'chosen flags match');
});

check('a CSV cell starting with = + - @ cannot run as a formula', () => {
  addToRoster('=HYPERLINK("http://evil")');
  const p = one(`SELECT id FROM person WHERE name LIKE '=HYPER%'`);
  const o = newOrder({ title: 'CSV', person_ids: [p.id] });
  const csv = csvFor(o);
  assert(csv.includes(`"'=HYPERLINK`), csv);
});

check('typing a name on the team link joins the order, claimed, tagged, and on the roster', () => {
  const o = newOrder({ title: 'Join', person_ids: [] });
  const team = one('SELECT team_token FROM meal_order WHERE id=?', o).team_token;
  const { token: t } = join(team, '  Student   9 ');
  const inv = one('SELECT * FROM invite WHERE token=?', t);
  eq(inv.person_name, 'Student 9', 'name cleaned');
  assert(inv.claimed_at, 'claimed'); eq(inv.self_joined, 1, 'tagged');
  assert(one('SELECT 1 AS x FROM person WHERE name=?', 'Student 9'), 'on roster');
  eq(teamView(team).people.find((p) => p.name === 'Student 9')!.taken, true, 'shows picked');
});

check('a name already on the order cannot be typed again, in any case', () => {
  const o = newOrder({ title: 'Join 2' });
  const team = one('SELECT team_token FROM meal_order WHERE id=?', o).team_token;
  throws(() => join(team, 'student 1'), 'name_on_order', 'same name');
});

check('joining is refused when the coach turned it off, or the order is closed', () => {
  const o = newOrder({ title: 'Join 3', allow_join: false });
  const team = one('SELECT team_token FROM meal_order WHERE id=?', o).team_token;
  throws(() => join(team, 'Student 10'), 'no_join', 'off');
  eq(teamView(team).can_join, false, 'team view says so');
  updateOrder(o, { allow_join: true, status: 'closed' });
  throws(() => join(team, 'Student 10'), 'closed', 'closed');
});

check('an order with nobody on it is fine only if people can add themselves', () => {
  throws(() => newOrder({ person_ids: [], allow_join: false }), 'no_people', 'empty and closed to joins');
  assert(newOrder({ person_ids: [] }), 'empty but open to joins');
});

check('a blank or junk name is refused', () => {
  const o = newOrder({ title: 'Join 4' });
  const team = one('SELECT team_token FROM meal_order WHERE id=?', o).team_token;
  throws(() => join(team, ' '), 'bad_name', 'blank');
  throws(() => join(team, '99'), 'bad_name', 'digits only');
});

check('sessions: a good password signs in, a bad one does not', () => {
  const t = login('coach@example.invalid', 'demo12345');
  eq(actorFor(t)?.email, 'coach@example.invalid', 'actor');
  throws(() => login('coach@example.invalid', 'wrong-password'), 'bad_login', 'bad password');
  eq(actorFor('not-a-token'), null, 'junk token');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
