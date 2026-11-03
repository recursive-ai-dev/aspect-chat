# Android engineering sprint

Baseline: `ce22e99`, 2026-11-03. Scope: Android Capacitor shell and the shared JavaScript paths it executes. Priorities consider severity, likelihood, affected users and dependencies. Status flow: PENDING → IN_PROGRESS → VERIFIED; BLOCKED requires an external dependency. Verification results are recorded per item below.

## Reconnaissance

- Entry: `MainActivity → BridgeActivity → dist/index.html → main.js → init()`. The native activity owns the WebView; vanilla ES modules own presentation, provider transport, tool execution and IndexedDB state. Capacitor 8, API 24–36, JDK 21, Gradle 8.14.3; Vite builds assets, Vitest/jsdom/MSW exercise shared code.
- Data: `state.aspects → persistAspects → scheduleSave → saveAspects → withStore`; active conversation messages share the `chatHistory` array. Knowledge, vectors and memory use the same database. Visibility/page teardown flush debounced saves.
- Chat: composer → user tools → request/stream → tool loop → persistence. Provider discovery is independent of chat startup. Tool code uses an opaque-origin iframe and an origin approval broker.
- Imports/exports: library JSON and `.aspect` ZIP are external trust boundaries; imported tool grants are stripped. Exports currently use blob anchors, unsupported in this bare Android WebView.
- Preserve: HTTP localhost origin and LAN HTTP model support, existing ES module boundaries, tool isolation, library formats and conversation aliases. No framework rewrite is justified.
- Initial environment: clean `main`; JDK/SDK 36 present; no connected Android device/emulator or configured release keystore. Dependency installation and baseline tests follow. Real-device validation and signed distribution require their respective infrastructure.

## Prioritized improvements

### AND-27 — Reject imported and hydrated HTML render caches
- Priority/severity: P0 / critical security; a shared library could forge cached HTML to bypass chat sanitization and access Android bridge capabilities or credentials.
- Components/evidence: `sanitizeImportedAspect` and storage hydration retained message `_renderedHtml`/`_renderedContent`; `chat.js:renderChatMessages` directly inserts that cache when its content marker matches.
- Implementation: discard render caches and edit flags at JSON import, legacy migration/recovery, IndexedDB load and snapshot hydration boundaries; retain runtime render caching for trusted in-session output.
- Acceptance: imported/stored message metadata cannot inject HTML or editing UI; all displayed model text passes the current sanitizer.
- Tests: real library import followed by chat rendering with forged matching caches/event handlers/data actions; legacy chatHistory, authoritative DB and snapshot hydration regressions; existing backup/chat/persistence tests.
- Dependencies: none. Status: VERIFIED.
- Verification: `tests/importRenderSecurity.test.js` exercises the original cache bypass and confirms plain content renders with no injected image/handler/action/editing nodes. Affected regression pass: 6 files / 112 tests passed (2026-11-03).

`AND-20` (dependency advisories) is being investigated alongside P0/P1 security fixes; its severity depends on reachable advisory conditions rather than audit totals alone.

### AND-28 — Fail closed when Android exposes the native bridge to tool frames
- Priority/severity: P0 / critical security; older WebViews and listener initialization failures activate Capacitor's legacy bridge fallback.
- Components/evidence: installed Capacitor `MessageHandler.java:26–41` falls back to `addJavascriptInterface`; its native dispatcher does not authenticate frame origin. [Android documents all-frame injection](https://developer.android.com/reference/android/webkit/WebView#addJavascriptInterface(java.lang.Object,%20java.lang.String)); the [modern listener supports origin restrictions](https://developer.android.com/reference/androidx/webkit/WebViewCompat#addWebMessageListener(android.webkit.WebView,java.lang.String,java.util.Set%3Cjava.lang.String%3E,androidx.webkit.WebViewCompat.WebMessageListener)).
- Implementation: bootstrap refuses tool initialization if its opaque frame exposes `androidBridge`, before script creation or memory handoff. All frame paths deliver code only through the checked init handshake; ready/error/teardown remain deterministic. Document the WebView update requirement.
- Acceptance: an exposed legacy native bridge never receives tool calls and untrusted source never runs; frames without a native bridge retain brokered tools.
- Tests: real bootstrap with exposed legacy bridge and parent-only modern bridge simulation; handshake/source staging; existing sandbox lifecycle, cancellation and broker tests.
- Dependencies: none. Status: VERIFIED.
- Verification: `tests/sandboxNativeBridge.test.js` asserts no script creation/tool execution/native call/memory handoff on legacy exposure, normal isolated initialization and teardown, and no embedded untrusted srcdoc script. Affected regression pass: 9 files / 153 tests passed (2026-11-03). No physical Android WebView was available to validate platform injection behavior.

- Device verification: the seventh connected test executes Calculator through the packaged production sandbox and asserts native-bridge and parent-state isolation on Android 16/API36; 7/7 final connected tests pass.

### AND-01 — Enforce tool network grants across redirects
- Priority/severity: P0 / high security; any network-enabled custom tool can encounter redirects.
- Components/evidence: `tools.js`, `brokerToolFetch` approves the initial URL, then uses default `fetch` redirect following, bypassing destination approval.
- Implementation: reject redirects at the broker boundary and return an actionable error; keep opaque sandbox networking disabled.
- Acceptance: approved hosts cannot forward requests or data to unapproved hosts; normal approved fetches still work.
- Tests: approved fetch, cross-origin redirect, invalid URL and existing tool sandbox security suite.
- Dependencies: none. Status: VERIFIED.

- Verification: `tests/tools.test.js`: approved-origin requests and a real MSW 307 POST redirect; redirect returns failure and the attacker endpoint receives zero requests. Existing sandbox isolation tests pass. Affected regression pass: 17 files / 358 tests passed (2026-11-03).

### AND-02 — Preserve authoritative IndexedDB data during migration retries
- Priority/severity: P0 / high data loss; migration bookkeeping can fail under storage pressure.
- Components/evidence: `persist.js:migrateFromLocalStorage` calls purge-capable `saveAspects` before checking existing rows. A retained legacy blob can replace a newer library on restart.
- Implementation: migrate only into an empty store, decide and write in one transaction, preserve the legacy backup and existing records.
- Acceptance: stale legacy data never changes existing IndexedDB records, including missing migration flags and bookkeeping failure retries.
- Tests: empty migration, conflicting/newer records, concurrent retries, failed bookkeeping.
- Dependencies: none. Status: VERIFIED.

- Verification: Atomic empty-store migration is covered by stale/conflicting rows, concurrent first migrations and repeatedly failed localStorage bookkeeping. tests/persist.test.js passes; final behavioral regression: 635/635.

### AND-03 — Disarm writes when only stale legacy recovery is available
- Priority/severity: P0 / high data loss; transient database reads can fail on phones under pressure.
- Components/evidence: `persist.js:loadAspects` explicitly marks persistence ready after an IndexedDB failure if an old backup exists, permitting a later purge of unread current records.
- Implementation: expose recovered data in read-only recovery state; require successful authoritative reload or explicit recovery before writing.
- Acceptance: queued, direct and flushed saves cannot overwrite unread rows; recovery remains visible and exportable.
- Tests: failed read with old backup and newer database rows, timer already queued, explicit re-arm and successful retry.
- Dependencies: AND-02. Status: VERIFIED.

- Verification: Read-failure recovery tests retain newer disk records, disarm direct/debounced/flushed saves, cancel queued work and re-arm only after successful reload/explicit recovery. Recovery warning is visible. Final behavioral regression: 635/635.

### AND-04 — Own the entire chat turn and prevent Aspect crossover
- Priority/severity: P1 / high correctness; tool latency and rapid touches make this reachable.
- Components/evidence: `tools.js:sendMessage` awaits user tools before setting generation state; `aspects.js:selectAspect/deleteCurrentAspect` allow switching while continuation/tool code resolves the current Aspect.
- Implementation: acquire generation/cancellation ownership before the first await; block conflicting active-library changes until deterministic cleanup; preserve recursive tool requests.
- Acceptance: double Send, Stop, Aspect create/switch/delete/import/restore and conversation changes cannot move tools, messages or logs to another Aspect.
- Tests: deferred user tool, duplicate send, stop during tool, selection/deletion and continuation ownership regressions.
- Dependencies: none. Status: VERIFIED.

- Verification: `tests/tools.test.js`, `tests/aspects.test.js`, `tests/ui.test.js`: deferred manual tool holds ownership, duplicate send preserves input, Stop suppresses subsequent tools/provider/state adoption, generation/library locks block Aspect and conversation mutation. Existing recursive/native tool, chat and workflow tests pass. Affected regression pass: 17 files / 358 tests passed (2026-11-03).

- Ownership audit: initial/default library loading holds `libraryBusy` across the full asynchronous load and always releases it. Deferred-load tests reject create/import/Send before authoritative publication; read-failure cleanup is covered. Latest affected pass: 16 files / 337 tests passed.

### AND-05 — Reject malformed imported conversation structures safely
- Priority/severity: P1 / high reliability; imports are untrusted shared files.
- Components/evidence: `persist.js:parseLibrary` accepts arrays as records; `conversations.js:normalizeConversations/deriveTitle` dereference null conversations/messages and call `.trim()` on arbitrary content.
- Implementation: validate the library envelope/records and normalize recoverable conversation/message fields before rendering or saving; retain supported tool-call metadata.
- Acceptance: malformed data produces a controlled error or repaired valid records, never an uncaught UI error or partial import; normalization is idempotent.
- Tests: null/array/scalar records, malformed messages, duplicate IDs, invalid titles/timestamps and deterministic randomized normalization.
- Dependencies: none. Status: VERIFIED.

- Verification: Malformed envelope/record/message/title/timestamp/duplicate-ID cases plus 500 deterministic randomized records (seed0x51a7) assert safe/idempotent normalization and shared active-message alias. Real malformed presentation import commits safely. Final behavioral regression: 635/635.

### AND-21 — Bound untrusted ZIP expansion on Android
- Priority/severity: P1 / high memory exhaustion.
- Components/evidence: `zip.js:loadAspectFile` limits only compressed file size, then inflates arbitrary entries in parallel without decoded-byte/entry limits.
- Implementation: bound entry count, per-entry decoded bytes and aggregate decoded bytes while inflating, reject excess before publishing imported data.
- Acceptance: highly compressed/oversized archives fail with a controlled error and no state change; valid boundary archives import.
- Tests: compressed bombs, too many entries, per-entry/aggregate boundaries, valid archive regression.
- Dependencies: none. Status: VERIFIED.
- Verification: Real compressed archives verify 1000-entry, 15MiB/entry, 50MiB aggregate boundaries, highly compressed bombs, untrusted declared sizes, traversal/normalized collisions and binary/UTF-8 contents. Actual streaming bytes are bounded, extracted sequentially and decoded before state publication; scoped prefixes avoid JSZip.folder().files including unrelated entries. Focused ZIP/archive/download/atomic-storage run: 33/33 passed.

### AND-22 — Avoid partially imported Aspects after knowledge write failure
- Priority/severity: P1 / high state consistency.
- Components/evidence: `zip.js` pushes/selects a new Aspect before its independent asynchronous knowledge writes complete; a failed write leaves visible partial state and orphan records.
- Implementation: stage all parsed data, batch knowledge atomically, publish only after commit and roll back staged data on later failure; guard conflicting generation changes.
- Acceptance: failed knowledge/Aspect persistence leaves original selection/library intact and no imported residue; successful import retains all files.
- Tests: injected batch/save failure, multiple files, active generation and successful round trip.
- Dependencies: AND-04, AND-21. Status: VERIFIED.
- Verification: Import takes libraryBusy synchronously, validates/extracts before mutation, refuses generation/read-only recovery, flushes prior writes and uses one aspects+files transaction. Tests cover rejected save/flush, concurrent import, duplicate flattened filenames, successful files and cache/disk rollback on real fake-IDB duplicate-key abort. Focused run: 33/33 passed.
- Test migration: replaced async()-only JSZip mocks with actual compressed archives because streaming bounds and JSZip.folder().files scope cannot be verified by the old mocks. Retained metadata/images/legacy history/malformed JSON/tool state/raw knowledge/Windows paths/limits/export/no-tools/preset and HTML escaping/no-icon behaviors, adding real persistence-failure/concurrency tests.

### AND-06 — Save Android exports through the document picker
- Priority/severity: P1 / high broken functionality; affects all Android backup/export users.
- Components/evidence: `backup.js` and `zip.js` create blob download anchors; bare `MainActivity` and Capacitor have no DownloadListener or export plugin.
- Implementation: native Capacitor export bridge using Android document creation, bounded payload validation, cancellation and deterministic stream cleanup; shared browser/native download adapter.
- Acceptance: JSON, `.aspect` and HTML export paths use native save on Android; success is shown only after writing; cancellation is clean; browser export continues working.
- Tests: native adapter payloads/errors/cancel, browser cleanup, Java validation tests; device picker smoke where available.
- Dependencies: none. Status: VERIFIED.
- Verification: Android 16/API 36 x86_64 KVM emulator connected suite passed 6/6. Actual native bridge staging/output bytes, malformed chunks, cache eviction, cancellation, unavailable provider, discard/reinitialization and activity recreation were exercised. ACTION_CREATE_DOCUMENT results were intercepted by Instrumentation.ActivityMonitor; vendor document-picker UI was not manually driven. Shared JSON/ZIP/HTML/browser adapter regression is included in 7 files/70 passing JS tests; JVM export policy 4/4.

### AND-25 — Keep ephemeral memory out of durable data
- Priority/severity: P1 / high data confidentiality.
- Components/evidence: `~` memory keys are documented as session-only, but `persist.js:serializeAspect` and `db.js:saveMemory` persist the entire memory object; a later durable write, snapshot or export includes them.
- Implementation: share an explicit durable-memory projection across DB/Aspect serialization and export paths, retaining ephemeral keys in runtime only.
- Acceptance: `~` keys remain usable in-session and never appear in durable memory, Aspect saves, snapshots or exported files; ordinary keys round-trip.
- Tests: ephemeral write followed by durable write/autosave/export/snapshot and restore; malformed memory records.
- Dependencies: AND-06 export integration. Status: VERIFIED.

- Verification: Real IDB tests assert runtime ~ keys remain available but never reach durable memory, Aspect rows, library JSON, snapshots or ZIP memory.json; runtime listeners and imported/hydrated ephemeral keys are omitted. Final behavioral regression: 635/635.

### AND-26 — Exclude credentials from automatic Android data extraction
- Priority/severity: P1 / high credential privacy; affects Android 12+ OEM device-transfer paths.
- Components/evidence: native lint reports DataExtractionRules; allowBackup=false alone does not suppress device transfers on some OEMs, while WebView profile stores API keys. [Android backup documentation](https://developer.android.com/identity/data/autobackup) describes this exception.
- Implementation: retain allowBackup=false, explicitly disable legacy full backups and exclude all nine app/device-protected domains from cloud-backup and device-transfer extraction rules.
- Acceptance: packaged manifest references restrictive rules; every supported storage domain is excluded in both modes with no include exceptions.
- Tests: native resource compilation/lint and instrumentation parser assertions for both modes/all domains; inspect packaged manifest.
- Dependencies: none. Status: VERIFIED.

### AND-07 — Make snapshot restore report durable success
- Priority/severity: P1 / high recovery correctness.
- Components/evidence: `backup.js:restoreSnapshot` ignores failed pre-restore snapshot (`null`) and does not await debounced persistence before announcing success.
- Implementation: require a recovery snapshot before replacing nonempty state, await committed restore and roll back presentation state on save failure; guard active generation.
- Acceptance: failed recovery backup/save leaves the previous library usable and never claims success; restored records are committed before success.
- Tests: snapshot read/write failures, quota/transaction rejection, successful disk round trip, generation guard.
- Dependencies: AND-03, AND-04. Status: VERIFIED.

- Verification: Fault injection covers pre-restore snapshot failure, rejected durable save, rollback of selection/write protection, deferred commit lock and successful round trip; presentation errors cannot undo a committed library. Final behavioral regression: 635/635.

### AND-20 — Remediate vulnerable locked dependencies
- Priority/severity: P1 / high security, subject to advisory reachability.
- Components/evidence: initial `npm audit` reports 17 affected dependencies (1 critical, 5 high, 11 moderate), including DOMPurify used for untrusted chat HTML, build tools and transitive packages.
- Implementation: review advisories, apply compatible patched versions, test rendering/build/runtime compatibility; document any externally blocked transitive upgrades precisely.
- Acceptance: reachable production vulnerabilities have fixes, remaining audit findings have explicit dependency paths and limits; no forced incompatible upgrade or weakened sanitization.
- Tests: before/after audit, complete JS suite, production build and sanitizer regressions.
- Dependencies: none. Status: BLOCKED.

- Audit result: compatible updates reduced 17 findings (1 critical/5 high/11 moderate) to 6 (0 critical/2 high/4 moderate). DOMPurify 3.4.17, Vite 8.3.5, Vitest/coverage/mocker 4.1.12 and patched source-map-js/undici are locked. A newly available compatible rimraf 6.1.4 patch removed the CLI tooling chain via glob 14.0.3/minimatch 11.0.4.
- Remaining blocker: Transformers 3.8.1 → Node-only sharp 0.34.5 (2 high aggregate), and Capacitor assets 4.0.0 → trapezedev 7.1.11 → xcode 3.0.1 → uuid 7.0.3 (4 moderate aggregate). Registry inspection confirms no newer Transformers 3/sharp 0.34 or trapezedev 7 patch resolves them; xcode 4 and Transformers 4 are incompatible upstream-major changes. No unsupported override, forced downgrade or sanitizer weakening was applied. Sharp is excluded by the Transformers browser export used in Android; the assets chain is development tooling.
- Verification: patched sanitizer/renderMarkdown adversarial regressions passed 33 tests; post-update full behavior suite passed 41 files / 635 tests, build-helper suite passed 7/7 and packaged-server checks passed 1/1. The remaining upstream chains stay BLOCKED.

### AND-23 — End streams at protocol terminal events
- Priority/severity: P1 / medium resource/lifecycle failure.
- Components/evidence: `llm.js` ignores SSE `[DONE]` and Ollama `done:true`, awaiting socket EOF indefinitely even after completion.
- Implementation: stop reading at terminal events, deliver terminal content/tool metadata, cancel/release reader deterministically.
- Acceptance: completed streams unlock without connection close; trailing data cannot alter completed replies.
- Tests: terminal event with nonclosing socket, final content/tool metadata, trailing error/data, split chunks and cancellation.
- Dependencies: none. Status: VERIFIED.

- Verification: `tests/streamDecoder.test.js`: SSE and Ollama terminal events complete after one read from a reader that rejects any subsequent read; trailing content/errors are ignored and final content/tool calls preserved. UTF-8 split and native calling tests pass. Affected regression pass: 17 files / 358 tests passed (2026-11-03).

### AND-08 — Ignore obsolete model discovery responses
- Priority/severity: P1 / medium correctness; common on slow mobile connections.
- Components/evidence: `settings.js` applies asynchronous model lists after provider/URL changes with no request identity check.
- Implementation: bind each request/result to current settings controls and invalidate previous work for primary and fallback discovery.
- Acceptance: delayed responses cannot overwrite the newly selected provider's model or status.
- Tests: out-of-order primary/fallback results and switching to Custom/WebLLM/off.
- Dependencies: none. Status: VERIFIED.

- Verification: `tests/settings.test.js`: deliberately out-of-order primary and fallback discovery retains the newer model; obsolete failures after Custom selection do not change status. Request identity covers WebLLM catalogue results and connection tests. Affected regression pass: 17 files / 358 tests passed (2026-11-03).

### AND-09 — Permit configured fallback for Aspect summons
- Priority/severity: P1 / medium broken functionality.
- Components/evidence: `tools.js:fetchAIResponseForAspect` rejects a missing primary URL before executing fallback transport.
- Implementation: delegate configuration validation to the same fallback-aware transport used by ordinary chat; propagate cancellation.
- Acceptance: fallback-only summons work, invalid configurations give a clear failure, and Stop never retries.
- Tests: empty primary + valid fallback, missing both, abort and existing summon/native-function tests.
- Dependencies: AND-04. Status: VERIFIED.

- Verification: `tests/tools.test.js`: missing primary with valid fallback produces the fallback answer; cancellation accompanied by a generic transport failure issues only one fetch. Existing summon tests pass. Affected regression pass: 17 files / 358 tests passed (2026-11-03).

### AND-10 — Recover database connections after close or failed open
- Priority/severity: P1 / medium reliability.
- Components/evidence: `idb.js` retains one rejected promise forever and closes on versionchange without invalidating that promise; subsequent transactions use a dead connection.
- Implementation: lazy coalesced connection acquisition, invalidate on close/versionchange/open failure and close late-success connections after blocked opens.
- Acceptance: transient open failure and closed connection can recover without reload; concurrent callers share an open and no blocked-open connection leaks.
- Tests: injected open failure, explicit close/versionchange, concurrent acquisition, blocked-then-success event sequence.
- Dependencies: none. Status: VERIFIED.

- Verification: Failed/coalesced/blocked-late-success opens, versionchange, explicit close and direct memory/knowledge consumers recover. Shared transaction creation retries before callbacks only; aborted writes are not retried. Cache failed initialization can retry. Final behavioral regression: 635/635.

### AND-11 — Validate complete signing configuration before building
- Priority/severity: P1 / medium release reliability.
- Components/evidence: `scripts/android.mjs` accepts an empty properties file as configured signing, starting expensive work and potentially producing unsigned artifacts.
- Implementation: validate effective properties/environment fields and readable keystore with actionable redacted errors before web/Gradle work.
- Acceptance: incomplete/unreadable signing fails early; valid properties/environment precedence works without printing secrets.
- Tests: empty/partial/missing signing, valid mixed configuration, debug without signing.
- Dependencies: none. Status: VERIFIED.

- Verification: Signing preflight now resolves Java-properties/environment precedence and validates every required field plus readable regular keystore before Vite/Gradle. Seven Node test groups pass, including empty/partial config, fallback precedence, escaped properties, directory rejection and redacted errors. No release identity is available for a real signed build.

### AND-12 — Validate Android version code range and mapping
- Priority/severity: P1 / medium update correctness.
- Components/evidence: `android/app/build.gradle` maps unchecked major/minor/patch using fixed 100-wide slots; patch/minor ≥100 collide and arithmetic/overrides can overflow or be invalid.
- Implementation: validate bounded semantic components and Play-compatible positive version codes, supporting explicit valid overrides for unmappable versions.
- Acceptance: unique supported mappings; zero, negative, fractional, overflowing or colliding automatic versions fail with useful errors.
- Tests: component boundaries, prereleases, invalid overrides, maximum valid code.
- Dependencies: none. Status: VERIFIED.

- Verification: Both JavaScript and Gradle reject invalid SemVer/colliding automatic ranges and invalid overrides, using arbitrary-precision arithmetic before bounds checking. Node tests and standalone Gradle contract tests pass, each exhausting 20,000 unique supported version codes plus boundary/prerelease/overflow cases.

- Independent-audit correction: all prerelease/build-metadata versions now require an explicit positive version-code override, preventing stable/prerelease publication collisions. Packager passes its computed code explicitly to every Gradle invocation so local Gradle properties cannot silently override artifact provenance.

### AND-29 — Replace fabricated weather with validated current data
- Priority/severity: P1 / medium incorrect behavior; affects users of the bundled weather tool and templates.
- Components/evidence: both `systemTools.js:Weather.js` and the default Aspect return invented temperatures/conditions selected by the current minute, independent of actual weather.
- Implementation: use permission-brokered Open-Meteo geocoding/current-weather APIs with bounded validated inputs/responses, clear failures and source attribution; default tools reuse canonical definitions.
- Acceptance: weather values come from the selected location's API response, never fabricated fallback data; denied/offline/malformed responses report errors; public tool filename remains compatible.
- Tests: valid city/coordinates, no results, invalid coordinates, malformed weather/units, HTTP/network errors, permission path regression and default canonical code.
- Dependencies: AND-01 network grants. Status: VERIFIED.

- Verification: 21 Weather tests cover valid city/coordinates/units and invalid, denied, offline, HTTP and malformed-response paths; live coordinate API request returned validated weather/time/units/source successfully. Default canonical code tests pass. Existing saved tool sources are intentionally preserved; replace older Weather tools through System Tools (ANDROID.md). Final behavioral regression: 635/635.
- Canonical default integration: Studio Guide deep-copies Calculator/Weather/DateTime from `systemTools` (retains public `Calculate.js` alias). `tests/aspects.test.js` verifies canonical code equality and independent mutable state; the duplicate production Weather implementation is removed.

### AND-18 — Preserve fallback keys in session-only mode
- Priority/severity: P2 / medium usability/reliability.
- Components/evidence: `settings.js` stores only primary session key while `state.js` reads fallback key only from durable storage; disabling Remember loses fallback credentials on reload.
- Implementation: use the same session/durable policy for both credentials, clearing the opposite store on policy changes.
- Acceptance: both keys survive the current session without durable copies when Remember is off, and clear correctly when removed.
- Tests: remember on/off transitions, module reload, empty keys and both storage locations.
- Dependencies: none. Status: VERIFIED.

- Verification: `tests/settings.test.js`: both keys stay out of localStorage in session mode, survive module reload, and session copies clear when Remember is enabled. Existing primary credential tests pass. Affected regression pass: 17 files / 358 tests passed (2026-11-03).

### AND-19 — Bound and validate provider model discovery
- Priority/severity: P2 / medium resilience.
- Components/evidence: `providers.js:fetchModels` has no request timeout and directly maps nullable model entries; stalled/malformed servers can hang diagnostics or throw obscure errors.
- Implementation: bounded cancellable discovery and response validation, preserving empty-list/manual-model behavior.
- Acceptance: stalled servers terminate within configured timeout; malformed entries cannot crash model rendering; cancellation does not leave controls disabled.
- Tests: deterministic stalled fetch timeout, abort, malformed list and valid local/hosted formats.
- Dependencies: AND-08. Status: VERIFIED.

- Verification: `tests/providers.test.js`: deterministic 50ms stalled-fetch deadline aborts networking and removes listeners/timers; explicit cancellation propagates; malformed/null/duplicate IDs normalize safely or reject clearly. Existing provider/API tests pass. Affected regression pass: 17 files / 358 tests passed (2026-11-03).

### AND-24 — Bound stored and entered numeric settings
- Priority/severity: P2 / medium correctness.
- Components/evidence: negative `maxContext` changes history slicing; oversized tool timeout can overflow platform timers despite UI limits.
- Implementation: central bounded numeric normalization for persisted settings and form submission; defend consumer boundaries.
- Acceptance: finite integral context counts/timeouts remain within advertised limits; malformed storage cannot produce incorrect slicing or immediate timer overflow.
- Tests: zero/negative/fractional/nonfinite/oversized settings and history/timeout behavior.
- Dependencies: none. Status: VERIFIED.

- Verification: `tests/numericSettings.test.js`, `tests/settings.test.js`, `tests/tools.test.js`: zero/negative/fractional/nonfinite/oversized values, persisted startup values, form limits and history slicing checked. Tool execution defensively normalizes its timer limit. Affected regression pass: 17 files / 358 tests passed (2026-11-03).

### AND-13 — Validate and describe packaged Android artifacts
- Priority/severity: P2 / medium distribution reliability.
- Components/evidence: `scripts/android.mjs` copies artifact and checksum without signature/manifest validation or build provenance.
- Implementation: verify APK signatures/alignment and bundle packaging where tools support them; record tool versions and artifact metadata; publish checksum only for successful outputs.
- Acceptance: mislabeled/unsigned/corrupt outputs fail packaging, valid files have SHA-256 plus documented version/environment and honest platform limits.
- Tests: packaging helper adversarial tests and actual SDK packaging/signature inspection.
- Dependencies: AND-11, AND-12. Status: VERIFIED.

- Verification: Actual debug APK packaging passed apksigner verification, 16 KiB native alignment validation, and manifest identity/version/minSDK24/targetSDK36/debuggable checks. Versioned SHA-256 and build JSON record exact toolchain, commit/dirty state and runtime limits. Seven Node adversarial groups pass, including corrupt manifest and unsigned/partially signed bundle rejection. Signed production APK/AAB validation remains dependent on existing release credentials; unsigned outputs are never mislabeled by the packaging command.

- Independent-audit correction: AGP-pinned bundletool validates AAB structure and dumps its real manifest; package identity/version/SDK/debuggable values are checked against expected release metadata. Partially unsigned JAR signatures are rejected, and failed preflight removes only requested same-version stale outputs. Seven adversarial Node helper groups pass.

- Native release inspection: unsigned APK/AAB builds and AGP-pinned bundletool validation passed; real APK and AAB manifest checks confirmed 1.0.1/code10001, application ID, API24/36 and non-debuggable state. Original outputs were verified unsigned. A temporary copy signed with the existing development debug key launched on the API36 emulator and rendered the full Studio UI; that test copy was deleted and is not a release-signed distribution.

### AND-16 — Restrict FileProvider paths to actual capture needs
- Priority/severity: P2 / medium defense in depth.
- Components/evidence: `res/xml/file_paths.xml` exports a mapping for the entire external storage root and cache; no custom sharing feature needs those broad roots.
- Implementation: trace Capacitor file input capture ownership and narrow paths to required private capture location; preserve camera upload compatibility.
- Acceptance: unrelated external files cannot be mapped by the provider; required capture URI creation remains valid.
- Tests: native provider URI allow/deny tests and manifest/build inspection.
- Dependencies: native capture source inspection. Status: VERIFIED.
- Verification: Traced Capacitor captures to external app Pictures/ and narrowed provider mapping accordingly. Connected API 36 FileProvider tests passed: capture_images URI allowed, unrelated external-app file and private-cache file refused. Native lint/build passed. No whole-external-storage or cache-root mapping remains.

### AND-30 — Preserve exported image formats
- Priority/severity: P2 / medium data fidelity.
- Components/evidence: `.aspect` export always names icons `Icon.png` and backgrounds `Background.jpeg`, including the default SVG icon; import assigns the mismatched MIME unconditionally.
- Implementation: preserve known image MIME/extension pairs in archive export/import while supporting legacy archive filenames.
- Acceptance: SVG/PNG/JPEG/WebP image bytes and MIME survive a real archive round trip; unsupported formats fail safely without executable markup insertion.
- Tests: real compressed archive format round trips and legacy names, malformed image inputs.
- Dependencies: AND-21 bounded archive handling. Status: VERIFIED.

### AND-17 — Replace template Android tests with app smoke checks
- Priority/severity: P2 / medium validation gap.
- Components/evidence: instrumentation asserts `com.getcapacitor.app` instead of `dev.recursiveai.aspectstudio`; unit test only checks 2+2.
- Implementation: assert actual application identity, launcher/startup, bridge/export registration and security properties; add real native validation unit coverage.
- Acceptance: tests target the shipped app and can detect broken identity/startup/configuration; disclose lack of device execution if infrastructure unavailable.
- Tests: compile/run JVM suite, compile instrumentation, connected smoke if available.
- Dependencies: AND-06, AND-16. Status: VERIFIED.
- Verification: Replaced generated 2+2/wrong-package tests with 4 passing JVM validation tests (seed 0x415350454354) and 6 passing connected API 36 tests for identity/privacy, all-domain extraction exclusions, FileProvider allow/deny, native exports and WebView startup/recreation/origin persistence. Additional packaged-sandbox smoke added for final rerun; physical devices/older Android not tested.

### AND-14 — Gate Android changes with native tests and lint
- Priority/severity: P2 / medium regression risk.
- Components/evidence: `.github/workflows/android.yml` runs only on tags/manual and never invokes native tests/lint.
- Implementation: Android path-aware PR/main CI, install exact SDK, run JS/build helper tests plus native unit tests/lint before packaging; keep signing secrets away from PRs.
- Acceptance: Android regressions are checked before release and missing signing does not conceal failed verification.
- Tests: inspect workflow triggers/secret conditions and run equivalent Gradle checks locally.
- Dependencies: AND-17. Status: VERIFIED.

- Verification: Workflow now covers path-filtered main/PR changes, exact API36/build-tools36 installation, JavaScript/build-helper/version-contract tests, app JVM tests/lint and instrumentation compilation before debug packaging. Signing secrets are confined to manual/tag release steps and decoded key cleanup is unconditional. Equivalent local app checks passed: 4 native JVM tests, instrumentation APK compilation, lint 0 errors (19 existing/template warnings). Broad all-module instrumentation fails in generated Cordova test dependencies from pre-existing Kotlin duplicate classes; checks intentionally target the shipped app. Emulator setup is now being attempted for connected tests.

- Connected verification: installed a task-specific Android 16/API 36 Google APIs x86_64 emulator, KVM acceleration verified; app connected suite passed 6/6 in 43.538s, including startup/recreation, actual export staging/write/cancel/failure recovery and security boundaries. No physical device or older Android version was tested.

- Final connected pass after source/dependency changes: 7/7 tests, 0 failures/errors/skips in 22.236s on API36, including real packaged Calculator execution and native/parent sandbox isolation. Latest native JVM 4/4 and lint 0 errors/18 template/version/icon warnings.

### AND-15 — Pin the Gradle distribution checksum
- Priority/severity: P2 / medium supply-chain hardening.
- Components/evidence: wrapper properties configure HTTPS and URL validation but no `distributionSha256Sum`.
- Implementation: pin the official Gradle 8.14.3 distribution digest for the configured archive.
- Acceptance: wrapper verifies downloaded bytes against the official SHA-256 without disabling TLS.
- Tests: compare official checksum and invoke wrapper.
- Dependencies: none. Status: VERIFIED.

- Verification: official services.gradle.org Gradle 8.14.3-all checksum is pinned; a fresh wrapper download passed checksum validation and `./gradlew --version` ran successfully on JDK 21.

## Final verification and distribution

- Improvements: 30 identified; 29 implemented and individually VERIFIED; AND-20 remains BLOCKED for upstream transitive dependency patches after all compatible fixes.
- Behavioral regression: 635/635 JavaScript tests across 41 files pass. Android build helper: 7/7 groups; packaged-server checks: 1/1. Version-code contract tests exhaust 20,000 distinct mappings plus adversarial boundaries.
- Native verification: JDK 21, Android SDK/build-tools 36, Gradle 8.14.3, Node 26.12.0/npm 11.20.0. Four JVM tests and seven connected Android 16/API36 emulator tests pass (22.236s final connected run), including actual sandbox Calculator execution and native/parent isolation. Native lint: zero errors (18 template/icon/update warnings). Device picker results are intercepted; real ContentResolver writes/cancellation/failure recovery are executed. No physical-device, vendor-picker UI or OEM-transfer run is claimed.
- Coverage command: all behavioral assertions pass, but the existing global 80% coverage gate fails. An isolated unchanged ce22e99 checkout using the same patched test toolchain also fails. Thresholds/assertions/exclusions were preserved:

| Coverage | Baseline ce22e99 | Sprint |
| --- | ---: | ---: |
| Statements | 72.82% | 75.97% |
| Branches | 61.54% | 66.06% |
| Functions | 73.86% | 78.57% |
| Lines | 76.45% | 79.77% |

- Independent audit: separate agents reviewed native, shared-state/security and build/release changes. Findings corrected include imported HTML-cache injection, legacy bridge exposure, startup ownership, malformed presentation fields, version-code suffix collisions and actual AAB manifest/metadata disagreement. Final diff/secret/generated-file review precedes commit.
- Performance: no speedup is claimed. Real 15MiB/entry and 50MiB aggregate archive limits are exercised. Four large archive tests use explicit 30-second test deadlines under coverage/emulator load; payloads and assertions were not reduced.
- Distribution: preliminary release APK/AAB compile and pass manifest/SDK/debug-state, APK alignment and pinned bundletool validation. Signed production APK/AAB packaging is BLOCKED: no release keystore/password/alias exists locally or in repository secrets. No substitute release identity was generated. Clean-source artifacts/checksums and publication are the remaining release steps below.
- Runtime limits: Android 16 emulator tested; older Android/WebViews, physical devices, actual vendor picker UI, Play submission and model inference on-device remain unverified. Existing saved Weather source is preserved; replace the prior demo tool using System Tools. Residual dependency advisories and the pre-existing coverage gate prevent an unqualified production-readiness claim.
- Publication target: [v1.0.1 Android preview](https://github.com/recursive-ai-dev/aspect-chat/releases/tag/v1.0.1). Final commit/push/release asset verification will be recorded after execution.
