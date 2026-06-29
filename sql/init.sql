-- ─────────────────────────────────────────────────────────────
--  init.sql
--  Run once against your PostgreSQL instance
--  psql -U postgres -d order_booking -f sql/init.sql
-- ─────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- for gen_random_uuid()

-- ─── Enum Types ──────────────────────────────────────────────

CREATE TYPE order_status AS ENUM (
  'pending',
  'confirmed',
  'processing',
  'shipped',
  'delivered',
  'cancelled',
  'refunded'
);

CREATE TYPE payment_status AS ENUM (
  'pending',
  'processing',
  'completed',
  'failed',
  'refunded'
);

CREATE TYPE notification_channel AS ENUM (
  'email',
  'sms',
  'push'
);

CREATE TYPE notification_status AS ENUM (
  'pending',
  'sent',
  'failed'
);

CREATE TYPE event_status AS ENUM (
  'pending',
  'published',
  'failed'
);

-- ─── Users ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(255)  NOT NULL UNIQUE,
  phone         VARCHAR(20),
  full_name     VARCHAR(255)  NOT NULL,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─── Products ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS products (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(255)  NOT NULL,
  description   TEXT,
  price         NUMERIC(12,2) NOT NULL,
  sku           VARCHAR(100)  NOT NULL UNIQUE,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─── Inventory ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS inventory (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      UUID          NOT NULL REFERENCES products(id),
  quantity        INTEGER       NOT NULL DEFAULT 0,
  reserved        INTEGER       NOT NULL DEFAULT 0,
  available       INTEGER       GENERATED ALWAYS AS (quantity - reserved) STORED,
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─── Orders ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS orders (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID          NOT NULL REFERENCES users(id),
  status            order_status  NOT NULL DEFAULT 'pending',
  total_amount      NUMERIC(12,2) NOT NULL,
  idempotency_key   VARCHAR(255)  NOT NULL UNIQUE,
  metadata          JSONB,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─── Order Items ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS order_items (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID          NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id    UUID          NOT NULL REFERENCES products(id),
  quantity      INTEGER       NOT NULL,
  unit_price    NUMERIC(12,2) NOT NULL,
  total_price   NUMERIC(12,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─── Payments ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS payments (
  id                UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          UUID            NOT NULL REFERENCES orders(id),
  user_id           UUID            NOT NULL REFERENCES users(id),
  amount            NUMERIC(12,2)   NOT NULL,
  status            payment_status  NOT NULL DEFAULT 'pending',
  idempotency_key   VARCHAR(255)    NOT NULL UNIQUE,
  provider          VARCHAR(100),
  provider_ref      VARCHAR(255),
  failure_reason    TEXT,
  created_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- ─── Notifications ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notifications (
  id            UUID                  PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID                  NOT NULL REFERENCES users(id),
  order_id      UUID                  REFERENCES orders(id),
  channel       notification_channel  NOT NULL,
  status        notification_status   NOT NULL DEFAULT 'pending',
  subject       VARCHAR(255),
  body          TEXT                  NOT NULL,
  sent_at       TIMESTAMPTZ,
  failure_reason TEXT,
  created_at    TIMESTAMPTZ           NOT NULL DEFAULT NOW()
);

-- ─── Outbox Events (Transactional Outbox Pattern) ────────────
--  Produced by the order service in the same DB transaction
--  as the order insert. A relay process publishes to Kafka.

CREATE TABLE IF NOT EXISTS outbox_events (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_id  UUID          NOT NULL,
  aggregate_type VARCHAR(100) NOT NULL,
  event_type    VARCHAR(100)  NOT NULL,
  topic         VARCHAR(255)  NOT NULL,
  payload       JSONB         NOT NULL,
  status        event_status  NOT NULL DEFAULT 'pending',
  attempts      INTEGER       NOT NULL DEFAULT 0,
  last_error    TEXT,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  published_at  TIMESTAMPTZ
);

-- ─── Dead Letter Queue Log ───────────────────────────────────
--  Mirror of events that landed in a Kafka DLQ topic.

CREATE TABLE IF NOT EXISTS dlq_events (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  original_topic  VARCHAR(255)  NOT NULL,
  dlq_topic       VARCHAR(255)  NOT NULL,
  partition       INTEGER,
  "offset"        BIGINT,
  key             TEXT,
  payload         JSONB         NOT NULL,
  error           TEXT,
  consumer_group  VARCHAR(255),
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
