// Organizer accounts and sessions.
//
// Only the people running orders sign in. Students and anyone else on an order
// hold a personal link instead, which is their whole identity for that order.

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { one, insert, run, nowIso, all } from '../db/db.ts';
import { HttpError, type Ctx, type Actor } from '../api/router.ts';

const SESSION_DAYS = 30;
const COOKIE = 'mc_session';

export const token = (bytes = 18) => randomBytes(bytes).toString('base64url');

export function hashPassword(password: string, salt?: string): { hash: string; salt: string } {
  const s = salt ?? randomBytes(16).toString('hex');
  return { hash: scryptSync(password, s, 64).toString('hex'), salt: s };
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  const attempt = Buffer.from(scryptSync(password, salt, 64).toString('hex'));
  const stored = Buffer.from(hash);
  return attempt.length === stored.length && timingSafeEqual(attempt, stored);
}

export const needsSetup = () => !one('SELECT 1 AS x FROM organizer LIMIT 1');

export function createOrganizer(email: string, name: string, password: string): string {
  email = String(email ?? '').trim().toLowerCase();
  name = String(name ?? '').trim();
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw new HttpError(400, 'bad_email', 'Enter an email address.');
  if (!name) throw new HttpError(400, 'bad_name', 'Enter your name.');
  if (String(password ?? '').length < 8) throw new HttpError(400, 'weak_password', 'Use a password of at least 8 characters.');
  if (one('SELECT 1 AS x FROM organizer WHERE email=?', email)) throw new HttpError(409, 'exists', 'That email already has an account.');
  const { hash, salt } = hashPassword(password);
  return insert('organizer', { email, name, pw_hash: hash, pw_salt: salt, created_at: nowIso() });
}

// A few wrong passwords a minute per address, then a pause. In memory: a
// restart forgets it, which is fine for slowing a guesser down.
const failures = new Map<string, number[]>();

export function login(email: string, password: string): string {
  email = String(email ?? '').trim().toLowerCase();
  const recent = (failures.get(email) ?? []).filter((t) => Date.now() - t < 60_000);
  if (recent.length >= 5) throw new HttpError(429, 'slow_down', 'Too many tries. Wait a minute and try again.');
  const row = one('SELECT * FROM organizer WHERE email=?', email);
  if (!row || !verifyPassword(String(password ?? ''), row.pw_hash, row.pw_salt)) {
    failures.set(email, [...recent, Date.now()]);
    throw new HttpError(401, 'bad_login', 'That email and password do not match.');
  }
  failures.delete(email);
  const t = token(24);
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  run('INSERT INTO session (token, organizer_id, created_at, expires_at) VALUES (?, ?, ?, ?)', t, row.id, nowIso(), expires);
  return t;
}

export function logout(t: string | null): void {
  if (t) run('DELETE FROM session WHERE token=?', t);
}

export function actorFor(t: string | null): Actor | null {
  if (!t) return null;
  const row = one(
    `SELECT o.id, o.email, o.name FROM session s JOIN organizer o ON o.id = s.organizer_id
     WHERE s.token=? AND s.expires_at > ?`, t, nowIso());
  return row ? { organizer_id: row.id, email: row.email, name: row.name } : null;
}

export function cookieToken(ctx: Ctx): string | null {
  for (const part of (ctx.req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function sessionCookie(t: string, secure: boolean): string {
  const maxAge = t ? SESSION_DAYS * 86400 : 0;
  return `${COOKIE}=${encodeURIComponent(t)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

export function requireActor(ctx: Ctx): Actor {
  if (!ctx.actor) throw new HttpError(401, 'signed_out', 'Sign in first.');
  return ctx.actor;
}

export const organizers = () => all('SELECT id, email, name, created_at FROM organizer ORDER BY created_at');
