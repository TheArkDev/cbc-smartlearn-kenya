PRAGMA foreign_keys = ON;

CREATE TABLE schools (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  county TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  phone TEXT UNIQUE,
  username TEXT UNIQUE,                 -- used by child accounts (no email needed)
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  account_status TEXT NOT NULL DEFAULT 'active'
    CHECK (account_status IN ('pending','active','suspended','closed')),
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE roles (id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL);
INSERT INTO roles (id, name) VALUES
 ('learner','learner'),('teacher','teacher'),('parent','parent'),
 ('school_admin','school_admin'),('content_author','content_author'),
 ('content_reviewer','content_reviewer'),('curriculum_admin','curriculum_admin'),
 ('super_admin','super_admin');

CREATE TABLE user_roles (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES roles(id),
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE learner_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  grade_id TEXT NOT NULL REFERENCES grades(id),
  school_id TEXT REFERENCES schools(id),     -- NULL = independent learner
  language TEXT NOT NULL DEFAULT 'en'
);

CREATE TABLE teacher_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  school_id TEXT REFERENCES schools(id),
  verification_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('pending','verified','rejected'))
);

CREATE TABLE learner_guardians (
  learner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  guardian_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  relationship TEXT,
  status TEXT NOT NULL DEFAULT 'verified',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (learner_id, guardian_id)
);

CREATE TABLE guardian_consents (
  id TEXT PRIMARY KEY,
  guardian_id TEXT NOT NULL REFERENCES users(id),
  learner_id TEXT NOT NULL REFERENCES users(id),
  consent_type TEXT NOT NULL,
  notice_version TEXT NOT NULL,
  granted_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_hash TEXT NOT NULL UNIQUE,
  device_label TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_guardians_guardian ON learner_guardians(guardian_id);
CREATE INDEX idx_user_roles_user ON user_roles(user_id);
