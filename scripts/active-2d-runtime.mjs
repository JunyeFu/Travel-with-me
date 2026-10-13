import { readdir, readFile } from 'node:fs/promises';
import { dirname, extname, relative, resolve, sep } from 'node:path';

const STATIC_IMPORT_PATTERN =
  /\b(?:import\s+(?:[^'";]*?\s+from\s+)?|export\s+(?:[^'";]*?\s+from\s+))['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT_PATTERN = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

export const ACTIVE_2D_JAVASCRIPT_MANIFEST = Object.freeze([
  'js/api/amap-loader.js',
  'js/api/amap-web-service.js',
  'js/api/fallback-amap.js',
  'js/api/geocode.js',
  'js/api/guide-import.js',
  'js/api/routing.js',
  'js/config.js',
  'js/day-plan.js',
  'js/data/trip.js',
  'js/error-boundary.js',
  'js/guide-import-cleanup.js',
  'js/guide-import-flow.js',
  'js/logger.js',
  'js/main.js',
  'js/render/day-editor-modal.js',
  'js/render/day-plan-modal.js',
  'js/render/event-editor-modal.js',
  'js/render/guide-import-modal.js',
  'js/render/guide-preview-modal.js',
  'js/render/icons.js',
  'js/render/map.js',
  'js/render/modal-base.js',
  'js/render/route-editor-modal.js',
  'js/render/search-modal.js',
  'js/render/share-flow.js',
  'js/render/share-modal.js',
  'js/render/sidebar.js',
  'js/render/trip-modal.js',
  'js/render/workspace-import-modal.js',
  'js/render/workspace-tabs.js',
  'js/route-config.js',
  'js/route-geometry.js',
  'js/route-guidance.js',
  'js/route-planner.js',
  'js/share-image.js',
  'js/share.js',
  'js/state.js',
  'js/storage.js',
  'js/time-slots.js',
  'js/utils.js'
]);

const ACTIVE_2D_HTML_ENTRYPOINTS = Object.freeze(['js/main.js']);
const ACTIVE_2D_STYLESHEET_MANIFEST = Object.freeze([
  'css/tokens.css',
  'css/layout.css',
  'css/components.css'
]);

export async function build2DRuntimeManifest(projectRoot) {
  const root = resolve(projectRoot);
  const htmlPath = resolve(root, 'index.html');
  const html = await readFile(htmlPath, 'utf8');
  const htmlJavaScriptEntrypoints = extractLocalModuleEntrypoints(html);
  const htmlStylesheets = extractLocalStylesheets(html);

  if (htmlJavaScriptEntrypoints.length === 0) {
    throw new Error('index.html does not declare a local module entrypoint');
  }

  const activeJavaScriptPaths = new Set();
  for (const entrypoint of htmlJavaScriptEntrypoints) {
    await visitModule(root, entrypoint, activeJavaScriptPaths);
  }

  const allJavaScriptPaths = new Set(await listJavaScriptFiles(resolve(root, 'js'), root));
  const inactiveJavaScriptPaths = new Set(
    [...allJavaScriptPaths].filter(projectPath => !activeJavaScriptPaths.has(projectPath))
  );

  return {
    activeJavaScriptPaths,
    allJavaScriptPaths,
    htmlJavaScriptEntrypoints,
    htmlStylesheets,
    inactiveJavaScriptPaths
  };
}

export function assertExplicit2DRuntimeManifest(runtimeManifest) {
  const violations = [
    ...compareSets(
      'JavaScript module',
      new Set(ACTIVE_2D_JAVASCRIPT_MANIFEST),
      runtimeManifest.activeJavaScriptPaths
    ),
    ...compareSets(
      'HTML module entrypoint',
      new Set(ACTIVE_2D_HTML_ENTRYPOINTS),
      new Set(runtimeManifest.htmlJavaScriptEntrypoints)
    ),
    ...compareSets(
      'HTML stylesheet',
      new Set(ACTIVE_2D_STYLESHEET_MANIFEST),
      new Set(runtimeManifest.htmlStylesheets)
    )
  ];

  if (violations.length > 0) {
    throw new Error(
      `2D runtime manifest drift:\n${violations.map(item => `- ${item}`).join('\n')}`
    );
  }
}

export function projectPathFromRequestURL(requestURL, assetRoot = 'js') {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(requestURL).pathname);
  } catch {
    return '';
  }
  if (!pathname.startsWith(`/${assetRoot}/`) || pathname.includes('\0')) return '';
  return pathname.replace(/^\/+/, '');
}

async function visitModule(root, projectPath, activePaths) {
  const normalizedProjectPath = toPosix(projectPath);
  if (activePaths.has(normalizedProjectPath)) return;

  const absolutePath = resolveWithinRoot(root, normalizedProjectPath);
  activePaths.add(normalizedProjectPath);
  const source = stripComments(await readFile(absolutePath, 'utf8'));

  for (const specifier of extractModuleSpecifiers(source)) {
    if (!specifier.startsWith('.')) {
      throw new Error(
        `${normalizedProjectPath} imports unsupported external module specifier ${specifier}`
      );
    }

    const cleanSpecifier = specifier.split(/[?#]/, 1)[0];
    const importedPath = resolve(dirname(absolutePath), cleanSpecifier);
    const targetPath = extname(importedPath) ? importedPath : `${importedPath}.js`;
    const targetProjectPath = toPosix(relative(root, targetPath));
    if (!targetProjectPath.startsWith('js/')) {
      throw new Error(`${normalizedProjectPath} imports outside the browser JS root: ${specifier}`);
    }
    await visitModule(root, targetProjectPath, activePaths);
  }
}

function extractLocalModuleEntrypoints(html) {
  const entries = [];
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attributes = match[1];
    const src = attributes.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!src) {
      if (match[2].trim()) throw new Error('index.html contains inline executable JavaScript');
      continue;
    }
    if (/^(?:[a-z]+:)?\/\//i.test(src)) {
      throw new Error(`index.html contains an external script entrypoint: ${src}`);
    }
    if (!/\btype\s*=\s*["']module["']/i.test(attributes)) {
      throw new Error(`index.html contains a non-module script entrypoint: ${src}`);
    }
    const localPath = localAssetPath(src);
    if (localPath) entries.push(localPath);
  }
  return [...new Set(entries)];
}

function compareSets(label, expected, actual) {
  const violations = [];
  for (const projectPath of actual) {
    if (!expected.has(projectPath)) violations.push(`unexpected ${label}: ${projectPath}`);
  }
  for (const projectPath of expected) {
    if (!actual.has(projectPath)) violations.push(`missing ${label}: ${projectPath}`);
  }
  return violations;
}

function extractLocalStylesheets(html) {
  const stylesheets = [];
  for (const match of html.matchAll(/<link\b([^>]*)>/gi)) {
    const attributes = match[1];
    if (!/\brel\s*=\s*["']stylesheet["']/i.test(attributes)) continue;
    const href = attributes.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
    const localPath = localAssetPath(href);
    if (localPath) stylesheets.push(localPath);
  }
  return [...new Set(stylesheets)];
}

function localAssetPath(specifier) {
  if (!specifier || /^(?:[a-z]+:)?\/\//i.test(specifier)) return '';
  const clean = specifier.split(/[?#]/, 1)[0].replace(/^\.\//, '').replace(/^\/+/, '');
  return toPosix(clean);
}

function extractModuleSpecifiers(source) {
  const specifiers = [];
  for (const pattern of [STATIC_IMPORT_PATTERN, DYNAMIC_IMPORT_PATTERN]) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) specifiers.push(match[1]);
  }
  return [...new Set(specifiers)];
}

async function listJavaScriptFiles(directory, root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async entry => {
      const absolutePath = resolve(directory, entry.name);
      if (entry.isDirectory()) return listJavaScriptFiles(absolutePath, root);
      if (!entry.isFile() || !entry.name.endsWith('.js')) return [];
      return [toPosix(relative(root, absolutePath))];
    })
  );
  return nested.flat();
}

function resolveWithinRoot(root, projectPath) {
  const absolutePath = resolve(root, projectPath);
  const relativePath = relative(root, absolutePath);
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`)) {
    throw new Error(`runtime asset escapes project root: ${projectPath}`);
  }
  return absolutePath;
}

function stripComments(source) {
  let output = '';
  let quote = '';
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];

    if (quote) {
      output += current;
      if (escaped) escaped = false;
      else if (current === '\\') escaped = true;
      else if (current === quote) quote = '';
      continue;
    }

    if (current === '"' || current === "'" || current === '`') {
      quote = current;
      output += current;
      continue;
    }

    if (current === '/' && next === '/') {
      output += '  ';
      index += 2;
      while (index < source.length && source[index] !== '\n') {
        output += ' ';
        index += 1;
      }
      if (index < source.length) output += '\n';
      continue;
    }

    if (current === '/' && next === '*') {
      output += '  ';
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        output += source[index] === '\n' ? '\n' : ' ';
        index += 1;
      }
      output += '  ';
      index += 1;
      continue;
    }

    output += current;
  }

  return output;
}

function toPosix(value) {
  return value.split(sep).join('/');
}
