import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assertExplicit2DRuntimeManifest, build2DRuntimeManifest } from './active-2d-runtime.mjs';
import vitestConfig from '../vitest.config.js';

const ACTIVE_2D_SUPPORT_FILE_MANIFEST = Object.freeze([
  '.dockerignore',
  '.editorconfig',
  '.env.example',
  '.gitattributes',
  '.gitignore',
  '.prettierignore',
  '.prettierrc',
  'AGENTS.md',
  'ARCHITECTURE.md',
  'Dockerfile',
  'README.md',
  'docs/README.md',
  'docs/architecture/2d-data-foundation.md',
  'docs/engineering/api.md',
  'docs/engineering/development-workflow.md',
  'docs/engineering/testing/live-provider.md',
  'docs/operations/public-demo.md',
  'docs/product/guide-import-evaluation.md',
  'eslint.config.js',
  'package.json',
  'playwright.config.js',
  'server/index.js',
  'server/prompts/guide-extract.md',
  'server/rag/bm25.js',
  'server/rag/db.js',
  'server/rag/retrieve.js',
  'server/rag/store.js',
  'server/rag/tokenizer.js',
  'scripts/active-2d-quality.mjs',
  'scripts/active-2d-runtime.mjs',
  'scripts/assemble-2d-runtime.mjs',
  'scripts/audit-render-imports.mjs',
  'scripts/check-2d-runtime-boundary.mjs',
  'scripts/check-visible-text-encoding.mjs',
  'scripts/check-release-evidence.mjs',
  'scripts/create-release-review.mjs',
  'scripts/evaluate-guide-import.mjs',
  'scripts/evaluate-live-guide-import.mjs',
  'scripts/live-ai-budget.mjs',
  'scripts/release-evidence.mjs',
  'scripts/run-active-2d-quality.mjs',
  'scripts/run-e2e-smoke.mjs',
  'scripts/run-live-deepseek-smoke.mjs',
  'scripts/run-live-provider-smoke.mjs',
  'scripts/serve-release-review.mjs',
  'tests/e2e/smoke.spec.js',
  'tests/fixtures/guide-import-evaluation/rag-reference.json',
  'vitest.config.js',
  'work/codex-blackboard.md',
  'work/codex-evaluation-harness.md',
  'work/codex-verification-log.md'
]);

export async function build2DQualityManifest(projectRoot) {
  const runtime = await build2DRuntimeManifest(projectRoot);
  assertExplicit2DRuntimeManifest(runtime);
  const unitTests = Array.isArray(vitestConfig?.test?.include) ? vitestConfig.test.include : [];
  if (!unitTests.length) throw new Error('vitest.config.js must explicitly list active 2D tests');

  const projectPaths = [
    ...new Set([
      'index.html',
      ...runtime.htmlStylesheets,
      ...runtime.activeJavaScriptPaths,
      ...unitTests,
      ...ACTIVE_2D_SUPPORT_FILE_MANIFEST
    ])
  ].sort();

  await Promise.all(projectPaths.map(projectPath => access(resolve(projectRoot, projectPath))));
  return { projectPaths, runtime, unitTests: [...unitTests] };
}
