import { Hono } from 'hono';
import type { Env } from '../index';
import { requireAuth, requireRole } from '../guards';

export const assessments = new Hono<Env>();
export const progress = new Hono<Env>();

type Opt = { id: string; label: string };
const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

// A learner may only see published + approved assessments for THEIR grade.
const VISIBLE = `
  SELECT a.id, a.title, a.version, a.time_limit_minutes, a.max_attempts,
         s.id AS subject_id, s.name AS subject_name, ss.title AS topic,
         (SELECT COUNT(*) FROM assessment_questions q WHERE q.assessment_id = a.id) AS question_count
    FROM assessments a
    JOIN sub_strands ss ON ss.id = a.sub_strand_id
    JOIN strands st ON st.id = ss.strand_id
    JOIN grade_subjects gs ON gs.id = st.grade_subject_id
    JOIN subjects s ON s.id = gs.subject_id
   WHERE a.status = 'published' AND a.approved = 1 AND gs.grade_id = ?1`;

async function learnerGrade(db: D1Database, uid: string): Promise<string | null> {
  const r = await db.prepare('SELECT grade_id FROM learner_profiles WHERE user_id=?1').bind(uid).first<{ grade_id: string }>();
  return r?.grade_id ?? null;
}

// ---------- Learner ----------
assessments.get('/', requireAuth, requireRole('learner'), async (c) => {
  const grade = await learnerGrade(c.env.DB, c.get('user').id);
  if (!grade) return c.json({ success: true, data: [] });
  const { results } = await c.env.DB.prepare(VISIBLE + ' ORDER BY a.title').bind(grade).all();
  return c.json({ success: true, data: results });
});

// ---------- Teacher ----------
assessments.get('/mine', requireAuth, requireRole('teacher'), async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, title, status, approved, version, created_at FROM assessments WHERE created_by=?1 ORDER BY created_at DESC'
  ).bind(c.get('user').id).all();
  return c.json({ success: true, data: results });
});

assessments.post('/', requireAuth, requireRole('teacher'), async (c) => {
  const db = c.env.DB;
  const b = await c.req.json().catch(() => null);
  const title = String(b?.title ?? '').trim();
  const subStrandId = String(b?.sub_strand_id ?? '');
  const qs: any[] = Array.isArray(b?.questions) ? b.questions : [];
  const outcomeIds: string[] = Array.isArray(b?.outcome_ids) ? b.outcome_ids.map(String).slice(0, 5) : [];

  if (title.length < 3 || title.length > 150) return c.json({ success: false, error: 'Title must be 3-150 characters' }, 400);
  if (qs.length < 1 || qs.length > 15) return c.json({ success: false, error: 'Add 1 to 15 questions' }, 400);

  const ss = await db.prepare('SELECT id FROM sub_strands WHERE id=?1').bind(subStrandId).first();
  if (!ss) return c.json({ success: false, error: 'Unknown sub-strand' }, 400);

  if (outcomeIds.length) {
    const ph = outcomeIds.map((_, i) => `?${i + 2}`).join(',');
    const ok = await db.prepare(`SELECT id FROM learning_outcomes WHERE sub_strand_id=?1 AND id IN (${ph})`)
      .bind(subStrandId, ...outcomeIds).all();
    if (ok.results.length !== outcomeIds.length)
      return c.json({ success: false, error: 'Outcomes must belong to the chosen sub-strand' }, 400);
  }

  const asmId = crypto.randomUUID();
  const stmts: D1PreparedStatement[] = [
    db.prepare('INSERT INTO assessments (id, title, sub_strand_id, created_by) VALUES (?1,?2,?3,?4)')
      .bind(asmId, title, subStrandId, c.get('user').id),
  ];

  for (let i = 0; i < qs.length; i++) {
    const q = qs[i];
    const type = q?.type;
    const prompt = String(q?.prompt ?? '').trim();
    const points = Math.min(Math.max(parseInt(q?.points ?? 1, 10) || 1, 1), 10);
    const explanation = q?.explanation ? String(q.explanation).slice(0, 500) : null;
    if (prompt.length < 3 || prompt.length > 500)
      return c.json({ success: false, error: `Question ${i + 1}: prompt must be 3-500 characters` }, 400);

    const qid = crypto.randomUUID();
    let optionsJson: string | null = null;
    let correctOptionId: string | null = null;
    let acceptedJson: string | null = null;

    if (type === 'mcq') {
      const labels: string[] = Array.isArray(q.options) ? q.options.map((x: unknown) => String(x).trim()) : [];
      const idx = Number(q.correct_index);
      if (labels.length < 2 || labels.length > 6 || labels.some((l) => !l || l.length > 200) || !Number.isInteger(idx) || idx < 0 || idx >= labels.length)
        return c.json({ success: false, error: `Question ${i + 1}: give 2-6 options and a valid correct_index` }, 400);
      const opts: Opt[] = labels.map((label) => ({ id: crypto.randomUUID(), label }));
      optionsJson = JSON.stringify(opts);
      correctOptionId = opts[idx].id;
    } else if (type === 'true_false') {
      if (typeof q.correct !== 'boolean')
        return c.json({ success: false, error: `Question ${i + 1}: correct must be true or false` }, 400);
      const opts: Opt[] = [{ id: crypto.randomUUID(), label: 'True' }, { id: crypto.randomUUID(), label: 'False' }];
      optionsJson = JSON.stringify(opts);
      correctOptionId = q.correct ? opts[0].id : opts[1].id;
    } else if (type === 'short_answer') {
      const acc: string[] = Array.isArray(q.accepted) ? q.accepted.map((x: unknown) => String(x).trim()).filter(Boolean) : [];
      if (acc.length < 1 || acc.length > 5) return c.json({ success: false, error: `Question ${i + 1}: give 1-5 accepted answers` }, 400);
      acceptedJson = JSON.stringify(acc);
    } else {
      return c.json({ success: false, error: `Question ${i + 1}: type must be mcq, true_false or short_answer` }, 400);
    }

    stmts.push(
      db.prepare('INSERT INTO assessment_questions (id, assessment_id, question_type, prompt, points, options_json, sort_order) VALUES (?1,?2,?3,?4,?5,?6,?7)')
        .bind(qid, asmId, type, prompt, points, optionsJson, i + 1),
      db.prepare('INSERT INTO answer_keys (question_id, correct_option_id, accepted_json, explanation) VALUES (?1,?2,?3,?4)')
        .bind(qid, correctOptionId, acceptedJson, explanation)
    );
  }
  for (const oid of outcomeIds)
    stmts.push(db.prepare('INSERT INTO assessment_outcomes (assessment_id, outcome_id) VALUES (?1,?2)').bind(asmId, oid));

  await db.batch(stmts);
  return c.json({ success: true, data: { id: asmId, status: 'draft' } }, 201);
});

// Publishing locks the assessment. Learners still cannot see it until a reviewer approves it.
assessments.post('/:id/publish', requireAuth, requireRole('teacher'), async (c) => {
  const r = await c.env.DB.prepare(
    "UPDATE assessments SET status='published', published_at=datetime('now') WHERE id=?1 AND created_by=?2 AND status='draft'"
  ).bind(c.req.param('id'), c.get('user').id).run();
  if (!r.meta.changes) return c.json({ success: false, error: 'Not found or already published' }, 404);
  return c.json({ success: true, data: { status: 'published', approved: false } });
});

assessments.post('/:id/approve', requireAuth, requireRole('content_reviewer', 'curriculum_admin', 'super_admin'), async (c) => {
  const db = c.env.DB;
  const uid = c.get('user').id;
  const id = c.req.param('id');
  const r = await db.prepare(
    "UPDATE assessments SET approved=1, approved_by=?2, approved_at=datetime('now') WHERE id=?1 AND status='published'"
  ).bind(id, uid).run();
  if (!r.meta.changes) return c.json({ success: false, error: 'Not found or not published' }, 404);
  await db.prepare("INSERT INTO audit_logs (id, actor_id, action, target) VALUES (?1,?2,'assessment_approved',?3)")
    .bind(crypto.randomUUID(), uid, id).run();
  return c.json({ success: true, data: { approved: true } });
});

// Questions for a learner. Answer keys are NEVER selected here.
assessments.get('/:id', requireAuth, requireRole('learner'), async (c) => {
  const db = c.env.DB;
  const grade = await learnerGrade(db, c.get('user').id);
  const asm = grade ? await db.prepare(VISIBLE + ' AND a.id=?2').bind(grade, c.req.param('id')).first<any>() : null;
  if (!asm) return c.json({ success: false, error: 'Not found' }, 404);
  const { results } = await db.prepare(
    'SELECT id, question_type, prompt, points, options_json FROM assessment_questions WHERE assessment_id=?1 ORDER BY sort_order'
  ).bind(asm.id).all<any>();
  const questions = results.map((q) => ({
    id: q.id, type: q.question_type, prompt: q.prompt, points: q.points,
    options: q.options_json ? JSON.parse(q.options_json) : [],
  }));
  return c.json({ success: true, data: { ...asm, questions } });
});

// Submit an attempt. Marked here, on the server. Safe to retry: same attempt_id = same result.
assessments.post('/:id/attempts', requireAuth, requireRole('learner'), async (c) => {
  const db = c.env.DB;
  const uid = c.get('user').id;
  const asmId = c.req.param('id');
  const b = await c.req.json().catch(() => null);
  const attemptId = String(b?.attempt_id ?? '');
  if (!/^[0-9a-fA-F-]{36}$/.test(attemptId)) return c.json({ success: false, error: 'Invalid attempt_id' }, 400);
  const answers: any[] = Array.isArray(b?.answers) ? b.answers.slice(0, 50) : [];

  const existing = await db.prepare('SELECT learner_id, assessment_id, results_json FROM assessment_attempts WHERE id=?1')
    .bind(attemptId).first<any>();
  if (existing) {
    if (existing.learner_id !== uid || existing.assessment_id !== asmId)
      return c.json({ success: false, error: 'Conflict' }, 409);
    return c.json({ success: true, data: JSON.parse(existing.results_json), duplicate: true });
  }

  const grade = await learnerGrade(db, uid);
  const asm = grade ? await db.prepare(VISIBLE + ' AND a.id=?2').bind(grade, asmId).first<any>() : null;
  if (!asm) return c.json({ success: false, error: 'Not found' }, 404);

  if (asm.max_attempts > 0) {
    const n = await db.prepare('SELECT COUNT(*) AS n FROM assessment_attempts WHERE learner_id=?1 AND assessment_id=?2')
      .bind(uid, asmId).first<{ n: number }>();
    if ((n?.n ?? 0) >= asm.max_attempts) return c.json({ success: false, error: 'No attempts left' }, 403);
  }

  const { results: qs } = await db.prepare(
    `SELECT q.id, q.question_type, q.points, q.options_json, k.correct_option_id, k.accepted_json, k.explanation
       FROM assessment_questions q JOIN answer_keys k ON k.question_id = q.id
      WHERE q.assessment_id=?1 ORDER BY q.sort_order`
  ).bind(asmId).all<any>();

  const byQ = new Map<string, any>(answers.map((a) => [String(a?.question_id), a]));
  let score = 0, max = 0;
  const marked = qs.map((q) => {
    const a = byQ.get(q.id) ?? {};
    const opts: Opt[] = q.options_json ? JSON.parse(q.options_json) : [];
    max += q.points;
    let correct = false;
    let correctAnswer = '';
    if (q.question_type === 'short_answer') {
      const accepted: string[] = q.accepted_json ? JSON.parse(q.accepted_json) : [];
      correct = accepted.map(norm).includes(norm(a.text));
      correctAnswer = accepted[0] ?? '';
    } else {
      correct = !!a.option_id && a.option_id === q.correct_option_id;
      correctAnswer = opts.find((o) => o.id === q.correct_option_id)?.label ?? '';
    }
    const pts = correct ? q.points : 0;
    score += pts;
    return { question_id: q.id, correct, points_awarded: pts, correct_answer: correctAnswer, explanation: q.explanation ?? null };
  });

  const percent = max > 0 ? Math.round((score * 100) / max) : 0;
  const result = { attempt_id: attemptId, assessment_id: asmId, score, max_score: max, percent, results: marked };
  const status = percent >= 80 ? 'demonstrated' : percent >= 50 ? 'developing' : 'requires_additional_support';

  const clean = answers.map((a) => ({
    question_id: String(a?.question_id ?? '').slice(0, 64),
    option_id: a?.option_id ? String(a.option_id).slice(0, 64) : undefined,
    text: a?.text !== undefined ? String(a.text).slice(0, 200) : undefined,
  }));

  const { results: outs } = await db.prepare('SELECT outcome_id FROM assessment_outcomes WHERE assessment_id=?1')
    .bind(asmId).all<{ outcome_id: string }>();

  const stmts: D1PreparedStatement[] = [
    db.prepare(
      'INSERT INTO assessment_attempts (id, assessment_id, assessment_version, learner_id, client_submitted_at, score, max_score, answers_json, results_json) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)'
    ).bind(attemptId, asmId, asm.version, uid, String(b?.submitted_at ?? '').slice(0, 40) || null, score, max, JSON.stringify(clean), JSON.stringify(result)),
    ...outs.map((o) =>
      db.prepare('INSERT INTO competency_evidence (id, learner_id, outcome_id, attempt_id, score_pct, status) VALUES (?1,?2,?3,?4,?5,?6)')
        .bind(crypto.randomUUID(), uid, o.outcome_id, attemptId, percent, status)),
  ];
  try {
    await db.batch(stmts);
  } catch (e) {
    if (String(e).includes('UNIQUE')) {
      const again = await db.prepare('SELECT results_json FROM assessment_attempts WHERE id=?1 AND learner_id=?2')
        .bind(attemptId, uid).first<any>();
      if (again) return c.json({ success: true, data: JSON.parse(again.results_json), duplicate: true });
    }
    throw e;
  }
  return c.json({ success: true, data: result }, 201);
});

// ---------- Progress ----------
progress.get('/me', requireAuth, requireRole('learner'), async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT ce.outcome_id, lo.description, ce.status, ce.score_pct, ce.created_at
       FROM competency_evidence ce JOIN learning_outcomes lo ON lo.id = ce.outcome_id
      WHERE ce.learner_id=?1
        AND ce.created_at = (SELECT MAX(x.created_at) FROM competency_evidence x
                              WHERE x.learner_id = ce.learner_id AND x.outcome_id = ce.outcome_id)
      GROUP BY ce.outcome_id
      ORDER BY lo.description`
  ).bind(c.get('user').id).all();
  return c.json({ success: true, data: results });
});
