import { Hono } from 'hono';
import type { Env } from '../index';

export const lessons = new Hono<Env>();

// List published lessons for a sub-strand (paginated).
lessons.get('/', async (c) => {
  const subStrandId = c.req.query('sub_strand_id');
  if (!subStrandId) return c.json({ success: false, error: 'sub_strand_id required' }, 400);
  const limit = Math.min(Number(c.req.query('limit') ?? 20), 50);
  const offset = Math.max(Number(c.req.query('offset') ?? 0), 0);
  const { results } = await c.env.DB.prepare(
    `SELECT id, title, estimated_minutes, version FROM lessons
      WHERE sub_strand_id=?1 AND status='published'
      ORDER BY title LIMIT ?2 OFFSET ?3`
  ).bind(subStrandId, limit, offset).all();
  return c.json({ success: true, data: results.map((r: any) => ({ ...r, download_available: true })) });
});

// Single lesson with sections (only published). Answer keys will live in a separate table later.
lessons.get('/:id', async (c) => {
  const id = c.req.param('id');
  const lesson = await c.env.DB.prepare(
    "SELECT id, title, estimated_minutes, version, language FROM lessons WHERE id=?1 AND status='published'"
  ).bind(id).first();
  if (!lesson) return c.json({ success: false, error: 'Not found' }, 404);
  const { results } = await c.env.DB.prepare(
    'SELECT id, section_type, title, content_json FROM lesson_sections WHERE lesson_id=?1 ORDER BY sort_order'
  ).bind(id).all();
  const sections = results.map((s: any) => ({ ...s, content: JSON.parse(s.content_json), content_json: undefined }));
  return c.json({ success: true, data: { ...lesson, sections } });
});
