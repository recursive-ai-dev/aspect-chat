# 📦 Dependency Report

### Vulnerability Summary
- `npm audit`: **0 vulnerabilities** (re-verified during the local-models production pass).
- Previously flagged: `dompurify` (moderate), `nanoid`/`postcss`/`undici` (high, all transitive dev-only deps of `vite`/`vitest`/`jsdom`) — resolved via `npm audit fix` (patch-level bumps only, no API changes). Tests and production build were re-run and pass after the update.

### Action Log (audit remediation pass — findings F001–F011)
- **`pdfjs-dist` `^4.10.38` → `^6.3.289`** (finding F008). The knowledge-file PDF import path in `src/js/modules/db.js` uses only stable core API — `getDocument({ data })`, `.promise`, `.numPages`, `.getPage`, `page.getTextContent()`, `item.str`, and `GlobalWorkerOptions.workerSrc` pointed at `pdfjs-dist/build/pdf.worker.mjs` — all unchanged across the 4→6 majors. `npm install`, the full test suite (369 tests) and `npm run build` all pass; the `pdfjs` and `pdf.worker` chunks build and lazy-load as before. **Still owed:** a manual QA pass importing a real PDF and a real `.docx` in a browser, since the automated suite does not exercise the actual parser.
- `@testing-library/jest-dom` (`^6.9.1`, latest `7.x`) left as-is — dev-only, not security-relevant, out of scope for this pass.

### Action Log (local-models production pass)
- Added `@fontsource/patrick-hand` and `@fontsource/balsamiq-sans`. These bundle the two display fonts locally so the app renders correctly with no network — it previously pulled them from Google Fonts, which meant an offline "fully local" app fell back to a serif system font. They add ~230 KB of woff/woff2 to the build, only the subsets actually referenced are emitted, and neither ships executable code.
- Ran `npm audit fix` to clear a moderate advisory in `@xmldom/xmldom` (a transitive dependency of `mammoth`, used for `.docx` knowledge-file import). Patch-level bump only; the full suite and the production build pass afterwards.

### Action Log (earlier handoff pass)
- Ran `npm audit fix` — bumped `dompurify` 3.4.11 → 3.4.14 and transitive dev dependencies `nanoid`, `postcss`, `undici` to patched versions. No `package.json` semver ranges changed (all bumps satisfied existing `^` ranges); only `package-lock.json` moved.
- Skipped low-severity minor/patch updates (`marked`, `mammoth`, `vite`, `vitest`) — not required for security and outside the scope of this pass; see Pending Debt below.

### Pending Architectural Debt (Requires Manual Review)
- ~~`pdfjs-dist`: current `4.10.38`, latest `6.x`.~~ **Done** in the audit remediation pass — bumped to `^6.3.289`; see the Action Log above. A manual browser QA pass of PDF/`.docx` import is still owed.
- `@testing-library/jest-dom`: current `6.9.1`, latest `7.x`. One major version behind — low risk, but still needs a test-suite re-run against the new major before adopting.
- Minor/patch-only updates available and considered low priority: `marked`, `mammoth`, `vite`, `vitest`/`@vitest/coverage-v8`. None are security-relevant; safe to pick up opportunistically in routine maintenance.
