import { Hono } from 'hono';
import type { Env } from '../index';
import { requireAuth, requireRole } from '../lib/auth';
import { hashPassword } from '../lib/crypto';

export const guardians = new Hono<Env>();
guardians.use('*', requireAuth, requireRole('parent'));

const USERNAME_RE = /^[a-z0-9_.]{4,30}$/;
const NOTICE_VERSION = 'draft-v0'; // replace with the lawyer-approved privacy notice version

// A parent/guardian creates a child's learner account and records consent in the same step.
guardians.post('/learners', async (c) => {
  const parentId = c.get('user').id;
  const b = await c.req.json().catch(() => null);
  const name = String(b?.full_name ?? '').trim();
  const username = String(b?.username ?? '').trim().toLowerCase();
  const password = String(b?.password ?? '');
  const gradeId = String(b?.grade_id ?? '');

  if (b?.consent !== true) return c.json({ success: false, error: 'Guardian consent is required' }, 400);
  if (name.length < 2 || name.length > 100) return c.json({ success: false, error: "Enter the child's name" }, 400);
  if (!USERNAME_RE.test(username))
    return c.json({ success: false, error: 'Username: 4-30 letters, numbers, . or _' }, 400);
  if (password.length < 6 || password.length > 100)
    return c.json({ success: false, error: 'Password must be at least 6 characters' }, 400);

  const db = c.env.DB;
  const grade = await db.prepare('SELECT id FROM grades WHERE id=?1').bind(gradeId).first();
  if (!grade) return c.json({ success: false, error: 'Choose a valid grade' }, 400);

  const count = await db.prepare('SELECT COUNT(*) AS n FROM learner_guardians WHERE guardian_id=?1')
    .bind(parentId).first<{ n: number }>();
  if ((count?.n ?? 0) >= 10) return c.json({ success: false, error: 'Learner limit reached' }, 400);

  const id = crypto.randomUUID();
  const hash = await hashPassword(password);
  try {
    await db.batch([
      db.prepare('INSERT INTO users (id, username, password_hash, full_name, created_by) VALUES (?1,?2,?3,?4,?5)')
        .bind(id, username, hash, name, parentId),
      db.prepare("INSERT INTO user_roles (user_id, role_id) VALUES (?1,'learner')").bind(id),
      db.prepare('INSERT INTO learner_profiles (user_id, grade_id) VALUES (?1,?2)').bind(id, gradeId),
      db.prepare('INSERT INTO learner_guardians (learner_id, guardian_id, relationship) VALUES (?1,?2,?3)')
        .bind(id, parentId, String(b?.relationship ?? 'guardian').slice(0, 30)),
      db.prepare("INSERT INTO guardian_consents (id, guardian_id, learner_id, consent_type, notice_version) VALUES (?1,?2,?3,'child_data_processing',?4)")
        .bind(crypto.randomUUID(), parentId, id, NOTICE_VERSION),
      db.prepare("INSERT INTO audit_logs (id, actor_id, action, target) VALUES (?1,?2,'learner_created',?3)")
        .bind(crypto.randomUUID(), parentId, id),
    ]);
  } catch (e) {
    if (String(e).includes('UNIQUE')) return c.json({ success: false, error: 'That username is taken' }, 409);
    throw e;
  }
  return c.json({ success: true, data: { id, username } }, 201);
});

// Only the parent's own linked learners are ever returned.
guardians.get('/learners', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.full_name, u.username, g.name AS grade_name
       FROM learner_guardians lg
       JOIN users u ON u.id = lg.learner_id
       JOIN learner_profiles lp ON lp.user_id = u.id
       JOIN grades g ON g.id = lp.grade_id
      WHERE lg.guardian_id=?1 AND lg.status='verified'
      ORDER BY u.full_name`
  ).bind(c.get('user').id).all();
  return c.json({ success: true, data: results });
});
