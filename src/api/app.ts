// Every API route. Organizer routes need a session; the student and cart-fill
// routes are reached by a token in the path and nothing else.

import { Router, HttpError, type Ctx } from './router.ts';
import {
  needsSetup, createOrganizer, login, logout, cookieToken, sessionCookie, requireActor, organizers,
} from '../core/auth.ts';
import {
  listPeople, addPeople as addToRoster, updatePerson, listRestaurants, getRestaurant, createRestaurant, updateRestaurant, template,
} from '../core/roster.ts';
import {
  createOrder, getOrder, listOrders, summaryFor, updateOrder, addPeople, removeInvite, rotateFillToken,
  deleteOrder, studentView, saveCart, skip, menuFor, isOpen, teamView, claim, resetClaim, join,
} from '../core/orders.ts';
import { parseMenu } from '../core/menu.ts';

export const app = new Router();

const secure = (ctx: Ctx) => ctx.req.headers['x-forwarded-proto'] === 'https' || process.env.MC_SECURE_COOKIES === '1';

// ------------------------------------------------------------- account ---

app.get('/api/setup', () => ({ needs_setup: needsSetup() }));

app.post('/api/setup', (ctx) => {
  // Only the very first account is created this way. After that, organizers add organizers.
  if (!needsSetup()) throw new HttpError(409, 'already_set_up', 'This MealConvene is already set up. Sign in instead.');
  const { email, name, password } = ctx.body ?? {};
  createOrganizer(email, name, password);
  const t = login(email, password);
  ctx.res.setHeader('set-cookie', sessionCookie(t, secure(ctx)));
  return { ok: true };
});

app.post('/api/login', (ctx) => {
  const t = login(ctx.body?.email, ctx.body?.password);
  ctx.res.setHeader('set-cookie', sessionCookie(t, secure(ctx)));
  return { ok: true };
});

app.post('/api/logout', (ctx) => {
  logout(cookieToken(ctx));
  ctx.res.setHeader('set-cookie', sessionCookie('', secure(ctx)));
  return { ok: true };
});

app.get('/api/me', (ctx) => ({ me: ctx.actor, needs_setup: needsSetup() }));

app.get('/api/organizers', (ctx) => { requireActor(ctx); return { organizers: organizers() }; });

app.post('/api/organizers', (ctx) => {
  requireActor(ctx);
  const { email, name, password } = ctx.body ?? {};
  createOrganizer(email, name, password);
  return { ok: true };
});

// -------------------------------------------------------------- roster ---

app.get('/api/people', (ctx) => {
  requireActor(ctx);
  return { people: listPeople(ctx.query.get('all') === '1') };
});

app.post('/api/people', (ctx) => { requireActor(ctx); return addToRoster(ctx.body?.names); });

app.patch('/api/people/:id', (ctx) => { requireActor(ctx); updatePerson(ctx.params.id, ctx.body ?? {}); return { ok: true }; });

// --------------------------------------------------------- restaurants ---

app.get('/api/restaurants', (ctx) => { requireActor(ctx); return { restaurants: listRestaurants() }; });
app.get('/api/restaurants/:id', (ctx) => { requireActor(ctx); return { restaurant: getRestaurant(ctx.params.id) }; });
app.post('/api/restaurants', (ctx) => { requireActor(ctx); return { id: createRestaurant(ctx.body ?? {}) }; });
app.put('/api/restaurants/:id', (ctx) => { requireActor(ctx); updateRestaurant(ctx.params.id, ctx.body ?? {}); return { ok: true }; });
app.get('/api/templates/:kind', (ctx) => { requireActor(ctx); return { menu_text: template(ctx.params.kind) }; });

/** Parse without saving, for the live preview beside the menu editor. */
app.post('/api/menu/preview', (ctx) => {
  requireActor(ctx);
  return parseMenu(String(ctx.body?.menu_text ?? ''));
});

// -------------------------------------------------------------- orders ---

app.get('/api/orders', (ctx) => { requireActor(ctx); return { orders: listOrders() }; });

app.post('/api/orders', (ctx) => {
  const me = requireActor(ctx);
  return { id: createOrder(me.organizer_id, ctx.body ?? {}) };
});

app.get('/api/orders/:id', (ctx) => {
  requireActor(ctx);
  const o = getOrder(ctx.params.id);
  return {
    order: { ...o, count_cushion: !!o.count_cushion, allow_notes: !!o.allow_notes, allow_join: !!o.allow_join, open: isOpen(o) },
    summary: summaryFor(o.id),
    item_count: menuFor(o.id).length,
  };
});

app.patch('/api/orders/:id', (ctx) => { requireActor(ctx); updateOrder(ctx.params.id, ctx.body ?? {}); return { ok: true }; });
app.del('/api/orders/:id', (ctx) => { requireActor(ctx); deleteOrder(ctx.params.id); return { ok: true }; });

app.post('/api/orders/:id/people', (ctx) => {
  requireActor(ctx);
  return { added: addPeople(ctx.params.id, ctx.body?.person_ids ?? []) };
});

app.del('/api/orders/:id/people/:inviteId', (ctx) => {
  requireActor(ctx);
  removeInvite(ctx.params.id, ctx.params.inviteId);
  return { ok: true };
});

app.post('/api/orders/:id/people/:inviteId/reset', (ctx) => {
  requireActor(ctx);
  resetClaim(ctx.params.id, ctx.params.inviteId);
  return { ok: true };
});

app.post('/api/orders/:id/fill-token', (ctx) => { requireActor(ctx); return { fill_token: rotateFillToken(ctx.params.id) }; });

// ------------------------------------------------- a student's own link ---

app.get('/api/o/:token', (ctx) => studentView(ctx.params.token));
app.put('/api/o/:token/cart', (ctx) => saveCart(ctx.params.token, ctx.body?.lines));
app.post('/api/o/:token/skip', (ctx) => { skip(ctx.params.token); return { ok: true }; });

// ---------------------------------------------------- the team chat link ---

app.get('/api/t/:token', (ctx) => teamView(ctx.params.token));
app.post('/api/t/:token/claim', (ctx) => claim(ctx.params.token, ctx.body?.invite_id));

// Typing a name is the one public write that creates rows, so it is slowed
// per address. In memory: a restart forgets, which is fine for this.
const joins = new Map<string, number[]>();
app.post('/api/t/:token/join', (ctx) => {
  const ip = String(ctx.req.headers['cf-connecting-ip'] ?? ctx.req.socket.remoteAddress ?? '');
  const recent = (joins.get(ip) ?? []).filter((t) => Date.now() - t < 10 * 60_000);
  if (recent.length >= 20) throw new HttpError(429, 'slow_down', 'Too many names from here. Wait a few minutes.');
  const out = join(ctx.params.token, ctx.body?.name);
  joins.set(ip, [...recent, Date.now()]);
  return out;
});
