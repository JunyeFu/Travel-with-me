// js/api/geocode.js
// 地点解析：把"地点名"或"地址"变成 [lng, lat]
//
// 两种策略：
//   - resolveBy: 'poi'  → 用 PlaceSearch（适合特定门店、连锁品牌）
//   - 默认            → 用 Geocoder（适合街道地址、地标）
//
// 都支持 searchTerms 数组：依次尝试多个关键词，只要有一个命中就返回
// 单个关键词超过 6 秒还没回包就跳到下一个，避免卡死

import { AppConfig } from '../config.js';
import { unique } from '../utils.js';
import { normalizeLngLat, requestAMapWebService } from './amap-web-service.js';

const QUERY_TIMEOUT_MS = 6000;

// 创建可复用的 geocoder / placeSearch 服务实例
export function createGeocodeServices(AMap, city = AppConfig.cityCode) {
  return {
    AMap,
    city,
    geocoder: new AMap.Geocoder({ city }),
    placeSearch: new AMap.PlaceSearch({
      city,
      citylimit: true,
      pageSize: 10,
      extensions: 'all'
    })
  };
}

// 解析单个地点
// loc: { name, query, addr, searchTerms?, includeKeywords?, resolveBy? }
// 返回：{ lnglat: [lng, lat] } 或 null
export async function resolveLocation(services, loc, options = {}) {
  const fromBff = await placeSearchWithBff(loc, services.city, options.signal);
  if (fromBff) return fromBff;
  const geocodedByBff = await geocodeWithBff(loc, services.city, options.signal);
  if (geocodedByBff) return geocodedByBff;
  if (loc.resolveBy === 'poi') return placeSearchWithRetries(services.placeSearch, loc);
  return placeSearchWithRetries(services.placeSearch, loc).then(
    result => result || geocodeWithRetries(services.geocoder, loc)
  );
}

// 多结果搜索：给"添加地点"弹窗用，返回 POI 列表
// 关键词命中 0~10 个 POI；调用方让用户挑一个
// 自动匹配限定城市；手动搜索可明确传 citylimit:false 供用户跨城选择。
export async function searchPlaces(AMap, keyword, options = {}) {
  const citylimit = options.citylimit ?? options.city !== false;
  const fromBff = await fetchBffPois(
    '/v3/place/text',
    {
      keywords: keyword,
      city: options.city === false ? '' : options.city || AppConfig.cityCode,
      citylimit: String(citylimit),
      offset: options.pageSize || 10,
      extensions: 'all'
    },
    options.signal
  );
  if (fromBff.length) return fromBff;
  return new Promise(resolve => {
    if (!AMap || !keyword) {
      resolve([]);
      return;
    }
    const psOptions = {
      citylimit,
      pageSize: options.pageSize || 10,
      extensions: 'all'
    };
    if (options.city !== false) {
      psOptions.city = options.city || AppConfig.cityCode;
    }
    const ps = new AMap.PlaceSearch(psOptions);
    ps.search(keyword, (status, result) => {
      if (status !== 'complete' || !result?.poiList?.pois) {
        resolve([]);
        return;
      }
      resolve(mapPois(result.poiList.pois));
    });
  });
}

// 周边搜索：以 center 为中心、radius 米半径内找 keyword 命中的 POI。
// 给"AI 搜附近"用——返回结构与 searchPlaces 一致，能复用同一套渲染逻辑。
//
// types 可选，是高德 POI 大类编码（如餐饮 050000），多个用 | 分隔。
// 不传 types 时只用 keyword 过滤；传了能进一步收窄结果。
export async function searchNearBy(AMap, { keyword, center, radius = 1500, types, signal } = {}) {
  if (!keyword || !Array.isArray(center) || center.length < 2) return [];
  const lng = Number(center[0]);
  const lat = Number(center[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return [];
  const fromBff = await fetchBffPois(
    '/v3/place/around',
    {
      keywords: keyword,
      location: `${lng},${lat}`,
      radius: Math.max(200, Math.min(5000, Math.round(Number(radius) || 1500))),
      types: types || '',
      offset: 10,
      extensions: 'all'
    },
    signal
  );
  if (fromBff.length || !AMap) return fromBff;
  return new Promise(resolve => {
    const psOptions = {
      citylimit: false,
      pageSize: 10,
      extensions: 'all'
    };
    if (types) psOptions.type = types;

    const ps = new AMap.PlaceSearch(psOptions);
    const safeRadius = Math.max(200, Math.min(5000, Math.round(Number(radius) || 1500)));
    ps.searchNearBy(keyword, [lng, lat], safeRadius, (status, result) => {
      if (status !== 'complete' || !result?.poiList?.pois) {
        resolve([]);
        return;
      }
      resolve(mapPois(result.poiList.pois));
    });
  });
}

function mapPois(pois) {
  return pois
    .map(poi => {
      // 高德 JS API 2.0 在 extensions=all 下，rating/cost 有时在顶层、有时在 biz_ext 下
      // 兼容两种写法，缺失时返回 null（不要伪造为 0 或 '暂无'）
      const rating = pickNumber(poi.rating ?? poi.biz_ext?.rating);
      const cost = pickNumber(poi.cost ?? poi.biz_ext?.cost);
      const photos = Array.isArray(poi.photos) ? poi.photos : [];
      return {
        id: poi.id,
        name: String(poi.name || ''),
        addr: String(poi.address || ''),
        province: String(poi.pname || ''),
        city: String(poi.cityname || ''),
        district: String(poi.adname || ''),
        type: String(poi.type || ''),
        lnglat: normalizeLngLat(poi.location),
        rating,
        cost,
        tag: String(poi.tag || '').trim(),
        tel: String(poi.tel || '').trim(),
        photo: String(photos[0]?.url || '').trim(),
        businessArea: String(poi.business_area || '').trim(),
        openTime: String(poi.opentime_today || poi.opentime_week || '').trim(),
        source: 'amap-web-service'
      };
    })
    .filter(p => p.lnglat && Number.isFinite(p.lnglat[0]) && Number.isFinite(p.lnglat[1]));
}

function pickNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// 逆地理编码：根据 [lng, lat] 反查"省市区 + 详细地址"。
// 用在已有地点（来自 trip.locations）只存了名称没存地址、但有坐标的场景，
// 比 POI 搜索拿到的 address 更可信。
export async function reverseGeocode(AMap, lnglat) {
  const fromBff = await reverseGeocodeWithBff(lnglat);
  if (fromBff) return fromBff;
  return reverseGeocodeWithSdk(AMap, lnglat);
}

function reverseGeocodeWithSdk(AMap, lnglat) {
  return new Promise(resolve => {
    if (!AMap || !Array.isArray(lnglat) || lnglat.length < 2) {
      resolve(null);
      return;
    }
    const lng = Number(lnglat[0]);
    const lat = Number(lnglat[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      resolve(null);
      return;
    }
    const geocoder = new AMap.Geocoder({ city: AppConfig.cityCode });

    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    }, QUERY_TIMEOUT_MS);

    geocoder.getAddress([lng, lat], (status, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const r = result?.regeocode;
      if (status === 'complete' && (result?.info || '').toUpperCase() === 'OK' && r) {
        const c = r.addressComponent || {};
        resolve({
          formatted: String(r.formattedAddress || '').trim(),
          province: String(c.province || '').trim(),
          city: String(c.city || c.province || '').trim(),
          district: String(c.district || '').trim()
        });
      } else {
        resolve(null);
      }
    });
  });
}

async function placeSearchWithBff(loc, city = AppConfig.cityCode, signal) {
  const queries = unique((loc.searchTerms || [loc.query, loc.name]).filter(Boolean));
  for (const query of queries) {
    const pois = await fetchBffPois(
      '/v3/place/text',
      {
        keywords: query,
        city,
        citylimit: 'true',
        offset: 10,
        extensions: 'all'
      },
      signal
    );
    const matched = pois.find(
      poi =>
        !loc.includeKeywords || loc.includeKeywords.every(keyword => poi.name.includes(keyword))
    );
    if (matched) return matched;
  }
  return null;
}

async function geocodeWithBff(loc, city = AppConfig.cityCode, signal) {
  const queries = unique((loc.searchTerms || [loc.query, loc.name, loc.addr]).filter(Boolean));
  for (const address of queries) {
    const result = await requestAMapWebService(
      '/v3/geocode/geo',
      {
        address,
        city
      },
      { signal }
    );
    const geocode = result.ok ? result.payload?.geocodes?.[0] : null;
    const lnglat = normalizeLngLat(geocode?.location);
    if (lnglat) {
      return {
        lnglat,
        addr: String(geocode?.formatted_address || '').trim(),
        province: String(geocode?.province || '').trim(),
        city: String(geocode?.city || geocode?.province || '').trim(),
        district: String(geocode?.district || '').trim(),
        source: 'amap-web-service'
      };
    }
  }
  return null;
}

async function reverseGeocodeWithBff(lnglat) {
  const normalized = normalizeLngLat(lnglat);
  if (!normalized) return null;
  const result = await requestAMapWebService('/v3/geocode/regeo', {
    location: normalized.join(','),
    extensions: 'base'
  });
  const regeocode = result.ok ? result.payload?.regeocode : null;
  if (!regeocode) return null;
  const component = regeocode.addressComponent || {};
  return {
    formatted: String(regeocode.formatted_address || '').trim(),
    province: String(component.province || '').trim(),
    city: String(component.city || component.province || '').trim(),
    district: String(component.district || '').trim()
  };
}

async function fetchBffPois(path, params, signal) {
  const result = await requestAMapWebService(path, params, { signal });
  return result.ok ? mapPois(result.payload?.pois || []) : [];
}

// 把 POI / 逆地理结果合成一个用于显示的"详细地址"，
// 多用于 POI 没填 address 时的兜底。
export function buildDisplayAddress(parts = {}) {
  const formatted = String(parts.formatted || parts.addr || '').trim();
  if (formatted) return formatted;
  const composed = [parts.province, parts.city, parts.district]
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .join('');
  return composed;
}

// ─── 内部实现 ──────────────────────────────────────────

function placeSearchWithRetries(placeSearch, loc) {
  const queries = unique((loc.searchTerms || [loc.query, loc.name]).filter(Boolean));

  return tryQueries(queries, (query, next, done) => {
    placeSearch.search(query, (status, result) => {
      const pois = result?.poiList?.pois || [];
      const matched = pois.find(poi => {
        const name = String(poi?.name || '');
        return !loc.includeKeywords || loc.includeKeywords.every(kw => name.includes(kw));
      });

      if (status === 'complete' && matched?.location) {
        done(
          mapPois([matched])[0] || {
            lnglat: [Number(matched.location.lng), Number(matched.location.lat)]
          }
        );
      } else {
        next();
      }
    });
  });
}

function geocodeWithRetries(geocoder, loc) {
  const queries = unique((loc.searchTerms || [loc.query, loc.name, loc.addr]).filter(Boolean));

  return tryQueries(queries, (query, next, done) => {
    geocoder.getLocation(query, (status, result) => {
      const geocodes = result?.geocodes || [];
      if (status === 'complete' && result.info === 'OK' && geocodes.length > 0) {
        const point = geocodes[0].location;
        done({
          lnglat: [Number(point.lng), Number(point.lat)]
        });
      } else {
        next();
      }
    });
  });
}

// 串行尝试多个 query，每个都有超时保护
// runner(query, nextCb, doneCb)：内部异步逻辑
//   - 调 nextCb() 表示"这个 query 没结果，试下一个"
//   - 调 doneCb(value) 表示"成功，返回 value"
function tryQueries(queries, runner) {
  return new Promise(resolve => {
    let index = 0;

    function next() {
      if (index >= queries.length) {
        resolve(null);
        return;
      }
      const query = queries[index++];
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          next();
        }
      }, QUERY_TIMEOUT_MS);

      runner(
        query,
        () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          next();
        },
        value => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(value);
        }
      );
    }

    next();
  });
}
