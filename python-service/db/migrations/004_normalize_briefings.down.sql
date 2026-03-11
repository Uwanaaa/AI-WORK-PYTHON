-- Revert normalized briefing tables back to the previous single-table design.

DROP TABLE IF EXISTS briefing_metrics;
DROP TABLE IF EXISTS briefing_points;
DROP TABLE IF EXISTS briefings;

CREATE TABLE briefs (
  id SERIAL PRIMARY KEY,
  ticker VARCHAR(10) NOT NULL,
  "companyName" VARCHAR(255) NOT NULL,
  "analystName" VARCHAR(255) NOT NULL,
  sector VARCHAR(255) NOT NULL,
  summary TEXT NOT NULL,
  recommendation VARCHAR(255) NOT NULL,
  "keyPoints" JSONB NOT NULL,
  risks JSONB NOT NULL,
  metrics JSONB NULL,
  generated BOOLEAN NOT NULL DEFAULT FALSE,
  report_html TEXT NULL
);

