// The team chat link: everyone on the order taps their own name, once.

import { h, api, when, fill } from './util.js';

const teamToken = location.pathname.split('/').filter(Boolean)[1];
const view = document.getElementById('view');
const KEY = `mc:team:${teamToken}`;

function remembered() {
  try { return localStorage.getItem(KEY); } catch { return null; }
}
function remember(t) {
  try { localStorage.setItem(KEY, t); } catch { /* private window: the link still works this once */ }
}

async function load() {
  // This device already picked a name on this order: go straight back to it.
  const mine = remembered();
  // Unless the coach has since reset it, which retires the old personal link.
  if (mine) {
    const still = await fetch(`/api/o/${encodeURIComponent(mine)}`).then((r) => r.ok, () => true);
    if (still) { location.replace(`/o/${encodeURIComponent(mine)}`); return; }
    try { localStorage.removeItem(KEY); } catch { /* nothing remembered to forget */ }
  }

  let data;
  try {
    data = await api('GET', `/api/t/${encodeURIComponent(teamToken)}`);
  } catch (err) {
    fill(view, h('div', { class: 'card' }, h('h1', { text: 'Link not found' }), h('p', { text: err.message })));
    return;
  }
  document.title = `${data.order.title} · MealConvene`;
  let error = null;

  const pick = async (p) => {
    if (!confirm(`Order as ${p.name}?\n\nOnly pick your own name. Once picked, it's locked to this device.`)) return;
    try {
      const { token } = await api('POST', `/api/t/${encodeURIComponent(teamToken)}/claim`, { invite_id: p.id });
      remember(token);
      location.href = `/o/${encodeURIComponent(token)}`;
    } catch (err) {
      error = err.message;
      if (err.code === 'taken') p.taken = true;
      draw();
    }
  };

  const nameInput = h('input', { type: 'text', maxlength: '40', autocomplete: 'name', placeholder: 'First name and last initial' });
  const addMe = async (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    if (!name) return;
    if (!confirm(`Order as ${name}?\n\nUse your real name. Your coach sees everyone who adds themselves.`)) return;
    try {
      const { token } = await api('POST', `/api/t/${encodeURIComponent(teamToken)}/join`, { name });
      remember(token);
      location.href = `/o/${encodeURIComponent(token)}`;
    } catch (err) {
      error = err.message;
      draw();
    }
  };

  const draw = () => fill(view, 
    h('h1', { text: data.order.title }),
    h('p', { class: 'muted' }, data.order.restaurant,
      data.order.deadline ? ` · closes ${when(data.order.deadline)}` : ''),
    !data.open ? h('p', { class: 'note warn' }, 'Ordering is closed.') : null,
    error ? h('p', { class: 'note stop', role: 'alert' }, error) : null,
    data.people.length ? [
      h('h2', { text: 'Tap your name' }),
      h('div', { class: 'card' }, h('ul', { class: 'list' }, data.people.map((p) => h('li', { class: 'between' },
        h('span', { text: p.name }),
        p.taken
          ? h('span', { class: 'chip skipped' }, 'Picked')
          : h('button', { class: 'btn small', disabled: !data.open, onclick: () => pick(p) }, 'This is me'),
      )))),
    ] : null,
    data.can_join ? [
      h('h2', { text: data.people.length ? 'Not on the list?' : 'Add your name' }),
      h('form', { class: 'card stack', onsubmit: addMe },
        h('label', {}, 'Your name', nameInput),
        h('button', { class: 'btn', type: 'submit' }, 'Start my order')),
    ] : null,
    h('p', { class: 'small muted', style: 'margin-top:1rem' },
      data.can_join ? 'Someone already picked your name? Ask your coach to reset it.' : 'Not on the list, or someone picked your name? Ask your coach for your personal link.'),
  );
  draw();
}

load();
