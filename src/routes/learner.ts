import { Hono } from 'hono';
import type { Env } from '../index';
import { requireAuth, requireRole } from '../guards';
import { buildSummary } from '../lib/summary';

export const learner = new Hono<Env>();
learner.use('*', requireAuth, requireRole('learner'));

export const Q_ME = `
  SELECT u.full_name, lp.grade_id, g.name AS grade_name
    FROM users u JOIN learner_profiles lp ON lp.user_id = u.id JOIN grades g ON g.id = lp.grade_id
   WHERE u.id=?1`;

export const Q_SUBJECTS = `
  SELECT gs.id AS grade_subject_id, s.id AS subject_id, s.name, s.category,
         (SELECT COUNT(*) FROM lessons l
            JOIN sub_strands ss ON ss.id = l.sub_strand_id JOIN strands st ON st.id = ss.strand_id
           WHERE st.grade_subject_id = gs.id AND l.status = 'published') AS lesson_total,
         (SELECT COUNT(*) FROM lesson_progress p
            JOIN lessons l ON l.id = p.lesson_id AND l.status = 'published'
            JOIN sub_strands ss ON ss.id = l.sub_strand_id JOIN strands st ON st.id = ss.strand_id
           WHERE st.grade_subject_id = gs.id AND p.learner_id = ?3 AND p.completed_at IS NOT NULL) AS lesson_done
    FROM grade_subjects gs JOIN subjects s ON s.id = gs.subject_id
   WHERE gs.grade_id = ?1 AND gs.curriculum_version_id = ?2
   ORDER BY CASE s.category WHEN 'core' THEN 0 WHEN 'religious' THEN 1 ELSE 2 END, s.name`;

export const Q_RESUME = `
  SELECT l.id AS lesson_id, l.title, s.name AS subject_name, s.id AS subject_id, 'resume' AS kind
    FROM lesson_progress lp
    JOIN lessons l ON l.id = lp.lesson_id AND l.status = 'published'
    JOIN sub_strands ss ON ss.id = l.sub_strand_id JOIN strands st ON st.id = ss.strand_id
    JOIN grade_subjects gs ON gs.id = st.grade_subject_id JOIN subjects s ON s.id = gs.subject_id
   WHERE lp.learner_id = ?1 AND lp.completed_at IS NULL
   ORDER BY lp.last_opened_at DESC LIMIT 1`;

export const Q_NEXT = `
  SELECT l.id AS lesson_id, l.title, s.name AS subject_name, s.id AS subject_id, 'next' AS kind
    FROM lessons l
    JOIN sub_strands ss ON ss.id = l.sub_strand_id JOIN strands st ON st.id = ss.strand_id
    JOIN grade_subjects gs ON gs.id = st.grade_subject_id JOIN subjects s ON s.id = gs.subject_id
   WHERE gs.grade_id = ?1 AND l.status = 'published'
     AND NOT EXISTS (SELECT 1 FROM lesson_progress p WHERE p.learner_id = ?2 AND p.lesson_id = l.id AND p.completed_at IS NOT NULL)
   ORDER BY l.id LIMIT 1`;

export const Q_LESSON_VISIBLE = `
  SELECT l.id FROM lessons l
    JOIN sub_strands ss ON ss.id = l.sub_strand_id JOIN strands st ON st.id = ss.strand_id
    JOIN grade_subjects gs ON gs.id = st.grade_subject_id
   WHERE l.id = ?1 AND l.status = 'published' AND gs.grade_id = ?2`;

export const Q_OPEN = `
  INSERT INTO lesson_progress (learner_id, lesson_id, first_opened_at, last_opened_at)
  VALUES (?1, ?2, datetime('now'), datetime('now'))
  ON CONFLICT(learner_id, lesson_id) DO UPDATE SET last_opened_at = datetime('now')`;

export const Q_COMPLETE = `
  INSERT INTO lesson_progress (learner_id, lesson_id, first_opened_at, last_opened_at, completed_at)
  VALUES (?1, ?2, datetime('now'), datetime('now'), COALESCE(?3, datetime('now')))
  ON CONFLICT(learner_id, lesson_id) DO UPDATE SET
    last_opened_at = datetime('now'),
    completed_at = COALESCE(lesson_progress.completed_at, excluded.completed_at)`;

export const Q_TREE_STRANDS = `SELECT id, title FROM strands WHERE grade_subject_id=?1 ORDER BY sort_order`;

export const Q_TREE_SUBS = `
  SELECT ss.id, ss.strand_id, ss.title, ss.suggested_lessons,
         (SELECT COUNT(*) FROM lessons l WHERE l.sub_strand_id = ss.id AND l.status = 'published') AS lesson_count,
         (SELECT COUNT(*) FROM lesson_progress p JOIN lessons l ON l.id = p.lesson_id
           WHERE l.sub_strand_id = ss.id AND l.status = 'published' AND p.learner_id = ?2 AND p.completed_at IS NOT NULL) AS done_count,
         (SELECT COUNT(*) FROM assessments a WHERE a.sub_strand_id = ss.id AND a.status = 'published' AND a.approved = 1) AS quiz_count
    FROM sub_strands ss JOIN strands st ON st.id = ss.strand_id
   WHERE st.grade_subject_id = ?1 ORDER BY ss.sort_order`;

export const Q_TREE_OUTCOMES = `
  SELECT lo.id, lo.sub_strand_id, lo.description,
         (SELECT ce.status FROM competency_evidence ce
           WHERE ce.learner_id = ?2 AND ce.outcome_id = lo.id
           ORDER BY ce.created_at DESC, ce.rowid DESC LIMIT 1) AS status
    FROM learning_outcomes lo
    JOIN sub_strands ss ON ss.id = lo.sub_strand_id JOIN strands st ON st.id = ss.strand_id
   WHERE st.grade_subject_id = ?1 ORDER BY lo.sort_order`;

async function myGrade(db: D1Database, uid: string): Promise<string | null> {
  const r = await db.prepare('SELECT grade_id FROM learner_profiles WHERE user_id=?1').bind(uid).first<{ grade_id: string }>();
  return r?.grade_id ?? null;
}

function sqlTime(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = Date.parse(v);
  if (Number.isNaN(t)) return null;
  const now = Date.now();
  if (t > now + 5 * 60000 || t < now - 30 * 86400000) return null; // ignore clocks that are clearly wrong
  return new Date(t).toISOString().slice(0, 19).replace('T', ' ');
}

learner.get('/dashboard', async (c) => {
  const db = c.env.DB;
  const uid = c.get('user').id;
  const me = await db.prepare(Q_ME).bind(uid).first<any>();
  if (!me) return c.json({ success: false, error: 'Not found' }, 404);
  const v = await db
    .prepare("SELECT id FROM curriculum_versions WHERE status='active' ORDER BY created_at DESC LIMIT 1")
    .first<{ id: string }>();
  const [subjects, resume, summary] = await Promise.all([
    v ? db.prepare(Q_SUBJECTS).bind(me.grade_id, v.id, uid).all() : Promise.resolve({ results: [] as any[] }),
    db.prepare(Q_RESUME).bind(uid).first<any>(),
    buildSummary(db, uid),
  ]);
  const next = resume ? null : await db.prepare(Q_NEXT).bind(me.grade_id, uid).first<any>();
  return c.json({
    success: true,
    data: {
      name: me.full_name,
      grade_id: me.grade_id,
      grade_name: me.grade_name,
      subjects: subjects.results,
      continue: resume ?? next ?? null,
      goal_lessons: 1,
      ...summary,
    },
  });
});

// Subject map for one of the learner's own grade subjects, with progress and outcome status.
learner.get('/grade-subjects/:id/tree', async (c) => {
  const db = c.env.DB;
  const uid = c.get('user').id;
  const id = c.req.param('id');
  const grade = await myGrade(db, uid);
  const gs = await db.prepare('SELECT s.name, s.id AS subject_id, gs.grade_id FROM grade_subjects gs JOIN subjects s ON s.id = gs.subject_id WHERE gs.id=?1')
    .bind(id).first<any>();
  if (!gs || gs.grade_id !== grade) return c.json({ success: false, error: 'Not found' }, 404);
  const [strands, subs, outs] = await Promise.all([
    db.prepare(Q_TREE_STRANDS).bind(id).all<any>(),
    db.prepare(Q_TREE_SUBS).bind(id, uid).all<any>(),
    db.prepare(Q_TREE_OUTCOMES).bind(id, uid).all<any>(),
  ]);
  const data = strands.results.map((s) => ({
    ...s,
    sub_strands: subs.results
      .filter((x) => x.strand_id === s.id)
      .map((x) => ({ ...x, outcomes: outs.results.filter((o) => o.sub_strand_id === x.id) })),
  }));
  return c.json({ success: true, data: { subject_id: gs.subject_id, name: gs.name, strands: data } });
});

learner.get('/completed', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT lesson_id FROM lesson_progress WHERE learner_id=?1 AND completed_at IS NOT NULL'
  ).bind(c.get('user').id).all<{ lesson_id: string }>();
  return c.json({ success: true, data: results.map((r) => r.lesson_id) });
});

learner.post('/lessons/:id/open', async (c) => {
  const db = c.env.DB;
  const uid = c.get('user').id;
  const grade = await myGrade(db, uid);
  const ok = grade ? await db.prepare(Q_LESSON_VISIBLE).bind(c.req.param('id'), grade).first() : null;
  if (!ok) return c.json({ success: false, error: 'Not found' }, 404);
  await db.prepare(Q_OPEN).bind(uid, c.req.param('id')).run();
  return c.json({ success: true, data: null });
});

// Safe to repeat: completing a lesson twice keeps the first completion time.
learner.post('/lessons/:id/complete', async (c) => {
  const db = c.env.DB;
  const uid = c.get('user').id;
  const b = await c.req.json().catch(() => null);
  const grade = await myGrade(db, uid);
  const ok = grade ? await db.prepare(Q_LESSON_VISIBLE).bind(c.req.param('id'), grade).first() : null;
  if (!ok) return c.json({ success: false, error: 'Not found' }, 404);
  await db.prepare(Q_COMPLETE).bind(uid, c.req.param('id'), sqlTime(b?.completed_at)).run();
  const s = await buildSummary(db, uid);
  return c.json({ success: true, data: { completed: true, streak: s.streak, lessons_completed: s.stats.lessons_completed, badges: s.badges } });
});
