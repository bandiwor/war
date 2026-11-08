# ADR-0004: Testing strategy and quality gates

- Status: Accepted
- Date: 2026-11-08

## Decision

| Layer               | Tooling                                                          | Gate                                                      |
| ------------------- | ---------------------------------------------------------------- | --------------------------------------------------------- |
| Pure logic          | Vitest + fast-check (property-based)                             | Coverage: domain/application ≥ 99% lines, 100% functions  |
| Determinism         | Golden state hashes + golden replay file                         | Exact hash match (`tests/golden`)                         |
| Architecture        | ESLint layer/determinism rules                                   | Rules themselves unit-tested (`tests/lint-rules.test.ts`) |
| Browser integration | Playwright e2e (dev server)                                      | Boot, ticking, debug menu                                 |
| Shaders (stage 1+)  | Playwright `toHaveScreenshot`, fixed seed                        | ≤ 1% pixel diff                                           |
| Performance         | `npm run perf` (budgets in `perf-budgets.json`), `npm run bench` | Ticks/s floor, minor-GC ceiling                           |
| Production bundle   | `scripts/check-bundle.mjs`                                       | Debug tooling absent from `dist/`                         |

Branch coverage thresholds (85%) are lower than line thresholds: under `noUncheckedIndexedAccess`
every typed-array read carries a `?? 0` fallback that can never run, and V8 coverage counts each one
as a branch. We prefer those explicit fallbacks to `!` assertions, which are banned.

Golden files change only through `npm run golden:update`, and the diff is reviewed like code.

`npm run ci` runs every gate locally; `.github/workflows/ci.yml` runs the same plus e2e. A
pre-commit hook (`.githooks/pre-commit`, set up by `npm install`) runs typecheck, lint, format and
unit tests.
