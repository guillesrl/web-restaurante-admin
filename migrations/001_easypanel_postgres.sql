-- Initial schema for the isolated restaurant dashboard database.
-- Apply this to the dedicated dashboard_restaurante database, never to the
-- shared postgres database used by other Easypanel services.

BEGIN;

CREATE TABLE IF NOT EXISTS menu (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(255) NOT NULL,
  ingredientes TEXT,
  precio NUMERIC(10, 2) NOT NULL,
  categoria VARCHAR(100) NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0,
  vegetariano VARCHAR(10) NOT NULL DEFAULT 'no',
  gluten VARCHAR(10) NOT NULL DEFAULT 'no',
  marisco VARCHAR(10) NOT NULL DEFAULT 'no',
  lactosa VARCHAR(10) NOT NULL DEFAULT 'no',
  vegano VARCHAR(10) NOT NULL DEFAULT 'no',
  tenant_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(255) NOT NULL,
  telefono VARCHAR(50),
  direccion VARCHAR(255) NOT NULL DEFAULT 'Dirección no especificada',
  items JSONB NOT NULL,
  total NUMERIC(10, 2) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  time VARCHAR(10),
  source VARCHAR(50),
  fulfillment_type VARCHAR(20),
  scheduled_for TIMESTAMPTZ,
  observations TEXT,
  stock_reserved_at TIMESTAMPTZ,
  stock_restored_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancelled_by VARCHAR(50),
  delivery_notification_due_at TIMESTAMPTZ,
  delivery_notification_claimed_at TIMESTAMPTZ,
  delivery_notification_sent_at TIMESTAMPTZ,
  out_for_delivery_notification_due_at TIMESTAMPTZ,
  out_for_delivery_notification_claimed_at TIMESTAMPTZ,
  out_for_delivery_notification_sent_at TIMESTAMPTZ,
  inbox_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reservations (
  id SERIAL PRIMARY KEY,
  customer_name VARCHAR(255) NOT NULL,
  phone VARCHAR(50),
  date DATE NOT NULL,
  time TIME NOT NULL,
  people INTEGER NOT NULL,
  table_number INTEGER,
  status VARCHAR(50) NOT NULL DEFAULT 'confirmed',
  google_event_id VARCHAR(255),
  observations TEXT,
  inbox_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dashboard_users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('owner', 'kitchen', 'driver')),
  password_hash TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS dashboard_users_email_lower_idx
  ON dashboard_users (LOWER(email));

CREATE TABLE IF NOT EXISTS audit_events (
  id BIGSERIAL PRIMARY KEY,
  actor_user_id INTEGER REFERENCES dashboard_users(id) ON DELETE SET NULL,
  actor_role VARCHAR(20),
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id VARCHAR(100) NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_events_entity_idx
  ON audit_events (entity_type, entity_id, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_order_cancellation_confirmations (
  token UUID PRIMARY KEY,
  order_id INTEGER NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS backup_runs (
  id BIGSERIAL PRIMARY KEY,
  source VARCHAR(20) NOT NULL CHECK (source IN ('automatic', 'manual')),
  status VARCHAR(20) NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  object_key TEXT,
  checksum_sha256 VARCHAR(64),
  size_bytes BIGINT,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS backup_runs_started_idx
  ON backup_runs (started_at DESC);

COMMIT;
