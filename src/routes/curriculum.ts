import { Hono } from 'hono';
import type { Env } from '../index';

export const curriculum = new Hono<Env>();

async function activeVersion(db: D1Database): Promise<string | null> {
  const r = await db
    .prepare("SELECT id FROM curriculum_versions WHERE status='active' ORDER BY created_at DESC LIMIT 1")
    .first<{ id: string }>();
  return r?.id ?? null;
}

curriculum.get('/grades', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, name, level_id FROM grades ORDER BY sort_order'
  ).all();
  return c.json({ success: true, data: results });
});

curriculum.get('/grades/:gradeId/subjects', async (c) => {
  const v = await activeVersion(c.env.DB);
  if (!v) return c.json({ success: true, data: [] });
  const { results } = await c.env.DB.prepare(
    `SELECT gs.id AS grade_subject_id, s.id AS subject_id, s.name, s.category
       FROM grade_subjects gs JOIN subjects s ON s.id = gs.subject_id
      WHERE gs.grade_id = ?1 AND gs.curriculum_version_id = ?2
      ORDER BY CASE s.category WHEN 'core' THEN 0 WHEN 'religious' THEN 1 ELSE 2 END, s.name`
  ).bind(c.req.param('gradeId'), v).all();
  return c.json({ success: true, data: results, curriculum_version: v });
});

// Plain tree (no learner data). Used by the teacher quiz builder.
curriculum.get('/grade-subjects/:id/tree', async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const [strands, subs, outs] = await Promise.all([
    db.prepare('SELECT id, title FROM strands WHERE grade_subject_id=?1 ORDER BY sort_order').bind(id).all(),
    db.prepare(
      `SELECT ss.id, ss.strand_id, ss.title FROM sub_strands ss
         JOIN strands st ON st.id = ss.strand_id
        WHERE st.grade_subject_id=?1 ORDER BY ss.sort_order`).bind(id).all(),
    db.prepare(
      `SELECT lo.id, lo.sub_strand_id, lo.description FROM learning_outcomes lo
         JOIN sub_strands ss ON ss.id = lo.sub_strand_id
         JOIN strands st ON st.id = ss.strand_id
        WHERE st.grade_subject_id=?1 ORDER BY lo.sort_order`).bind(id).all(),
  ]);
  const data = (strands.results as any[]).map((s) => ({
    ...s,
    sub_strands: (subs.results as any[])
      .filter((x) => x.strand_id === s.id)
      .map((x) => ({ ...x, outcomes: (outs.results as any[]).filter((o) => o.sub_strand_id === x.id) })),
  }));
  return c.json({ success: true, data });
});
