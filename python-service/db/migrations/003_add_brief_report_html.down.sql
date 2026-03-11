-- Revert HTML report column change.

ALTER TABLE briefs
    DROP COLUMN report_html;

ALTER TABLE briefs
    ALTER COLUMN metrics SET NOT NULL;

