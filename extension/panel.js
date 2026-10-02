// Copyright (C) 2026 SoftwareConvene LLC and the MealConvene contributors.
// Part of MealConvene, free software under the GNU AGPL-3.0-only; see LICENSE and NOTICE.txt.
//
// The panel on the restaurant's page: the order as a checklist, and Add all.
// Lives in a shadow root so the site's CSS can't reach it and ours can't leak.

(() => {
  const MC = window.__mealconvene;
  if (!MC || MC.panel) return;

  const store = {
    get: (keys) => new Promise((r) => chrome.storage.local.get(keys, r)),
    set: (obj) => new Promise((r) => chrome.storage.local.set(obj, r)),
  };

  let host = null;
  let busy = false;

  async function open() {
    await store.set({ mc_panel_open: true });
    render();
  }

  async function close() {
    await store.set({ mc_panel_open: false });
    host?.remove(); host = null;
  }

  function el(tag, props = {}, ...kids) {
    const e = Object.assign(document.createElement(tag), props);
    for (const k of kids.flat()) if (k != null && k !== false) e.append(k);
    return e;
  }

  const lineLabel = (l) => `${l.qty}× ${l.item}${l.category ? ` (${l.category})` : ''}`;

  async function render(statusText) {
    const { mc_manifest: m, mc_done: done = {}, mc_running: running } = await store.get(['mc_manifest', 'mc_done', 'mc_running']);
    if (!host) {
      host = el('div', { id: 'mealconvene-panel-host' });
      host.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483647;';
      host.attachShadow({ mode: 'open' });
      document.documentElement.append(host);
    }
    const root = host.shadowRoot;
    const adapter = MC.adapterFor();
    let status = statusText;
    if (!status && running && !busy) {
      status = `Interrupted while adding ${running}. Check the bag: tick it if it got added, then press Add all.`;
      await store.set({ mc_running: null });
    }
    const rows = (m?.lines ?? []).map((l) => {
      const box = el('input', { type: 'checkbox', checked: !!done[l.key] });
      box.addEventListener('change', async () => {
        const cur = (await store.get(['mc_done'])).mc_done ?? {};
        if (box.checked) cur[l.key] = true; else delete cur[l.key];
        await store.set({ mc_done: cur });
      });
      const chosen = l.options.map((o) => o.name).join(', ');
      return el('label', { className: 'row' }, box,
        el('span', {}, el('b', { textContent: lineLabel(l) }),
          chosen ? el('span', { className: 'sub', textContent: chosen }) : null,
          l.note ? el('span', { className: 'sub', textContent: `Note: ${l.note}` }) : null,
          el('span', { className: 'sub', textContent: `For ${l.who.join(', ')}` }),
          el('span', { className: 'err', id: `err-${CSS.escape(l.key)}` })));
    });
    const go = el('button', { className: 'go', textContent: busy ? 'Working…' : 'Add all', disabled: busy || !m });
    go.addEventListener('click', run);
    const stop = el('button', { textContent: 'Stop', hidden: !busy });
    stop.addEventListener('click', () => { busy = false; });
    const hide = el('button', { textContent: 'Hide' });
    hide.addEventListener('click', close);
    const map = el('button', { textContent: 'Save page map', title: 'Saves the layout of this page (headings and buttons, never anything you typed) so a better adapter can be written for this site.' });
    map.addEventListener('click', savePageMap);

    root.replaceChildren(
      el('style', { textContent: `
        :host { all: initial; }
        .card { width: 340px; max-height: 82vh; overflow: auto; background: #fff; color: #12161c; border: 2px solid #b42318; border-radius: 12px;
          padding: 12px; font: 14px/1.4 system-ui, -apple-system, sans-serif; box-shadow: 0 10px 30px rgba(0,0,0,.25); }
        h1 { font-size: 15px; margin: 0 0 2px; } .muted { color: #55606f; font-size: 12px; }
        .row { display: flex; gap: 8px; align-items: flex-start; padding: 7px 0; border-top: 1px solid #e5e7eb; cursor: pointer; }
        .row input { margin-top: 3px; width: 16px; height: 16px; flex: none; }
        .sub { display: block; color: #55606f; font-size: 12px; } .err { display: block; color: #9f1239; font-size: 12px; font-weight: 600; }
        .status { margin: 8px 0; padding: 6px 8px; border-radius: 6px; background: #fef3c7; color: #92400e; font-size: 12px; }
        .bar { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 10px; }
        button { font: inherit; padding: 7px 11px; border-radius: 7px; border: 1px solid #d8dde5; background: #fff; cursor: pointer; }
        button.go { background: #b42318; color: #fff; border-color: #b42318; font-weight: 600; }
        button:disabled { opacity: .5; cursor: default; }` }),
      el('div', { className: 'card', role: 'region', ariaLabel: 'MealConvene cart fill' },
        el('h1', { textContent: m ? m.order.title : 'MealConvene' }),
        el('div', { className: 'muted', textContent: m ? `${m.order.restaurant} · ${adapter.name} steps · stops at the first item it can't finish` : 'No order loaded. Open the extension and paste your cart-fill link.' }),
        status ? el('div', { className: 'status', role: 'status', textContent: status }) : null,
        rows,
        el('div', { className: 'bar' }, go, stop, hide, map),
        el('div', { className: 'muted', textContent: 'It never checks out. Review the bag and pay yourself.' })),
    );
  }

  async function run() {
    if (busy) return;
    busy = true;
    await render('Working. Keep this tab in front and leave the mouse alone.');
    const adapter = MC.adapterFor();
    const { mc_manifest: m } = await store.get(['mc_manifest']);
    let stoppedOn = null;
    for (const line of m.lines) {
      if (!busy) { stoppedOn = 'stopped'; break; }
      const { mc_done: done = {} } = await store.get(['mc_done']);
      if (done[line.key]) continue;
      // Remembered in case the site reloads the page mid-item, so the next
      // load says so instead of silently adding it a second time.
      await store.set({ mc_running: lineLabel(line) });
      let res;
      try {
        res = await adapter.addLine(line, { log: (t) => setStatus(`${lineLabel(line)}: ${t}`) });
      } catch (e) {
        res = { ok: false, detail: String(e?.message ?? e) };
      }
      await store.set({ mc_running: null });
      if (!res.ok) { stoppedOn = { line, detail: res.detail }; break; }
      done[line.key] = true;
      await store.set({ mc_done: done });
      await new Promise((r) => setTimeout(r, 900));
    }
    busy = false;
    if (stoppedOn && stoppedOn !== 'stopped') {
      await render(`Stopped on ${lineLabel(stoppedOn.line)}: ${stoppedOn.detail} Tick it once it's in the bag, then press Add all.`);
    } else if (stoppedOn === 'stopped') {
      await render('Stopped. Press Add all to carry on.');
    } else {
      await render('Everything is in the bag. Check it against the order, then check out.');
    }
  }

  function setStatus(t) {
    const s = host?.shadowRoot.querySelector('.status');
    if (s) s.textContent = t;
  }

  function savePageMap() {
    const blob = new Blob([JSON.stringify(MC.pageMap(), null, 1)], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `mealconvene-pagemap-${location.hostname}-${Date.now()}.json` });
    document.body.append(a); a.click(); a.remove();
  }

  chrome.runtime.onMessage.addListener((msg) => { if (msg?.type === 'mc:open') open(); });
  MC.panel = { open, close, render };

  // Reappear after the site navigates, if it was open.
  store.get(['mc_panel_open']).then(({ mc_panel_open }) => { if (mc_panel_open) render(); });
})();
