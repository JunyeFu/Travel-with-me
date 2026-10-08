import { getTransportLabel } from './utils.js';
import { createRouteGeometryDiagnostics } from './route-geometry.js';

export const ROUTE_MODE_OPTIONS = [
  { id: 'driving', label: '打车/驾车' },
  { id: 'walking', label: '步行' },
  { id: 'transit', label: '公共交通' },
  { id: 'riding', label: '骑行' }
];

const ROUTE_MODE_IDS = ROUTE_MODE_OPTIONS.map(option => option.id);

export function normalizeRouteMode(mode) {
  return ROUTE_MODE_IDS.includes(mode) ? mode : 'driving';
}

export function normalizeRouteToNext(route = {}) {
  const mode = normalizeRouteMode(route.mode);
  const label = String(route.label || '').trim();
  const legs = Array.isArray(route.legs)
    ? route.legs
        .map(leg => ({
          mode: normalizeRouteMode(leg?.mode),
          label: String(leg?.label || '').trim()
        }))
        .filter(leg => leg.label)
    : [];
  const geometry = normalizeRouteGeometry(route.geometry);

  return {
    mode,
    ...(label ? { label } : {}),
    ...(legs.length ? { legs } : {}),
    ...(geometry ? { geometry } : {}),
    ...(route.manual === true || label || legs.length ? { manual: true } : {})
  };
}

export function normalizeRouteGeometry(geometry) {
  if (!geometry || typeof geometry !== 'object') return null;
  const paths = Array.isArray(geometry.paths)
    ? geometry.paths
        .map(path =>
          Array.isArray(path)
            ? path
                .map(point => [Number(point?.[0]), Number(point?.[1])])
                .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat))
            : []
        )
        .filter(path => path.length >= 2)
    : [];
  if (!paths.length) return null;
  const normalized = {
    source: String(geometry.source || 'unknown'),
    mode: normalizeRouteMode(geometry.mode),
    paths,
    fetchedAt: Number.isFinite(Number(geometry.fetchedAt)) ? Number(geometry.fetchedAt) : Date.now()
  };
  return {
    ...normalized,
    diagnostics:
      geometry.diagnostics && typeof geometry.diagnostics === 'object'
        ? normalizeRouteDiagnostics(geometry.diagnostics, normalized)
        : createRouteGeometryDiagnostics(normalized)
  };
}

export function getRouteDisplayLabel(route = {}) {
  const normalized = normalizeRouteToNext(route);
  return normalized.label || getTransportLabel(normalized.mode);
}

function normalizeRouteDiagnostics(diagnostics, geometry) {
  const fallback = createRouteGeometryDiagnostics(geometry);
  return {
    hash: fallback.hash,
    pointCount: fallback.pointCount,
    lengthMeters: fallback.lengthMeters,
    firstPoint: fallback.firstPoint,
    lastPoint: fallback.lastPoint,
    source: String(diagnostics.source || fallback.source),
    mode: normalizeRouteMode(diagnostics.mode || fallback.mode)
  };
}
