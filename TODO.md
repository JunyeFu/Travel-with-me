# Travel With Me Roadmap

Last updated: 2026-10-02

The active product is 2D-only. Historical 3D work is frozen under `archive/3d/` and is not part of this backlog.

## Current Stage

2D stability and data-integrity closure before review and release preparation.

The document-to-implementation defect table and current repair evidence are maintained in
[2026-10-02 conformance review](docs/engineering/2d-conformance-review-2026-10-02.md).
Historical release manifests do not certify the current working tree.

## Closure Gates

- Keep `npm run check`, `npm test`, `npm run test:guide-import`, `npm run test:e2e`, and `npm audit --audit-level=high` green on Node.js 22.22.1 or newer.
- Keep the active browser import graph, server allowlist, production image, default tests, dependencies, and UI free of 3D runtime code.
- Complete one credentialed AMap live-provider smoke and one real Docker image build before release approval.
- Reconcile this branch with current remote `main`, then review and stage only product-owned files. Exclude runtime databases and integration-test output.

## Deferred Product Work

- Cloud sync and account ownership.
- Provider quotas, monitoring, and operational alerts.
- Real-user desktop acceptance and mobile compatibility review.
- Image upload / OCR (current AI import accepts text only).
- Kotlin M1–M4; M0 samples exist, see `docs/product/kotlin-native-migration-plan.md`.

Any 3D revival requires a separate entry point, dependency surface, service boundary, test pipeline, and explicit product decision.
