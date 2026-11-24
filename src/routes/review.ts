import { Hono } from 'hono';
import type { Env } from '../index';
import { requireAuth } from '../guards';

export const review = new Hono<Env>();
review.use('*', requireAuth);

const REVIEWER_ROLES = ['content_reviewer', 'curriculum_admin', 'super_admin'];
const isReviewer = (roles: string[]) => roles.some((r) => REVIEWER_ROLES.includes(r));

// Quizzes that teachers published and that still wait for approval.
review.get('/pending', async (c) => {
  if (!isReviewer(c.get('user').roles)) return c.json({ success: false, error: 'Forbidden' }, 403);
  const { results } = await c.env.DB.prepare(
    `SELECT a.id, a.title, a.published_at, u.full_name AS author,
            (SELECT COUNT(*) FROM assessment_questions q WHERE q.assessment_id = a.id) AS question_count
       FROM assessments a LEFT JOIN users u ON u.id = a.created_by
      WHERE a.status='published' AND a.approved=0
      ORDER BY a.published_at`
  ).all();
  return c.json({ success: true, data: results });
});

// Full quiz INCLUDING answer keys. Only the author or a reviewer may see this. Learners never can.
review.get('/assessments/:id', async (c) => {
  const user = c.get('user');
  const asm = await c.env.DB.prepare(
    'SELECT id, title, status, approved, version, created_by FROM assessments WHERE id=?1'
  ).bind(c.req.param('id')).first<any>();
  if (!asm || (asm.created_by !== user.id && !isReviewer(user.roles)))
    return c.json({ success: false, error: 'Not found' }, 404);

  const { results } = await c.env.DB.prepare(
    `SELECT q.id, q.question_type, q.prompt, q.points, q.options_json,
            k.correct_option_id, k.accepted_json, k.explanation
       FROM assessment_questions q LEFT JOIN answer_keys k ON k.question_id = q.id
      WHERE q.assessment_id=?1 ORDER BY q.sort_order`
  ).bind(asm.id).all<any>();

  const questions = results.map((q) => ({
    id: q.id, type: q.question_type, prompt: q.prompt, points: q.points,
    options: q.options_json ? JSON.parse(q.options_json) : [],
    correct_option_id: q.correct_option_id,
    accepted: q.accepted_json ? JSON.parse(q.accepted_json) : [],
    explanation: q.explanation,
  }));
  return c.json({
    success: true,
    data: { id: asm.id, title: asm.title, status: asm.status, approved: asm.approved, version: asm.version, questions },
  });
});

// Send a quiz back / retire it so learners never see it.
review.post('/assessments/:id/reject', async (c) => {
  const user = c.get('user');
  if (!isReviewer(user.roles)) return c.json({ success: false, error: 'Forbidden' }, 403);
  const id = c.req.param('id');
  const r = await c.env.DB.prepare(
    "UPDATE assessments SET status='retired' WHERE id=?1 AND status='published' AND approved=0"
  ).bind(id).run();
  if (!r.meta.changes) return c.json({ success: false, error: 'Not found or already decided' }, 404);
  await c.env.DB.prepare("INSERT INTO audit_logs (id, actor_id, action, target) VALUES (?1,?2,'assessment_rejected',?3)")
    .bind(crypto.randomUUID(), user.id, id).run();
  return c.json({ success: true, data: { status: 'retired' } });
});
