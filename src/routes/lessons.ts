import { Hono } from 'hono';
import type { Env } from '../index';

export const lessons = new Hono<Env>();

// List published lessons for a sub-strand.
lessons.get('/', async (c) => {
  const subStrandId = c.req.query('sub_strand_id');
  if (!subStrandId) return c.json({ success: false, error: 'sub_strand_id required' }, 400);
  const limit = Math.min(Number(c.req.query('limit') ?? 30), 50);
  const offset = Math.max(Number(c.req.query('offset') ?? 0), 0);
  const { results } = await c.env.DB.prepare(
    `SELECT id, title, estimated_minutes, version FROM lessons
      WHERE sub_strand_id=?1 AND status='published'
      ORDER BY id LIMIT ?2 OFFSET ?3`
  ).bind(subStrandId, limit, offset).all();
  return c.json({ success: true, data: results.map((r: any) => ({ ...r, download_available: true })) });
});

// One published lesson with its sections, linked outcomes and where the content came from.
lessons.get('/:id', async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const lesson = await db.prepare(
    `SELECT l.id, l.title, l.estimated_minutes, l.version, l.language, src.attribution AS source_note
       FROM lessons l LEFT JOIN curriculum_sources src ON src.id = l.source_id
      WHERE l.id=?1 AND l.status='published'`
  ).bind(id).first();
  if (!lesson) return c.json({ success: false, error: 'Not found' }, 404);
  const [secs, outs] = await Promise.all([
    db.prepare('SELECT id, section_type, title, content_json FROM lesson_sections WHERE lesson_id=?1 ORDER BY sort_order').bind(id).all<any>(),
    db.prepare(
      `SELECT lo.id, lo.description FROM lesson_outcomes x JOIN learning_outcomes lo ON lo.id = x.outcome_id
        WHERE x.lesson_id=?1 ORDER BY lo.sort_order`
    ).bind(id).all(),
  ]);
  const sections = secs.results.map((s: any) => ({
    id: s.id, section_type: s.section_type, title: s.title, content: JSON.parse(s.content_json),
  }));
  return c.json({ success: true, data: { ...lesson, sections, outcomes: outs.results } });
});
