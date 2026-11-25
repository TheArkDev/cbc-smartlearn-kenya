// Shared learner summary used by the learner dashboard and the parent view.

export const Q_LESSON_COUNT = `
  SELECT COUNT(*) AS n FROM lesson_progress WHERE learner_id=?1 AND completed_at IS NOT NULL`;

export const Q_QUIZ_STATS = `
  SELECT COUNT(*) AS n,
         COALESCE(ROUND(AVG(score * 100.0 / NULLIF(max_score, 0))), 0) AS avg_pct,
         COALESCE(MAX(score * 100.0 / NULLIF(max_score, 0)), 0) AS best_pct
    FROM assessment_attempts WHERE learner_id=?1`;

// Days with any learning activity, in East Africa Time (UTC+3).
export const Q_ACTIVE_DAYS = `
  SELECT d FROM (
    SELECT date(completed_at, '+3 hours') AS d FROM lesson_progress WHERE learner_id=?1 AND completed_at IS NOT NULL
    UNION
    SELECT date(received_at, '+3 hours') AS d FROM assessment_attempts WHERE learner_id=?1
  ) ORDER BY d DESC LIMIT 60`;

export const Q_OUTCOMES = `
  SELECT ce.outcome_id, lo.description, ce.status, ce.score_pct, ce.created_at
    FROM competency_evidence ce JOIN learning_outcomes lo ON lo.id = ce.outcome_id
   WHERE ce.learner_id=?1
     AND ce.created_at = (SELECT MAX(x.created_at) FROM competency_evidence x
                           WHERE x.learner_id = ce.learner_id AND x.outcome_id = ce.outcome_id)
   GROUP BY ce.outcome_id
   ORDER BY lo.description`;

export function eatToday(): string {
  return new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
}

function shift(day: string, delta: number): string {
  return new Date(Date.parse(day + 'T00:00:00Z') + delta * 86400000).toISOString().slice(0, 10);
}

export function computeStreak(days: string[], today: string): number {
  const set = new Set(days);
  let cur: string | null = set.has(today) ? today : set.has(shift(today, -1)) ? shift(today, -1) : null;
  let n = 0;
  while (cur && set.has(cur)) {
    n++;
    cur = shift(cur, -1);
  }
  return n;
}

export async function buildSummary(db: D1Database, learnerId: string) {
  const [lessons, quizzes, days, outcomes] = await Promise.all([
    db.prepare(Q_LESSON_COUNT).bind(learnerId).first<{ n: number }>(),
    db.prepare(Q_QUIZ_STATS).bind(learnerId).first<{ n: number; avg_pct: number; best_pct: number }>(),
    db.prepare(Q_ACTIVE_DAYS).bind(learnerId).all<{ d: string }>(),
    db.prepare(Q_OUTCOMES).bind(learnerId).all<any>(),
  ]);
  const today = eatToday();
  const dayList = days.results.map((r) => r.d);
  const streak = computeStreak(dayList, today);
  const lessonsDone = lessons?.n ?? 0;
  const quizCount = quizzes?.n ?? 0;
  const best = quizzes?.best_pct ?? 0;

  const badges = [
    { id: 'first_lesson', title: 'First lesson', description: 'Complete your first lesson', earned: lessonsDone >= 1 },
    { id: 'five_lessons', title: 'Explorer', description: 'Complete 5 lessons', earned: lessonsDone >= 5 },
    { id: 'first_quiz', title: 'Quiz starter', description: 'Finish your first quiz', earned: quizCount >= 1 },
    { id: 'quiz_star', title: 'Quiz star', description: 'Score 80% or more on a quiz', earned: best >= 80 },
    { id: 'streak_3', title: '3-day streak', description: 'Learn 3 days in a row', earned: streak >= 3 },
    { id: 'streak_7', title: 'Week warrior', description: 'Learn 7 days in a row', earned: streak >= 7 },
  ];

  return {
    stats: { lessons_completed: lessonsDone, quizzes_taken: quizCount, average_score: Math.round(quizzes?.avg_pct ?? 0) },
    streak,
    today_done: dayList.includes(today),
    badges,
    outcomes: outcomes.results,
  };
}
