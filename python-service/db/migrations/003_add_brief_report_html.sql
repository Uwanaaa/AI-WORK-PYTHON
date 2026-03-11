-- Add column to store generated HTML reports and allow nullable metrics.

ALTER TABLE briefs
    ADD COLUMN report_html TEXT;

ALTER TABLE briefs
    ALTER COLUMN metrics DROP NOT NULL;

