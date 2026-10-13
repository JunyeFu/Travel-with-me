import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertExplicit2DRuntimeManifest, build2DRuntimeManifest } from './active-2d-runtime.mjs';

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const targetArgument = process.argv[2];
if (!targetArgument) throw new Error('Usage: node scripts/assemble-2d-runtime.mjs <empty-target>');

const targetRoot = resolve(targetArgument);
const targetFromSource = relative(sourceRoot, targetRoot);
if (
  targetFromSource === '' ||
  (!targetFromSource.startsWith('..') && !isAbsolute(targetFromSource))
) {
  throw new Error('The 2D runtime target must be outside the source project');
}

const runtimeManifest = await build2DRuntimeManifest(sourceRoot);
assertExplicit2DRuntimeManifest(runtimeManifest);

const runtimePaths = new Set([
  'index.html',
  'package.json',
  'package-lock.json',
  'server/index.js',
  'server/guide-time.js',
  'server/prompts/guide-extract.md',
  'server/rag/bm25.js',
  'server/rag/db.js',
  'server/rag/retrieve.js',
  'server/rag/store.js',
  'server/rag/tokenizer.js',
  'scripts/active-2d-runtime.mjs',
  ...runtimeManifest.htmlStylesheets,
  ...runtimeManifest.activeJavaScriptPaths
]);

await mkdir(targetRoot);
for (const projectPath of [...runtimePaths].sort()) {
  const sourcePath = resolve(sourceRoot, projectPath);
  const targetPath = resolve(targetRoot, projectPath);
  await mkdir(dirname(targetPath), { recursive: true });
  await copyFile(sourcePath, targetPath);
}

console.log(
  `Assembled 2D production runtime at ${targetRoot}: ${runtimePaths.size} allowlisted files copied.`
);
