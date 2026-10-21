// Directory membership is an employment fact, separate from login activation.
// Callers join employee_profiles p in employee e's scope and source links s only
// for live employees. Former source records stay excluded after a local edit.
export const directoryActiveSql="CASE WHEN LOWER(TRIM(p.employment_status)) IN ('terminated','inactive','archived') THEN 0 WHEN s.source_id IS NOT NULL THEN CASE WHEN LOWER(TRIM(s.source_status)) IN ('terminated','inactive','archived') THEN 0 ELSE 1 END WHEN LOWER(TRIM(p.employment_status)) IN ('active','probation','on leave','notice period') THEN 1 ELSE e.active END";
