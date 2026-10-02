// Copyright (C) 2026 SoftwareConvene LLC and the MealConvene contributors.
// Part of MealConvene, free software under the GNU AGPL-3.0-only; see LICENSE and NOTICE.txt.
//
// MealConvene cart-fill engine.
//
// Runs in the organizer's own browser, on the restaurant's own ordering page,
// signed in as themselves. It does what they would do by hand, one item at a
// time, at human speed: open the item, set each choice, set the quantity, add
// it. It never checks out and never touches payment.
//
// When it can't find something it STOPS with that item left open, so the
// organizer finishes it by hand. A half-built sandwich in the bag is worse
// than a stop.
//
// Site-specific steps live in adapters/<site>.js. An adapter may replace
// addLine() entirely or call MC.generic.addLine() with site options.

(() => {
  if (window.__mealconvene) return;

  // ------------------------------------------------------------ helpers ---
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  /** Lowercase, no accents, no ® ™, & → and, punctuation to spaces. */
  const norm = (s) => String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[®™©]/g, '').replace(/&/g, ' and ')
    .replace(/(\d)\s*(?:"|”|inch(?:es)?|in\b)/g, '$1 inch')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const visible = (el) => !!(el && el.isConnected && (el.offsetWidth || el.offsetHeight || el.getClientRects().length)
    && getComputedStyle(el).visibility !== 'hidden');
  const label = (el) => el?.getAttribute?.('aria-label') || el?.innerText || el?.textContent || '';
  /** 1 = same words; 0.75+ = one contains the other; else word overlap. */
  function score(a, b) {
    a = norm(a); b = norm(b);
    if (!a || !b) return 0;
    if (a === b) return 1;
    const A = new Set(a.split(' ')), B = new Set(b.split(' '));
    let inter = 0; A.forEach((t) => B.has(t) && inter++);
    const jac = inter / (A.size + B.size - inter);
    return (a.includes(b) || b.includes(a)) ? Math.max(0.75, jac) : jac;
  }
  async function waitFor(fn, ms = 4000, step = 120) {
    const end = Date.now() + ms;
    while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(step); }
    return null;
  }
  /**
   * The element whose own text best matches a name. Big containers whose text
   * merely CONTAINS the name are skipped by the length slack.
   */
  function best(els, name, { min = 0.6, slack = 40, synonyms = [] } = {}) {
    let top = null, topScore = 0;
    const names = [name, ...synonyms];
    for (const el of els) {
      if (!visible(el)) continue;
      const t = label(el);
      for (const n of names) {
        if (norm(t).length > norm(n).length + slack) continue;
        const s = score(t, n);
        if (s > topScore) { topScore = s; top = el; }
      }
    }
    return topScore >= min ? top : null;
  }
  /** A real-looking click: some sites listen for pointerdown, not click. */
  function click(el) {
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    const at = { bubbles: true, cancelable: true, composed: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
    el.dispatchEvent(new PointerEvent('pointerdown', { ...at, pointerType: 'mouse', isPrimary: true }));
    el.dispatchEvent(new MouseEvent('mousedown', at));
    el.dispatchEvent(new PointerEvent('pointerup', { ...at, pointerType: 'mouse', isPrimary: true }));
    el.dispatchEvent(new MouseEvent('mouseup', at));
    el.click();
  }
  const findDialog = () =>
    [...document.querySelectorAll('[role=dialog],[aria-modal=true],dialog[open],[class*=modal i],[class*=drawer i]')]
      .filter((d) => visible(d) && !d.closest('#mealconvene-panel-host')).pop() || null;
  function isChecked(el) {
    const input = el.matches?.('input') ? el : el.querySelector?.('input[type=checkbox],input[type=radio]');
    if (input) return input.checked;
    for (const a of ['aria-checked', 'aria-pressed', 'aria-selected']) {
      const v = el.getAttribute?.(a) ?? el.closest?.(`[${a}]`)?.getAttribute(a);
      if (v === 'true') return true;
      if (v === 'false') return false;
    }
    return /\b(selected|active|checked|is-selected)\b/i.test(el.className?.toString?.() ?? '');
  }
  /** Set an input so React and friends notice. */
  function setValue(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // --------------------------------------------------- the generic flow ---
  const CLICKABLE = 'button,[role=button],a,[role=link],[tabindex="0"]';
  const OPTION_SEL = 'label,[role=radio],[role=checkbox],[role=option],[role=switch],button,[role=button],li,input[type=radio],input[type=checkbox],[tabindex="0"]';
  const ADD_RE = /^(add|\+|select|choose|customi[sz]e|build|order|start)\b|^\+$/i;
  const CONFIRM_RE = /^(add( item)?( to)?( my)?( (cart|order|bag|basket))?|update( item| order| bag)?|save|done)\b/i;
  const NOT_CONFIRM_RE = /cancel|close|back|remove|clear|delete|meal|combo|upgrade/i;

  /** The part of the page that holds one choice group, found by its heading. */
  function groupScope(root, groupName, synonyms = []) {
    const heads = [...root.querySelectorAll('legend,h1,h2,h3,h4,h5,h6,[role=heading],[role=group],[role=radiogroup],fieldset,[class*=title i],[class*=heading i],[class*=header i]')];
    const head = best(heads, groupName, { min: 0.75, slack: 30, synonyms });
    if (!head) return null;
    return head.closest('fieldset,[role=group],[role=radiogroup],section') || head.parentElement?.parentElement || null;
  }

  function findOption(scope, name, synonyms = []) {
    const els = [...scope.querySelectorAll(OPTION_SEL)];
    const el = best(els, name, { min: 0.75, slack: 30, synonyms });
    // Prefer the clickable thing over a text node's wrapper.
    return el ? (el.closest('label,button,[role=radio],[role=checkbox],[role=option],[role=switch],[role=button]') || el) : null;
  }

  function findConfirm(root) {
    const btns = [...root.querySelectorAll('button,[role=button],input[type=submit]')]
      .filter((b) => visible(b) && !b.disabled && !b.closest('#mealconvene-panel-host')
        && CONFIRM_RE.test(label(b).trim()) && !NOT_CONFIRM_RE.test(label(b)));
    return btns[btns.length - 1] || null; // the footer button is usually last
  }

  /** Click the section tab for this line's category, if the page has one. */
  async function openCategory(category, synonyms = []) {
    if (!category) return;
    const tabs = [...document.querySelectorAll('a,button,[role=tab],[role=link]')].filter((e) => !e.closest('#mealconvene-panel-host'));
    const tab = best(tabs, category, { min: 0.75, slack: 12, synonyms });
    if (!tab) return;
    if (tab.getAttribute('aria-selected') === 'true' || tab.getAttribute('aria-current')) return;
    click(tab);
    await sleep(1200);
  }

  async function setGroups(scope, line, { log, synonyms = {} }) {
    const missing = [];
    for (const g of line.groups) {
      const gScope = groupScope(scope, g.name, synonyms[g.name] ?? []) || scope;
      for (const o of g.options) {
        let el = findOption(gScope, o.name, synonyms[o.name] ?? []);
        if (!el && o.chosen && gScope !== scope) el = findOption(scope, o.name, synonyms[o.name] ?? []);
        if (!el) { if (o.chosen) missing.push(`${g.name}: ${o.name}`); continue; }
        // A REQUIRED pick-one unselects the others by itself, so never click one
        // off. An optional one (Cheese) can be empty, and its default must go.
        if (!o.chosen && g.max === 1 && g.min >= 1) continue;
        if (isChecked(el) !== o.chosen) {
          log?.(`${o.chosen ? 'Choosing' : 'Removing'} ${o.name}`);
          click(el);
          await sleep(350);
          if (o.chosen && !isChecked(el)) {
            // Some sites re-render the option; look it up again before calling it failed.
            const again = findOption(gScope, o.name, synonyms[o.name] ?? []);
            if (again && !isChecked(again)) missing.push(`${g.name}: ${o.name} (wouldn't select)`);
          }
        }
      }
    }
    return missing;
  }

  async function setQty(scope, qty) {
    if (qty <= 1) return true;
    const input = [...scope.querySelectorAll('input[type=number],input[inputmode=numeric]')].find(visible);
    if (input) { setValue(input, String(qty)); await sleep(200); return true; }
    const plus = [...scope.querySelectorAll('button,[role=button]')].find((b) => visible(b) && (
      /^\+$/.test(label(b).trim()) || /increase|increment|plus|add one|more/i.test(b.getAttribute('aria-label') || '')));
    if (!plus) return false;
    for (let i = 1; i < qty; i++) { click(plus); await sleep(250); }
    return true;
  }

  const generic = {
    name: 'generic',
    match: () => true,
    async addLine(line, { log, synonyms = {}, categorySynonyms = {}, itemSynonyms = [] } = {}) {
      await openCategory(line.category, categorySynonyms[line.category] ?? []);

      const titles = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,a,button,span,div,p,li,[class*=title i],[class*=name i]')]
        .filter((e) => !e.closest('#mealconvene-panel-host'));
      const title = best(titles, line.item, { min: 0.75, slack: 25, synonyms: itemSynonyms });
      if (!title) return { ok: false, detail: `Couldn't find "${line.item}" on this page. Open the right menu section and try again.` };

      // The item's own Add/Customize button, or the item card itself.
      let trigger = null;
      for (let el = title, i = 0; el && i < 6 && !trigger; el = el.parentElement, i++) {
        trigger = [...el.querySelectorAll(CLICKABLE)].find((b) => visible(b) && ADD_RE.test(label(b).trim()));
      }
      const target = trigger || title.closest(CLICKABLE) || title;
      log?.(`Opening ${line.item}`);
      click(target);

      const scope = await waitFor(() => findDialog() || (findConfirm(document) && document.querySelector('main')) , 6000);
      if (!scope) {
        if (line.groups.some((g) => g.options.some((o) => o.chosen))) return { ok: false, detail: 'The item didn\'t open its choices.' };
        for (let n = 1; n < line.qty; n++) { await sleep(700); click(target); }
        return { ok: true };
      }
      await sleep(600);

      const missing = await setGroups(scope, line, { log, synonyms });
      if (missing.length) return { ok: false, detail: `Couldn't set ${missing.join('; ')}. Finish this one by hand.` };

      const qtyOk = await setQty(scope, line.qty);
      if (line.note) {
        const box = scope.querySelector('textarea,input[placeholder*=instruction i],input[placeholder*=note i],input[placeholder*=request i]');
        if (box) setValue(box, line.note);
      }
      await sleep(300);
      const confirm = findConfirm(scope) || findConfirm(document);
      if (!confirm) return { ok: false, detail: 'Couldn\'t find the "Add" button. Finish this one by hand.' };
      log?.('Adding to the bag');
      click(confirm);
      const done = await waitFor(() => !confirm.isConnected || !visible(confirm) || (scope !== document.querySelector('main') && !visible(scope)), 7000);
      if (!done) return { ok: false, detail: 'It didn\'t take. A required choice may be missing.' };
      if (!qtyOk && line.qty > 1) return { ok: false, detail: `Added 1. Set the quantity to ${line.qty} in the bag.` };
      return { ok: true };
    },
  };

  // ------------------------------------------------------- page map ---
  /**
   * A structural snapshot of the page: headings and things you can click, with
   * their roles, labels and test ids. Never form values, never anything typed.
   * This is what a new site adapter is written from.
   */
  function pageMap() {
    const els = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role=heading],legend,button,[role=button],a,[role=tab],[role=radio],[role=checkbox],[role=option],[role=switch],[role=dialog],[aria-modal=true],input,label,[data-testid]')]
      .filter((e) => !e.closest('#mealconvene-panel-host') && visible(e)).slice(0, 2500);
    const path = (e) => { const out = []; for (let p = e.parentElement; p && out.length < 4; p = p.parentElement) { const t = p.getAttribute('data-testid'); if (t) out.push(t); } return out; };
    return {
      url: location.origin + location.pathname,
      title: document.title,
      at: new Date().toISOString(),
      elements: els.map((e) => ({
        tag: e.tagName.toLowerCase(),
        role: e.getAttribute('role'),
        type: e.getAttribute('type'),
        testid: e.getAttribute('data-testid'),
        aria: e.getAttribute('aria-label'),
        checked: e.getAttribute('aria-checked') ?? e.getAttribute('aria-pressed') ?? e.getAttribute('aria-selected') ?? (e.matches('input[type=checkbox],input[type=radio]') ? String(e.checked) : null),
        text: e.matches('input') ? null : (e.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 80),
        cls: (e.className?.toString?.() ?? '').split(/\s+/).slice(0, 3).join(' '),
        within: path(e),
      })),
    };
  }

  window.__mealconvene = {
    adapters: [],
    register(a) { this.adapters.unshift(a); },
    adapterFor(loc = location) { return this.adapters.find((a) => a.match(loc)) || generic; },
    generic,
    pageMap,
    helpers: { sleep, norm, score, visible, label, waitFor, best, click, findDialog, isChecked, setValue, groupScope, findOption, findConfirm, setGroups, setQty, openCategory },
  };
})();
