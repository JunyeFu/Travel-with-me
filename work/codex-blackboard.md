# Codex Blackboard

## Current Task Goal

Complete R1–R6 route-trust repairs after official AMap / W3C / Node research. Final evidence is in `docs/engineering/route-trust-repair-2026-10-02.md`: 197 unit tests, 27 browser passes / 15 platform skips, real Hangzhou driving/transit and semantic DeepSeek fixture passed. Preserve existing work, credentials, sealed 3D and the unstarted Kotlin migration.

## Constraints

- Do not modify global Codex configuration or install hooks.
- Preserve untracked `data/` and `test-tmp-integration/` until ownership is known.
- Keep archived 3D source available for history, but never reconnect it to the 2D entry point, default tests, dependencies, UI, or BFF routes.
- Verify every product change with automated evidence.
- Keep child packages blocked until their parent visual direction is explicitly confirmed.
- Visual confirmation decisions below remain constraints; the user has authorized this repair implementation.
- Add defensive behavior only for demonstrated requirements, failures, invariants, security boundaries, or material irreversible risks.

## Known Evidence

- Active branch: `feature/kotlin-migration-samples`. Older counts and stage PASS entries below are historical; use the 2026-10-02 conformance review for current verification.
- `scripts/check-2d-runtime-boundary.mjs` recursively scans the active `js/main.js` import graph and checks HTML, CSS, package, server, Docker, E2E, and quality-gate surfaces.
- The production server serves 38 explicitly approved 2D browser modules; 73 inactive JavaScript files are sealed behind the HTTP allowlist. The active server package retains the 2D SQLite/BM25 guide-import RAG modules.
- The production Docker stage is assembled from a 46-file allowlist instead of copying the repository tree.
- Default lint, formatting, renderer-boundary, encoding, unit, and E2E gates are routed through the active 2D manifests; archived 3D tests require the explicit `@archived-3d` tag.
- Data protections cover semantic deletion during normalization, shared-trip collisions/full workspaces, durable-storage failures, import shape validation, bounded guide days, cancellation, city-aware geocoding, and trip-owned async coordinate results.
- Bulk guide import emits one render-driving state change; stale search/reverse-geocode responses are ignored.
- The route-card keyboard E2E now models a multi-marker fit center and passed 10 concurrent repeats; it no longer mistakes the preceding single-marker animation for route activation.
- Latest S4-S5 gates: `npm run check` passed across 93 active quality files; `npm test` passed with 17 files / 167 tests; the 12-case guide-import evaluation and `git diff --check` passed. The fixed-port Playwright runner was updated but not executed in this pass.
- Node support and CI use Node 22.22.1; CI runs the complete 2D architecture check and default Playwright suite.
- Browser review passed at 1440x900 and 390x844: nonblank 2D map/list rendering, no 3D DOM, visible mobile live status, modal focus/background isolation, and no console warnings/errors.
- `npm audit` reports zero known vulnerabilities after compatible Hono and transitive dependency updates.
- Product direction `L1-A`, `M1-A` dual trip/day tabs, `M2-B` bidirectional itinerary/map selection, `M3-A` linear guide-import review, `M4-C` map-area output preview workbench, `M5-A` list-first explicit mobile view switching, and `M6-A` layered release-evidence packet are confirmed.
- `L2` is closed with all six medium packages confirmed. `S1.1-A` through `S6.2-B` are implemented and browser-verified. Implementation is complete while release readiness remains `HOLD`.
- The active workspace contract currently caps trips at three. Q8 therefore refines visibility and positioning within that cap instead of speculatively increasing capacity.
- `S2.1-A` confirms one shared primary selection: place cards and markers share a place target, route cards and lines share a mutually exclusive route target, and map-origin selection reveals the corresponding left-side target. `S2.2` may build only on that established anchor; it must not add multi-selection or automatic writing.
- Workspace JSON import now uses a full map-area workbench with linear syntax/shape/data validation, file metadata, route/date/place summaries and explicit whole-workspace replacement; the recovery snapshot remains mandatory before saving and failures leave current data intact.
- The active responsive shell uses a desktop `35/65` itinerary/map split at `768px` and above. Smaller viewports default to the itinerary, expose semantic keyboard-operable “行程 / 地图” tabs with 44px targets, preserve day/selection/list scroll, and resize/refit the 2D map without clearing the selected target.
- Existing accessibility infrastructure includes a polite atomic status region, card focus-visible outlines, modal focus trapping/background isolation/trigger restoration, and a global reduced-motion rule; Q17 chooses the visible nonmodal feedback placement, not whether these invariants exist.
- `S5.2-B` fixes one visible nonmodal status band below the persistent itinerary/map tabs while focus and selection remain on their source controls; this choice does not replace semantic controls or modal focus boundaries.
- `S6.1-B` is confirmed as a maintainer-only, 2D-only layered loose-leaf review binder. It binds one exact commit to seven fail-closed evidence layers and generates its human-readable packet from the same machine manifest.
- `S6.2` must replace the stale Node 18/3D release material with one exact-candidate 2D contract, execute AMap and DeepSeek LIVE independently, verify both container health and readiness, retain a tested rollback revision, and require named authorization.
- `S6.2-B` is confirmed as the release-closure surface: unresolved gates are expanded with cause, owner, required evidence, rollback point and closure condition, while the complete proof chain remains in the `S6.1-B` binder.

## Risks

- Archived 3D source and historical documents intentionally remain in the repository; they are not served or included in the production image.
- Old persisted `annotations`/`geoAssets` fields are preserved as opaque compatibility data so a 2D save does not destroy archived user data.
- Live AMap/DeepSeek behavior still depends on external credentials and providers; browser smoke uses deterministic mocks.
- The first S6 Docker build exposed production `prepare: husky` failure. The dependency stage now deletes only its temporary package copy's prepare script; the rebuilt Node 22 image passed `/healthz` and `/readyz` in an ephemeral container.
- Credentialed AMap and DeepSeek preliminary live calls passed in the ephemeral container, but remain `BLOCKED` as release evidence because they were not run against a clean frozen candidate or retained CI workflow artifacts.
- Fetched `origin/main` at `c568aa4` has been reconciled locally. Its RAG/BM25 capability and documentation layout were retained; its 3D runtime remained sealed.
- `data/` and `test-tmp-integration/` remain untracked and untouched.

## Next Queue

- `L1-A` is confirmed as the homepage map-led direction.
- `M1-A` is confirmed as the dual loose-leaf trip and visible day-tab navigation model.
- `M2-B` is confirmed as the bidirectional itinerary/map interaction model.
- `M3-A` is confirmed as the linear two-stage guide-import review model.
- `M4-C` is confirmed as the map-area share/data output preview workbench.
- `M5-A` is confirmed as the list-first explicit itinerary/map mobile compatibility model.
- `M6-A` is confirmed as the layered evidence review packet; it remains a maintainer artifact outside the end-user homepage.
- `S1.1-A` is confirmed: keep up to three trips in creation order, truncate long titles, automatically reveal the active tab, hide `+` at capacity, and retain `AI 导入`.
- `S1.2-A` is confirmed: remember each trip's last viewed date only for the current session, silently restore it when valid, fall back to all dates when invalid, and clear the old trip's concrete place/route selection.
- `S3.2-B` is confirmed: keep the per-day draft on the left and compare one unmatched place's search results in a dedicated right column before binding or deliberately keeping it unresolved.
- `S4.1-A` is confirmed: keep three content options in the left rail; each change triggers one Canvas regeneration while the last successful preview remains under a light loading veil, then swaps atomically on success.
- `S4.2-A` is confirmed: show JSON syntax, workspace structure and trip/date data validation linearly in the left rail, then summarize the imported workspace and create the recovery point before one whole-workspace replacement.
- `S5.1-A` is confirmed: keep a full-width persistent “行程 / 地图” switch directly below the trip tabs, default to itinerary, and retain trip/day/selection/list context across view changes.
- `S5.2-B` is confirmed: place all nonmodal results in one visible band below the persistent view tabs, keep focus and selection at their source controls, and use one polite atomic announcement path.
- `S6.1-B` is confirmed: keep total/local/CI/LIVE/container/human/authorization loose-leaf pages, separate AMap and DeepSeek, and derive every page from one candidate-bound manifest.
- `S6.2-B` is confirmed: keep the default view focused on unresolved gates, link every item back to the complete layered binder, and retain `HOLD` until every required layer, rollback proof and named authorization closes.
- S1-S6 implementation is verified. `work/release/current-manifest.json` is valid and truthfully derives `HOLD` with eight unresolved rows.
- Next hard gate: after explicit approval, create one reviewed clean candidate commit; then rerun local, Node 22.22.1 CI, independent AMap/DeepSeek LIVE, container, rollback, named four-viewport review and release authorization against that exact commit.
- Complete final Git review and publish only after explicit approval.
- Treat any future 3D revival as a separate entry point, package, service surface, and verification pipeline.
