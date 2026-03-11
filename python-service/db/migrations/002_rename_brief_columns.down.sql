-- Revert Brief column names back to snake_case and drop generated column

ALTER TABLE briefs
    RENAME COLUMN "companyName" TO company_name;

ALTER TABLE briefs
    RENAME COLUMN "analystName" TO analyst_name;

ALTER TABLE briefs
    RENAME COLUMN "keyPoints" TO key_points;

ALTER TABLE briefs
    DROP COLUMN generated;

