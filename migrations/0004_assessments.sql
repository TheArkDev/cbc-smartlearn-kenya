PRAGMA foreign_keys = ON;

CREATE TABLE assessments (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  sub_strand_id TEXT NOT NULL REFERENCES sub_strands(id),
  created_by TEXT REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','retired')),
  approved INTEGER NOT NULL DEFAULT 0,          -- learners only see published AND approved
  approved_by TEXT REFERENCES users(id),
  approved_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  time_limit_minutes INTEGER,
  max_attempts INTEGER NOT NULL DEFAULT 0,      -- 0 = unlimited
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE assessment_outcomes (
  assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  outcome_id TEXT NOT NULL REFERENCES learning_outcomes(id) ON DELETE CASCADE,
  PRIMARY KEY (assessment_id, outcome_id)
);

-- options_json holds only [{id,label}] and NEVER marks which option is correct.
CREATE TABLE assessment_questions (
  id TEXT PRIMARY KEY,
  assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  question_type TEXT NOT NULL CHECK (question_type IN ('mcq','true_false','short_answer')),
  prompt TEXT NOT NULL,
  points INTEGER NOT NULL DEFAULT 1,
  options_json TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- Answer keys live apart from questions and are only read inside the marking code.
CREATE TABLE answer_keys (
  question_id TEXT PRIMARY KEY REFERENCES assessment_questions(id) ON DELETE CASCADE,
  correct_option_id TEXT,
  accepted_json TEXT,
  explanation TEXT
);

-- id is generated on the device, so a retried upload can never create a duplicate.
CREATE TABLE assessment_attempts (
  id TEXT PRIMARY KEY,
  assessment_id TEXT NOT NULL REFERENCES assessments(id),
  assessment_version INTEGER NOT NULL,
  learner_id TEXT NOT NULL REFERENCES users(id),
  client_submitted_at TEXT,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  score INTEGER NOT NULL,
  max_score INTEGER NOT NULL,
  answers_json TEXT NOT NULL,                   -- original answers, never overwritten
  results_json TEXT NOT NULL
);

-- Internal labels, not official KICD classifications.
CREATE TABLE competency_evidence (
  id TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL REFERENCES users(id),
  outcome_id TEXT NOT NULL REFERENCES learning_outcomes(id),
  attempt_id TEXT REFERENCES assessment_attempts(id),
  score_pct INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('evidence_collected','developing','demonstrated','requires_additional_support')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_asm_substrand ON assessments(sub_strand_id, status, approved);
CREATE INDEX idx_q_asm ON assessment_questions(assessment_id, sort_order);
CREATE INDEX idx_att_learner ON assessment_attempts(learner_id, assessment_id);
CREATE INDEX idx_ev_learner ON competency_evidence(learner_id, outcome_id, created_at);
