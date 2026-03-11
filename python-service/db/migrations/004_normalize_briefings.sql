-- Normalize briefing storage into separate tables.
-- WARNING: This will drop existing briefing data.

-- Drop any previous versions of these tables to make the migration idempotent
-- if it is accidentally run more than once.
DROP TABLE IF EXISTS briefing_metrics CASCADE;
DROP TABLE IF EXISTS briefing_points CASCADE;
DROP TABLE IF EXISTS briefings CASCADE;
DROP TABLE IF EXISTS briefs CASCADE;

CREATE TABLE briefings (
  id SERIAL PRIMARY KEY,
  ticker VARCHAR(10) NOT NULL,
  "companyName" VARCHAR(255) NOT NULL,
  "analystName" VARCHAR(255) NOT NULL,
  sector VARCHAR(255) NOT NULL,
  summary TEXT NOT NULL,
  recommendation VARCHAR(255) NOT NULL,
  generated BOOLEAN NOT NULL DEFAULT FALSE,
  report_html TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE briefing_points (
  id SERIAL PRIMARY KEY,
  briefing_id INTEGER NOT NULL REFERENCES briefings(id) ON DELETE CASCADE,
  kind VARCHAR(16) NOT NULL,
  text TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_briefing_points_briefing_id_kind
  ON briefing_points (briefing_id, kind, position);

CREATE TABLE briefing_metrics (
  id SERIAL PRIMARY KEY,
  briefing_id INTEGER NOT NULL REFERENCES briefings(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  value VARCHAR(255) NOT NULL
);

CREATE UNIQUE INDEX uq_briefing_metrics_briefing_id_name
  ON briefing_metrics (briefing_id, name);

