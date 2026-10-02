// Copyright (C) 2026 SoftwareConvene LLC and the MealConvene contributors.
// Part of MealConvene, free software under the GNU AGPL-3.0-only; see LICENSE and NOTICE.txt.
//
// Loads an order's cart-fill feed and opens the panel on the current tab.

const $ = (id) => document.getElementById(id);
const store = {
  get: (keys) => new Promise((r) => chrome.storage.local.get(keys, r)),
  set: (obj) => new Promise((r) => chrome.storage.local.set(obj, r)),
};

function fail(msg) { $('error').textContent = msg; $('error').hidden = false; }

/** Only a MealConvene cart-fill link: https, or http on this machine for testing. */
function checkUrl(raw) {
  let u;
  try { u = new URL(raw.trim()); } catch { return null; }
  const local = ['localhost', '127.0.0.1'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) return null;
  if (!/^\/fill\/[A-Za-z0-9_-]+(\.json)?$/.test(u.pathname)) return null;
  return u.toString();
}

async function load(url) {
  $('error').hidden = true;
  const res = await fetch(url, { cache: 'no-store', credentials: 'omit' }).catch(() => null);
  if (!res) return fail('Could not reach that link. Check your connection.');
  const data = await res.json().catch(() => null);
  if (!res.ok || data?.format !== 'mealconvene.fill/1') return fail(data?.message ?? 'That is not a MealConvene cart-fill link.');
  const prev = await store.get(['mc_url', 'mc_done']);
  // Keep the ticks when it's the same order; a different order starts clean.
  const done = prev.mc_url === url ? prev.mc_done ?? {} : {};
  const keys = new Set(data.lines.map((l) => l.key));
  for (const k of Object.keys(done)) if (!keys.has(k)) delete done[k];
  await store.set({ mc_url: url, mc_manifest: data, mc_done: done });
  show(data);
}

function show(m) {
  $('order').hidden = false;
  $('title').textContent = m.order.title;
  const n = m.lines.reduce((s, l) => s + l.qty, 0);
  $('meta').textContent = `${m.order.restaurant} · ${n} item${n === 1 ? '' : 's'} on ${m.lines.length} line${m.lines.length === 1 ? '' : 's'}${m.order.status === 'open' ? ' · ordering still open' : ''}`;
}

$('load').addEventListener('submit', (e) => {
  e.preventDefault();
  const url = checkUrl($('url').value);
  if (!url) return fail('Paste the cart-fill link from the order page. It ends in /fill/ and a code.');
  load(url);
});

$('show').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https?:/.test(tab.url ?? '')) return fail('Open the restaurant\'s order page in this tab first.');
  // Re-load the feed so picks saved since the popup last loaded are included.
  const { mc_url } = await store.get(['mc_url']);
  if (mc_url) await load(mc_url);
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'mc:open' });
  } catch {
    // Not a site with a built-in adapter: inject the engine with the one-time permission from this click.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['engine.js', 'adapters/subway.js', 'panel.js'] });
    await chrome.tabs.sendMessage(tab.id, { type: 'mc:open' });
  }
  window.close();
});

$('reset').addEventListener('click', async () => {
  await store.set({ mc_done: {}, mc_running: null });
  $('reset').textContent = 'Unticked';
});

store.get(['mc_url', 'mc_manifest']).then(({ mc_url, mc_manifest }) => {
  if (mc_url) $('url').value = mc_url;
  if (mc_manifest) show(mc_manifest);
});
