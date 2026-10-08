# Codex Verification Log

## 2026-10-02 — R1–R6 route truth and keyboard closure

- Plan and sources: `docs/engineering/route-trust-repair-2026-10-02.md`; official AMap, W3C Tabs and Node child-process contracts.
- Fixed: endpoint city propagation; no fabricated real geometry; one bus candidate per segment; native SDK transit paths without duplicate rendering; complete cached paths and truthful SDK source; keyboard wrap/Home/End/focus preservation; Windows LIVE launcher and semantic provider checks.
- Review caught and fixed: real AMap empty railway placeholders, body accidentally bound as a mobile-view button, and default SDK fixtures leaking requests to the real BFF.
- Final gates: check and diff-check PASS; 197 unit tests PASS; offline 12 fixtures PASS; E2E 27 PASS / 15 platform skips; LIVE AMap 2 PASS and DeepSeek required-stop/day checks PASS. Real keyboard desktop/mobile screenshots and original-arrow route screenshots reviewed. Route visual first run had 3 unclassified console errors; diagnostic rerun had 0, plus one SDK performance warning. See plan for exact evidence boundaries.
- No credentials, 3D, Kotlin, releases or unrelated user work changed.

## 2026-10-02 — Document conformance and F01–F04 repair

- Expected: align maintained documents with the active 2D implementation, verify official advisories / W3C guidance, reproduce observed defects, then implement and review.
- Reproduced: strengthened E2E failed with zero route overlays despite visible cards; AI overlength error remained after valid input. Fixed the SDK mock contract, error state, associated labels and input-to-preview capability guidance. No OCR added.
- Updated compatible dependencies: Hono 4.13.12, Vitest/mocker 4.1.11, brace-expansion 1.1.21, js-yaml 4.3.2. Audit: zero known vulnerabilities. Maintained docs now distinguish 2D, frozen 3D, ordinal Days, offline evaluation and unstarted Kotlin stages.
- Verification: check PASS; 20 files / 187 unit tests PASS; 12 offline guide fixtures PASS; full E2E 25 PASS / 15 platform-scoped skips; final route error-check E2E 1 PASS. Real AMap desktop/mobile rendered five roads with native white arrows and correct selection/clearing, zero errors and one SDK Canvas2D performance warning. AI input desktop/mobile screenshots reviewed, zero errors.
- Review and limits: see `docs/engineering/2d-conformance-review-2026-10-02.md` for sources, defect closure and external screenshot paths. No current LIVE DeepSeek / CI / container / release approval claim. Existing dirty work preserved; no credentials, sealed 3D or release manifest changed. Temporary local verification server stopped after review.

## 2026-09-28 — Live AMap CSP repair

- Fix: allow mapplugin.amap.com only in script-src and webapi.amap.com in connect-src; extend the existing CSP integration assertion for both directives.
- Verification: server integration tests passed (32 tests); npm run check and git diff --check passed. Real SDK at localhost:8080 rendered on 1440x900 and 390x844, with 16 itinerary cards and selected-card/map interaction; no CSP violations or console errors. Mobile screenshot was recaptured after tiles settled and visually inspected.
- Remaining observations: SDK Canvas2D performance warning; some tile requests aborted during view changes. Screenshots: external visual-audit/after/live-map-1440.png and live-map-390.png. No mocks, credential edits, 3D activation, Kotlin implementation or publication.

## 2026-09-28 — Responsive visual closure

- Plan and fixes: constrain JSON card grid tracks; share a 360px-minimum/35% rail between homepage and workbenches; wrap closure revision text; use the existing paper background and explicit flat cards; move mobile guide controls above full-width editors. Tablet import actions stack to avoid cramped button labels.
- Visual acceptance: 36 screenshots at 1440x900, 768x900, 390x844 and 320x844. Mobile JSON cards now measure 362px/292px instead of 598px; tablet rails all measure 360px; desktop rails remain 504px; the 320px review and guide preview have no global or inspected nested overflow. All four captures recorded zero page errors and console warnings/errors.
- Actual screenshot review caught two gaps after the first fix: a long revision still expanded the closure card's internal track, and the 320px guide title/compare grids still expanded internally. Both were fixed and regression assertions now check nested bounds, not just document scrollWidth.
- Verification: npm run check, npm test (19 files / 181 tests), git diff --check passed. Scoped Playwright: 10 passed / 4 skipped; two skips avoid duplicate mobile-project execution of explicit four-viewport tests and two are existing desktop-only AI/share-option flows. Import/edit/save/reload/share/download, cancel-without-replacement and mobile draft-note preservation passed.
- Environment and scope: localhost:8080, Chromium; Browser skill/runtime not exposed in this session, so regular Playwright used. Providers mocked; the review preview is generated with updated source from the historical manifest without rewriting release evidence. No credentials, archived 3D, Kotlin implementation, commits or external releases changed.

## 2026-09-28 — Close confirmed pre-migration bloat issues

- Root causes: `console-log-json` had no active consumers; guide matching imposed 220ms + 80ms per place + 180ms solely to expose progress states; workspace share styling overrode the obsolete share-dialog block instead of replacing it.
- Fixes: removed the unused package and its three exclusive optional/transitive lock entries; removed presentation-only sleeps while preserving progress, 8s request timeout and cancellation; consolidated share CSS into one base definition and retained mobile overrides, removing obsolete dialog bounds and unused URL-input styles.
- Verification: new timer regression failed before the fix with `[220, 8000, 80, 8000, 80, 180]` and passed afterward with `[8000, 8000]`; `npm run check` passed; `npm test` passed (19 files / 181 tests); scoped Playwright guide/share scenarios passed (8 passed, 2 existing desktop-only skips). Six desktop/mobile share-workbench screenshots exactly matched the pre-cleanup screenshots.
- Browser QA: localhost:8080, Chromium 1280×720 and Pixel 5 393×851; page identity, nonblank content, no error overlay, console errors, screenshots and import/edit/persist/download interactions passed. Browser plugin unavailable, regular Playwright used. AI/POI providers mocked; actual provider speed is not claimed.
- Scope: existing sample fixes retained; no global configuration, credential, archive/3D, Kotlin implementation or publication changes. Lockfile refreshed offline with scripts disabled; installed node_modules was not pruned.

## 2026-09-28 — Synthetic travel samples and Kotlin migration baseline

- Expected: three explicitly synthetic guides/images and a schema-v5 workspace; Web import/edit/persist/share works on desktop and mobile; Kotlin work remains a phased plan.
- Observed: three routes, five days, seventeen places parsed; six Playwright scenarios passed at 1280×720 and 393×851 with screenshot and downloaded-PNG attachments. Built-in image_gen generated three posters; prompts and PNGs are in `work/user-simulation/`.
- Failures resolved: editor silently rejected edits without coordinates; mobile grid tracks let the preview cover download controls; sharing an unresolved trip drew the default Beijing map. Fixed only those observed paths, with regression coverage in the existing smoke suite.
- Verification: `npm run check`; `npm test` (19 files / 180 tests); `node node_modules/@playwright/test/cli.js test tests/e2e/smoke.spec.js --grep 'synthetic user route' --workers 2` (6 passed); workspace parsed using `parseWorkspaceImport`; `git diff --check`.
- Boundaries: Browser plugin not available, so regular Playwright used. Map/POI are mocked and remain unresolved; no DeepSeek extraction, OCR, real-user metrics, Android build or native-device acceptance claimed. No credential changes, external publication or 3D activation.

Use this file to record verification for meaningful project changes. Keep entries short, factual, and tied to commands, screenshots, or file checks.

## Entry Template

### YYYY-MM-DD - Task Name

**Expected Observation**

- What should be true before running the command, opening the page, checking the file, or taking the screenshot.

**Actual Result**

- What actually happened.

**Deviation / Surprise**

- Any difference from expectation, unexpected warning, failed command, visual mismatch, or untrusted data issue.

**Verification Command**

```powershell
# command, test, screenshot path, or file inspection used for verification
```

**Residual Risk**

- Remaining uncertainty, untested edge case, external dependency risk, or manual review item.

## Log

### 2026-09-01 - Close S6 evidence and release contract

**Expected Observation**

- One exact-candidate 2D manifest drives a read-only seven-layer binder and blocker-first closure desk.
- Missing, mismatched, mock, skipped, dirty-workspace, unverified rollback, unnamed review, and absent authorization evidence fail closed to `HOLD`.

**Actual Result**

- Added the manifest validator, artifact SHA-256 verifier, review generator, local read-only preview server, and 12 contract tests.
- Split the manual LIVE workflow into independent AMap and DeepSeek jobs and added a secret-safe DeepSeek smoke command.
- Fixed the observed production container failure caused by `prepare: husky`; the rebuilt Node 22 image returned `/healthz 200 ok` and `/readyz 200 ready`.
- AMap and DeepSeek preliminary live calls passed in an ephemeral container, then the container was removed. Because the source tree is dirty, both are recorded as `BLOCKED`, not `PASS`.
- Generated `work/release/current-manifest.json` and `work/release/review.html`; the manifest is valid and derives `HOLD` with eight unresolved rows.
- Browser review matched the selected warm-paper binder/closure direction at `1487x1058`, kept one blocker expanded and release disabled, logged no browser errors, and had no horizontal overflow at `390x844`.

**Deviation / Surprise**

- The initial Docker build failed because production-only install still ran the development Husky prepare command. The fix is isolated to the temporary dependency-stage package copy and retains native dependency install scripts.

**Verification Command**

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run test:guide-import
npm.cmd audit --audit-level=high
npm.cmd run test:live:deepseek
docker build -t travel-with-me:s6-review .
npm.cmd run release:evidence:check -- work/release/current-manifest.json
npm.cmd run release:review -- work/release/current-manifest.json work/release/review.html
git diff --check
```

**Residual Risk**

- The tree is not yet a clean frozen candidate. Node 22.22.1 CI artifacts, clean-candidate LIVE/container reruns, verified rollback, named human four-viewport review, and explicit release authorization remain open; publication stays `HOLD`.

### 2026-09-01 - Implement and verify S4-S5

**Expected Observation**

- Share and JSON tools should use the confirmed 35/65 map-area workbench without mutating the trip before an explicit import confirmation.
- Mobile itinerary/map switching should retain day, primary selection and list position while one visible polite status band remains below the switch.
- All four fixed viewports should remain free of global horizontal overflow and the 3D runtime should remain sealed.

**Actual Result**

- Implemented live share configuration with a retained previous preview, current-generation ownership, atomic successful swap, failure preservation, and latest-result copy/download.
- Replaced the native JSON confirmation with a linear validation workbench showing file metadata and route/day/place summaries; recovery-first whole-workspace replacement remains in `storage.js`.
- Added mobile tab/panel relationships, arrow-key navigation, 44px targets, duplicate status re-announcement, and map reveal logic that no longer clears the selected target.
- `npm run check`, 17 files / 167 unit tests, the 12-case guide-import evaluation, and `git diff --check` passed. The runtime boundary reports 38 approved active modules and 73 sealed inactive JavaScript files.
- Browser review passed at `1487x1058` for both S4 workbenches and at `1280x800`, `1440x900`, `1920x1080`, and `390x844` for S5. All viewports had zero global horizontal overflow and exactly one polite live region.
- The 390x844 round trip retained Day 2, the selected place, and list scroll position `296`; the original trip title remained unchanged before JSON confirmation.

**Deviation / Surprise**

- The first browser reload still used the pre-change runtime allowlist. Restarting the registered 5173 preview service loaded the new explicitly approved module.
- The first mobile reveal implementation reused `selectDay`, which cleared the selected target. Browser evidence exposed the mismatch; reveal now refreshes visible markers and refits without changing selection.
- The transient JSON file input was not attached to the DOM, preventing the browser chooser flow from addressing it. It is now temporarily attached, hidden, and removed on change or cancel.

**Verification Command**

```powershell
npm run check
npm test
npm run test:guide-import
git diff --check
# In-app browser: 1487x1058, 1280x800, 1440x900, 1920x1080, 390x844
```

**Residual Risk**

- The fixed-port Playwright runner was updated but not executed in this pass; browser-equivalent S4-S5 core paths were exercised directly.
- S6 candidate binding, CI/LIVE/container/rollback evidence, named human review, release authorization, deployment and publication remain outside this batch. Release remains `HOLD`.

### 2026-09-01 - Implement and verify S1-S3

**Expected Observation**

- Three-trip navigation keeps AI import visible and silently restores each trip's last valid day.
- Place and route selection share one exclusive runtime target; candidate insertion previews on the map and mutates only after confirmation.
- Guide import retains a continuous four-step paper flow, compares unmatched candidates in a right column, preserves notes, and requires an explicit unresolved decision.

**Actual Result**

- Implemented session-only per-trip day memory, semantic ordered trip tabs, active-tab reveal, persistent AI import, and one exclusive selected target.
- Implemented map-origin place selection, route/place visual exclusivity, temporary candidate marker/dashed anchor relation, compact confirmation sheet, and cancel cleanup.
- Implemented persistent preview steps/source summary, split repair layout, explicit keep-unmatched gate, sticky final actions, and unmatched-note preservation.
- `npm run check` passed; `npm test` passed with 17 files / 166 tests; the 12-case guide-import evaluation passed all thresholds; `git diff --check` passed.
- Browser checks at `1488x1058` confirmed the three-trip capacity boundary, Day 2 restoration, exclusive place/route selection, candidate cancel without mutation, continuous guide preview, source return, and explicit unmatched-decision unlock. Both inspected browser tabs had zero console errors.
- Same-viewport source/implementation comparisons passed in `design-qa.md` after two P2 visual corrections.

**Deviation / Surprise**

- The first candidate implementation kept the entire search dialog visible; it was reduced to the confirmed map paper sheet.
- The first guide comparison hid final actions below the scroll fold; the action footer is now sticky.
- The configured DeepSeek credential returned an authentication error. UI verification used a deterministic local browser response; no release or credentialed LIVE claim was made.

**Verification Command**

```powershell
npm run check
npm test
npm run test:guide-import
git diff --check
# Browser evidence:
# output/design-preview/implementation-s1-tabs.png
# output/design-preview/implementation-s2-confirmation.png
# output/design-preview/implementation-s3-guide-compare.png
```

**Residual Risk**

- Credentialed DeepSeek LIVE and the fixed-port Playwright runner were not used in this pass. Release remains HOLD; S4-S6 remain outside this implementation batch.

### 2026-09-01 - Confirm S6.2-B and close the visual question phase

**Expected Observation**

- Selecting Q19 option 2 should confirm `S6.2-B`, complete all twelve small-package visual decisions, and move `L3` to implementation-ready without changing product code or treating any release gate as passed.

**Actual Result**

- Bound the user's `2` response to the second displayed Q19 result: `S6.2-B / blocker-first closure desk`.
- Updated the task package and blackboard so all twelve selected small-package directions are recorded, the visual question phase is closed, and the implementation queue is ordered from `S1-S3` through `S4-S5` to `S6`.
- Kept real LIVE execution, candidate freezing, push, deployment, publication and all 3D surfaces out of scope. Product code remains unchanged.

**Deviation / Surprise**

- None. The selected result maps unambiguously to the second displayed Q19 image and remains a maintainer-only target, not release evidence.

**Verification Commands**

```powershell
npx prettier --write work/2d-three-level-task-package.md work/codex-blackboard.md work/codex-verification-log.md
npm run check
npx prettier --check work/2d-three-level-task-package.md work/codex-blackboard.md work/codex-verification-log.md
git diff --check
git status --short --branch
```

**Residual Risk**

- No selected package is implemented yet. Real release remains `HOLD` until exact-candidate evidence, separate AMap/DeepSeek LIVE results, container health/readiness, named four-viewport review, tested rollback identity and explicit authorization all close.

### 2026-09-01 - Confirm S6.1-B and open final release-closure review

**Expected Observation**

- Selecting Q18 option 2 should confirm only `S6.1-B`, then open final small package `S6.2` while product implementation and any real release action remain blocked.
- Q19 should compare only three maintainer-facing release-closure models for one frozen 2D candidate; all previews should remain fail-closed and must not imply credentials, gates, deployment, rollback or authorization actually exist.

**Actual Result**

- Bound the user's `2` response to the latest Q18 preview: `S6.1-B / layered loose-leaf review binder`.
- Inspected the active release surfaces: Node `22.22.1` default CI is current, the manual LIVE workflow carries only AMap credentials, Docker defines `/healthz` but the release contract also requires `/readyz`, and the stale playbook still declares Node 18 plus 3D steps.
- Generated three independent Q19 previews with the implemented homepage, confirmed `M6-A` packet and selected `S6.1-B` binder attached; copied them to `output/design-preview/`, verified dimensions and SHA-256 hashes, and left product code unchanged.

**Deviation / Surprise**

- Generated labels, statuses, counts, hashes, times, people, branches and rollback targets are illustrative. The current worktree is not a frozen clean release candidate.
- The third preview rendered an illustrative `git checkout` sequence and the second rendered an illustrative region/rollback value; neither is an approved operational command or current deployment fact.

**Verification Commands**

```powershell
Get-FileHash output/design-preview/q19-option-*.png -Algorithm SHA256
npx prettier --write work/2d-three-level-task-package.md work/codex-blackboard.md work/codex-verification-log.md
npm run check
npx prettier --check work/2d-three-level-task-package.md work/codex-blackboard.md work/codex-verification-log.md
git diff --check
git status --short --branch
```

**Residual Risk**

- `S6.2` still needs user selection and later implementation/testing for candidate freezing, clean-scope identity, real Node 22 CI provenance, separate DeepSeek LIVE workflow ownership, container build/health/readiness evidence, named four-viewport review, tested rollback identity, role-separated authorization invalidation and final `HOLD / RELEASE` derivation. Release remains blocked.

### 2026-09-01 - Confirm S5.2-B and open candidate-bound evidence review

**Expected Observation**

- Selecting Q17 option 2 should confirm only `S5.2-B`, then open `S6.1` while `S6.2` and product implementation remain blocked.
- Q18 should compare only three maintainer-facing views of one exact-commit, seven-layer, fail-closed 2D evidence source; it must not run gates, imply release, or add a test center to the user homepage.

**Actual Result**

- Bound the user's `2` response to the latest Q17 preview: `S5.2-B / unified top status band`.
- Inspected the active release surfaces: local evidence currently comes from Node 24, the candidate has no current Node `22.22.1` CI result, credentialed AMap and DeepSeek LIVE evidence is absent, Docker build evidence is missing, and human review plus release authorization remain open.
- Generated three independent Q18 previews with the implemented homepage and confirmed evidence/confirmation references attached, copied them to `output/design-preview/`, verified dimensions and SHA-256 hashes, and left product code unchanged.

**Deviation / Surprise**

- The second preview includes illustrative run identifiers and timestamps beside blocked rows. Those values are generated content, not proof that a gate ran.
- All statuses, file names, hashes, people and signatures shown in the previews are illustrative; only the copied image files and their recorded hashes are current evidence.

**Verification Commands**

```powershell
Get-FileHash output/design-preview/q18-option-*.png -Algorithm SHA256
npx prettier --write work/2d-three-level-task-package.md work/codex-blackboard.md work/codex-verification-log.md
npm run check
npx prettier --check work/2d-three-level-task-package.md work/codex-blackboard.md work/codex-verification-log.md
git diff --check
git status --short --branch
```

**Residual Risk**

- `S6.1` still needs user selection and later implementation/testing for schema correctness, candidate cleanliness, evidence provenance, stale/mismatched evidence rejection, separate AMap/DeepSeek LIVE ownership, named human ACK, and read-only packet generation. Release remains blocked.

### 2026-09-01 - Confirm S5.1-A and open the S5.2 accessibility-state review

**Expected Observation**

- Selecting Q16 option 1 should confirm only `S5.1-A`, then open `S5.2` while `S6.1-S6.2` and product implementation remain blocked.
- Q17 should compare only visible nonmodal feedback placement while preserving semantic controls, focus/selection distinction, modal isolation, reduced motion, touch targets, four viewport gates and 2D-only boundaries.

**Actual Result**

- Bound the user's `1` response to the latest Q16 preview: `S5.1-A / persistent top itinerary-map tabs`.
- Inspected active accessibility infrastructure: semantic mobile tabs, a polite atomic status region, visible card focus outlines, modal Tab trapping/background isolation/Escape close/trigger restoration, and a global reduced-motion rule.
- Generated three independent Q17 previews with the implemented homepage and confirmed `S5.1-A / S2.1-A` references attached, copied them to `output/design-preview/`, verified dimensions and SHA-256 hashes, and left product code unchanged.

**Deviation / Surprise**

- All three generated previews are `853x1844` at the requested `390x844` portrait ratio rather than literal viewport pixels.
- The third image contains a device-style black home indicator despite the prompt exclusion. It is recorded as a generation artifact and is not part of the candidate contract.
- Visible focus rings, status placement and touch sizing are illustrative; images cannot prove semantic or assistive-technology behavior.

**Verification Commands**

```powershell
Get-FileHash output/design-preview/q17-option-*.png -Algorithm SHA256
npx prettier --write work/2d-three-level-task-package.md work/codex-blackboard.md work/codex-verification-log.md
npm run check
npx prettier --check work/2d-three-level-task-package.md work/codex-blackboard.md work/codex-verification-log.md
git diff --check
git status --short --branch
```

**Residual Risk**

- `S5.2` still needs user selection and later implementation/testing for accessible names and roles, repeated live-region messages, focus clipping/order, focus-versus-selection contrast, stacked-modal behavior, trigger restoration after rerender, reduced-motion coverage, 44px targets, zoom, and four-viewport overflow/visual acceptance.

### 2026-09-01 - Confirm S4.2-A and open the S5.1 responsive-view review

**Expected Observation**

- Selecting Q15 option 1 should confirm only `S4.2-A`, then open `S5.1` while `S5.2-S6.2` and product implementation remain blocked.
- Q16 should retain the desktop `35/65` shell and compare only explicit small-screen itinerary/map switch placement while preserving trip, day, selection and 2D-only boundaries.

**Actual Result**

- Bound the user's `1` response to the latest Q15 preview: `S4.2-A / linear validation confirmation`.
- Inspected the active responsive shell: mobile defaults to the itinerary, uses semantic “行程 / 地图” tabs and one visible panel, and resizes/refits the map on reveal; desktop hides the switch and retains the `35/65` split.
- Generated three independent Q16 previews with the implemented homepage and confirmed `M5-A / S2.1-A` references attached, copied them to `output/design-preview/`, verified dimensions and SHA-256 hashes, and left product code unchanged.

**Deviation / Surprise**

- The generator returned `853x1844`, `853x1844`, and `852x1846` images at the requested `390x844` portrait ratio rather than literal viewport pixels.
- The map geography, itinerary data, focus appearance and rendered touch sizes are illustrative; the bottom-paper direction is a scoped two-view control, not approval for a mobile application navigation bar.

**Verification Commands**

```powershell
Get-FileHash output/design-preview/q16-option-*.png -Algorithm SHA256
npx prettier --write work/2d-three-level-task-package.md work/codex-blackboard.md work/codex-verification-log.md
npm run check
npx prettier --check work/2d-three-level-task-package.md work/codex-blackboard.md work/codex-verification-log.md
git diff --check
git status --short --branch
```

**Residual Risk**

- `S5.1` still needs user selection and later implementation/testing for exact `390x844` layout, visibility and `aria-selected`, keyboard order, 44px touch targets, scroll restoration, map resize/fit timing, selected-target retention, bottom safe-area clearance and horizontal overflow.

### 2026-09-01 - Confirm S4.1-A and open the S4.2 workspace-import review

**Expected Observation**

- Selecting Q14 option 1 should confirm only `S4.1-A`, then open `S4.2` while `S5.1-S6.2` and product implementation remain blocked.
- Q15 should preserve the existing JSON validation, whole-workspace replacement, recovery-snapshot-first, and no-write-on-failure boundaries while making import scope understandable in the map-area workbench.

**Actual Result**

- Bound the user's `1` response to the latest Q14 preview: `S4.1-A / live-regeneration configuration rail`.
- Inspected the active import path: export wraps format, format version, Schema, timestamp and workspace; import reads and validates the file before confirmation; an existing workspace must be snapshotted successfully before the imported workspace is saved and initialized.
- Generated three independent Q15 previews with the implemented homepage and confirmed `M4-C / S4.1-A` references attached, copied them to `output/design-preview/`, verified dimensions and SHA-256 hashes, and left product code unchanged.

**Deviation / Surprise**

- The generated images are `1487x1058` at the requested desktop aspect rather than literal `1440x1024` pixels.
- Route titles, counts, dates, metadata and preview summaries are illustrative and do not establish runtime import correctness.

**Verification Commands**

```powershell
Get-FileHash output/design-preview/q15-option-*.png -Algorithm SHA256
npx prettier --write work/2d-three-level-task-package.md work/codex-blackboard.md work/codex-verification-log.md
npm run check
npx prettier --check work/2d-three-level-task-package.md work/codex-blackboard.md work/codex-verification-log.md
git diff --check
git status --short --branch
```

**Residual Risk**

- `S4.2` still needs user selection and later implementation/testing for file-reader errors, invalid or oversized structures, legacy Schema handling, snapshot/persistence failures, exact replacement scope, double confirmation, runtime reinitialization, 2D map synchronization and recovery evidence.

### 2026-09-01 - Confirm S3.2-B and open the S4.1 long-image review

**Expected Observation**

- Selecting Q13 option 2 should confirm only `S3.2-B`, then open `S4.1` while later packages and product implementation remain blocked.
- Q14 should vary only the configuration and Canvas regeneration rhythm while preserving the three existing content options, last successful preview, map-area workbench and 2D-only boundary.

**Actual Result**

- Bound the user's `2` response and subsequent confirmation to `S3.2-B / split candidate comparison`.
- Confirmed the current share flow has notes checked by default, routes/transport and unscheduled places unchecked, automatic regeneration after every option change, a loading overlay, disabled controls during generation, and copy/download actions for the successful PNG.
- Generated and copied three Q14 previews, verified dimensions and SHA-256 hashes, and left product code unchanged.

**Deviation / Surprise**

- The first Q14 option-2 generation cell disappeared without producing a file; one fresh generation completed successfully.
- The option-2 image rendered an illustrative `2026-08-30` timestamp despite the `2026-09-01` prompt anchor. Generated timestamps are not product requirements or runtime evidence.

**Verification Commands**

```powershell
Get-FileHash output/design-preview/q14-option-*.png -Algorithm SHA256
npx prettier --write work/2d-three-level-task-package.md work/codex-blackboard.md work/codex-verification-log.md
npm run check
npx prettier --check work/2d-three-level-task-package.md work/codex-blackboard.md work/codex-verification-log.md
git diff --check
git status --short --branch
```

**Residual Risk**

- The selected `S4.1-A` still requires later implementation/testing for generation races, stale-result suppression, option normalization, Canvas failure, preview preservation, clipboard permissions, download output and same-viewport visual comparison.

### 2026-08-31 - Confirm S3.1-A and open the S3.2 candidate-repair review

**Expected Observation**

- Selecting Q12 option 1 should confirm only `S3.1-A`, then open `S3.2` while later packages and product implementation remain blocked.
- Q13 should preserve draft isolation and final-create boundaries while making unmatched-place search, binding, and deliberate unresolved import understandable.

**Actual Result**

- Bound the user's `1` response to the latest Q12 preview: `S3.1-A / continuous paper steps`.
- Confirmed the current preview supports title, note, day, time and delete edits; unmatched items search up to eight city-scoped places and selecting a result marks only the draft item matched. The final action currently remains available with unmatched items, which are created with no coordinates.
- Generated three independent Q13 previews with the current homepage and confirmed import/confirmation references attached, copied them to `output/design-preview/`, verified dimensions and SHA-256 hashes, and left product code unchanged.

**Residual Risk**

- `S3.2` still needs user selection and later implementation/testing for async search races, result selection, draft-only mutation, unresolved-item semantics, focus restoration, single-trip creation, rollback after partial failure, and real provider behavior.

### 2026-08-31 - Confirm S2.2-C and open the S3.1 guide-import transition review

**Expected Observation**

- Selecting Q11 option 3 should confirm only `S2.2-C`, then open `S3.1` while later packages and product implementation remain blocked.
- Q12 must preserve existing guide-import boundaries: valid Chinese source text produces a draft first, the user can return to input, and only final import writes a new trip.

**Actual Result**

- Bound the user's `3` response to the latest Q11 preview: `S2.2-C / paper confirmation sheet`.
- Inspected active guide import: `50-5000` Chinese characters, a four-stage progress track, successful parse opening an editable per-day draft, and final `导入为新行程` as the only write action.
- Generated, copied, and hashed three Q12 desktop previews; product code remains unchanged.

**Residual Risk**

- `S3.1` still needs user selection and later implementation/testing for abort/error recovery, source restoration, progress timing, draft isolation, keyboard focus, and final import atomicity.

### 2026-08-31 - Confirm S2.1-A and open the S2.2 candidate-preview review

**Expected Observation**

- Selecting Q10 option 1 should confirm only `S2.1-A`, then open `S2.2` while later small packages and product implementation remain blocked.
- Q11 should preserve the current search and insertion contract: a candidate may preview on the map, but only explicit confirmation may create one post-anchor event; cancellation or failure must leave the itinerary unchanged.

**Actual Result**

- Bound the user's `1` response to the latest displayed Q10 option 1: `S2.1-A / exclusive single focus`.
- Inspected the active 2D flow: the search modal supports keyword and `5km` nearby search with up to four results, then title/icon/time/note input; `afterEventId` already resolves the selected event, same-day selection, or day tail, while no map candidate preview exists before `onConfirm` writes.
- Generated three independent Q11 previews, copied them to `output/design-preview/`, verified `1487x1058` dimensions and SHA-256 hashes, and left product code unchanged.

**Deviation / Surprise**

- Image generation returned an invalid display payload after rendering the third option; the generated file was present, then inspected and copied without regenerating it. The generated dimensions differ from the prompt's nominal desktop target.

**Verification Commands**

```powershell
Get-FileHash output/design-preview/q11-option-*.png -Algorithm SHA256
npx prettier --write work/2d-three-level-task-package.md work/codex-blackboard.md work/codex-verification-log.md
npm run check
npx prettier --check work/2d-three-level-task-package.md work/codex-blackboard.md work/codex-verification-log.md
git diff --check
git status --short --branch
```

**Residual Risk**

- `S2.2` still requires user selection and, after all small-layer confirmations, implementation plus tests for transient candidate lifecycle, asynchronous search cancellation, map-marker cleanup, explicit confirmation atomicity, `afterEventId` ordering, and same-viewport visual comparison. LIVE providers, Docker, human acceptance, publish authority, and release remain separate gates.

### 2026-08-31 - Confirm S1.2-A and open the S2.1 unified-selection review

**Expected Observation**

- Selecting Q9 option 1 should confirm only `S1.2-A`, then open `S2.1` while `S2.2-S6.2` and product implementation remain blocked.
- Q10 should refine only the shared selection relationship between itinerary places/routes and the 2D map, preserving the current homepage art, `35/65` layout, confirmed tabs/date behavior, and one active target.
- The design should not pull `S2.2` detail, search, insertion, multi-select, persisted browsing state, or 3D back into scope.

**Actual Result**

- Bound the user's `1` response to the latest displayed Q9 option 1: `S1.2-A / current-session per-trip silent day restoration`.
- Inspected the active 2D implementation and confirmed selection ownership is currently split: event cards add DOM `.active` and write `selectedEventRef`, marker clicks only open the info window, and route clicks update map highlight state without a stable selected route-card appearance.
- Defined Q10 as a choice between an exclusive single-focus model, a route-and-endpoints compound context, and a unified selection model with one slim explicit status strip. All variants keep one primary target and clear invalid selection on trip/day/target changes.
- Generated three independent Q10 previews with the implemented homepage and relevant confirmed visual targets attached, copied them to `output/design-preview/`, verified copy hashes and dimensions, and left product code unchanged.

**Deviation / Surprise**

- All three generated previews are `1487x1058` at the requested `1440x1024` desktop aspect rather than literal target pixels.
- Static previews cannot prove the shared runtime selection contract, duplicate-location resolution, map-polyline hit behavior, list auto-reveal, keyboard semantics, or invalid-target cleanup.

**Verification**

```text
Get-FileHash output/design-preview/q10-option-*.png -Algorithm SHA256
npx prettier --write work/2d-three-level-task-package.md work/codex-blackboard.md work/codex-verification-log.md
npm run check
npx prettier --check work/2d-three-level-task-package.md work/codex-blackboard.md work/codex-verification-log.md
git diff --check
git status --short --branch
```

**Residual Risk**

- `S2.1` still needs a user selection and, after all small-layer confirmations, implementation plus tests for list/marker and route/polyline symmetry, mutual exclusion, repeated location references, map-origin list reveal, selection clearing, keyboard behavior, and same-viewport visual comparison. LIVE providers, Docker, human acceptance, publish authority, and release remain separate gates.

### 2026-08-31 - Confirm S1.1-A and open the S1.2 date-context review

**Expected Observation**

- Selecting Q8 option 1 should confirm only `S1.1-A`, then open `S1.2` while all later small packages and product implementation remain blocked.
- Q9 should refine only the date context after switching trips, preserving ordered trip tabs, the current homepage art, list/map date synchronization, and the 2D-only boundary.
- The design should not invent durable UI-state persistence, restore a stale place selection, or widen scope into map-camera and scroll-position restoration.

**Actual Result**

- Bound the user's `1` response to the latest displayed Q8 option 1: `S1.1-A / ordered loose-leaf tabs with active auto-reveal`.
- Inspected the current implementation and confirmed that `activeDayId` is one global application value, `handleTripReplaced()` always selects `全部日期`, date switching resets the itinerary scroll position, and there is no per-trip date memory.
- Defined Q9 as a current-session-only choice between silent per-trip day restoration, restoration with a light status notice, and an all-dates-first model with an explicit continue action. All variants clear the previous trip's specific place/route selection and fall back to all dates if the remembered day no longer exists.
- Generated three independent Q9 previews with the implemented homepage and selected visual targets attached, copied them to `output/design-preview/`, and left product code unchanged.

**Deviation / Surprise**

- The generator returned two `1487x1058` images and one `1499x1049` image at the requested `1440x1024` desktop target instead of literal dimensions.
- Static previews cannot prove session ownership, stale-day fallback, semantic selected states, status timing/announcement, route cancellation, or real map synchronization.

**Verification**

```text
Get-FileHash output/design-preview/q9-option-*.png -Algorithm SHA256
npx prettier --write work/2d-three-level-task-package.md work/codex-blackboard.md work/codex-verification-log.md
npm run check
npx prettier --check work/2d-three-level-task-package.md work/codex-blackboard.md work/codex-verification-log.md
git diff --check
git status --short --branch
```

**Residual Risk**

- `S1.2` still needs a user selection and, after all small-layer confirmations, implementation plus tests for two-trip switching, invalid/deleted days, selection clearing, keyboard behavior, list/map synchronization, and same-viewport visual comparison. Later small packages and release gates remain blocked.

### 2026-08-31 - Confirm M6-A and open the S1.1 trip-tab review

**Expected Observation**

- Selecting Q7 option 1 should confirm `M6-A`, close all six medium packages, and open only the first small package for visual review.
- The small-layer catalog should preserve the confirmed medium boundaries and keep product implementation, commit, push, deployment, and release blocked.
- Q8 should refine trip-tab visibility and positioning without speculatively increasing current workspace capacity or changing the homepage art and 2D-only boundary.

**Actual Result**

- Bound the user's `1` response to the latest displayed Q7 option 1: `M6-A / layered evidence review packet`; marked `L2` confirmed.
- Created a twelve-package small-layer queue covering navigation, map selection/insertion, guide import, share/data recovery, viewport/accessibility, and release evidence. Only `S1.1` entered `IN_REVIEW`.
- Inspected the current implementation and found `MAX_TRIPS = 3`, an already scrollable loose-leaf track, a conditional `+` entry, a terminal `AI 导入` entry, and no separate trip locator. Q8 therefore keeps the three-trip cap and compares only ordered auto-reveal, a pinned active tab with an other-trips menu, and equal-width tabs.
- Generated three independent Q8 previews with the implemented homepage and selected visual targets attached, copied them to `output/design-preview/`, and left product code unchanged.

**Deviation / Surprise**

- The generator returned two `1487x1058` images and one `1488x1057` image at the requested `1440x1024` aspect instead of literal target pixels.
- Generated close glyphs, example titles, menu metadata, dates, and map details are illustrative. They do not authorize a new quick-delete action, a higher trip limit, or changes outside `S1.1`.

**Verification**

```text
Get-FileHash output/design-preview/q8-option-*.png -Algorithm SHA256
npx prettier --write work/2d-three-level-task-package.md work/codex-blackboard.md work/codex-verification-log.md
npm run check
npx prettier --check work/2d-three-level-task-package.md work/codex-blackboard.md work/codex-verification-log.md
git diff --check
git status --short --branch
```

**Residual Risk**

- `S1.1` still needs a user selection, implementation-task readiness review, unit/E2E coverage for three long titles and keyboard access, and same-viewport comparison. Later small packages, Node 22 CI, credentialed LIVE providers, Docker, human visual acceptance, publish authority, and release remain separate blocked gates.

### 2026-08-31 - Confirm M5-A and open the M6 release-evidence review

**Expected Observation**

- Selecting Q6 option 1 should confirm only `M5-A`, then open the final medium package `M6` for review.
- Product implementation, small packages, commit, push, deployment, and release should remain blocked.
- Q7 should vary only release-evidence organization while fixing the confirmed product, current homepage art, 2D-only boundary, fail-closed statuses, and separation between local, CI, LIVE, container, human, and authorization evidence.

**Actual Result**

- Bound the user's `1` response to the latest displayed Q6 option 1: `M5-A / list-first explicit itinerary-map switching`.
- Verified the live repository uses Node `22.22.1` in default and manual live-provider CI, while the current local runtime is Node `24.15.0` and the four AMap/DeepSeek credential variables are absent.
- Confirmed the default CI runs active 2D checks, audit, unit tests, guide evaluation, and default E2E; the current LIVE smoke proves AMap readiness/geocoding only, so DeepSeek requires its own credentialed release evidence when enabled.
- Found the current release playbook still names Node 18, 3D entry, archived endpoints, and 3D metrics; it cannot serve as the final 2D release contract without a scoped correction.
- Generated three independent Q7 previews: a layered evidence packet, a sequential promotion runbook, and an exception-first closure desk. Copied all previews to `output/design-preview/`, recorded dimensions and SHA-256 values, and left product code unchanged.

**Deviation / Surprise**

- The generator returned `1487x1058` images at the requested `1440x1024` aspect instead of literal pixels.
- Generated commit IDs, timestamps, Node patch text, status counts, and PASS/BLOCKED rows are visual mock data. They do not prove that the current dirty working tree or a future implementation candidate passed those gates.
- The current branch has no configured upstream; historical CI or another branch's result cannot close the candidate-commit gate.

**Verification**

```text
Get-FileHash output/design-preview/q7-option-*.png -Algorithm SHA256
npx prettier --write work/2d-three-level-task-package.md work/codex-blackboard.md work/codex-verification-log.md
npm run check
npx prettier --check work/2d-three-level-task-package.md work/codex-blackboard.md work/codex-verification-log.md
git diff --check
git status --short --branch
```

**Residual Risk**

- The selected `M6` direction will still require small-task decomposition and implementation of a candidate-bound evidence schema/report, a corrected 2D release contract, separate DeepSeek LIVE evidence when the feature is enabled, actual Node 22 CI, container build/start probes, same-viewport human review, rollback proof, and explicit publish authority.

### 2026-08-31 - Confirm M4-C and open the M5 accessibility/viewport review

**Expected Observation**

- Selecting Q5 option 3 should confirm only `M4-C`, then open `M5` for review.
- `M6`, all small implementation packages, and product-code changes should remain blocked.
- Q6 should vary only the `390x844` itinerary/map viewing model while fixing the desktop `35/65` shell, current homepage art, confirmed `L1-A / M1-A / M2-B / M3-A / M4-C`, 2D-only boundary, and accessibility invariants.

**Actual Result**

- Bound the user's `3` response to the latest displayed Q5 option 3: `M4-C / map-area output preview workbench`.
- Inspected the existing explicit mobile itinerary/map tabs, semantic selected state, live status, modal focus/background isolation, visible focus styling, reduced-motion rule, mobile smoke test, and desktop visual guide before defining `M5`.
- Generated three independent Q6 previews: list-first explicit view switching, map-first compact itinerary sheet, and a stacked map/itinerary overview.
- Copied the previews to `output/design-preview/`, recorded their actual dimensions and SHA-256 values in the control package, and left product code unchanged.

**Deviation / Surprise**

- The generator returned `852x1846` and `853x1844` images at the requested `390x844` portrait ratio instead of literal target pixels.
- The first attempt at the stacked preview failed with a transient image-generation network error; one built-in retry with fewer, still relevant references succeeded. No CLI/API fallback was used.
- Generated focus rings, status text, touch sizes, labels, map geography, and itinerary data are illustrative and do not establish accessibility or runtime behavior.

**Verification**

```text
Get-FileHash output/design-preview/q6-option-*.png -Algorithm SHA256
npx prettier --write work/2d-three-level-task-package.md work/codex-blackboard.md work/codex-verification-log.md
npm run check
npx prettier --check work/2d-three-level-task-package.md work/codex-blackboard.md work/codex-verification-log.md
git diff --check
git status --short --branch
```

**Residual Risk**

- The selected `M5` direction will still require small-task decomposition, implementation, same-viewport comparison, semantic/keyboard/screen-reader checks, modal and live-region regression, reduced-motion coverage, touch-target measurement, and real-browser screenshots at `1280x800 / 1440x900 / 1920x1080 / 390x844`.

### 2026-08-30 - Confirm M3-A and open the M4 share/data review

**Expected Observation**

- Selecting Q4 option 1 should confirm only `M3-A`, then open `M4` for review.
- `M5-M6`, small implementation packages, and product-code changes should remain blocked.
- Q5 should vary only share/data-tool organization while fixing the implemented homepage, `L1-A`, `M1-A`, `M2-B`, `M3-A`, current Canvas/JSON behavior, and the 2D-only boundary.

**Actual Result**

- Bound the user's `1` response to the latest displayed Q4 option 1: `M3-A / linear two-stage paper-modal guide review`.
- Generated three independent Q5 previews: context-separated compact share modal, unified share/workspace-data center, and map-area output preview workbench.
- Copied the previews to `output/design-preview/`, recorded their SHA-256 values in the control package, and left product code unchanged.

**Deviation / Surprise**

- The generator returned `1487x1058` files at the requested desktop aspect rather than literal `1440x1024` pixels.
- Poster content, filenames, trip counts, addresses, and map geography are illustrative; no new cloud, merge, or file-format capability is implied.

**Verification**

```text
Get-FileHash output/design-preview/q5-option-*.png -Algorithm SHA256
npx prettier --write work/2d-three-level-task-package.md work/codex-blackboard.md work/codex-verification-log.md
npm run check
npx prettier --check work/2d-three-level-task-package.md work/codex-blackboard.md work/codex-verification-log.md
git diff --check
git status --short --branch
```

**Residual Risk**

- The selected `M4` direction will still require small-task decomposition after all medium packages are confirmed, implementation, same-viewport comparison, real Canvas regeneration/download/clipboard tests, and replacement-import/recovery-snapshot regression coverage.

### 2026-08-30 - Confirm M2-B and open the M3 guide-import review

**Expected Observation**

- Selecting Q3 option 2 should confirm only `M2-B`, then open `M3` for review.
- `M4-M6`, small implementation packages, and product-code changes should remain blocked.
- Q4 should vary only the guide-review hierarchy while fixing the implemented homepage, `L1-A`, `M1-A`, `M2-B`, current guide-import capability, and the 2D-only boundary.

**Actual Result**

- Bound the user's `2` response to the latest displayed Q3 option 2: `M2-B / bidirectional itinerary-map selection with a compact detail bar`.
- Generated three independent Q4 previews: a linear two-stage paper modal, a map-linked review workspace, and an exception-first match-repair queue.
- Copied the previews to `output/design-preview/`, recorded their SHA-256 values in the control package, and left product code unchanged.

**Deviation / Surprise**

- The generator returned `1487x1058` files at the requested desktop aspect rather than literal `1440x1024` pixels.
- Preview POI candidates, addresses, map geography, and itinerary data are illustrative; no numeric AI confidence or new backend capability is implied.

**Verification**

```text
Get-FileHash output/design-preview/q4-option-*.png -Algorithm SHA256
npx prettier --write work/2d-three-level-task-package.md work/codex-blackboard.md work/codex-verification-log.md
npm run check
npx prettier --check work/2d-three-level-task-package.md work/codex-blackboard.md work/codex-verification-log.md
git diff --check
git status --short --branch
```

**Residual Risk**

- The selected `M3` direction will still require small-task decomposition after all medium packages are confirmed, implementation, state/keyboard regression tests, same-viewport visual comparison, and credentialed DeepSeek/AMap LIVE verification.

### 2026-08-30 - Confirm M1-A and open the M2 interaction review

**Expected Observation**

- Selecting Q2 option 1 should confirm only `M1-A`, then open `M2` for review.
- `M3-M6`, small implementation packages, and product-code changes should remain blocked.
- Q3 should vary only the timeline/map interaction while fixing the implemented homepage, confirmed `L1-A`, confirmed `M1-A`, and the 2D-only boundary.

**Actual Result**

- Bound the user's `1` response to the latest displayed Q2 option 1: `M1-A / dual loose-leaf trip tabs and visible day tabs`.
- Generated three independent Q3 previews: list-driven map following, full bidirectional selection with a compact detail bar, and map-first insertion with an explicit confirmation preview.
- Copied the previews to `output/design-preview/`, recorded their SHA-256 values in the control package, and left product code unchanged.

**Deviation / Surprise**

- The generator returned `1487x1058` files at the requested desktop aspect rather than literal `1440x1024` pixels.
- Map labels, geography, and example itinerary data are illustrative; only the `M2` interaction contract is under review.

**Verification**

```text
Get-FileHash output/design-preview/q3-option-*.png -Algorithm SHA256
npx prettier --write work/2d-three-level-task-package.md work/codex-blackboard.md work/codex-verification-log.md
npm run check
npx prettier --check work/2d-three-level-task-package.md work/codex-blackboard.md work/codex-verification-log.md
git diff --check
git status --short --branch
```

**Residual Risk**

- The selected `M2` direction will still require small-task decomposition after all medium packages are confirmed, implementation, interaction/state regression tests, and same-viewport visual comparison.

### 2026-08-30 - Confirm L1-A and open the M1 navigation review

**Expected Observation**

- Selecting Q1 option 1 should confirm only the homepage map-led large-layer direction.
- Only `M1` should enter review; `M2-M6` and product implementation should remain blocked.
- Q2 should compare navigation interactions while keeping both the implemented homepage art direction and selected Q1 shell fixed.

**Actual Result**

- Bound the user's `1` response to the latest displayed set: `Q1-v2 / L1-A / homepage map-led`, then marked `L1` confirmed.
- Opened `M1` for review and kept all later medium packages blocked.
- Generated three independent Q2 previews with both the implemented homepage and selected Q1 image attached: visible dual tabs, compact day stepper, and collapsible day index.
- Copied all Q2 previews to `output/design-preview/`, recorded SHA-256 values in the control package, and left product code unchanged.

**Deviation / Surprise**

- The generator again returned `1487x1058` files at the requested desktop aspect rather than literal `1440x1024` pixels.
- Map labels and example itinerary data are illustrative; only the navigation hierarchy is under review.

**Verification Command**

```powershell
Get-FileHash -Algorithm SHA256 output/design-preview/q2-option-*.png
npx prettier --check work/2d-three-level-task-package.md work/codex-blackboard.md work/codex-verification-log.md
npm run check
git diff --check
git status --short --branch
```

**Residual Risk**

- The selected M1 image still requires small-task decomposition, implementation, keyboard/state regression tests, and same-viewport visual comparison.

### 2026-08-30 - Regenerate Q1 from the implemented homepage art direction

**Expected Observation**

- The revised concepts should treat the implemented homepage as a strict visual blueprint rather than introduce a new design system.
- All three images should retain the current loose-leaf tabs, warm paper palette, compact timeline language, and 2D-only boundary.
- The earlier Q1 images should remain traceable but no longer be selectable as the current set.

**Actual Result**

- Generated three independent Q1-v2 previews with the current homepage screenshot attached to every generation.
- The visible order now maps to homepage map focus, homepage itinerary focus, and homepage AI-review modal. All three preserve the implemented shell and omit 3D UI or rendering.
- Copied the previews to versioned `output/design-preview/q1-v2-*.png` paths, recorded their SHA-256 values, and marked Q1-v1 as historical in the control package.
- No product implementation file changed.

**Deviation / Surprise**

- The generator returned `1487x1058` files at the requested desktop aspect instead of literal `1440x1024` pixels.
- Map labels and geography remain illustrative even though the shell styling is grounded in the implemented homepage.

**Verification Command**

```powershell
Get-FileHash -Algorithm SHA256 output/design-preview/q1-v2-*.png
npx prettier --check work/2d-three-level-task-package.md work/codex-blackboard.md work/codex-verification-log.md
npm run check
git diff --check
git status --short --branch
```

**Residual Risk**

- The selected image will still require implementation and same-viewport visual comparison; generated text and map details are not acceptance evidence.

### 2026-08-30 - Establish three-level 2D design-control packages

**Expected Observation**

- The control document should keep large, medium, and small packages traceable and block child work until its parent is confirmed.
- Three independent Q1 previews should preserve the current 2D visual language and exclude every 3D surface.
- No product implementation file should change before the first visual choice.

**Actual Result**

- Added `work/2d-three-level-task-package.md` with package fields, a confirmation state machine, `L1-L3`, provisional `M1-M6`, and the evidence-bound Q1 mapping.
- Generated three independent desktop concepts from the current 2D screenshot: map-led, itinerary-led, and AI-import-review-led. Copied the previews under `output/design-preview/` and recorded SHA-256 values in the task package.
- All three concepts use a top-down 2D map and omit a 3D entry or rendering mode. Product code remains unchanged.

**Deviation / Surprise**

- The current-page baseline captured the layout and live loading state, but the provider map had not rendered during the capture. The generated maps are therefore target concepts grounded by current layout, tokens, content, and architecture rather than proof of current provider rendering.
- The generator returned `1487x1058` images at the requested desktop aspect instead of literal `1440x1024` pixels.

**Verification Command**

```powershell
git status --short --branch
Get-FileHash -Algorithm SHA256 output/design-preview/q1-option-*.png
npx prettier --check work/2d-three-level-task-package.md work/codex-blackboard.md work/codex-verification-log.md
npm run check
git diff -- work/2d-three-level-task-package.md work/codex-blackboard.md work/codex-verification-log.md
```

**Residual Risk**

- AI-generated UI text and map geography are illustrative. The selected concept still requires implementation, same-viewport visual QA, automated regression, and credentialed provider verification.

### 2026-08-30 - Close the active 2D branch

**Expected Observation**

- The flaky keyboard route test should distinguish event focus from route fitting without retries or product-code fallbacks.
- Node support, CI, live-provider workflow, README, and the active roadmap should match the 2D-only runtime.

**Actual Result**

- The AMap mock now computes the center of all fitted markers; the keyboard route test passed 10 concurrent repeats.
- Node and CI now target 22.22.1, CI runs the full 2D check and default Playwright suite, and the live-provider workflow only exposes its implemented AMap target.
- Remote `main@c568aa4` was reconciled locally. Its SQLite/BM25 guide-import RAG remains active and tested; its 3D code and tests remain outside the default runtime and gates.
- `npm run check`, 163 tests in 17 files, 12 guide-import evaluation cases, the zero-vulnerability audit, and the full 2D E2E suite passed. E2E executed 17 applicable cases and skipped 13 viewport-inapplicable instances.

**Deviation / Surprise**

- Docker reached the daemon but could not read Node 22 base-image metadata because the Docker Hub connection returned `unexpected EOF`; no source build step ran.
- Credentialed live-provider smoke could not run because the three required AMap variables are absent.
- The remote merge introduced an untagged 3D Playwright file; the default runner now selects the explicit active 2D smoke file, and the architecture gate enforces that selection.

**Verification Command**

```powershell
npx playwright test tests/e2e/smoke.spec.js --grep "desktop keyboard activates itinerary and route map links" --project=chromium --repeat-each=10 --reporter=line
npm run check
npm test
npm run test:guide-import
npm audit --audit-level=high
npm run test:e2e -- --reporter=line
docker build --tag travel-with-me:2d-closure .
```

**Residual Risk**

- Docker and credentialed AMap verification remain external gates.
- Local verification used Node 24.15.0; CI remains responsible for the exact Node 22.22.1 run.

### 2026-08-12 - Seal 3D and harden the 2D product

**Expected Observation**

- The active startup graph, UI, dependency manifest, default gates, and BFF expose no 3D runtime.
- Confirmed 2D data-loss, unbounded-import, persistence, cancellation, city, and async-ownership defects have regression coverage.

**Actual Result**

- Added a recursive 2D runtime boundary gate and browser boundary test; the server now serves 37 approved modules and rejects 63 inactive JavaScript files.
- Added a 46-file production assembly allowlist and multi-stage Docker runtime; default formatting, lint, renderer, encoding, unit, and E2E gates now use the active 2D manifests.
- Added regression coverage and fixes for shared-trip overwrite, semantic normalization deletion, localStorage recovery failures, invalid import/coordinate shapes, duplicate IDs, day caps, guide cancellation, city-aware geocoding, trip-owned async writes, stale search results, batched imports, keyboard cards, mobile live status, and stacked-modal focus isolation.
- `npm run check` passed; `npm test` passed with 12 files and 98 tests; default E2E passed with 17 executed and 13 viewport-inapplicable instances skipped.
- Browser review at 1440x900 and 390x844 found a nonblank 2D map/list, visible mobile status, correct modal focus restoration, no 3D DOM, and no console warnings/errors.
- `npm audit` passed with zero known vulnerabilities after updating Hono, the Node adapter, and four transitive development packages without running lifecycle scripts.

**Deviation / Surprise**

- The original bare-word `3D` exclusion also removed the new negative isolation test; explicit `@archived-3d` tagging now keeps the isolation test in the default suite.
- A new stacked-modal regression exposed focus falling back to `body` after the AI preview re-rendered; the top-modal keyboard guard and focus restoration were corrected before final verification.

**Verification Command**

```powershell
npm run check
npm test
npx playwright test tests/e2e/smoke.spec.js --grep "2D runtime does not load or expose archived 3D surfaces"
npx playwright test tests/e2e/smoke.spec.js --grep "loads the trip planner shell|mobile can switch|desktop can open share"
npm run test:e2e -- --reporter=line
npm audit --json
git diff --check
```

**Residual Risk**

- Live provider behavior was not exercised. Dockerfile behavior passed static and local assembly checks, but a real image build was blocked by a registry `unexpected EOF`.

### 2026-07-22 - Refresh Codex project summary

**Expected Observation**

- The blackboard reflects the current `main` checkout, the isolated feature-branch commit, latest verification results, and known runtime artifacts.
- No product code or untracked runtime output is modified.

**Actual Result**

- Updated `work/codex-blackboard.md` with current branch, commit, summary-bar behavior, tests, risks, and next queue.
- Current checkout remains `main` at `6f8bda3`; `data/` and `test-tmp-integration/` remain untracked and untouched.

**Deviation / Surprise**

- Full E2E smoke previously exposed one whitespace-sensitive assertion and Overpass network resets; the corrected targeted test passed.

**Verification Command**

```powershell
git status --short --branch
git log --oneline --decorate -2
Get-Content -Raw work/codex-blackboard.md
```

**Residual Risk**

- The feature-branch summary-bar change is not merged into `main`, and the generated runtime directories still need ownership review.

### 2026-06-24 - Enable Codex SAPIEN-Lite local workflow

**Expected Observation**

- `AGENTS.md` exists with a `Codex Workflow` section.
- `work/codex-blackboard.md`, `work/codex-verification-log.md`, and `work/codex-evaluation-harness.md` exist with their required structures.
- No global configuration, hooks, or long-term memory files are modified.

**Actual Result**

- All four files exist.
- Required sections were found with `Select-String`.
- `git status --short` shows only `AGENTS.md` and `work/` as new repository-local changes.

**Deviation / Surprise**

- None.

**Verification Command**

```powershell
Test-Path AGENTS.md
Test-Path work/codex-blackboard.md
Test-Path work/codex-verification-log.md
Test-Path work/codex-evaluation-harness.md
Select-String -Path AGENTS.md,work/codex-*.md -Pattern "Codex Workflow|Current Task Goal|Expected Observation|Task Category"
git status --short
```

**Residual Risk**

- The workflow only helps if future tasks actively keep the blackboard and verification log current.
