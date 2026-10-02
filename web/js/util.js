// Small helpers shared by both pages. No framework.

/** Build an element. Text is always set as text, never parsed as HTML. */
export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    // Through the CSSOM: the page's CSP refuses style attributes, not this.
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'text') el.textContent = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : String(kid));
  }
  return el;
}

export async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(data?.message ?? `Request failed (${res.status})`);
    err.status = res.status; err.code = data?.error; err.detail = data?.detail;
    throw err;
  }
  return data;
}

export async function copy(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    if (button) { const was = button.textContent; button.textContent = 'Copied'; setTimeout(() => (button.textContent = was), 1500); }
  } catch {
    window.prompt('Copy this:', text);
  }
}

export const when = (iso) => iso ? new Date(iso).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';

/** replaceChildren, minus the nulls: the DOM would print them as the word "null". */
export const fill = (el, ...kids) =>
  el.replaceChildren(...kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false));
