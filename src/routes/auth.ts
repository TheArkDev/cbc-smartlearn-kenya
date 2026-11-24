import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../index';
import { requireAuth } from '../guards';
import { b64u, hashPassword, sha256, signJwt, verifyPassword } from '../lib/crypto';

export const auth = new Hono<Env>();

const ACCESS_TTL = 900; // 15 minutes
const REFRESH_DAYS = 30;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function getRoles(db: D1Database, userId: string): Promise<string[]> {
  const { results } = await db
    .prepare('SELECT role_id FROM user_roles WHERE user_id=?1')
    .bind(userId).all<{ role_id: string }>();
  return results.map((r) => r.role_id);
}

async function issueSession(c: Context<Env>, userId: string, roles: string[], device?: string) {
  const access = await signJwt({ sub: userId, roles }, c.env.JWT_SECRET, ACCESS_TTL);
  const refresh = b64u(crypto.getRandomValues(new Uint8Array(32)));
  const expires = new Date(Date.now() + REFRESH_DAYS * 86400000).toISOString();
  await c.env.DB.prepare(
    'INSERT INTO sessions (id, user_id, refresh_hash, device_label, expires_at) VALUES (?1,?2,?3,?4,?5)'
  ).bind(crypto.randomUUID(), userId, await sha256(refresh), device?.slice(0, 60) ?? null, expires).run();
  return { access_token: access, refresh_token: refresh, expires_in: ACCESS_TTL };
}

// Self-registration is for parents and teachers only. Learners are created by a parent/guardian.
auth.post('/register', async (c) => {
  const b = await c.req.json().catch(() => null);
  const role = b?.role;
  const name = String(b?.full_name ?? '').trim();
  const email = String(b?.email ?? '').trim().toLowerCase();
  const password = String(b?.password ?? '');

  if (role !== 'parent' && role !== 'teacher')
    return c.json({ success: false, error: 'Role must be parent or teacher' }, 400);
  if (name.length < 2 || name.length > 100) return c.json({ success: false, error: 'Enter your full name' }, 400);
  if (!EMAIL_RE.test(email) || email.length > 200) return c.json({ success: false, error: 'Enter a valid email' }, 400);
  if (password.length < 8 || password.length > 100)
    return c.json({ success: false, error: 'Password must be 8 to 100 characters' }, 400);

  const id = crypto.randomUUID();
  const hash = await hashPassword(password);
  const stmts = [
    c.env.DB.prepare('INSERT INTO users (id, email, password_hash, full_name) VALUES (?1,?2,?3,?4)').bind(id, email, hash, name),
    c.env.DB.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?1,?2)').bind(id, role),
  ];
  if (role === 'teacher')
    stmts.push(c.env.DB.prepare('INSERT INTO teacher_profiles (user_id) VALUES (?1)').bind(id));
  try {
    await c.env.DB.batch(stmts);
  } catch (e) {
    if (String(e).includes('UNIQUE')) return c.json({ success: false, error: 'An account with this email already exists' }, 409);
    throw e;
  }
  const session = await issueSession(c, id, [role], b?.device_label);
  return c.json({ success: true, data: session }, 201);
});

auth.post('/login', async (c) => {
  const b = await c.req.json().catch(() => null);
  const ident = String(b?.identifier ?? '').trim().toLowerCase();
  const password = String(b?.password ?? '');
  const bad = () => c.json({ success: false, error: 'Incorrect login details' }, 401);
  if (!ident || !password || password.length > 100) return bad();

  const u = await c.env.DB.prepare(
    'SELECT id, password_hash, account_status, failed_attempts, locked_until FROM users WHERE email=?1 OR username=?1'
  ).bind(ident).first<any>();

  if (!u) {
    await verifyPassword(password, await hashPassword('dummy')); // keep timing similar
    return bad();
  }
  if (u.locked_until && u.locked_until > new Date().toISOString())
    return c.json({ success: false, error: 'Too many attempts. Try again in 15 minutes.' }, 429);
  if (u.account_status !== 'active')
    return c.json({ success: false, error: 'This account is not available' }, 403);

  if (!(await verifyPassword(password, u.password_hash))) {
    const fails = u.failed_attempts + 1;
    const lock = fails >= 5 ? new Date(Date.now() + 15 * 60000).toISOString() : null;
    await c.env.DB.prepare('UPDATE users SET failed_attempts=?2, locked_until=?3 WHERE id=?1')
      .bind(u.id, lock ? 0 : fails, lock).run();
    return bad();
  }
  await c.env.DB.prepare('UPDATE users SET failed_attempts=0, locked_until=NULL WHERE id=?1').bind(u.id).run();
  const roles = await getRoles(c.env.DB, u.id);
  return c.json({ success: true, data: await issueSession(c, u.id, roles, b?.device_label) });
});

// Refresh tokens rotate: the old one stops working as soon as a new one is issued.
auth.post('/refresh', async (c) => {
  const b = await c.req.json().catch(() => null);
  const token = String(b?.refresh_token ?? '');
  if (!token) return c.json({ success: false, error: 'Unauthorized' }, 401);
  const hash = await sha256(token);
  const s = await c.env.DB.prepare(
    `SELECT s.id, s.user_id, u.account_status FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.refresh_hash=?1 AND s.revoked_at IS NULL AND s.expires_at > ?2`
  ).bind(hash, new Date().toISOString()).first<any>();
  if (!s || s.account_status !== 'active') return c.json({ success: false, error: 'Unauthorized' }, 401);
  await c.env.DB.prepare("UPDATE sessions SET revoked_at=datetime('now') WHERE id=?1").bind(s.id).run();
  const roles = await getRoles(c.env.DB, s.user_id);
  return c.json({ success: true, data: await issueSession(c, s.user_id, roles) });
});

auth.post('/logout', async (c) => {
  const b = await c.req.json().catch(() => null);
  if (b?.refresh_token) {
    await c.env.DB.prepare("UPDATE sessions SET revoked_at=datetime('now') WHERE refresh_hash=?1")
      .bind(await sha256(String(b.refresh_token))).run();
  }
  return c.json({ success: true, data: null });
});

auth.get('/me', requireAuth, async (c) => {
  const uid = c.get('user').id;
  const db = c.env.DB;
  const user = await db.prepare('SELECT id, full_name, email, username FROM users WHERE id=?1').bind(uid).first();
  if (!user) return c.json({ success: false, error: 'Unauthorized' }, 401);
  const roles = await getRoles(db, uid);
  const data: Record<string, unknown> = { user, roles };
  if (roles.includes('learner')) {
    data.learner = await db.prepare(
      'SELECT lp.grade_id, g.name AS grade_name, lp.language FROM learner_profiles lp JOIN grades g ON g.id=lp.grade_id WHERE lp.user_id=?1'
    ).bind(uid).first();
  }
  return c.json({ success: true, data });
});
