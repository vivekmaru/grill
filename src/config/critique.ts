// Tunable constants for critique calibration. Spec §10.1.
// Centralized so a future "deep mode" toggle is a single-file change.

export const MAX_FLAGS_PER_PASS = 8
export const MAX_FOLLOWUPS_PER_ROLE = 2
export const DEFAULT_SEVERITY_FLOOR = 2 as 1 | 2 | 3
export const MAX_REWRITE_RETRIES = 1
export const MAX_REWRITE_CANDIDATES = 2
export const JD_OVERLAY_MAX_STANDARDS = 3
