-- Phase 4 — Disciplinary Records & Incident Reports
-- Run AFTER schema.sql and schema-phase3.sql are in place.

-- ============================================================
-- 1. Disciplinary Records
--    Created by Director/Ops Manager against a staff member.
--    Staff can view their own (read-only) via the portal.
-- ============================================================
CREATE TABLE IF NOT EXISTS disciplinary_records (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  incident_date DATE NOT NULL,
  type          VARCHAR(50) NOT NULL,
  -- warning | final_warning | suspension | termination | fraud | misconduct | other
  description   TEXT NOT NULL,
  action_taken  TEXT,
  issued_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_disciplinary_employee ON disciplinary_records(employee_id);

-- ============================================================
-- 2. Incident Reports
--    Any staff member can submit. Name disclosure is optional.
--    Director/Ops Manager can view all and update status.
-- ============================================================
CREATE TABLE IF NOT EXISTS incident_reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id     UUID REFERENCES employees(id) ON DELETE SET NULL,
  -- NULL when is_anonymous = true
  is_anonymous    BOOLEAN NOT NULL DEFAULT FALSE,
  report_date     DATE NOT NULL DEFAULT CURRENT_DATE,
  site_location   VARCHAR(255),
  incident_type   VARCHAR(50) NOT NULL,
  -- harassment | discrimination | misconduct | safety | fraud | other
  against_person  VARCHAR(255),
  -- free text — name/role of person being reported
  description     TEXT NOT NULL,
  status          VARCHAR(30) NOT NULL DEFAULT 'open',
  -- open | under_review | resolved | closed
  resolution_notes TEXT,
  reviewed_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_incident_reporter ON incident_reports(reporter_id);
CREATE INDEX IF NOT EXISTS idx_incident_status   ON incident_reports(status);
