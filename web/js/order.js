// A student's own order page, opened from their personal link.

import { h, api, when, fill } from './util.js';
import { fmt, unitPrice, validateSelection, groupHint, counted } from './pricing.js';

const token = location.pathname.split('/').filter(Boolean)[1];
const view = document.getElementById('view');
const tray = document.getElementById('tray');
const dlg = document.getElementById('pick');

let data = null;
let lines = [];          // { key, menuItemId, optionIds, qty, note }
let nextKey = 1;
let dirty = false;
let message = null;      // { kind: 'ok' | 'stop', text }
let byId = new Map();

const sig = (ids) => [...ids].sort().join(',');

async function load() {
  try {
    data = await api('GET', `/api/o/${encodeURIComponent(token)}`);
  } catch (err) {
    fill(view, h('div', { class: 'card' }, h('h1', { text: 'Link not found' }), h('p', { text: err.message })));
    return;
  }
  byId = new Map(data.menu.map((m) => [m.id, m]));
  lines = data.lines.map((l) => ({ key: nextKey++, ...l }));
  document.title = `${data.order.title} · MealConvene`;
  render();
}

const subtotal = () => lines.reduce((s, l) => { const m = byId.get(l.menuItemId); return m ? s + unitPrice(m, l.optionIds) * l.qty : s; }, 0);
const optionNames = (m, ids) => m.groups.flatMap((g) => g.options).filter((o) => ids.includes(o.id)).map((o) => o.name).join(', ');

function change(fn) { fn(); dirty = true; message = null; render(); }

function render() {
  const { order } = data;
  const open = data.open;
  const sections = new Map();
  for (const m of data.menu) {
    const key = m.category ?? 'Menu';
    sections.set(key, [...(sections.get(key) ?? []), m]);
  }

  const limitLine = order.count_cushion && order.cushion_pct > 0
    ? `${fmt(order.limit_cents)} each, tax and tip included. That's about ${fmt(order.food_budget_cents)} of food.`
    : `${fmt(order.limit_cents)} each.`;

  const statusNote = data.status === 'skipped'
    ? h('p', { class: 'note' }, 'You said you are not eating this time. Pick something below if that changed.')
    : data.status === 'ordered' && !dirty
      ? h('p', { class: 'note ok' }, 'Your order is saved. You can change it until ordering closes.')
      : null;

  fill(view, 
    h('header', {},
      h('h1', { text: order.title }),
      h('p', { class: 'muted' }, `${order.restaurant} · ${limitLine}`),
      order.deadline ? h('p', { class: 'small muted' }, `Ordering closes ${when(order.deadline)}.`) : null,
      h('p', {}, 'Ordering as ', h('strong', { text: data.name }), '.'),
    ),
    !open ? h('p', { class: 'note warn', role: 'status' }, 'Ordering is closed. Ask your coach if you need a change.') : null,
    statusNote,
    ...[...sections].map(([name, items]) => h('section', {},
      h('h2', { text: name }),
      h('div', { class: 'card' }, items.map((m) => h('div', { class: 'menu-item' },
        h('div', {}, h('div', { text: m.name, style: 'font-weight:600' }),
          h('div', { class: 'small muted' }, fmt(m.price_cents), m.groups.length ? ' · choose options' : '')),
        h('button', { class: 'btn small', disabled: !open, 'aria-label': `Add ${m.name}`, onclick: () => openPicker(m) }, 'Add'),
      ))),
    )),
    h('h2', { text: 'Your order' }),
    h('div', { class: 'card' }, lines.length === 0
      ? h('p', { class: 'muted' }, 'Nothing yet. Press Add on something above.')
      : h('ul', { class: 'list' }, lines.map(lineRow))),
    open ? h('p', { class: 'small', style: 'margin-top:1rem' },
      h('button', { class: 'btn ghost small', onclick: notEating }, 'Not eating this time')) : null,
  );
  renderTray();
}

function lineRow(l) {
  const m = byId.get(l.menuItemId);
  if (!m) return null;
  const open = data.open;
  const setQty = (q) => change(() => {
    lines = q <= 0 ? lines.filter((x) => x.key !== l.key) : lines.map((x) => (x.key === l.key ? { ...x, qty: Math.min(20, q) } : x));
  });
  return h('li', {},
    h('div', { class: 'between' },
      h('div', {},
        h('div', { text: m.name, style: 'font-weight:600' }),
        optionNames(m, l.optionIds) ? h('div', { class: 'opts' }, optionNames(m, l.optionIds)) : null,
        h('div', { class: 'small num' }, fmt(unitPrice(m, l.optionIds) * l.qty)),
        m.groups.length && open ? h('button', { class: 'btn ghost small', style: 'margin-top:.35rem', onclick: () => openPicker(m, l) }, 'Change') : null,
      ),
      h('div', { class: 'qty' },
        h('button', { 'aria-label': l.qty === 1 ? `Remove ${m.name}` : `One fewer ${m.name}`, disabled: !open, onclick: () => setQty(l.qty - 1) }, l.qty === 1 ? '×' : '−'),
        h('span', { class: 'num', text: String(l.qty) }),
        h('button', { 'aria-label': `One more ${m.name}`, disabled: !open || l.qty >= 20, onclick: () => setQty(l.qty + 1) }, '+'),
      ),
    ),
    data.order.allow_notes ? h('input', {
      type: 'text', 'aria-label': `Note for ${m.name}`, placeholder: 'Note for the kitchen (optional)', maxlength: '120',
      value: l.note ?? '', disabled: !open,
      oninput: (e) => { lines = lines.map((x) => (x.key === l.key ? { ...x, note: e.target.value } : x)); dirty = true; renderTray(); },
    }) : null,
  );
}

function renderTray() {
  const { order } = data;
  const sub = subtotal();
  const c = counted(sub, order);
  const over = c > order.limit_cents;
  const pct = Math.min(100, (c / order.limit_cents) * 100);
  tray.hidden = false;
  fill(tray, h('div', { class: 'inner' },
    h('div', { class: 'between small' },
      h('span', { class: 'num' }, fmt(sub), order.count_cushion && order.cushion_pct ? ` food · ${fmt(c)} with tax and tip` : ''),
      h('strong', { class: over ? 'error num' : 'num' }, over ? `${fmt(c - order.limit_cents)} over` : `${fmt(order.limit_cents - c)} left`),
    ),
    h('div', { class: `bar${over ? ' over' : ''}`, role: 'progressbar', 'aria-label': 'Spent of your limit',
      'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(pct)) }, h('div', { style: `width:${pct}%` })),
    message ? h('p', { class: message.kind === 'ok' ? 'note ok small' : 'note stop small', role: 'status' }, message.text) : null,
    h('button', { class: 'btn block', disabled: !data.open || over || lines.length === 0 || (!dirty && data.status === 'ordered'), onclick: save },
      over ? 'Over your limit' : data.status === 'ordered' && !dirty ? 'Saved' : 'Save my order'),
  ));
}

async function save() {
  try {
    await api('PUT', `/api/o/${encodeURIComponent(token)}/cart`, {
      lines: lines.map(({ menuItemId, optionIds, qty, note }) => ({ menuItemId, optionIds, qty, note })),
    });
    data.status = 'ordered';
    dirty = false;
    message = { kind: 'ok', text: 'Saved. Your coach will see it.' };
  } catch (err) {
    message = { kind: 'stop', text: err.message };
    if (err.code === 'closed') data.open = false;
  }
  render();
}

async function notEating() {
  if (lines.length && !confirm('Clear your picks and tell your coach you are not eating?')) return;
  try {
    await api('POST', `/api/o/${encodeURIComponent(token)}/skip`, {});
    lines = []; dirty = false; data.status = 'skipped';
    message = { kind: 'ok', text: 'Got it. Your coach will see you are not eating.' };
  } catch (err) {
    message = { kind: 'stop', text: err.message };
  }
  render();
}

// ------------------------------------------------------------ the picker ---

function toggle(ids, g, id) {
  const inGroup = new Set(g.options.map((o) => o.id));
  if (ids.includes(id)) {
    // A required pick-one can be switched, not emptied.
    if (g.max_select === 1 && g.min_select >= 1) return ids;
    return ids.filter((x) => x !== id);
  }
  if (g.max_select === 1) return [...ids.filter((x) => !inGroup.has(x)), id];
  if (ids.filter((x) => inGroup.has(x)).length >= g.max_select) return ids;
  return [...ids, id];
}

function openPicker(m, editing = null) {
  if (!m.groups.length) {
    change(() => {
      const i = lines.findIndex((l) => l.menuItemId === m.id && !l.optionIds.length && !l.note);
      if (i >= 0) lines[i] = { ...lines[i], qty: Math.min(20, lines[i].qty + 1) };
      else lines.push({ key: nextKey++, menuItemId: m.id, optionIds: [], qty: 1, note: '' });
    });
    return;
  }
  let ids = editing ? [...editing.optionIds] : [];
  let qty = editing ? editing.qty : 1;
  let tried = false;

  const draw = () => {
    const err = validateSelection(m, ids);
    const unit = unitPrice(m, ids);
    fill(dlg, 
      h('div', { class: 'body' },
        h('div', { class: 'between' }, h('h2', { id: 'pick-title', text: m.name, style: 'margin:0' }),
          h('button', { class: 'btn ghost small', onclick: () => dlg.close(), 'aria-label': 'Close' }, '×')),
        m.groups.map((g) => {
          const chosen = g.options.filter((o) => ids.includes(o.id)).length;
          const full = g.max_select > 1 && chosen >= g.max_select;
          return h('fieldset', { role: g.max_select === 1 ? 'radiogroup' : 'group' },
            h('legend', {}, g.name, ' ', h('span', { class: 'muted small' }, `· ${groupHint(g)}`)),
            g.options.map((o) => {
              const on = ids.includes(o.id);
              return h('button', {
                type: 'button', class: 'choice', role: g.max_select === 1 ? 'radio' : 'checkbox', 'aria-checked': on ? 'true' : 'false',
                disabled: !on && full,
                onclick: () => { ids = toggle(ids, g, o.id); draw(); },
              }, h('span', { text: o.name }), o.price_cents ? h('span', { class: 'small num' }, `+${fmt(o.price_cents)}`) : null);
            }),
          );
        }),
      ),
      h('div', { class: 'foot' },
        h('div', { class: 'qty' },
          h('button', { type: 'button', 'aria-label': 'Fewer', onclick: () => { qty = Math.max(1, qty - 1); draw(); } }, '−'),
          h('span', { class: 'num', text: String(qty) }),
          h('button', { type: 'button', 'aria-label': 'More', onclick: () => { qty = Math.min(20, qty + 1); draw(); } }, '+'),
        ),
        h('div', { style: 'flex:1' },
          tried && err ? h('div', { class: 'error small', role: 'alert' }, err) : null,
          h('button', {
            class: 'btn block', type: 'button',
            onclick: () => {
              if (err) { tried = true; draw(); return; }
              change(() => {
                if (editing) lines = lines.map((x) => (x.key === editing.key ? { ...x, optionIds: ids, qty } : x));
                else {
                  const i = lines.findIndex((l) => l.menuItemId === m.id && sig(l.optionIds) === sig(ids) && !l.note);
                  if (i >= 0) lines[i] = { ...lines[i], qty: Math.min(20, lines[i].qty + qty) };
                  else lines.push({ key: nextKey++, menuItemId: m.id, optionIds: ids, qty, note: '' });
                }
              });
              dlg.close();
            },
          }, `${editing ? 'Update' : 'Add'} · ${fmt(unit * qty)}`),
        ),
      ),
    );
  };
  draw();
  dlg.showModal();
}

window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

load();
