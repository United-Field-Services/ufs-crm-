# R19 HR retest candidate

Prepared from live v22, commit `6f5635d2301b2fd1db9bf74b7ad43bec66e0dcb7`.
Authentication, session handling, MFA, QA-account exceptions, and runtime configuration are unchanged.

## Changes

- Workflow templates have reversible Archive and Restore actions. Existing runs and tasks remain intact. Archived templates cannot start new runs. All mutations retain server-owned role and scope checks and an atomic audit record.
- Workflows loads only its operations section rather than waiting for unrelated assets, news, time entries, and document acknowledgements. Loading errors offer Retry; stale and denied reads cannot restore protected data.
- Identifier suffix inputs explicitly reject an invalid whole insertion rather than silently truncating it. Full identifier collection remains disabled.
- Dashboard My time off includes year selection, leave-type selection, balances, own request history and status filters, and a preselected request form. The four Time off page balance tiles filter to the signed-in employee's selected leave type and year.
- Historical headcount bars open a searchable employee panel with clickable current profiles. Only imported, dated status evidence supports historical membership. Missing, conflicting, and undated evidence is excluded; current employees and hire dates are not substituted. Supported counts are reconciled to the source bar, with partial/mismatch warnings and an explicit warning that equal counts alone do not establish exact membership.
- Current chart bars keep the existing People-page drill-down and now synchronize location, division, and department dropdowns. Clearing the report filter resets those controls.
- Historical x-axis labels use two horizontal lines with additional chart margins. Sidebar keyboard focus and current-page styling are visually distinct.
- Profile dirty state compares current control values to their initial values, so undoing an edit removes the discard warning. Clean editor openings and untouched existing records are covered by regression tests.
- Allowance forms show compact year guidance and explicit field-level errors for negative values and unsupported fractions such as 0.1. Zero and 0.125-day increments remain valid, and year changes retain the previously verified reload behavior.

## Preserved behavior

Company news “Mark as read” remains available to HR because it records that person's own acknowledgement. Its explanation now makes this explicit. HR company-file read counts and the absence of an HR “Mark read” action are preserved. Active employment labels, saved 2027 allowances, balance-year refresh, current location drill-down, and the dashboard Company files link remain covered.

## Verification boundaries

Validation uses synthetic API and DOM tests, TypeScript, a production build, asset audit, and independent code review. No live leave approvals, HR data writes, employee communications, authentication-factor changes, or database migrations were performed. Hosted browser layout and real-account access still require a targeted retest after a separately authorized publication. The double-highlight report was not reproduced as two active navigation states; tests enforce one current page and the styling separates focus from selection. Clean-open profile prompts were also not reproduced; the reproducible sticky warning after reverting edits was repaired.

This is a saved-version candidate only. Publication requires separate approval.
