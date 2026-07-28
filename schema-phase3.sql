-- Phase 3 — Multi-role RBAC, departments, and fleet tracking.
-- Run AFTER the Phase 1+2 schema (schema.sql) is in place.

-- ============================================================
-- 1. Extend users table with role and display name
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'role'
  ) THEN
    ALTER TABLE users ADD COLUMN role VARCHAR(30) NOT NULL DEFAULT 'supervisor';
    ALTER TABLE users ADD COLUMN full_name VARCHAR(255) NOT NULL DEFAULT '';
    ALTER TABLE users ADD COLUMN email VARCHAR(255);
    ALTER TABLE users ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE;
  END IF;
END $$;

-- ============================================================
-- 2. Departments
-- ============================================================
CREATE TABLE IF NOT EXISTS departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO departments (slug, name) VALUES
  ('site-security',      'Site Security Guards'),
  ('events-security',    'Events Security'),
  ('festival-security',  'Festival Security'),
  ('mobile-patrols',     'Mobile Patrols'),
  ('cctv-towers',        'CCTV Towers'),
  ('transport',          'Transport')
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- 3. Junction: which departments a user (manager/supervisor) can access
-- ============================================================
CREATE TABLE IF NOT EXISTS user_departments (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, department_id)
);

-- ============================================================
-- 4. Junction: which departments a staff member works in
-- ============================================================
CREATE TABLE IF NOT EXISTS staff_departments (
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (employee_id, department_id)
);

-- ============================================================
-- 5. Vehicles
-- ============================================================
CREATE TABLE IF NOT EXISTS vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registration VARCHAR(20) UNIQUE NOT NULL,
  make VARCHAR(100),
  model VARCHAR(100),
  vehicle_type VARCHAR(50) NOT NULL,  -- bus, van, car
  year INT,
  colour VARCHAR(50),
  vin VARCHAR(50),
  status VARCHAR(20) NOT NULL DEFAULT 'active',  -- active, off_road, disposed
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 6. Vehicle compliance documents (MOT, insurance, road tax, servicing)
-- ============================================================
CREATE TABLE IF NOT EXISTS vehicle_compliance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  document_type VARCHAR(50) NOT NULL,  -- MOT, INSURANCE, ROAD_TAX, SERVICE
  reference_number VARCHAR(100),
  issued_date DATE,
  expiry_date DATE,
  provider VARCHAR(255),
  cost DECIMAL(10,2),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 7. Driver compliance (licence, CPC, tachograph, medical)
-- ============================================================
CREATE TABLE IF NOT EXISTS driver_compliance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  document_type VARCHAR(50) NOT NULL,  -- DRIVING_LICENCE, CPC, TACHOGRAPH, MEDICAL_CERT
  licence_number VARCHAR(100),
  licence_categories VARCHAR(100),     -- e.g. "B,C1,D1"
  issued_date DATE,
  expiry_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 8. Vehicle-to-driver assignments
-- ============================================================
CREATE TABLE IF NOT EXISTS vehicle_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  assigned_date DATE NOT NULL DEFAULT CURRENT_DATE,
  unassigned_date DATE,
  is_primary_driver BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 9. Link audit_events to the users table now that roles exist
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'audit_events' AND column_name = 'actor_id'
  ) THEN
    ALTER TABLE audit_events ADD COLUMN actor_id UUID REFERENCES users(id);
  END IF;
END $$;
