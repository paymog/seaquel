# Napkin

## Corrections
| Date | Source | What Went Wrong | What To Do Instead |
|------|--------|----------------|-------------------|
| 2026-07-13 | user | Repaired the SeaQuel image from a temporary clone instead of the user's existing checkout | Make source changes in `/Users/paymahn/code/seaquel` (`../../seaquel` from infra2); use temporary clones only when no local checkout exists. |
| 2026-07-13 | self | Left the local SeaQuel smoke container running, so test-image cleanup failed | Track each detached smoke container and stop it immediately after the final assertion. |

## User Preferences
- Keep feature work on meaningful branches.

## Patterns That Work
- Smoke-test published container images on every advertised architecture before consuming them.

## Patterns That Don't Work
- Compiling Linux binaries on a newer host glibc and packaging them in an older runtime image.

## Domain Notes
- The self-hosted SeaQuel server listens on port 3000 and uses `SEAQUEL_ADMIN_PASSWORD` for its shared admin login.
