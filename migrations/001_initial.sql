-- migrations/001_initial.sql — EduVerse 3D core domain schema (PostgreSQL 14+)
-- Migration target. The runtime still uses the local JSON store by default;
-- see docs/POSTGRES.md for the migration guide and honest status.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------- Organizations ----------
CREATE TABLE institutions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 120),
  slug          TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{2,60}$'),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  branding      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE campuses (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  name           TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 120),
  city           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_campuses_institution ON campuses(institution_id);

CREATE TABLE departments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  campus_id      UUID REFERENCES campuses(id) ON DELETE SET NULL,
  name           TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 120),
  code           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (institution_id, name)
);
CREATE INDEX idx_departments_institution ON departments(institution_id);

CREATE TABLE academic_years (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  name           TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 60),
  starts_on      DATE NOT NULL,
  ends_on        DATE NOT NULL CHECK (ends_on > starts_on),
  is_current     BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (institution_id, name)
);
CREATE INDEX idx_academic_years_institution ON academic_years(institution_id);

CREATE TABLE semesters (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  academic_year_id UUID NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  name             TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 60),
  starts_on        DATE NOT NULL,
  ends_on          DATE NOT NULL CHECK (ends_on > starts_on),
  is_current       BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (academic_year_id, name)
);
CREATE INDEX idx_semesters_year ON semesters(academic_year_id);

-- ---------- Users ----------
CREATE TABLE users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID REFERENCES institutions(id) ON DELETE SET NULL,
  department_id  UUID REFERENCES departments(id) ON DELETE SET NULL,
  name           TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  username       TEXT NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9][a-z0-9._-]{2,29}$'),
  email          TEXT UNIQUE CHECK (email ~ '^\S+@\S+\.\S+$'),
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('super_admin','institution_admin','teacher','student')),
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','pending','suspended')),
  mfa_secret     TEXT,
  mfa_enabled    BOOLEAN NOT NULL DEFAULT false,
  email_verified BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_users_institution ON users(institution_id);
CREATE INDEX idx_users_role ON users(role);

-- ---------- Courses ----------
CREATE TABLE courses (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID REFERENCES institutions(id) ON DELETE SET NULL,
  owner_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  title          TEXT NOT NULL CHECK (char_length(title) BETWEEN 3 AND 200),
  description    TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  price_cents    INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  currency       CHAR(3) NOT NULL DEFAULT 'INR',
  prerequisites  JSONB NOT NULL DEFAULT '[]'::jsonb,
  objectives     JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_courses_institution ON courses(institution_id);
CREATE INDEX idx_courses_owner ON courses(owner_id);
CREATE INDEX idx_courses_status ON courses(status);

CREATE TABLE lessons (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id   UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title       TEXT NOT NULL CHECK (char_length(title) BETWEEN 2 AND 200),
  kind        TEXT NOT NULL DEFAULT 'reading'
              CHECK (kind IN ('video','reading','interactive','pdf','coding','quiz','assignment')),
  content     TEXT NOT NULL DEFAULT '',
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_lessons_course ON lessons(course_id);

CREATE TABLE enrollments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id   UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  via         TEXT NOT NULL DEFAULT 'direct',
  UNIQUE (student_id, course_id)
);
CREATE INDEX idx_enrollments_student ON enrollments(student_id);
CREATE INDEX idx_enrollments_course ON enrollments(course_id);

-- ---------- Quizzes & attempts ----------
CREATE TABLE quizzes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id      UUID REFERENCES courses(id) ON DELETE SET NULL,
  owner_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  institution_id UUID REFERENCES institutions(id) ON DELETE SET NULL,
  title          TEXT NOT NULL CHECK (char_length(title) BETWEEN 3 AND 200),
  status         TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  config         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_quizzes_course ON quizzes(course_id);
CREATE INDEX idx_quizzes_institution ON quizzes(institution_id);

CREATE TABLE questions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id     UUID REFERENCES quizzes(id) ON DELETE CASCADE,
  bank_owner  UUID REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('mcq','multiselect','truefalse','fillblank','match','essay','code','short')),
  prompt      TEXT NOT NULL CHECK (char_length(prompt) BETWEEN 2 AND 2000),
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  points      INTEGER NOT NULL DEFAULT 1 CHECK (points BETWEEN 1 AND 100),
  difficulty  TEXT CHECK (difficulty IN ('easy','medium','hard')),
  topic       TEXT,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (quiz_id IS NOT NULL OR bank_owner IS NOT NULL)
);
CREATE INDEX idx_questions_quiz ON questions(quiz_id);
CREATE INDEX idx_questions_bank_owner ON questions(bank_owner);

CREATE TABLE quiz_attempts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id      UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  student_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'in-progress' CHECK (status IN ('in-progress','submitted','graded')),
  answers      JSONB NOT NULL DEFAULT '{}'::jsonb,
  auto_score   INTEGER,
  final_score  INTEGER,
  passed       BOOLEAN NOT NULL DEFAULT false,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at TIMESTAMPTZ
);
CREATE INDEX idx_attempts_quiz ON quiz_attempts(quiz_id);
CREATE INDEX idx_attempts_student ON quiz_attempts(student_id);

-- ---------- Fees & subscriptions ----------
CREATE TABLE fee_structures (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  name           TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 120),
  amount_cents   INTEGER NOT NULL CHECK (amount_cents > 0),
  currency       CHAR(3) NOT NULL DEFAULT 'INR',
  due_date       DATE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_fee_structures_institution ON fee_structures(institution_id);

CREATE TABLE fee_records (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id   UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  student_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fee_structure_id UUID REFERENCES fee_structures(id) ON DELETE SET NULL,
  amount_due_cents INTEGER NOT NULL CHECK (amount_due_cents >= 0),
  amount_paid_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_paid_cents >= 0),
  currency         CHAR(3) NOT NULL DEFAULT 'INR',
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','partial','paid','overdue')),
  due_date         DATE,
  payments         JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (amount_paid_cents <= amount_due_cents)
);
CREATE INDEX idx_fee_records_student ON fee_records(student_id);
CREATE INDEX idx_fee_records_institution ON fee_records(institution_id);

CREATE TABLE subscription_plans (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID REFERENCES institutions(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  price_cents    INTEGER NOT NULL CHECK (price_cents >= 0),
  currency       CHAR(3) NOT NULL DEFAULT 'INR',
  interval       TEXT NOT NULL CHECK (interval IN ('monthly','yearly','one-time')),
  active         BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE institution_subscriptions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  plan_id        UUID REFERENCES subscription_plans(id) ON DELETE SET NULL,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled','past_due')),
  starts_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_inst_subs_institution ON institution_subscriptions(institution_id);

-- ---------- Marketplace ----------
CREATE TABLE marketplace_listings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  course_id      UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  price_cents    INTEGER NOT NULL CHECK (price_cents >= 0),
  currency       CHAR(3) NOT NULL DEFAULT 'INR',
  status         TEXT NOT NULL DEFAULT 'listed' CHECK (status IN ('listed','unlisted')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (course_id)
);
CREATE INDEX idx_marketplace_institution ON marketplace_listings(institution_id);

-- ---------- Notifications & audit ----------
CREATE TABLE notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  link       TEXT NOT NULL DEFAULT '',
  read       BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_user ON notifications(user_id);

CREATE TABLE security_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID REFERENCES institutions(id) ON DELETE SET NULL,
  kind           TEXT NOT NULL,
  detail         TEXT NOT NULL DEFAULT '',
  actor_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  ip             TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_security_events_institution ON security_events(institution_id);
CREATE INDEX idx_security_events_kind ON security_events(kind);
