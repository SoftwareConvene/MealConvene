// The organizer's app. Hash routes, one view at a time, no framework.

import { h, api, copy, when, fill } from './util.js';
import { fmt, toCents } from './pricing.js';

const view = document.getElementById('view');
const topbar = document.getElementById('topbar');
let me = null;

document.getElementById('signout').addEventListener('click', async () => {
  await api('POST', '/api/logout', {}).catch(() => {});
  me = null;
  location.hash = '#/';
  route();
});

const field = (label, input, hint) => h('label', {}, label, input, hint ? h('span', { class: 'small muted', style: 'font-weight:400' }, hint) : null);
const errorBox = () => h('p', { class: 'error', role: 'alert', hidden: true });
const showError = (box, err) => { box.textContent = err?.message ?? String(err); box.hidden = false; };
const origin = () => location.origin;

async function route() {
  const hash = location.hash.replace(/^#/, '') || '/';
  try {
    if (!me) {
      const s = await api('GET', '/api/me');
      me = s.me;
      if (!me) { topbar.hidden = true; return s.needs_setup ? setupView() : loginView(); }
    }
    topbar.hidden = false;
    for (const a of topbar.querySelectorAll('nav a')) {
      const target = a.getAttribute('href').slice(1);
      const here = target === '/' ? (hash === '/' || hash.startsWith('/order') || hash === '/new') : hash.startsWith(target);
      if (here) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    }
    let m;
    if (hash === '/') await ordersView();
    else if (hash === '/new') await newOrderView();
    else if ((m = hash.match(/^\/order\/(.+)$/))) await orderView(m[1]);
    else if (hash === '/people') await peopleView();
    else if (hash === '/restaurants') await restaurantsView();
    else if ((m = hash.match(/^\/restaurant\/(.+)$/))) await restaurantView(m[1]);
    else if (hash === '/account') await accountView();
    else fill(view, h('p', {}, 'Not found. ', h('a', { href: '#/' }, 'Back to orders')));
  } catch (err) {
    if (err.status === 401) { me = null; return route(); }
    fill(view, h('p', { class: 'note stop' }, err.message));
  }
  view.focus({ preventScroll: true });
}
window.addEventListener('hashchange', route);

// ----------------------------------------------------------- sign in ---

function setupView() {
  const err = errorBox();
  const email = h('input', { type: 'email', autocomplete: 'username', required: true });
  const name = h('input', { type: 'text', autocomplete: 'name', required: true });
  const pw = h('input', { type: 'password', autocomplete: 'new-password', minlength: '8', required: true });
  fill(view, h('form', {
    class: 'card stack', onsubmit: async (e) => {
      e.preventDefault();
      try { await api('POST', '/api/setup', { email: email.value, name: name.value, password: pw.value }); me = null; route(); }
      catch (x) { showError(err, x); }
    },
  },
  h('h1', {}, 'Set up MealConvene'),
  h('p', { class: 'muted' }, 'Create the first organizer account. Students never need an account.'),
  field('Your name', name), field('Email', email), field('Password', pw, 'At least 8 characters.'),
  err, h('button', { class: 'btn', type: 'submit' }, 'Create account')));
}

function loginView() {
  const err = errorBox();
  const email = h('input', { type: 'email', autocomplete: 'username', required: true });
  const pw = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  fill(view, h('form', {
    class: 'card stack', onsubmit: async (e) => {
      e.preventDefault();
      try { await api('POST', '/api/login', { email: email.value, password: pw.value }); me = null; route(); }
      catch (x) { showError(err, x); }
    },
  },
  h('div', { class: 'row' }, h('img', { src: '/img/mark.svg', alt: '', width: 36, height: 36 }), h('h1', { style: 'margin:0' }, 'MealConvene')),
  h('p', { class: 'muted' }, 'Team meal orders: everyone picks their own, under one limit.'),
  field('Email', email), field('Password', pw), err, h('button', { class: 'btn', type: 'submit' }, 'Sign in')));
}

// ------------------------------------------------------------ orders ---

async function ordersView() {
  const { orders } = await api('GET', '/api/orders');
  fill(view, 
    h('div', { class: 'between' }, h('h1', {}, 'Orders'), h('a', { class: 'btn', href: '#/new' }, 'New order')),
    orders.length === 0
      ? h('div', { class: 'card' }, h('p', {}, 'No orders yet.'),
        h('p', { class: 'muted small' }, 'Start with the Roster (who eats) and Restaurants (what they can pick), then make an order.'))
      : h('div', {}, orders.map((o) => h('a', { class: 'card', href: `#/order/${o.id}`, style: 'display:block;text-decoration:none;color:inherit' },
        h('div', { class: 'between' }, h('strong', { text: o.title }), h('span', { class: `chip ${o.open ? 'ordered' : 'skipped'}` }, o.open ? 'Open' : 'Closed')),
        h('div', { class: 'small muted' }, `${o.restaurant_name} · ${fmt(o.limit_cents)} each · ${o.ordered} ordered, ${o.skipped} not eating, ${o.people - o.ordered - o.skipped} waiting`),
      ))),
  );
}

async function newOrderView() {
  const [{ restaurants }, { people }] = await Promise.all([api('GET', '/api/restaurants'), api('GET', '/api/people')]);
  if (!restaurants.length) {
    fill(view, h('h1', {}, 'New order'), h('div', { class: 'card stack' },
      h('p', {}, 'Add a restaurant first: ', h('a', { href: '#/restaurants' }, 'Restaurants'), '.')));
    return;
  }
  const err = errorBox();
  const rest = h('select', {}, restaurants.map((r) => h('option', { value: r.id }, r.name + (r.store_label ? ` (${r.store_label})` : ''))));
  const warn = h('p', { class: 'note warn small', hidden: true });
  const today = new Date().toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  const title = h('input', { type: 'text', maxlength: '80' });
  const limit = h('input', { type: 'text', inputmode: 'decimal', value: '15.00' });
  const cushionOn = h('input', { type: 'checkbox', checked: true });
  const cushion = h('input', { type: 'number', min: '0', max: '50', value: '10' });
  const cushionRow = field('Tax and tip cushion (%)', cushion, 'Indiana sales tax is 7%. Add a tip if it is delivery.');
  const deadline = h('input', { type: 'datetime-local' });
  const boxes = people.map((p) => h('input', { type: 'checkbox', checked: true, value: p.id }));
  const allowJoin = h('input', { type: 'checkbox', checked: true });

  const sync = () => {
    const r = restaurants.find((x) => x.id === rest.value);
    if (!title.dataset.touched) title.value = `${r.name} · ${today}`;
    warn.hidden = r.prices_confirmed && !r.errors.length;
    fill(warn, r.errors.length ? `${r.name}'s menu has problems to fix first. ` : `${r.name}'s prices haven't been checked yet. `,
      h('a', { href: `#/restaurant/${r.id}` }, 'Open the menu'));
  };
  title.addEventListener('input', () => (title.dataset.touched = '1'));
  rest.addEventListener('change', sync);
  cushionOn.addEventListener('change', () => (cushionRow.hidden = !cushionOn.checked));
  sync();

  fill(view, h('h1', {}, 'New order'), h('form', {
    class: 'card stack', onsubmit: async (e) => {
      e.preventDefault();
      const cents = toCents(limit.value);
      if (!(cents > 0)) return showError(err, new Error('Enter the per-person limit in dollars, like 15 or 12.50.'));
      try {
        const { id } = await api('POST', '/api/orders', {
          restaurant_id: rest.value, title: title.value, limit_cents: cents,
          count_cushion: cushionOn.checked, cushion_pct: Number(cushion.value) || 0,
          deadline: deadline.value ? new Date(deadline.value).toISOString() : null,
          person_ids: boxes.filter((b) => b.checked).map((b) => b.value),
          allow_join: allowJoin.checked,
        });
        location.hash = `#/order/${id}`;
      } catch (x) { showError(err, x); }
    },
  },
  field('Restaurant', rest), warn,
  field('Order name', title),
  field('Limit per person ($)', limit, 'The same for everyone on this order, coaches included.'),
  h('label', { class: 'check' }, cushionOn, 'Count tax and tip against the limit'), cushionRow,
  field('Close ordering at (optional)', deadline),
  h('label', { class: 'check' }, allowJoin, 'Let people add their own name from the link'),
  h('p', { class: 'small muted' }, 'They type their name once and it\'s locked to their phone. Names they add are tagged on the order page so you can spot a double.'),
  people.length ? h('fieldset', {}, h('legend', {}, 'Already on the roster'),
    h('div', { class: 'row small', style: 'margin:.25rem 0' },
      h('button', { type: 'button', class: 'btn ghost small', onclick: () => boxes.forEach((b) => (b.checked = true)) }, 'All'),
      h('button', { type: 'button', class: 'btn ghost small', onclick: () => boxes.forEach((b) => (b.checked = false)) }, 'None')),
    people.map((p, i) => h('label', { class: 'check' }, boxes[i], p.name))) : null,
  err, h('button', { class: 'btn', type: 'submit' }, 'Create order')));
}

async function orderView(id) {
  const { order: o, summary: s } = await api('GET', `/api/orders/${encodeURIComponent(id)}`);
  const refresh = () => orderView(id);
  const err = errorBox();
  const act = async (fn) => { try { await fn(); refresh(); } catch (x) { showError(err, x); } };
  const teamUrl = `${origin()}/t/${o.team_token}`;
  const fillUrl = `${origin()}/fill/${o.fill_token}`;
  const personalUrl = (p) => `${origin()}/o/${p.token}`;

  const announce = [
    `${o.title}: pick your food by ${o.deadline ? when(o.deadline) : 'when I say ordering closes'}.`,
    `${fmt(o.limit_cents)} each${o.count_cushion && o.cushion_pct ? ', tax and tip included' : ''}.`,
    o.allow_join ? `Open this and add your name: ${teamUrl}` : `Tap your own name: ${teamUrl}`,
  ].join('\n');

  const lineText = (c) => `${c.qty}× ${c.item}${c.category ? ` (${c.category})` : ''}${c.options.length ? `: ${c.options.map((x) => x.name).join(', ')}` : ''}${c.note ? ` [${c.note}]` : ''}`;
  const overPeople = s.people.filter((p) => p.over);

  fill(view, 
    h('header', {},
      h('p', { class: 'small noprint' }, h('a', { href: '#/' }, '← Orders')),
      h('div', { class: 'between' }, h('h1', { text: o.title }), h('span', { class: `chip ${o.open ? 'ordered' : 'skipped'}` }, o.open ? 'Open' : 'Closed')),
      h('p', { class: 'muted' }, `${o.restaurant_name} · ${fmt(o.limit_cents)} each`,
        o.count_cushion && o.cushion_pct ? ` incl. ${o.cushion_pct}% tax/tip` : '', o.deadline ? ` · closes ${when(o.deadline)}` : ''),
      h('p', {}, h('strong', { class: 'num' }, fmt(s.total_cents)), ' of food before tax · ',
        `${s.counts.ordered} ordered · ${s.counts.skipped} not eating · ${s.counts.pending} waiting`),
      h('div', { class: 'row noprint' },
        h('button', { class: 'btn ghost small', onclick: () => act(() => api('PATCH', `/api/orders/${id}`, { status: o.status === 'open' ? 'closed' : 'open' })) },
          o.status === 'open' ? 'Close ordering' : 'Reopen ordering'),
        h('a', { class: 'btn ghost small', href: `/api/orders/${id}/export.csv` }, 'Download CSV'),
        h('button', { class: 'btn ghost small', onclick: () => window.print() }, 'Print pickup sheet')),
      err,
    ),
    overPeople.length ? h('p', { class: 'note stop' },
      `Over the limit since it changed: ${overPeople.map((p) => p.name).join(', ')}. Their saved picks stand until they edit them.`) : null,

    h('section', { class: 'noprint' }, h('h2', {}, 'Send the link'),
      h('div', { class: 'card stack' },
        h('p', { class: 'small muted' }, 'Post this in your team chat. Each person taps their own name once, and then it is locked to their device.'),
        h('pre', { class: 'small', style: 'white-space:pre-wrap;margin:0' }, announce),
        h('div', { class: 'row' },
          h('button', { class: 'btn small', onclick: (e) => copy(announce, e.target) }, 'Copy message'),
          h('button', { class: 'btn ghost small', onclick: (e) => copy(teamUrl, e.target) }, 'Copy link only')))),

    h('section', {}, h('h2', {}, 'What to order'),
      h('div', { class: 'card' }, s.consolidated.length === 0
        ? h('p', { class: 'muted' }, 'Nobody has ordered yet.')
        : [h('ul', { class: 'list' }, s.consolidated.map((c) => h('li', {},
          h('div', {}, h('strong', { class: 'num' }, `${c.qty}× `), c.item, c.category ? h('span', { class: 'muted small' }, ` · ${c.category}`) : ''),
          c.options.length ? h('div', { class: 'opts' }, c.options.map((x) => x.name).join(', ')) : null,
          c.note ? h('div', { class: 'small' }, `Note: ${c.note}`) : null,
          h('div', { class: 'small muted' }, `For ${c.who.join(', ')}`)))),
        h('button', { class: 'btn ghost small noprint', style: 'margin-top:.5rem', onclick: (e) => copy(s.consolidated.map(lineText).join('\n'), e.target) }, 'Copy as text')])),

    h('section', { class: 'noprint' }, h('h2', {}, 'Fill the cart'),
      h('div', { class: 'card stack' },
        h('p', { class: 'small' }, o.restaurant_kind === 'subway'
          ? 'Open your Subway store\'s order page in Chrome, click the MealConvene Cart Fill extension, paste this link and press Add all. It builds each sub in your own cart. You still check out and pay yourself.'
          : 'Open the restaurant\'s order page in Chrome, click the MealConvene Cart Fill extension, paste this link and press Add all. It tries each item; anything it cannot find is left for you.'),
        h('div', { class: 'row' },
          h('button', { class: 'btn small', onclick: (e) => copy(fillUrl, e.target) }, 'Copy cart-fill link'),
          h('button', { class: 'btn ghost small', onclick: () => confirm('Make a new cart-fill link? The old one stops working.') && act(() => api('POST', `/api/orders/${id}/fill-token`, {})) }, 'New link')),
        h('p', { class: 'small muted' }, 'The link shows what to order and first names only. Treat it like the order itself.'))),

    h('section', {}, h('h2', {}, 'People'),
      h('div', { class: 'card' }, h('ul', { class: 'list' }, s.people.map((p) => h('li', {},
        h('div', { class: 'between' },
          h('div', {}, h('strong', { text: p.name }), ' ',
            h('span', { class: `chip ${p.status}` }, { ordered: 'Ordered', skipped: 'Not eating', pending: 'Waiting' }[p.status]),
            p.self_joined ? h('span', { class: 'chip', title: 'Typed their own name on the team link' }, ' Added self') : null,
            p.over ? h('span', { class: 'chip over' }, ' Over limit') : null),
          h('span', { class: 'num' }, p.subtotal_cents ? fmt(p.subtotal_cents) : '')),
        p.lines.length ? h('div', { class: 'opts' }, p.lines.map((l) => h('div', {},
          `${l.qty}× ${l.item}${l.options.length ? `: ${l.options.join(', ')}` : ''}${l.note ? ` [${l.note}]` : ''}`))) : null,
        h('div', { class: 'row noprint', style: 'margin-top:.35rem' },
          h('button', { class: 'btn ghost small', onclick: (e) => copy(personalUrl(p), e.target) }, 'Copy personal link'),
          p.claimed ? h('button', {
            class: 'btn ghost small',
            onclick: () => confirm(`Release ${p.name}'s name? Their old link stops working and the name can be picked again from the team link. Their picks are kept.`)
              && act(() => api('POST', `/api/orders/${id}/people/${p.invite_id}/reset`, {})),
          }, 'Reset link') : null,
          h('button', {
            class: 'btn ghost small',
            onclick: () => confirm(`Take ${p.name} off this order? Their picks are deleted.`) && act(() => api('DELETE', `/api/orders/${id}/people/${p.invite_id}`)),
          }, 'Remove')),
      )))),
      await addPeopleBox(id, s.people, act)),

    h('section', { class: 'noprint' }, h('h2', {}, 'Settings'), settingsBox(o, act)),

    h('section', { class: 'noprint' }, h('h2', {}, 'Delete'),
      h('div', { class: 'card' }, h('p', { class: 'small muted' }, 'Deletes the order and everyone\'s picks. Do this once the food has been picked up.'),
        h('button', {
          class: 'btn danger small',
          onclick: async () => {
            if (!confirm(`Delete "${o.title}" and everyone's picks? This cannot be undone.`)) return;
            await api('DELETE', `/api/orders/${id}`); location.hash = '#/';
          },
        }, 'Delete order'))),
  );
}

async function addPeopleBox(orderId, onOrder, act) {
  const { people } = await api('GET', '/api/people');
  const taken = new Set(onOrder.map((p) => p.name.toLowerCase()));
  const missing = people.filter((p) => !taken.has(p.name.toLowerCase()));
  if (!missing.length) return null;
  const sel = h('select', {}, missing.map((p) => h('option', { value: p.id }, p.name)));
  return h('div', { class: 'row noprint', style: 'margin-top:.5rem' }, h('div', { style: 'flex:1' }, sel),
    h('button', { class: 'btn ghost small', onclick: () => act(() => api('POST', `/api/orders/${orderId}/people`, { person_ids: [sel.value] })) }, 'Add to order'));
}

function settingsBox(o, act) {
  const limit = h('input', { type: 'text', inputmode: 'decimal', value: (o.limit_cents / 100).toFixed(2) });
  const on = h('input', { type: 'checkbox', checked: o.count_cushion });
  const join = h('input', { type: 'checkbox', checked: o.allow_join });
  const pct = h('input', { type: 'number', min: '0', max: '50', value: String(o.cushion_pct) });
  const toLocal = (iso) => { if (!iso) return ''; const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
  const deadline = h('input', { type: 'datetime-local', value: toLocal(o.deadline) });
  const err = errorBox();
  return h('form', {
    class: 'card stack', onsubmit: (e) => {
      e.preventDefault();
      const cents = toCents(limit.value);
      if (!(cents > 0)) return showError(err, new Error('Enter the limit in dollars.'));
      act(() => api('PATCH', `/api/orders/${o.id}`, {
        limit_cents: cents, count_cushion: on.checked, cushion_pct: Number(pct.value) || 0, allow_join: join.checked,
        deadline: deadline.value ? new Date(deadline.value).toISOString() : null,
      }));
    },
  },
  field('Limit per person ($)', limit), h('label', { class: 'check' }, on, 'Count tax and tip against the limit'),
  field('Cushion (%)', pct), field('Close ordering at', deadline, 'Leave empty to close it by hand.'),
  h('label', { class: 'check' }, join, 'Let people add their own name from the link'),
  h('p', { class: 'small muted' }, 'A lower limit does not undo picks already saved; anyone now over it is flagged above.'),
  err, h('button', { class: 'btn small', type: 'submit' }, 'Save settings'));
}

// ------------------------------------------------------------ roster ---

async function peopleView() {
  const showAll = sessionStorage.getItem('mc:showRetired') === '1';
  const { people } = await api('GET', `/api/people${showAll ? '?all=1' : ''}`);
  const names = h('textarea', { rows: '5', placeholder: 'One name per line\nStudent 1\nStudent 2\nCoach' });
  const err = errorBox();
  const msg = h('p', { class: 'note ok small', hidden: true });
  const act = async (fn) => { try { await fn(); peopleView(); } catch (x) { showError(err, x); } };

  fill(view, 
    h('h1', {}, 'Roster'),
    h('p', { class: 'muted small' }, 'Optional. People who add their own name on an order link land here automatically, so next time they just tap it. Only a name is kept.'),
    h('form', {
      class: 'card stack', onsubmit: async (e) => {
        e.preventDefault();
        try {
          const r = await api('POST', '/api/people', { names: names.value });
          names.value = '';
          await peopleView();
          if (r.skipped.length) alert(`Already on the roster: ${r.skipped.join(', ')}`);
        } catch (x) { showError(err, x); }
      },
    }, field('Add people', names), err, msg, h('button', { class: 'btn small', type: 'submit' }, 'Add')),
    h('div', { class: 'card' },
      h('div', { class: 'between' }, h('strong', {}, `${people.filter((p) => p.active).length} people`),
        h('label', { class: 'check small' }, h('input', {
          type: 'checkbox', checked: showAll,
          onchange: (e) => { sessionStorage.setItem('mc:showRetired', e.target.checked ? '1' : '0'); peopleView(); },
        }), 'Show retired')),
      h('ul', { class: 'list' }, people.map((p) => h('li', { class: 'between' },
        h('span', { class: p.active ? '' : 'muted' }, p.name, p.active ? '' : ' (retired)'),
        h('div', { class: 'row' },
          h('button', {
            class: 'btn ghost small', onclick: () => {
              const n = prompt('Name', p.name);
              if (n && n.trim() !== p.name) act(() => api('PATCH', `/api/people/${p.id}`, { name: n }));
            },
          }, 'Rename'),
          h('button', { class: 'btn ghost small', onclick: () => act(() => api('PATCH', `/api/people/${p.id}`, { active: !p.active })) },
            p.active ? 'Retire' : 'Restore')))))),
  );
}

// ------------------------------------------------------- restaurants ---

async function restaurantsView() {
  const { restaurants } = await api('GET', '/api/restaurants');
  const add = async (kind) => {
    const name = kind === 'subway' ? 'Subway' : prompt('Restaurant name');
    if (!name) return;
    const { id } = await api('POST', '/api/restaurants', { name, kind, menu_text: '' });
    location.hash = `#/restaurant/${id}`;
  };
  fill(view, 
    h('h1', {}, 'Restaurants'),
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => add('subway') }, 'Add Subway'),
      h('button', { class: 'btn ghost', onclick: () => add('other') }, 'Add another restaurant')),
    h('div', { style: 'margin-top:1rem' }, restaurants.map((r) => h('a', { class: 'card', href: `#/restaurant/${r.id}`, style: 'display:block;text-decoration:none;color:inherit' },
      h('div', { class: 'between' }, h('strong', {}, r.name, r.store_label ? h('span', { class: 'muted' }, ` · ${r.store_label}`) : ''),
        r.errors.length ? h('span', { class: 'chip over' }, 'Menu has problems')
          : r.prices_confirmed ? h('span', { class: 'chip ordered' }, 'Ready') : h('span', { class: 'chip pending' }, 'Check prices')),
      h('div', { class: 'small muted' }, `${r.item_count} items${r.kind === 'subway' ? ' · Subway cart fill' : ''}`)))),
  );
}

async function restaurantView(id) {
  const { restaurant: r } = await api('GET', `/api/restaurants/${encodeURIComponent(id)}`);
  const name = h('input', { type: 'text', value: r.name, maxlength: '60' });
  const store = h('input', { type: 'text', value: r.store_label ?? '', maxlength: '80', placeholder: 'e.g. 3129 E State Blvd' });
  const kind = h('select', {}, h('option', { value: 'subway', selected: r.kind === 'subway' }, 'Subway'), h('option', { value: 'other', selected: r.kind === 'other' }, 'Other'));
  const notes = h('input', { type: 'checkbox', checked: r.allow_notes });
  const notesRow = h('label', { class: 'check' }, notes, 'Let people add a note for the kitchen');
  const menu = h('textarea', { rows: '28', spellcheck: false, value: r.menu_text });
  menu.value = r.menu_text;
  const confirmed = h('input', { type: 'checkbox', checked: r.prices_confirmed });
  const preview = h('div', { class: 'preview small' });
  const err = errorBox();
  const saved = h('p', { class: 'note ok small', hidden: true }, 'Saved.');

  const syncKind = () => { notesRow.hidden = kind.value === 'subway'; };
  kind.addEventListener('change', syncKind); syncKind();

  let timer = null;
  const runPreview = async () => {
    const p = await api('POST', '/api/menu/preview', { menu_text: menu.value }).catch((x) => ({ items: [], errors: [{ line: 0, message: x.message }] }));
    const sections = new Map();
    for (const it of p.items) sections.set(it.category ?? 'Menu', [...(sections.get(it.category ?? 'Menu') ?? []), it]);
    fill(preview, 
      p.errors.length ? h('div', { class: 'note stop' }, h('strong', {}, 'Fix these:'),
        h('ul', {}, p.errors.map((e) => h('li', {}, e.line ? `Line ${e.line}: ${e.message}` : e.message)))) : h('p', { class: 'note ok' }, `${p.items.length} items read.`),
      [...sections].map(([sec, items]) => h('div', {}, h('h3', { style: 'margin-top:.75rem' }, sec),
        items.map((it) => h('div', { style: 'margin:.35rem 0' }, h('strong', {}, it.name), ` ${fmt(it.price_cents)}`,
          it.groups.length ? h('div', { class: 'muted' }, it.groups.map((g) => `${g.name} (${g.options.length})`).join(' · ')) : null)))),
    );
  };
  menu.addEventListener('input', () => { saved.hidden = true; clearTimeout(timer); timer = setTimeout(runPreview, 400); });
  runPreview();

  fill(view, 
    h('p', { class: 'small' }, h('a', { href: '#/restaurants' }, '← Restaurants')),
    h('h1', {}, r.name),
    h('form', {
      class: 'stack', onsubmit: async (e) => {
        e.preventDefault();
        try {
          await api('PUT', `/api/restaurants/${id}`, {
            name: name.value, kind: kind.value, store_label: store.value, menu_text: menu.value,
            allow_notes: notes.checked, prices_confirmed: confirmed.checked,
          });
          saved.hidden = false; err.hidden = true;
        } catch (x) { showError(err, x); }
      },
    },
    h('div', { class: 'card stack' }, field('Name', name), field('Which store', store, 'So everyone knows which location the prices came from.'),
      field('Cart fill', kind, 'Subway gets the Subway cart-fill steps.'), notesRow),
    h('div', { class: 'grid2' },
      h('div', { class: 'card' }, field('Menu', menu),
        h('details', { class: 'small', style: 'margin-top:.5rem' }, h('summary', {}, 'How to write the menu'),
          h('ul', {},
            h('li', {}, 'A line with no price is a section: ', h('code', {}, 'Sandwiches')),
            h('li', {}, 'An item is a name and a price: ', h('code', {}, 'Tuna – 7.29')),
            h('li', {}, h('code', {}, '> Bread (pick 1)'), ' starts a choice. Rules: (pick 1), (pick 2-3), (up to 3), (optional).'),
            h('li', {}, 'Options start with a dash, with any extra cost: ', h('code', {}, '- Bacon +1.50')),
            h('li', {}, 'A choice right under a section heading applies to every item in that section. An item\'s own choice with the same name replaces it.'),
            h('li', {}, 'Use the restaurant\'s exact names. The cart fill finds items by name.')))),
      h('div', { class: 'card' }, h('strong', {}, 'Preview'), preview)),
    h('div', { class: 'card stack' },
      h('label', { class: 'check' }, confirmed, 'I checked these prices against this store'),
      h('p', { class: 'small muted' }, 'Orders can\'t open until this is ticked: the limit is only as true as the prices. Editing the menu never changes an order that already exists.'),
      err, saved, h('button', { class: 'btn', type: 'submit' }, 'Save'))),
  );
}

// ----------------------------------------------------------- account ---

async function accountView() {
  const { organizers } = await api('GET', '/api/organizers');
  const err = errorBox();
  const email = h('input', { type: 'email' });
  const name = h('input', { type: 'text' });
  const pw = h('input', { type: 'password', autocomplete: 'new-password', minlength: '8' });
  fill(view, 
    h('h1', {}, 'Account'),
    h('p', {}, 'Signed in as ', h('strong', { text: me.name }), ` (${me.email}).`),
    h('h2', {}, 'Organizers'),
    h('div', { class: 'card' }, h('ul', { class: 'list' }, organizers.map((o) => h('li', {}, `${o.name} · ${o.email}`)))),
    h('form', {
      class: 'card stack', onsubmit: async (e) => {
        e.preventDefault();
        try { await api('POST', '/api/organizers', { email: email.value, name: name.value, password: pw.value }); accountView(); }
        catch (x) { showError(err, x); }
      },
    }, h('strong', {}, 'Add an organizer'), h('p', { class: 'small muted' }, 'Another coach or mentor who runs orders. Give them the password yourself.'),
    field('Name', name), field('Email', email), field('Temporary password', pw), err, h('button', { class: 'btn small', type: 'submit' }, 'Add organizer')),
    h('p', { class: 'small muted', style: 'margin-top:2rem' }, 'MealConvene is free software under the GNU AGPL-3.0. ',
      h('a', { href: 'https://www.gnu.org/licenses/agpl-3.0.html' }, 'License')),
  );
}

route();
