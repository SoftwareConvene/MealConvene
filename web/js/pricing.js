// Prices, selections and the limit.
//
// Plain JavaScript on purpose: the server imports this exact file to enforce the
// limit, and the student's browser imports it to show the running total. One
// copy, so the number on the phone and the number the server checks can never
// disagree. The server is still the one that decides.

/** @param {number} cents */
export const fmt = (cents) => `$${(cents / 100).toFixed(2)}`;

/** Dollars typed by a person ("12", "12.5", "$12.50") to integer cents, or NaN. */
export function toCents(input) {
  const s = String(input ?? '').replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return NaN;
  return Math.round(Number(s) * 100);
}

export function unitPrice(item, optionIds) {
  const chosen = new Set(optionIds);
  let cents = item.price_cents;
  for (const g of item.groups) for (const o of g.options) if (chosen.has(o.id)) cents += o.price_cents;
  return cents;
}

/** A plain-language rule for a group: "Pick 1", "Up to 3", "Optional". */
export function groupHint(g) {
  if (g.max_select === 1) return g.min_select === 0 ? 'Optional' : 'Pick 1';
  if (g.min_select === 0) return `Up to ${g.max_select}`;
  if (g.min_select === g.max_select) return `Pick ${g.min_select}`;
  return `Pick ${g.min_select} to ${g.max_select}`;
}

/** An error message, or null when the selection satisfies every group's min and max. */
export function validateSelection(item, optionIds) {
  const chosen = new Set(optionIds);
  if (chosen.size !== optionIds.length) return 'An option was chosen twice';
  const known = new Set(item.groups.flatMap((g) => g.options.map((o) => o.id)));
  for (const id of chosen) if (!known.has(id)) return 'That option is not on this menu';
  for (const g of item.groups) {
    const n = g.options.filter((o) => chosen.has(o.id)).length;
    if (n < g.min_select) return g.min_select === 1 ? `Choose a ${g.name.toLowerCase()}` : `Choose at least ${g.min_select}: ${g.name}`;
    if (n > g.max_select) return `Too many choices for ${g.name} (${groupHint(g).toLowerCase()})`;
  }
  return null;
}

/**
 * What counts against the limit: the subtotal, plus the tax and tip cushion
 * when the organizer has that on. Rounded up, so the cushion never lets a
 * student slip a cent over.
 */
export function counted(subtotalCents, order) {
  if (!order.count_cushion) return subtotalCents;
  return Math.ceil(subtotalCents * (100 + order.cushion_pct) / 100);
}

export const withinLimit = (subtotalCents, order) => counted(subtotalCents, order) <= order.limit_cents;

/** The most food a person can pick, before cushion. Shown so nobody has to do the math. */
export function foodBudget(order) {
  if (!order.count_cushion) return order.limit_cents;
  return Math.floor(order.limit_cents * 100 / (100 + order.cushion_pct));
}
