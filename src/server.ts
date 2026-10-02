// MealConvene.
//
// One process serves the organizer app, each student's order page, the API and
// the cart-fill feed. No framework and no dependencies: install Node, run this.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Router, HttpError, readBody, json, text, type Ctx } from './api/router.ts';
import { app } from './api/app.ts';
import { migrate } from './db/db.ts';
import { actorFor, cookieToken, requireActor } from './core/auth.ts';
import { manifestFor, csvFor, getOrder } from './core/orders.ts';

const here = dirname(fileURLToPath(import.meta.url));
const WEB = join(here, '..', 'web');
const PORT = Number(process.env.PORT ?? 4330);
/**
 * Where this running copy's source code lives. AGPL section 13: everyone who
 * uses a hosted copy, students included, must be offered its source. If you
 * run a MODIFIED copy, point this at YOUR modified source.
 */
const SOURCE_URL = process.env.MC_SOURCE_URL ?? 'https://github.com/softwareconvene/mealconvene';
const HOST = process.env.HOST ?? '127.0.0.1';

migrate();

const router = new Router();
router.merge(app);

const PAGE_HEADERS = {
  'content-security-policy':
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; "
    + "form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  'x-content-type-options': 'nosniff',
  // The page URL carries a personal token. Never send it to anyone else.
  'referrer-policy': 'no-referrer',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const ctx: Ctx = { req, res, url, params: {}, query: url.searchParams, body: {}, actor: null };

  try {
    ctx.actor = actorFor(cookieToken(ctx));

    // ---- the cart-fill feed: read by the browser extension from any origin ----
    if (url.pathname.startsWith('/fill/')) return serveFill(ctx);

    // ---- the source offer every page links to ----
    if (url.pathname === '/source') {
      res.writeHead(302, { location: SOURCE_URL, 'cache-control': 'no-store' });
      return res.end();
    }

    // ---- the spreadsheet ----
    const csv = url.pathname.match(/^\/api\/orders\/([^/]+)\/export\.csv$/);
    if (csv) {
      requireActor(ctx);
      const o = getOrder(decodeURIComponent(csv[1]));
      const name = o.title.replace(/[^A-Za-z0-9 _-]/g, '').trim().replace(/\s+/g, '-') || 'order';
      return text(res, 200, 'text/csv; charset=utf-8', '﻿' + csvFor(o.id), {
        'content-disposition': `attachment; filename="${name}.csv"`,
        'cache-control': 'no-store',
      });
    }

    if (url.pathname.startsWith('/api/')) {
      const method = req.method ?? 'GET';
      const match = router.match(method, url.pathname);
      if (!match) return json(res, 404, { error: 'not_found', message: `No route for ${method} ${url.pathname}` });
      ctx.params = match.params;
      if (method !== 'GET' && method !== 'HEAD') {
        // Every write is JSON. A cross-site form cannot send that without a
        // preflight this server never grants, which is the CSRF defence.
        if (!String(req.headers['content-type'] ?? '').includes('application/json')) {
          throw new HttpError(415, 'json_only', 'Send JSON.');
        }
        ctx.body = await readBody(req);
      }
      const out = await match.handler(ctx);
      if (res.writableEnded) return;
      return json(res, out === undefined ? 204 : 200, out ?? null);
    }

    // ---- a student's personal order page ----
    if (/^\/o\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) return servePage(ctx, 'order.html');
    // ---- the team chat link: tap your name ----
    if (/^\/t\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) return servePage(ctx, 'team.html');

    return await serveStatic(ctx);
  } catch (err: any) {
    if (err instanceof HttpError) {
      return json(res, err.status, { error: err.code, message: err.message, detail: err.detail });
    }
    console.error(err);
    return json(res, 500, { error: 'server_error', message: 'Something went wrong on the server.' });
  }
});

function serveFill(ctx: Ctx) {
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET',
    'cache-control': 'no-store',
  };
  if (ctx.req.method === 'OPTIONS') { ctx.res.writeHead(204, cors); return ctx.res.end(); }
  const t = ctx.url.pathname.slice('/fill/'.length).replace(/\.json$/, '');
  try {
    const body = JSON.stringify(manifestFor(t), null, 2);
    return text(ctx.res, 200, 'application/json; charset=utf-8', body, cors);
  } catch (err: any) {
    if (err instanceof HttpError) return text(ctx.res, err.status, 'application/json; charset=utf-8', JSON.stringify({ error: err.code, message: err.message }), cors);
    throw err;
  }
}

async function servePage(ctx: Ctx, file: string) {
  const body = await readFile(join(WEB, file), 'utf8');
  return text(ctx.res, 200, 'text/html; charset=utf-8', body, { ...PAGE_HEADERS, 'cache-control': 'no-store' });
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

async function serveStatic(ctx: Ctx) {
  let path = ctx.url.pathname === '/' ? '/index.html' : ctx.url.pathname;
  const full = normalize(join(WEB, decodeURIComponent(path)));
  if (!full.startsWith(WEB)) return text(ctx.res, 403, 'text/plain', 'Forbidden');
  try {
    const s = await stat(full);
    if (!s.isFile()) throw new Error('not a file');
  } catch {
    return text(ctx.res, 404, 'text/plain; charset=utf-8', 'Not found');
  }
  const type = TYPES[extname(full)] ?? 'application/octet-stream';
  const body = await readFile(full);
  ctx.res.writeHead(200, {
    'content-type': type,
    'content-length': body.length,
    // Short, and revalidated: a deploy should reach phones the same day.
    'cache-control': type.startsWith('text/html') ? 'no-store' : 'public, max-age=300, must-revalidate',
    ...(type.startsWith('text/html') ? PAGE_HEADERS : { 'x-content-type-options': 'nosniff' }),
  });
  ctx.res.end(body);
}

server.listen(PORT, HOST, () => {
  console.log(`MealConvene on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
});
