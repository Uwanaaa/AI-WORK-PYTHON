-- Rename Brief columns from snake_case to camelCase to match the model

ALTER TABLE briefs
    RENAME COLUMN company_name TO "companyName";

ALTER TABLE briefs
    RENAME COLUMN analyst_name TO "analystName";

ALTER TABLE briefs
    RENAME COLUMN key_points TO "keyPoints";

ALTER TABLE briefs
    ADD COLUMN generated BOOLEAN NOT NULL DEFAULT FALSE;

