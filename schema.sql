-- Phase 1 Foundation schema.
-- Deliberately excludes users / tasks / notifications tables — those
-- belong to the phases that actually use them (2, 4, 6). Encryption of
-- employee_private columns is deferred to Phase 8 (see migration decision).

-- Phase 2 — Authentication. Completely independent of the employee
-- tables above: login has nothing to do with staff records.
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id VARCHAR(255) UNIQUE NOT NULL, -- the "id" field from staff_data.json
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  phone VARCHAR(50),
  phone_landline VARCHAR(50),
  date_of_birth DATE,
  place_of_birth VARCHAR(255),
  nationality VARCHAR(100),
  gender VARCHAR(50),
  driving_licence VARCHAR(50),
  status VARCHAR(20) DEFAULT 'active',        -- active, archived
  deploy_status VARCHAR(20) DEFAULT 'inactive',
  contract VARCHAR(50),
  induction BOOLEAN DEFAULT FALSE,
  added_date DATE,
  legacy_folder_path TEXT,                     -- e.g. "Active Staff/🟢 John Smith" — traces back to the source
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE employee_private (
  employee_id UUID PRIMARY KEY REFERENCES employees(id),
  ni_number VARCHAR(20),
  bank_account_number VARCHAR(20),
  bank_sort_code VARCHAR(10),
  bank_holder_name VARCHAR(255),
  bank_name VARCHAR(100),
  criminal_offences VARCHAR(10) DEFAULT 'No',
  criminal_offence_details TEXT,
  bankrupt VARCHAR(10) DEFAULT 'No',
  ccj VARCHAR(10) DEFAULT 'No',
  credit_check_consent VARCHAR(10) DEFAULT 'No'
);

CREATE TABLE employee_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID REFERENCES employees(id),
  address_line TEXT,
  moved_in DATE,
  moved_out DATE,
  is_current BOOLEAN DEFAULT TRUE,
  address_order INT DEFAULT 1
);

CREATE TABLE compliance_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID REFERENCES employees(id),
  document_type VARCHAR(50) NOT NULL,    -- SIA_LICENCE, CSCS_CARD, RIGHT_TO_WORK
  document_number VARCHAR(100),
  document_subtype VARCHAR(100),         -- visa type / CSCS qualification
  expiry_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE staff_references (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID REFERENCES employees(id),
  ref_number INT DEFAULT 1,               -- 1 or 2
  name VARCHAR(255),
  company VARCHAR(255),
  email VARCHAR(255),
  status VARCHAR(50) DEFAULT 'Not Started',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE employment_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID REFERENCES employees(id),
  employer_name VARCHAR(255),
  position VARCHAR(255),
  start_date DATE,
  end_date DATE,
  reason_for_leaving TEXT,
  order_index INT DEFAULT 0
);

-- No users table yet (Phase 2), so we just record the actor's email/name
-- as plain text for now rather than linking to an account.
CREATE TABLE audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_email VARCHAR(255),
  action VARCHAR(100) NOT NULL,           -- e.g. STAFF_CREATED, STAFF_UPDATED
  object_type VARCHAR(50),
  object_id UUID,
  object_name VARCHAR(255),
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- One row per migration script run — a receipt of the import itself.
CREATE TABLE migration_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source VARCHAR(100),
  batch_name VARCHAR(255),
  total_records INT,
  successful INT,
  failed INT,
  errors JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
