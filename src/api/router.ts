// A very small router. No framework, no dependencies.
//
// Same shape as TeamConvene's, so somebody who has read one codebase can read
// the other without relearning anything.

import type { IncomingMessage, ServerResponse } from 'node:http';

export type Ctx = {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  query: URLSearchParams;
  body: any;
  /** Filled in by the session layer. Null on public routes. */
  actor: Actor | null;
};

/** A signed-in organizer. Students never sign in; they hold a personal link. */
export type Actor = {
  organizer_id: string;
  email: string;
  name: string;
};

export type Handler = (ctx: Ctx) => any | Promise<any>;

type Route = { method: string; parts: string[]; handler: Handler };

export class Router {
  private routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler) {
    this.routes.push({ method, parts: pattern.split('/').filter(Boolean), handler });
    return this;
  }
  get(p: string, h: Handler) { return this.add('GET', p, h); }
  post(p: string, h: Handler) { return this.add('POST', p, h); }
  patch(p: string, h: Handler) { return this.add('PATCH', p, h); }
  put(p: string, h: Handler) { return this.add('PUT', p, h); }
  del(p: string, h: Handler) { return this.add('DELETE', p, h); }

  /** Fold another router's routes in. This is how modules mount. */
  merge(other: Router) {
    for (const r of other.all()) this.routes.push(r);
    return this;
  }
  all(): Route[] { return this.routes; }

  match(method: string, pathname: string): { handler: Handler; params: Record<string, string> } | null {
    const parts = pathname.split('/').filter(Boolean);
    for (const r of this.routes) {
      if (r.method !== method) continue;
      if (r.parts.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < r.parts.length; i++) {
        const rp = r.parts[i];
        if (rp.startsWith(':')) params[rp.slice(1)] = decodeURIComponent(parts[i]);
        else if (rp !== parts[i]) { ok = false; break; }
      }
      if (ok) return { handler: r.handler, params };
    }
    return null;
  }
}

export class HttpError extends Error {
  status: number;
  code: string;
  detail: any;
  constructor(status: number, code: string, message: string, detail?: any) {
    super(message);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

export function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 16 * 1024 * 1024) { reject(new HttpError(413, 'too_large', 'Body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      const type = req.headers['content-type'] ?? '';
      try {
        if (type.includes('application/json')) return resolve(JSON.parse(raw));
        if (type.includes('application/x-www-form-urlencoded')) {
          return resolve(Object.fromEntries(new URLSearchParams(raw)));
        }
        return resolve({ raw });
      } catch {
        return resolve({ raw });
      }
    });
    req.on('error', reject);
  });
}

export function json(res: ServerResponse, status: number, payload: any) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

export function text(res: ServerResponse, status: number, contentType: string, body: string, headers: Record<string, string> = {}) {
  res.writeHead(status, {
    'content-type': contentType,
    'content-length': Buffer.byteLength(body),
    ...headers,
  });
  res.end(body);
}
