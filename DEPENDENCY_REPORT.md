# 📦 Dependency Report

### Vulnerability Summary
- `npm audit`: **0 vulnerabilities** (verified as of this handoff pass).
- Previously flagged: `dompurify` (moderate), `nanoid`/`postcss`/`undici` (high, all transitive dev-only deps of `vite`/`vitest`/`jsdom`) — resolved via `npm audit fix` (patch-level bumps only, no API changes). Tests and production build were re-run and pass after the update.

### Action Log
- Ran `npm audit fix` — bumped `dompurify` 3.4.11 → 3.4.14 and transitive dev dependencies `nanoid`, `postcss`, `undici` to patched versions. No `package.json` semver ranges changed (all bumps satisfied existing `^` ranges); only `package-lock.json` moved.
- Skipped low-severity minor/patch updates (`marked`, `mammoth`, `vite`, `vitest`) — not required for security and outside the scope of this pass; see Pending Debt below.

### Pending Architectural Debt (Requires Manual Review)
- `pdfjs-dist`: current `4.10.38`, latest `6.x`. Two major versions behind. High risk of breaking changes (PDF.js has changed its worker/API surface across majors) — needs a dedicated upgrade + manual QA of the knowledge-file PDF import path, not a drive-by bump.
- `@testing-library/jest-dom`: current `6.9.1`, latest `7.x`. One major version behind — low risk, but still needs a test-suite re-run against the new major before adopting.
- Minor/patch-only updates available and considered low priority: `marked`, `mammoth`, `vite`, `vitest`/`@vitest/coverage-v8`. None are security-relevant; safe to pick up opportunistically in routine maintenance.
