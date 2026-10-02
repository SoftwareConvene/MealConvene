// The menu, as an organizer types or pastes it.
//
//   Sandwiches                          <- a line with no price is a section heading
//   > Size (pick 1)                     <- a group right under a heading applies to
//   - 6 Inch                               every item in that section
//   - Footlong +5.00
//   > Bread (pick 1)
//   - Artisan Italian
//   B.M.T.® – 7.49                      <- an item: name, then its base price
//   > Size (pick 1)                     <- an item's own group REPLACES the section
//   - 6 Inch                               group with the same name, in place
//   - Footlong +5.50
//   > Extras (up to 2)                  <- and any other item group is added after
//   - Bacon +1.50
//
// Group rules: (pick 1) · (pick 2-3) · (up to 3) · (optional). No rule = pick exactly 1.
// Lines starting with // are comments.
//
// Names have to match the restaurant's own labels: the cart-fill extension
// finds things on the ordering site by these names.

export type ParsedOption = { name: string; price_cents: number };
export type ParsedGroup = { name: string; min: number; max: number; options: ParsedOption[] };
export type ParsedItem = { name: string; price_cents: number; category: string | null; groups: ParsedGroup[] };
export type ParseIssue = { line: number; message: string };
export type ParseResult = { items: ParsedItem[]; errors: ParseIssue[] };

// A price is the LAST thing on the line, after whitespace and an optional
// separator. The separator must be followed by a space so "B.M.T.®" keeps its dots.
const ITEM = /^(.+?)\s+(?:[-–—:|·]\s+)?\$?(\d{1,4}(?:\.\d{1,2})?)$/;
const OPTION = /^[-•*]\s+(.+?)(?:\s+\+\s*\$?(\d{1,4}(?:\.\d{1,2})?))?$/;

const cents = (s: string) => Math.round(parseFloat(s) * 100);

export function parseGroupRule(raw: string): Omit<ParsedGroup, 'options'> {
  const m = raw.match(/^(.*?)\s*(?:\(([^)]*)\))?\s*$/)!;
  const rule = (m[2] ?? '').toLowerCase();
  let min = 1, max = 1;
  const up = rule.match(/up to\s+(\d+)/);
  const pick = rule.match(/pick\s+(\d+)(?:\s*(?:-|to)\s*(\d+))?/);
  if (up) { min = 0; max = +up[1]; }
  else if (pick) { min = +pick[1]; max = pick[2] ? +pick[2] : +pick[1]; }
  if (/optional/.test(rule)) min = 0;
  if (/required/.test(rule) && min === 0) min = 1;
  return { name: (m[1] || raw).trim(), min, max: Math.max(max, min, 1) };
}

const cloneGroup = (g: ParsedGroup): ParsedGroup => ({ ...g, options: g.options.map((o) => ({ ...o })) });

export function parseMenu(text: string): ParseResult {
  const items: ParsedItem[] = [];
  const errors: ParseIssue[] = [];
  let category: string | null = null;
  let sectionGroups: ParsedGroup[] = [];
  // Where a "-" option line goes: the group most recently opened.
  let current: ParsedGroup | null = null;
  // Whether a ">" line belongs to the section (no item yet since the heading) or the item.
  let item: ParsedItem | null = null;
  // Item-level groups collected so far, applied when the item is finished.
  let ownGroups: ParsedGroup[] = [];
  const groupLine = new Map<ParsedGroup, number>();

  const finishItem = () => {
    if (!item) return;
    const merged = sectionGroups.map(cloneGroup);
    for (const g of ownGroups) {
      const i = merged.findIndex((s) => s.name.toLowerCase() === g.name.toLowerCase());
      if (i >= 0) merged[i] = g; else merged.push(g);
    }
    item.groups = merged;
    items.push(item);
    item = null;
    ownGroups = [];
  };

  const lines = text.split(/\r?\n/);
  lines.forEach((raw, idx) => {
    const n = idx + 1;
    const line = raw.trim();
    if (!line || line.startsWith('//')) return;

    if (line.startsWith('>')) {
      const g: ParsedGroup = { ...parseGroupRule(line.slice(1).trim()), options: [] };
      groupLine.set(g, n);
      if (item) ownGroups.push(g); else sectionGroups.push(g);
      current = g;
      return;
    }

    const opt = line.match(OPTION);
    if (opt) {
      if (!current) { errors.push({ line: n, message: 'An option needs a "> Group" line above it' }); return; }
      current.options.push({ name: opt[1].trim(), price_cents: opt[2] ? cents(opt[2]) : 0 });
      return;
    }

    const m = line.match(ITEM);
    if (m) {
      finishItem();
      item = { name: m[1].trim(), price_cents: cents(m[2]), category, groups: [] };
      current = null;
      return;
    }

    // A heading: closes the item and starts a fresh section with no shared groups.
    finishItem();
    category = line.replace(/[:]+$/, '').trim();
    sectionGroups = [];
    current = null;
  });
  finishItem();

  for (const [g, n] of groupLine) {
    if (g.options.length === 0) errors.push({ line: n, message: `"${g.name}" has no options. Add lines starting with "-"` });
    else if (g.options.length < g.min) errors.push({ line: n, message: `"${g.name}" asks for ${g.min} but only lists ${g.options.length}` });
  }
  if (items.length === 0 && errors.length === 0) {
    errors.push({ line: 0, message: 'No menu items found. An item is a name and a price on one line, like "Turkey – 6.99".' });
  }
  const seen = new Set<string>();
  for (const it of items) {
    // The same name may appear in two sections (a B.M.T.® sub and a B.M.T.® wrap).
    const key = `${it.category ?? ''}|${it.name}`.toLowerCase();
    if (seen.has(key)) errors.push({ line: 0, message: `"${it.name}" appears twice${it.category ? ` under ${it.category}` : ''}. Give each item a different name.` });
    seen.add(key);
  }
  errors.sort((a, b) => a.line - b.line);
  return { items, errors };
}
