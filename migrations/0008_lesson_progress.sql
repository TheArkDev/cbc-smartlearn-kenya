PRAGMA foreign_keys = ON;

-- One row per learner per lesson. completed_at stays set once a lesson is completed.
CREATE TABLE lesson_progress (
  learner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  first_opened_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_opened_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  PRIMARY KEY (learner_id, lesson_id)
);
CREATE INDEX idx_lp_learner ON lesson_progress(learner_id, completed_at);
