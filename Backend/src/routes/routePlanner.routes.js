const express = require("express");
const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/auth.middleware");

const router = express.Router();

const TRAVEL_MODES = new Set(["car", "bike", "bus", "train", "flight"]);
const ROUTE_CACHE_TTL_MS = 10 * 60 * 1000;
const ROUTE_CACHE_MAX_ENTRIES = 400;
const ROUTE_CACHE_VERSION = "road-line-v3";
const ROUTE_TIMEOUT_MS = Math.max(2500, Math.min(15000, parsePositiveInt(process.env.ROUTE_TIMEOUT_MS) || 9000));
const ROUTE_FETCH_RETRIES = Math.max(1, Math.min(2, parsePositiveInt(process.env.ROUTE_FETCH_RETRIES) || 2));
const ROUTE_ORS_API_KEY = clampText(process.env.OPENROUTESERVICE_API_KEY || process.env.ORS_API_KEY || "", 260);
const ROUTE_ORS_URL = clampText(process.env.ROUTE_ORS_URL || "https://api.openrouteservice.org", 220).replace(/\/+$/, "");
const ROUTE_OSRM_URLS = buildProviderUrlList(
  process.env.ROUTE_OSRM_URLS,
  ["https://router.project-osrm.org", "https://routing.openstreetmap.de/routed-car"]
);
const ROUTE_VALHALLA_URL = clampText(process.env.ROUTE_VALHALLA_URL || "https://valhalla1.openstreetmap.de", 220).replace(/\/+$/, "");
const ROUTE_VALHALLA_ALTERNATIVES_MAX = 3;
const routeResponseCache = new Map();
const GEOCODE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const GEOCODE_CACHE_MAX_ENTRIES = 250;
const geocodeResponseCache = new Map();
const ROUTE_HUBS = Object.freeze({
  flight: Object.freeze({
    nashik: Object.freeze({ code: "ISK", name: "Nashik Airport (Ozar)", lat: 20.1196, lng: 73.9129 }),
    mumbai: Object.freeze({ code: "BOM", name: "Chhatrapati Shivaji Maharaj Intl Airport", lat: 19.0896, lng: 72.8656 }),
    pune: Object.freeze({ code: "PNQ", name: "Pune International Airport", lat: 18.5793, lng: 73.9089 }),
    aurangabad: Object.freeze({ code: "IXU", name: "Aurangabad Airport", lat: 19.8627, lng: 75.3981 }),
    goa: Object.freeze({ code: "GOI", name: "Goa Dabolim Airport", lat: 15.3808, lng: 73.8314 }),
    shirdi: Object.freeze({ code: "SAG", name: "Shirdi Airport", lat: 19.6886, lng: 74.3786 }),
    kolhapur: Object.freeze({ code: "KLH", name: "Kolhapur Airport", lat: 16.6647, lng: 74.2894 }),
    solapur: Object.freeze({ code: "SSE", name: "Solapur Airport", lat: 17.628, lng: 75.934 }),
    lonavala: Object.freeze({ code: "PNQ", name: "Pune International Airport", lat: 18.5793, lng: 73.9089 }),
    igatpuri: Object.freeze({ code: "ISK", name: "Nashik Airport (Ozar)", lat: 20.1196, lng: 73.9129 }),
    trimbak: Object.freeze({ code: "ISK", name: "Nashik Airport (Ozar)", lat: 20.1196, lng: 73.9129 }),
    mahabaleshwar: Object.freeze({ code: "PNQ", name: "Pune International Airport", lat: 18.5793, lng: 73.9089 })
  }),
  train: Object.freeze({
    nashik: Object.freeze({ code: "NK", name: "Nashik Road Railway Station", lat: 19.9506, lng: 73.8348 }),
    mumbai: Object.freeze({ code: "CSMT", name: "Mumbai CSMT Railway Station", lat: 18.9398, lng: 72.8355 }),
    pune: Object.freeze({ code: "PUNE", name: "Pune Junction Railway Station", lat: 18.5286, lng: 73.8745 }),
    aurangabad: Object.freeze({ code: "AWB", name: "Aurangabad Railway Station", lat: 19.8768, lng: 75.3433 }),
    goa: Object.freeze({ code: "MAO", name: "Madgaon Railway Station", lat: 15.2741, lng: 73.9589 }),
    shirdi: Object.freeze({ code: "SNSI", name: "Sainagar Shirdi Railway Station", lat: 19.7807, lng: 74.4778 }),
    kolhapur: Object.freeze({ code: "KOP", name: "Kolhapur Railway Station", lat: 16.7038, lng: 74.2433 }),
    solapur: Object.freeze({ code: "SUR", name: "Solapur Railway Station", lat: 17.6599, lng: 75.9064 }),
    lonavala: Object.freeze({ code: "LNL", name: "Lonavala Railway Station", lat: 18.7547, lng: 73.4097 }),
    igatpuri: Object.freeze({ code: "IGP", name: "Igatpuri Railway Station", lat: 19.6954, lng: 73.5626 }),
    trimbak: Object.freeze({ code: "NK", name: "Nashik Road Railway Station", lat: 19.9506, lng: 73.8348 }),
    mahabaleshwar: Object.freeze({ code: "PUNE", name: "Pune Junction Railway Station", lat: 18.5286, lng: 73.8745 })
  })
});

function clampText(value, max = 255) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function buildProviderUrlList(value, defaults = []) {
  const rawItems = String(value || "")
    .split(",")
    .map((item) => clampText(item, 260).replace(/\/+$/, ""))
    .filter(Boolean);
  const items = rawItems.length ? rawItems : defaults;
  return Object.freeze([...new Set(items.map((item) => clampText(item, 260).replace(/\/+$/, "")).filter(Boolean))]);
}

function formatDisplayCityName(value) {
  const raw = clampText(value, 120);
  if (!raw) return "";
  if (/[A-Z]/.test(raw)) return raw;
  return raw
    .split(/(\s+|-)/)
    .map((part) => (/^\s+$|^-$/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()))
    .join("");
}

function parsePositiveInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

function parseNonNegativeInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

function toBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(v)) return true;
    if (["0", "false", "no", "off"].includes(v)) return false;
  }
  return fallback;
}

function toIso(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
}

function safeJsonParse(value, fallback) {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed == null ? fallback : parsed;
  } catch (error) {
    return fallback;
  }
}

function safeJsonStringify(value, fallback = "{}") {
  try {
    return JSON.stringify(value == null ? JSON.parse(fallback) : value);
  } catch (error) {
    return fallback;
  }
}

function normalizeMode(value, fallback = "car") {
  const mode = clampText(value, 24).toLowerCase();
  return TRAVEL_MODES.has(mode) ? mode : fallback;
}

function normalizeTravelDate(value) {
  const raw = clampText(value, 20);
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function normalizeMetaObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out = {};
  Object.keys(value)
    .slice(0, 50)
    .forEach((key) => {
      const k = clampText(key, 60);
      if (!k) return;
      const v = value[key];
      if (v == null) {
        out[k] = null;
      } else if (typeof v === "string") {
        out[k] = clampText(v, 500);
      } else if (typeof v === "number" || typeof v === "boolean") {
        out[k] = v;
      }
    });
  return out;
}

function parseCityParam(value) {
  let raw = value;
  try {
    raw = decodeURIComponent(String(value || ""));
  } catch (error) {
    raw = String(value || "");
  }
  return clampText(raw, 120);
}

function cityCompareKey(value) {
  return clampText(value, 120)
    .toLowerCase()
    .replace(/[,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function roundCoord(value, digits = 6) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
}

function readCoordinate(value, min, max) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

function normalizeRoutePoint(point, index = 0) {
  if (!point || typeof point !== "object") return null;
  const lat = readCoordinate(point.lat ?? point.latitude, -90, 90);
  const lng = readCoordinate(point.lng ?? point.lon ?? point.longitude, -180, 180);
  if (lat === null || lng === null) return null;

  return {
    lat: roundCoord(lat),
    lng: roundCoord(lng),
    name: clampText(point.name || point.label || `Point ${index + 1}`, 120),
    city: clampText(point.city, 120)
  };
}

function normalizeRoutePoints(input, max = 16) {
  if (!Array.isArray(input)) return [];
  return input
    .slice(0, max)
    .map((point, index) => normalizeRoutePoint(point, index))
    .filter(Boolean);
}

function modeUsesDirectEndpointsOnly(mode) {
  return mode === "flight" || mode === "train";
}

function resolveHubForPoint(mode, point) {
  const dict = ROUTE_HUBS[mode];
  if (!dict || !point) return null;

  const candidates = [
    cityCompareKey(point.city),
    cityCompareKey(point.name)
  ].filter(Boolean);

  for (const key of candidates) {
    if (dict[key]) {
      return {
        ...dict[key],
        matchedBy: "city"
      };
    }
  }

  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return null;

  let nearest = null;
  let nearestDist = Number.POSITIVE_INFINITY;
  Object.values(dict).forEach((hub) => {
    if (!hub) return;
    const d = haversineKm(point.lat, point.lng, hub.lat, hub.lng);
    if (d < nearestDist) {
      nearest = hub;
      nearestDist = d;
    }
  });

  if (!nearest) return null;
  return {
    ...nearest,
    matchedBy: "nearest"
  };
}

function sanitizePointsForMode(mode, points) {
  if (!Array.isArray(points) || points.length < 2) return { points: [], warnings: [] };
  if (!modeUsesDirectEndpointsOnly(mode)) {
    return { points, warnings: [] };
  }

  const warnings = [];
  const endpoints = [points[0], points[points.length - 1]];
  if (points.length > 2) {
    warnings.push(`${mode === "flight" ? "Flight" : "Train"} mode supports direct endpoint routing only. Intermediate stops were ignored.`);
  }

  const mapped = endpoints.map((point, idx) => {
    const hub = resolveHubForPoint(mode, point);
    if (!hub) {
      warnings.push(`${mode === "flight" ? "Airport" : "Station"} not mapped for endpoint ${idx + 1}; using selected city coordinates.`);
      return { ...point };
    }

    if (hub.matchedBy === "nearest") {
      warnings.push(`Using nearest ${mode === "flight" ? "airport" : "railway station"} for "${point.city || point.name}".`);
    }

    return {
      ...point,
      lat: roundCoord(hub.lat, 6),
      lng: roundCoord(hub.lng, 6),
      name: clampText(hub.name, 120),
      hubCode: clampText(hub.code, 24)
    };
  });

  return { points: mapped, warnings };
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = (Math.sin(dLat / 2) ** 2)
    + (Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * (Math.sin(dLon / 2) ** 2));
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function estimateSpeedByMode(mode, distanceKm = 0) {
  const dist = Math.max(1, Number(distanceKm || 0));
  if (mode === "flight") return dist < 300 ? 420 : (dist < 900 ? 610 : 720);
  if (mode === "train") return dist < 40 ? 36 : (dist < 180 ? 58 : 72);
  if (mode === "bus") return dist < 12 ? 16 : (dist < 70 ? 32 : (dist < 180 ? 43 : 50));
  if (mode === "bike") return dist < 12 ? 20 : (dist < 70 ? 34 : 42);
  return dist < 12 ? 22 : (dist < 70 ? 44 : (dist < 180 ? 58 : 66));
}

function estimateDurationBufferMinutes(distanceKm, mode) {
  const dist = Math.max(1, Number(distanceKm || 0));
  if (mode === "flight") return dist < 300 ? 105 : 125;
  if (mode === "train") return dist < 50 ? 20 : 35;
  if (mode === "bus") return dist < 15 ? 8 : (dist < 90 ? 18 : 30);
  if (mode === "bike") return dist < 15 ? 5 : (dist < 90 ? 10 : 18);
  return dist < 15 ? 4 : (dist < 90 ? 10 : 18);
}

function estimateDurationMinutes(distanceKm, mode) {
  const dist = Math.max(1, Number(distanceKm || 0));
  const speed = estimateSpeedByMode(mode, dist);
  const durationHours = dist / Math.max(1, speed);
  const travelMinutes = Math.max(1, Math.round(durationHours * 60));
  const bufferMinutes = estimateDurationBufferMinutes(dist, mode);
  if (mode === "flight") {
    // Practical city-to-city flight ETA includes airport reporting, boarding, and exit buffer.
    return Math.max(90, travelMinutes + bufferMinutes);
  }
  return Math.max(1, travelMinutes + bufferMinutes);
}

function fallbackDistanceFactorForMode(mode) {
  if (mode === "flight") return 1;
  if (mode === "train") return 1.12;
  if (mode === "bike") return 1.18;
  if (mode === "bus") return 1.24;
  return 1.22;
}

function clampRouteSteps(value, min = 8, max = 42) {
  return Math.max(min, Math.min(max, Math.trunc(Number(value) || min)));
}

function buildEstimatedRouteCoordinates(points) {
  if (!Array.isArray(points) || points.length < 2) return [];
  const coordinates = [];

  for (let i = 1; i < points.length; i += 1) {
    const start = points[i - 1];
    const end = points[i];
    const startLat = Number(start?.lat);
    const startLng = Number(start?.lng);
    const endLat = Number(end?.lat);
    const endLng = Number(end?.lng);
    if (![startLat, startLng, endLat, endLng].every(Number.isFinite)) continue;

    const segmentKm = Math.max(0.5, haversineKm(startLat, startLng, endLat, endLng));
    const steps = clampRouteSteps(Math.ceil(segmentKm / 10), 8, 38);
    const midLat = (startLat + endLat) / 2;
    const latKmPerDeg = 111.32;
    const lngKmPerDeg = Math.max(20, 111.32 * Math.cos((midLat * Math.PI) / 180));
    const dxKm = (endLng - startLng) * lngKmPerDeg;
    const dyKm = (endLat - startLat) * latKmPerDeg;
    const lenKm = Math.max(0.0001, Math.sqrt((dxKm ** 2) + (dyKm ** 2)));
    const direction = i % 2 === 0 ? -1 : 1;
    const offsetKm = Math.max(1.2, Math.min(16, segmentKm * 0.035));
    const perpLng = (-dyKm / lenKm) * direction;
    const perpLat = (dxKm / lenKm) * direction;

    for (let step = 0; step <= steps; step += 1) {
      if (coordinates.length && step === 0) continue;
      const t = step / steps;
      const wave = Math.sin(Math.PI * t);
      const lat = startLat + ((endLat - startLat) * t) + ((perpLat * offsetKm * wave) / latKmPerDeg);
      const lng = startLng + ((endLng - startLng) * t) + ((perpLng * offsetKm * wave) / lngKmPerDeg);
      coordinates.push([roundCoord(lng, 6), roundCoord(lat, 6)]);
    }
  }

  if (coordinates.length < 2) {
    return points
      .map((point) => {
        const lat = Number(point?.lat);
        const lng = Number(point?.lng);
        return Number.isFinite(lat) && Number.isFinite(lng) ? [roundCoord(lng, 6), roundCoord(lat, 6)] : null;
      })
      .filter(Boolean);
  }
  return coordinates;
}

function buildStraightRoute(points, mode, reason = "fallback") {
  let distanceKm = 0;
  for (let i = 1; i < points.length; i += 1) {
    distanceKm += haversineKm(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
  }
  const roundedDistance = Number((distanceKm * fallbackDistanceFactorForMode(mode)).toFixed(2));
  const coordinates = buildEstimatedRouteCoordinates(points);
  return {
    source: reason,
    mode,
    distanceKm: roundedDistance,
    durationMinutes: estimateDurationMinutes(roundedDistance, mode),
    geometry: {
      type: "LineString",
      coordinates
    },
    alternatives: []
  };
}

function getRouteCacheKey(mode, points, alternativesLimit = 0) {
  const coords = points.map((point) => `${point.lat.toFixed(5)},${point.lng.toFixed(5)}`).join("|");
  const alternatives = Math.max(0, Math.min(3, Math.trunc(Number(alternativesLimit) || 0)));
  return `${ROUTE_CACHE_VERSION}|${mode}|alt:${alternatives}|${coords}`;
}

function getCachedRoute(cacheKey) {
  const hit = routeResponseCache.get(cacheKey);
  if (!hit) return null;
  if (Date.now() - hit.at > ROUTE_CACHE_TTL_MS) {
    routeResponseCache.delete(cacheKey);
    return null;
  }
  return hit.value;
}

function setCachedRoute(cacheKey, value) {
  routeResponseCache.set(cacheKey, { at: Date.now(), value });
  if (routeResponseCache.size <= ROUTE_CACHE_MAX_ENTRIES) return;
  const firstKey = routeResponseCache.keys().next().value;
  if (firstKey) routeResponseCache.delete(firstKey);
}

function getCachedGeocode(cacheKey) {
  const hit = geocodeResponseCache.get(cacheKey);
  if (!hit) return null;
  if (Date.now() - hit.at > GEOCODE_CACHE_TTL_MS) {
    geocodeResponseCache.delete(cacheKey);
    return null;
  }
  return hit.value;
}

function setCachedGeocode(cacheKey, value) {
  geocodeResponseCache.set(cacheKey, { at: Date.now(), value });
  if (geocodeResponseCache.size <= GEOCODE_CACHE_MAX_ENTRIES) return;
  const firstKey = geocodeResponseCache.keys().next().value;
  if (firstKey) geocodeResponseCache.delete(firstKey);
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = ROUTE_TIMEOUT_MS) {
  const { retries, ...fetchOptions } = options || {};
  const attempts = Math.max(1, Math.min(3, Math.trunc(Number(retries ?? ROUTE_FETCH_RETRIES) || ROUTE_FETCH_RETRIES)));
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...fetchOptions, signal: controller.signal });
      if (!response.ok) {
        const snippet = await response.text().catch(() => "");
        const error = new Error(`HTTP ${response.status}${snippet ? `: ${snippet.slice(0, 160)}` : ""}`);
        if (response.status >= 400 && response.status < 500) throw error;
        lastError = error;
      } else {
        return await response.json();
      }
    } catch (error) {
      if (error && error.name === "AbortError") {
        lastError = new Error("Routing provider timeout");
      } else {
        lastError = error;
      }
      if (String(lastError?.message || "").startsWith("HTTP 4")) {
        throw lastError;
      }
    } finally {
      clearTimeout(timer);
    }

    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, 350 * attempt));
    }
  }

  throw lastError || new Error("Routing provider unavailable");
}

function normalizeGeocodeLimit(value) {
  const n = Math.trunc(Number(value) || 5);
  return Math.max(1, Math.min(8, n));
}

function pickAddressField(address, keys = []) {
  if (!address || typeof address !== "object") return "";
  for (const key of keys) {
    const value = clampText(address[key], 160);
    if (value) return value;
  }
  return "";
}

function sanitizeGeocodeResult(row) {
  if (!row || typeof row !== "object") return null;
  const latRaw = readCoordinate(row.lat, -90, 90);
  const lngRaw = readCoordinate(row.lon ?? row.lng, -180, 180);
  const lat = latRaw === null ? null : roundCoord(latRaw, 6);
  const lng = lngRaw === null ? null : roundCoord(lngRaw, 6);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const address = row.address && typeof row.address === "object" ? row.address : {};
  const display = clampText(row.display_name, 300);
  const name = clampText(
    row.name
      || pickAddressField(address, ["attraction", "amenity", "tourism", "road", "suburb", "neighbourhood", "city", "town", "village"])
      || display.split(",")[0],
    120
  ) || "Selected Location";
  const city = pickAddressField(address, ["city", "town", "village", "municipality", "county", "state_district", "state"]);
  const area = pickAddressField(address, ["suburb", "neighbourhood", "residential", "quarter", "hamlet", "village", "city_district", "locality", "road"]);

  return {
    name,
    label: display || [name, area, city].filter(Boolean).join(", "),
    city,
    area,
    lat,
    lng,
    category: clampText(row.class, 60),
    type: clampText(row.type, 60),
    source: "nominatim"
  };
}

function sanitizeReverseGeocodeResult(row, lat, lng) {
  if (!row || typeof row !== "object") return null;
  const address = row.address && typeof row.address === "object" ? row.address : {};
  const display = clampText(row.display_name, 300);
  const area = pickAddressField(address, [
    "suburb", "neighbourhood", "residential", "quarter", "hamlet", "village",
    "city_district", "locality", "borough", "road"
  ]);
  const city = pickAddressField(address, [
    "city", "town", "village", "municipality", "county", "state_district", "state"
  ]);
  const name = clampText(
    row.name
      || pickAddressField(address, ["attraction", "amenity", "tourism", "road", "suburb", "neighbourhood", "city", "town", "village"])
      || area
      || city
      || display.split(",")[0],
    120
  ) || "Current Location";

  return {
    name,
    label: display || [name, area, city].filter(Boolean).join(", "),
    city,
    area,
    lat: roundCoord(lat, 6),
    lng: roundCoord(lng, 6),
    source: "nominatim"
  };
}

async function searchGeocodeProvider(query, limit = 5) {
  const safeQuery = clampText(query, 180);
  const safeLimit = normalizeGeocodeLimit(limit);
  if (safeQuery.length < 3) return [];

  const cacheKey = `${safeQuery.toLowerCase()}|${safeLimit}`;
  const cached = getCachedGeocode(cacheKey);
  if (cached) return cached;

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", String(safeLimit));
  url.searchParams.set("countrycodes", clampText(process.env.GEOCODE_COUNTRYCODES || "in", 20) || "in");
  url.searchParams.set("q", safeQuery);

  const payload = await fetchJsonWithTimeout(url.toString(), {
    headers: {
      Accept: "application/json",
      "User-Agent": "ExploreX-Backend/1.0 (route-planner geocoding)"
    }
  }, 10_000);

  const rows = (Array.isArray(payload) ? payload : [])
    .map((row) => sanitizeGeocodeResult(row))
    .filter(Boolean)
    .slice(0, safeLimit);

  setCachedGeocode(cacheKey, rows);
  return rows;
}

function osrmProfileForMode(mode) {
  if (mode === "bike") return "driving";
  return "driving";
}

function normalizeAlternativesLimit(value, max = 3) {
  return Math.max(0, Math.min(max, Math.trunc(Number(value) || 0)));
}

function canValhallaReturnAlternatives(points, costing) {
  if (!Array.isArray(points) || points.length !== 2) return false;
  if (String(costing || "").toLowerCase() === "multimodal") return false; // time dependent
  return true;
}

function fallbackAlternativeSeeds(mode) {
  if (mode === "bike") {
    return [
      { distanceFactor: 1.06, durationFactor: 1.12 },
      { distanceFactor: 0.97, durationFactor: 1.18 }
    ];
  }
  if (mode === "bus") {
    return [
      { distanceFactor: 1.04, durationFactor: 1.15 },
      { distanceFactor: 0.99, durationFactor: 1.24 }
    ];
  }
  return [
    { distanceFactor: 1.05, durationFactor: 1.10 },
    { distanceFactor: 0.98, durationFactor: 1.14 }
  ];
}

function estimateRoadModeDurationMinutes(mode, distanceKm, baseRoadMinutes = null) {
  const dist = Math.max(1, Number(distanceKm || 0));
  const baseMinutes = Number.isFinite(Number(baseRoadMinutes))
    ? Math.max(1, Number(baseRoadMinutes))
    : null;
  const estimatedMinutes = estimateDurationMinutes(dist, mode);

  if (mode === "bike") {
    if (baseMinutes == null) return estimatedMinutes;
    return Math.max(1, Math.round(Math.max(estimatedMinutes, baseMinutes * 1.35)));
  }
  if (mode === "bus") {
    if (baseMinutes == null) return estimatedMinutes;
    return Math.max(1, Math.round(Math.max(estimatedMinutes, baseMinutes * 1.15)));
  }
  if (mode === "car") {
    if (baseMinutes != null) return Math.max(1, Math.round(baseMinutes));
    return estimatedMinutes;
  }
  return estimatedMinutes;
}

function applyRoadModeTiming(route, mode) {
  if (!route || typeof route !== "object") return route;
  if (mode === "car") return route;

  const timed = {
    ...route,
    durationMinutes: estimateRoadModeDurationMinutes(mode, route.distanceKm, route.durationMinutes),
    alternatives: Array.isArray(route.alternatives)
      ? route.alternatives.map((alt, index) => ({
        ...alt,
        id: index + 1,
        durationMinutes: estimateRoadModeDurationMinutes(mode, alt.distanceKm, alt.durationMinutes)
      }))
      : []
  };
  return timed;
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, Number(value)));
}

function buildViaPointForAlternative(startPoint, endPoint, variant = {}) {
  const startLat = Number(startPoint?.lat);
  const startLng = Number(startPoint?.lng);
  const endLat = Number(endPoint?.lat);
  const endLng = Number(endPoint?.lng);
  if (![startLat, startLng, endLat, endLng].every((v) => Number.isFinite(v))) return null;

  const segmentKm = Math.max(1, haversineKm(startLat, startLng, endLat, endLng));
  const proportion = clampNumber(variant.proportion ?? 0.5, 0.25, 0.75);
  const direction = Number(variant.direction || 1) >= 0 ? 1 : -1;
  const offsetFactor = clampNumber(variant.offsetFactor ?? 0.08, 0.03, 0.20);

  const baseLat = startLat + ((endLat - startLat) * proportion);
  const baseLng = startLng + ((endLng - startLng) * proportion);

  const latKmPerDeg = 111.32;
  const lngKmPerDeg = Math.max(20, 111.32 * Math.cos((baseLat * Math.PI) / 180));
  const dxKm = (endLng - startLng) * lngKmPerDeg;
  const dyKm = (endLat - startLat) * latKmPerDeg;
  const lenKm = Math.max(0.0001, Math.sqrt((dxKm ** 2) + (dyKm ** 2)));

  const perpX = (-dyKm / lenKm) * direction;
  const perpY = (dxKm / lenKm) * direction;
  const offsetKm = Math.max(2.2, Math.min(20, segmentKm * offsetFactor));

  const viaLng = baseLng + ((perpX * offsetKm) / lngKmPerDeg);
  const viaLat = baseLat + ((perpY * offsetKm) / latKmPerDeg);

  if (!Number.isFinite(viaLat) || !Number.isFinite(viaLng)) return null;
  if (viaLat < -90 || viaLat > 90 || viaLng < -180 || viaLng > 180) return null;
  return {
    lat: roundCoord(viaLat),
    lng: roundCoord(viaLng),
    name: "Alt Via",
    city: ""
  };
}

async function generateRoadAlternativesFromViaPoints(points, mode, limit, primaryDistanceKm, primaryDurationMinutes) {
  const maxItems = normalizeAlternativesLimit(limit, 3);
  if (!maxItems) return [];
  if (!Array.isArray(points) || points.length !== 2) return [];

  const variants = [
    { direction: 1, offsetFactor: 0.075, proportion: 0.50 },
    { direction: -1, offsetFactor: 0.075, proportion: 0.50 },
    { direction: 1, offsetFactor: 0.11, proportion: 0.42 },
    { direction: -1, offsetFactor: 0.11, proportion: 0.58 }
  ];

  const out = [];
  const dedupe = new Set();
  for (const variant of variants) {
    if (out.length >= maxItems) break;
    const via = buildViaPointForAlternative(points[0], points[1], variant);
    if (!via) continue;

    try {
      const reroute = await fetchOsrmRoute([points[0], via, points[1]], "car", 0);
      const adjusted = applyRoadModeTiming(reroute, mode);
      const alt = {
        id: out.length + 1,
        distanceKm: Number(Number(adjusted.distanceKm || 0).toFixed(2)),
        durationMinutes: Math.max(1, Math.round(Number(adjusted.durationMinutes || 0))),
        geometry: adjusted.geometry
      };
      const altKey = `${alt.distanceKm.toFixed(1)}|${alt.durationMinutes}`;
      if (dedupe.has(altKey)) continue;
      dedupe.add(altKey);
      out.push(alt);
    } catch (error) {
      // Ignore single variant failures and continue trying other variants.
    }
  }

  return sanitizeAlternatives(out, primaryDistanceKm, primaryDurationMinutes, maxItems);
}

function buildEstimatedAlternatives(distanceKm, durationMinutes, mode, limit = 2) {
  const maxItems = normalizeAlternativesLimit(limit, 3);
  if (!maxItems) return [];

  const baseDist = Math.max(1, Number(distanceKm || 0));
  const baseMinutes = Math.max(1, Number(durationMinutes || 0));
  const seeds = fallbackAlternativeSeeds(mode);
  const out = [];
  const dedupe = new Set();

  for (let i = 0; i < seeds.length && out.length < maxItems; i += 1) {
    const seed = seeds[i];
    const dist = Number((baseDist * seed.distanceFactor).toFixed(2));
    const mins = Math.max(1, Math.round(baseMinutes * seed.durationFactor));
    const key = `${dist.toFixed(1)}|${mins}`;
    if (dedupe.has(key)) continue;
    dedupe.add(key);
    out.push({
      id: out.length + 1,
      distanceKm: dist,
      durationMinutes: mins
    });
  }

  return out.slice(0, maxItems);
}

function sanitizeAlternatives(alternatives, primaryDistanceKm, primaryDurationMinutes, limit = 2) {
  const maxItems = normalizeAlternativesLimit(limit, 3);
  if (!maxItems) return [];

  const baseDist = Math.max(1, Number(primaryDistanceKm || 0));
  const baseMins = Math.max(1, Number(primaryDurationMinutes || 0));
  const dedupe = new Set();

  return (Array.isArray(alternatives) ? alternatives : [])
    .map((item, index) => ({
      id: index + 1,
      distanceKm: Number(Number(item?.distanceKm || 0).toFixed(2)),
      durationMinutes: Math.max(1, Math.round(Number(item?.durationMinutes || 0))),
      geometry: item?.geometry && item.geometry.type === "LineString" && Array.isArray(item.geometry.coordinates)
        ? {
          type: "LineString",
          coordinates: item.geometry.coordinates
        }
        : null
    }))
    .filter((item) => item.distanceKm > 0 && item.durationMinutes > 0)
    .filter((item) => item.distanceKm <= (baseDist * 1.35) && item.durationMinutes <= (baseMins * 1.65))
    .filter((item) => {
      const key = `${item.distanceKm.toFixed(1)}|${item.durationMinutes}`;
      if (dedupe.has(key)) return false;
      dedupe.add(key);
      return true;
    })
    .slice(0, maxItems);
}

function valhallaCostingForMode(mode) {
  if (mode === "car") return "auto";
  if (mode === "bike") return "bicycle";
  if (mode === "bus") return "bus";
  if (mode === "train") return "multimodal";
  return "auto";
}

function decodePolyline(polyline, precision = 6) {
  if (typeof polyline !== "string" || !polyline) return [];
  const coordinates = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const factor = 10 ** precision;

  while (index < polyline.length) {
    let result = 1;
    let shift = 0;
    let byte;
    do {
      byte = polyline.charCodeAt(index) - 63 - 1;
      index += 1;
      result += byte << shift;
      shift += 5;
    } while (byte >= 0x1f && index < polyline.length);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);

    result = 1;
    shift = 0;
    do {
      byte = polyline.charCodeAt(index) - 63 - 1;
      index += 1;
      result += byte << shift;
      shift += 5;
    } while (byte >= 0x1f && index < polyline.length);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);

    coordinates.push([lat / factor, lng / factor]); // [lat, lng]
  }
  return coordinates;
}

function parseValhallaTrip(trip, mode) {
  if (!trip || typeof trip !== "object") return null;
  const legs = Array.isArray(trip.legs) ? trip.legs : [];
  if (!legs.length) return null;

  const geoCoordinates = [];
  legs.forEach((leg, legIndex) => {
    const shape = clampText(leg?.shape, 2_000_000);
    if (!shape) return;
    const decoded = decodePolyline(shape, 6); // [lat, lng]
    decoded.forEach((pt, pointIndex) => {
      if (!Array.isArray(pt) || pt.length < 2) return;
      if (legIndex > 0 && pointIndex === 0 && geoCoordinates.length) return;
      const lat = roundCoord(pt[0], 6);
      const lng = roundCoord(pt[1], 6);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      geoCoordinates.push([lng, lat]); // GeoJSON [lng, lat]
    });
  });

  if (geoCoordinates.length < 2) return null;

  const summary = trip.summary || {};
  const distanceKm = Number(Number(summary.length || 0).toFixed(2));
  const durationMinutesRaw = Number(summary.time || 0) / 60;
  const durationMinutes = durationMinutesRaw > 0
    ? Math.max(1, Math.round(durationMinutesRaw))
    : estimateDurationMinutes(distanceKm, mode);

  return {
    distanceKm: distanceKm > 0 ? distanceKm : Number(
      geoCoordinates
        .slice(1)
        .reduce((sum, coord, idx) => sum + haversineKm(
          geoCoordinates[idx][1],
          geoCoordinates[idx][0],
          coord[1],
          coord[0]
        ), 0)
        .toFixed(2)
    ),
    durationMinutes,
    geometry: {
      type: "LineString",
      coordinates: geoCoordinates
    }
  };
}

function calculateGeoJsonLineDistanceKm(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) return 0;
  let totalKm = 0;
  for (let i = 1; i < coordinates.length; i += 1) {
    const prev = coordinates[i - 1];
    const cur = coordinates[i];
    if (!Array.isArray(prev) || !Array.isArray(cur)) continue;
    totalKm += haversineKm(Number(prev[1]), Number(prev[0]), Number(cur[1]), Number(cur[0]));
  }
  return Number(totalKm.toFixed(2));
}

function normalizeProviderDistanceKm(rawDistance, geometryDistanceKm) {
  const dist = Number(rawDistance);
  const geomKm = Number(geometryDistanceKm || 0);
  if (!Number.isFinite(dist) || dist <= 0) return Math.max(0, geomKm);
  // Some providers return meters unless units=km is honored; detect and normalize safely.
  if (dist > 1000 && geomKm > 0 && dist > geomKm * 3) {
    return Number((dist / 1000).toFixed(2));
  }
  return Number(dist.toFixed(2));
}

function orsProfileForMode(mode) {
  if (mode === "bike") return "cycling-regular";
  return "driving-car";
}

function parseOpenRouteServiceFeature(feature, mode) {
  if (!feature || typeof feature !== "object") return null;
  const geometry = feature.geometry && feature.geometry.type === "LineString" ? feature.geometry : null;
  const coordinates = Array.isArray(geometry?.coordinates)
    ? geometry.coordinates
      .map((coord) => {
        if (!Array.isArray(coord) || coord.length < 2) return null;
        const lng = roundCoord(coord[0], 6);
        const lat = roundCoord(coord[1], 6);
        return Number.isFinite(lat) && Number.isFinite(lng) ? [lng, lat] : null;
      })
      .filter(Boolean)
    : [];
  if (coordinates.length < 2) return null;

  const summary = feature.properties?.summary || {};
  const geometryDistanceKm = calculateGeoJsonLineDistanceKm(coordinates);
  const distanceKm = normalizeProviderDistanceKm(summary.distance, geometryDistanceKm);
  const durationSeconds = Number(summary.duration || 0);
  const durationMinutes = durationSeconds > 0
    ? Math.max(1, Math.round(durationSeconds / 60))
    : estimateDurationMinutes(distanceKm, mode);
  return {
    distanceKm: distanceKm > 0 ? distanceKm : geometryDistanceKm,
    durationMinutes,
    geometry: {
      type: "LineString",
      coordinates
    }
  };
}

async function fetchOpenRouteServiceRoute(points, mode, alternativesLimit = 0) {
  if (!ROUTE_ORS_API_KEY) {
    throw new Error("OpenRouteService API key is not configured");
  }

  const profile = orsProfileForMode(mode);
  const payload = {
    coordinates: points.map((point) => [Number(point.lng), Number(point.lat)]),
    preference: "shortest",
    units: "km",
    geometry_simplify: false,
    instructions: false,
    continue_straight: false
  };

  const response = await fetchJsonWithTimeout(`${ROUTE_ORS_URL}/v2/directions/${profile}/geojson`, {
    method: "POST",
    headers: {
      Accept: "application/json, application/geo+json",
      "Content-Type": "application/json",
      Authorization: ROUTE_ORS_API_KEY,
      "User-Agent": "ExploreX-Backend/1.0 (route-planner ors)"
    },
    body: JSON.stringify(payload)
  });

  const features = Array.isArray(response?.features) ? response.features : [];
  const primary = parseOpenRouteServiceFeature(features[0], mode);
  if (!primary) {
    throw new Error("OpenRouteService returned invalid route geometry");
  }

  return {
    source: `ors_${profile}`,
    mode,
    distanceKm: Number(Number(primary.distanceKm || 0).toFixed(2)),
    durationMinutes: Math.max(1, Math.round(Number(primary.durationMinutes || 0))),
    geometry: primary.geometry,
    alternatives: []
  };
}

async function fetchValhallaRoute(points, mode, alternativesLimit = 2, options = {}) {
  const costing = clampText(options.costing || valhallaCostingForMode(mode), 40).toLowerCase();
  const alternativesAllowed = canValhallaReturnAlternatives(points, costing);
  const alternatives = alternativesAllowed
    ? normalizeAlternativesLimit(alternativesLimit, ROUTE_VALHALLA_ALTERNATIVES_MAX)
    : 0;

  const payload = {
    locations: points.map((point) => ({ lat: point.lat, lon: point.lng })),
    costing,
    units: "kilometers",
    alternates: alternatives
  };

  if (costing === "multimodal") {
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, "0");
    const d = String(now.getUTCDate()).padStart(2, "0");
    const hh = String(now.getUTCHours()).padStart(2, "0");
    const mm = String(now.getUTCMinutes()).padStart(2, "0");
    payload.date_time = { type: 1, value: `${y}-${m}-${d}T${hh}:${mm}` };
  }

  const response = await fetchJsonWithTimeout(`${ROUTE_VALHALLA_URL}/route`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "ExploreX-Backend/1.0"
    },
    body: JSON.stringify(payload)
  });

  const primary = parseValhallaTrip(response?.trip, mode);
  if (!primary) {
    throw new Error("Valhalla returned invalid trip geometry");
  }

  const rawAlternatives = Array.isArray(response?.alternates)
    ? response.alternates
      .map((alt, idx) => {
        const parsed = parseValhallaTrip(alt?.trip, mode);
        if (!parsed) return null;
        return {
          id: idx + 1,
          distanceKm: Number(Number(parsed.distanceKm || 0).toFixed(2)),
          durationMinutes: Math.max(1, Math.round(Number(parsed.durationMinutes || 0))),
          geometry: parsed.geometry
        };
      })
      .filter(Boolean)
      .slice(0, ROUTE_VALHALLA_ALTERNATIVES_MAX)
    : [];
  const alternativesData = sanitizeAlternatives(
    rawAlternatives,
    primary.distanceKm,
    primary.durationMinutes,
    alternatives
  );

  return {
    source: `valhalla_${costing}`,
    mode,
    distanceKm: Number(Number(primary.distanceKm || 0).toFixed(2)),
    durationMinutes: Math.max(1, Math.round(Number(primary.durationMinutes || 0))),
    geometry: primary.geometry,
    alternatives: alternativesData
  };
}

function buildOsrmRouteUrl(baseUrl, profile, coordinates, altQuery) {
  const base = clampText(baseUrl, 260).replace(/\/+$/, "");
  return `${base}/route/v1/${profile}/${coordinates}?overview=full&geometries=geojson&alternatives=${altQuery}&steps=false`;
}

async function fetchOsrmRoute(points, mode, alternativesLimit = 2) {
  const profile = osrmProfileForMode(mode);
  const coordinates = points.map((point) => `${point.lng},${point.lat}`).join(";");
  const alternatives = normalizeAlternativesLimit(alternativesLimit, 3);
  const altQuery = alternatives > 0 ? "true" : "false";
  let lastError = null;

  for (const baseUrl of ROUTE_OSRM_URLS) {
    try {
      const url = buildOsrmRouteUrl(baseUrl, profile, coordinates, altQuery);
      const payload = await fetchJsonWithTimeout(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "ExploreX-Backend/1.0 (route-planner osrm)"
        }
      });
      const routes = Array.isArray(payload?.routes) ? payload.routes : [];
      if (!routes.length) {
        throw new Error("OSRM returned no routes");
      }

      const sortedRoutes = [...routes].sort((a, b) => (Number(a?.distance) || Number.POSITIVE_INFINITY) - (Number(b?.distance) || Number.POSITIVE_INFINITY));
      const primary = sortedRoutes[0];
      const distanceKm = Number(((Number(primary.distance) || 0) / 1000).toFixed(2));
      const osrmDurationMinutes = Math.max(1, Math.round((Number(primary.duration) || 0) / 60));
      const durationMinutes = (mode === "car" || mode === "bike")
        ? osrmDurationMinutes
        : estimateDurationMinutes(distanceKm, mode);
      const geometry = primary?.geometry && primary.geometry.type === "LineString"
        ? primary.geometry
        : null;
      if (!geometry || !Array.isArray(geometry.coordinates) || geometry.coordinates.length < 2) {
        throw new Error("OSRM returned invalid geometry");
      }

      const rawAlternatives = sortedRoutes.slice(1, alternatives + 1).map((route, idx) => ({
        id: idx + 1,
        distanceKm: Number(((Number(route.distance) || 0) / 1000).toFixed(2)),
        durationMinutes: (mode === "car" || mode === "bike")
          ? Math.max(1, Math.round((Number(route.duration) || 0) / 60))
          : estimateDurationMinutes(((Number(route.distance) || 0) / 1000), mode),
        geometry: route?.geometry && route.geometry.type === "LineString" && Array.isArray(route.geometry.coordinates)
          ? route.geometry
          : null
      }));
      const alternativesData = sanitizeAlternatives(
        rawAlternatives,
        distanceKm,
        durationMinutes,
        alternatives
      );

      return {
        source: baseUrl.includes("routing.openstreetmap.de") ? "osrm_osmde" : "osrm",
        mode,
        distanceKm,
        durationMinutes,
        geometry,
        alternatives: alternativesData
      };
    } catch (error) {
      lastError = error;
      console.warn(`OSRM provider failed (${baseUrl}):`, error.message);
    }
  }

  throw lastError || new Error("OSRM route providers failed");
}
async function fetchOsrmRouteLegByLeg(points, mode, alternativesLimit = 0) {
  if (!Array.isArray(points) || points.length < 3) {
    return fetchOsrmRoute(points, mode, alternativesLimit);
  }

  const combinedCoordinates = [];
  const sources = new Set();
  let totalDistanceKm = 0;
  let totalDurationMinutes = 0;

  for (let index = 0; index < points.length - 1; index += 1) {
    const leg = await fetchOsrmRoute([points[index], points[index + 1]], mode, 0);
    const coordinates = Array.isArray(leg?.geometry?.coordinates) ? leg.geometry.coordinates : [];
    if (coordinates.length < 2) {
      throw new Error("OSRM leg returned invalid geometry");
    }

    sources.add(String(leg.source || "osrm").trim() || "osrm");
    totalDistanceKm += Number(leg.distanceKm || 0);
    totalDurationMinutes += Number(leg.durationMinutes || 0);
    coordinates.forEach((coord, coordIndex) => {
      if (index > 0 && coordIndex === 0) return;
      if (Array.isArray(coord) && coord.length >= 2) {
        combinedCoordinates.push([roundCoord(coord[0], 6), roundCoord(coord[1], 6)]);
      }
    });
  }

  if (combinedCoordinates.length < 2) {
    throw new Error("OSRM leg-by-leg route returned invalid geometry");
  }

  const firstSource = sources.values().next().value || "osrm";
  const source = sources.size === 1 ? `${firstSource}_legs` : "osrm_legs";
  return {
    source,
    mode,
    distanceKm: Number(Number(totalDistanceKm || 0).toFixed(2)),
    durationMinutes: Math.max(1, Math.round(Number(totalDurationMinutes || 0))),
    geometry: {
      type: "LineString",
      coordinates: combinedCoordinates
    },
    alternatives: []
  };
}

async function finalizeRoadRoute(points, mode, alternativesTarget, baseRoadRoute, warnings) {
  const route = applyRoadModeTiming(baseRoadRoute, mode);
  if (!route.alternatives.length && alternativesTarget > 0) {
    const viaAlternatives = await generateRoadAlternativesFromViaPoints(
      points,
      mode,
      alternativesTarget,
      route.distanceKm,
      route.durationMinutes
    );
    if (viaAlternatives.length) {
      route.alternatives = viaAlternatives;
      warnings.push("Alternative options are generated using road reroute variants.");
    }
  }
  if (!route.alternatives.length && alternativesTarget > 0 && !String(route.source || "").startsWith("valhalla")) {
    try {
      const valhallaRoute = await fetchValhallaRoute(points, mode, alternativesTarget);
      if (Array.isArray(valhallaRoute.alternatives) && valhallaRoute.alternatives.length) {
        const sanitized = sanitizeAlternatives(
          valhallaRoute.alternatives,
          route.distanceKm,
          route.durationMinutes,
          alternativesTarget
        );
        if (sanitized.length) {
          route.alternatives = sanitized.map((alt, index) => ({
            ...alt,
            id: index + 1,
            durationMinutes: estimateRoadModeDurationMinutes(mode, alt.distanceKm, alt.durationMinutes)
          }));
          warnings.push("Alternative options are provided by secondary routing provider.");
        }
      }
    } catch (altError) {
      // Keep the primary shortest road route; alternatives are optional.
    }
  }
  if (!route.alternatives.length && alternativesTarget > 0) {
    warnings.push("No additional road alternatives available for this corridor.");
  }
  if (mode === "bus") {
    warnings.push("Bus uses shortest drivable route; timing includes bus-speed adjustment.");
  }
  if (mode === "bike") {
    warnings.push("Bike uses shortest available road/cycle route; timing is adjusted for bike travel speed.");
  }
  return { result: route, warnings };
}
async function computeRouteByMode(points, mode, alternativesLimit = 2) {
  const warnings = [];
  const alternativesTarget = normalizeAlternativesLimit(alternativesLimit, 3);

  if (mode === "flight") {
    warnings.push("Flight mode uses airport-to-airport direct approximation.");
    return {
      result: buildStraightRoute(points, mode, "flight_straight"),
      warnings
    };
  }

  if (mode === "train") {
    try {
      const route = await fetchValhallaRoute(points, mode, alternativesLimit, { costing: "multimodal" });
      warnings.push("Train route uses station-to-station transit/rail data where available.");
      return { result: route, warnings };
    } catch (transitError) {
      console.warn("Valhalla multimodal route failed:", transitError.message);
      warnings.push("Rail-track route data unavailable for this corridor; using train-distance estimate.");
      const fallbackTrain = buildStraightRoute(points, mode, "train_estimate");
      return {
        result: {
          ...fallbackTrain,
          alternatives: alternativesTarget > 0
            ? buildEstimatedAlternatives(fallbackTrain.distanceKm, fallbackTrain.durationMinutes, mode, alternativesTarget)
            : []
        },
        warnings
      };
    }
  }

  if (mode === "car" || mode === "bike" || mode === "bus") {
    let providerWarningAdded = false;

    if (ROUTE_ORS_API_KEY) {
      try {
        const orsRoute = await fetchOpenRouteServiceRoute(points, mode, alternativesTarget);
        return await finalizeRoadRoute(points, mode, alternativesTarget, orsRoute, warnings);
      } catch (orsError) {
        console.warn("OpenRouteService route failed, trying OSRM:", orsError.message);
        warnings.push("Primary road router unavailable; using backup road provider.");
        providerWarningAdded = true;
      }
    }

    try {
      const baseRoadRoute = await fetchOsrmRoute(points, "car", alternativesTarget);
      return await finalizeRoadRoute(points, mode, alternativesTarget, baseRoadRoute, warnings);
    } catch (osrmError) {
      if (points.length > 2) {
        try {
          const legRoute = await fetchOsrmRouteLegByLeg(points, "car", 0);
          warnings.push("Multi-stop road route calculated leg-by-leg for better stop accuracy.");
          return await finalizeRoadRoute(points, mode, alternativesTarget, legRoute, warnings);
        } catch (legError) {
          console.warn("OSRM leg-by-leg road route failed, trying Valhalla:", legError.message);
        }
      } else {
        console.warn("OSRM road route failed, trying Valhalla:", osrmError.message);
      }
      if (!providerWarningAdded) {
        warnings.push("Primary road router unavailable; using backup road provider.");
        providerWarningAdded = true;
      }
      const fallbackBase = await fetchValhallaRoute(points, mode, alternativesTarget);
      return await finalizeRoadRoute(points, mode, alternativesTarget, fallbackBase, warnings);
    }
  }
  throw new Error("Unsupported routing mode");
}

function mapPlaceCategoryToRouteCategory(value) {
  const key = clampText(value, 80).toLowerCase();
  if (key === "religious") return "religious";
  if (key === "nature") return "nature";
  if (key === "food") return "food";
  if (key === "hotel") return "hotel";
  return "tourist";
}

function mapPlaceRow(row) {
  const lat = row?.latitude == null || row?.latitude === "" ? Number.NaN : Number(row.latitude);
  const lng = row?.longitude == null || row?.longitude === "" ? Number.NaN : Number(row.longitude);
  return {
    id: Number(row.id),
    name: row.name || "",
    city: formatDisplayCityName(row.city),
    area: row.area || "",
    category: row.category || "",
    secondaryCategory: row.secondary_category || "",
    cat: mapPlaceCategoryToRouteCategory(row.category),
    image: row.image_url || "",
    desc: row.description || "",
    entryFee: row.entry_fee || "",
    bestTime: row.best_time || "",
    timeRequired: row.time_required || "",
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    featured: Boolean(row.featured),
    priority: Number(row.priority) || 0,
    slug: row.slug || "",
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapServiceRow(row) {
  return {
    id: Number(row.id),
    name: row.name || "",
    city: formatDisplayCityName(row.city),
    area: row.area || "",
    category: row.category || "Transport",
    desc: row.description || "",
    link: row.link || "",
    status: row.status || "active",
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapItineraryItemRow(row) {
  return {
    id: Number(row.id),
    itineraryId: Number(row.itinerary_id),
    placeId: row.place_id == null ? null : Number(row.place_id),
    name: row.stop_name || "",
    city: row.stop_city || "",
    area: row.stop_area || "",
    category: row.stop_category || "",
    sequence: Number(row.sequence_no) || 1,
    notes: row.notes || "",
    meta: safeJsonParse(row.meta_json, {}),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapItineraryRow(row, items = []) {
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    title: row.title || "",
    fromCity: row.from_city || "",
    toCity: row.to_city || "",
    mode: row.travel_mode || "car",
    distanceKm: row.distance_km == null ? null : Number(row.distance_km),
    durationMinutes: row.duration_minutes == null ? null : Number(row.duration_minutes),
    travelDate: row.travel_date ? String(row.travel_date) : "",
    notes: row.notes || "",
    meta: safeJsonParse(row.meta_json, {}),
    items,
    isDeleted: Boolean(row.deleted_at),
    deletedAt: toIso(row.deleted_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function normalizeStopInput(item, index = 0) {
  if (!item || typeof item !== "object") return null;
  const placeId = parsePositiveInt(item.placeId || item.place_id || item.id || 0);
  const nameRaw = clampText(item.name || item.stopName || item.stop_name, 160);
  const name = nameRaw || (placeId ? `Place #${placeId}` : "");
  if (!name) return null;

  const city = clampText(item.city || item.stopCity || item.stop_city, 120);
  const area = clampText(item.area || item.stopArea || item.stop_area, 160);
  const category = clampText(item.category || item.stopCategory || item.stop_category, 80);
  const notes = clampText(item.notes || item.note, 255);
  const seq = parsePositiveInt(item.sequence || item.sequenceNo || item.sequence_no || (index + 1)) || (index + 1);

  const meta = normalizeMetaObject(item.meta);
  const lat = Number(item.lat ?? item.latitude);
  const lng = Number(item.lng ?? item.longitude);
  if (Number.isFinite(lat)) meta.lat = lat;
  if (Number.isFinite(lng)) meta.lng = lng;
  return {
    placeId,
    name,
    city,
    area,
    category,
    notes,
    sequence: seq,
    meta
  };
}

function normalizeStopsInput(input, limit = 40) {
  const arr = Array.isArray(input) ? input : [];
  const rows = arr
    .slice(0, limit)
    .map((item, index) => normalizeStopInput(item, index))
    .filter(Boolean)
    .sort((a, b) => a.sequence - b.sequence);
  return rows.map((row, index) => ({ ...row, sequence: index + 1 }));
}

async function resolvePersistableItineraryStops(stops) {
  if (!Array.isArray(stops) || !stops.length) return [];
  const ids = [...new Set(
    stops
      .map((stop) => Number(stop.placeId || 0))
      .filter((id) => Number.isFinite(id) && id > 0)
  )];
  if (!ids.length) return stops;

  const placeholders = ids.map(() => "?").join(", ");
  const [rows] = await pool.query(`SELECT id FROM places WHERE id IN (${placeholders})`, ids);
  const existing = new Set(rows.map((row) => Number(row.id)));

  return stops.map((stop) => {
    const placeId = Number(stop.placeId || 0);
    if (!placeId || existing.has(placeId)) return stop;
    return {
      ...stop,
      placeId: null,
      meta: {
        ...(stop.meta || {}),
        originalPlaceId: placeId,
        placeIdNote: "Original stop id was not found in places table when saving route."
      }
    };
  });
}

function resolveAuthUserId(req) {
  const id = Number(req.auth?.userId || 0);
  return Number.isFinite(id) && id > 0 ? Math.round(id) : null;
}

async function fetchItineraryItemsByIds(itineraryIds) {
  if (!Array.isArray(itineraryIds) || !itineraryIds.length) return new Map();
  const ids = itineraryIds
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (!ids.length) return new Map();

  const placeholders = ids.map(() => "?").join(", ");
  const [rows] = await pool.query(
    `SELECT *
     FROM itinerary_items
     WHERE itinerary_id IN (${placeholders})
     ORDER BY itinerary_id ASC, sequence_no ASC, id ASC`,
    ids
  );

  const grouped = new Map();
  rows.forEach((row) => {
    const itineraryId = Number(row.itinerary_id);
    if (!grouped.has(itineraryId)) grouped.set(itineraryId, []);
    grouped.get(itineraryId).push(mapItineraryItemRow(row));
  });
  return grouped;
}

async function fetchOwnedItinerary(itineraryId, userId, includeDeleted = false) {
  const whereDeleted = includeDeleted ? "" : "AND deleted_at IS NULL";
  const [rows] = await pool.query(
    `SELECT *
     FROM itineraries
     WHERE id = ? AND user_id = ? ${whereDeleted}
     LIMIT 1`,
    [itineraryId, userId]
  );
  return rows.length ? rows[0] : null;
}

// Free geocoding proxy for route planner search/autocomplete.
// Backend proxy keeps API usage in one place and lets the frontend fail gracefully.
router.get("/geocode/search", async (req, res) => {
  try {
    const query = clampText(req.query.q || req.query.search, 180);
    if (query.length < 3) {
      return res.status(400).json({
        success: false,
        message: "Search text must be at least 3 characters"
      });
    }

    const limit = normalizeGeocodeLimit(req.query.limit);
    const data = await searchGeocodeProvider(query, limit);
    return res.status(200).json({
      success: true,
      source: "nominatim",
      data
    });
  } catch (error) {
    console.error("Geocode search error:", error.message || error);
    return res.status(502).json({
      success: false,
      message: "Location search is temporarily unavailable"
    });
  }
});

router.get("/geocode/reverse", async (req, res) => {
  try {
    const lat = readCoordinate(req.query.lat ?? req.query.latitude, -90, 90);
    const lng = readCoordinate(req.query.lng ?? req.query.lon ?? req.query.longitude, -180, 180);
    if (lat === null || lng === null) {
      return res.status(400).json({
        success: false,
        message: "Valid lat and lng are required"
      });
    }

    const cacheKey = `reverse|${roundCoord(lat, 5)},${roundCoord(lng, 5)}`;
    const cached = getCachedGeocode(cacheKey);
    if (cached) {
      return res.status(200).json({ success: true, source: "cache", data: cached });
    }

    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("zoom", "18");
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lng));

    const payload = await fetchJsonWithTimeout(url.toString(), {
      headers: {
        Accept: "application/json",
        "User-Agent": "ExploreX-Backend/1.0 (route-planner reverse-geocoding)"
      }
    }, 10_000);

    const data = sanitizeReverseGeocodeResult(payload, lat, lng);
    if (!data) {
      return res.status(404).json({ success: false, message: "Location area not found" });
    }

    setCachedGeocode(cacheKey, data);
    return res.status(200).json({
      success: true,
      source: "nominatim",
      data
    });
  } catch (error) {
    console.error("Reverse geocode error:", error.message || error);
    return res.status(502).json({
      success: false,
      message: "Location area lookup is temporarily unavailable"
    });
  }
});

// City catalog for planner UI.
router.get("/cities", async (req, res) => {
  try {
    const search = clampText(req.query.search, 120).toLowerCase();
    const limit = Math.min(300, Math.max(1, Math.trunc(Number(req.query.limit) || 200)));

    const [placeRows] = await pool.query(
      `SELECT city, COUNT(*) AS place_count
       FROM places
       WHERE is_deleted = 0 AND status = 'published'
       GROUP BY city`
    );
    const [serviceRows] = await pool.query(
      `SELECT city, COUNT(*) AS service_count
       FROM city_services
       WHERE status = 'active'
         AND LOWER(TRIM(city)) NOT IN ('all', 'all india', 'selected cities', 'pan india', 'nationwide')
       GROUP BY city`
    );

    const byCity = new Map();
    placeRows.forEach((row) => {
      const rawName = clampText(row.city, 120);
      if (!rawName) return;
      const key = rawName.toLowerCase();
      const name = formatDisplayCityName(rawName);
      if (!byCity.has(key)) {
        byCity.set(key, { name, placeCount: 0, serviceCount: 0, totalCount: 0 });
      }
      const entry = byCity.get(key);
      entry.placeCount += Number(row.place_count) || 0;
      entry.totalCount = entry.placeCount + entry.serviceCount;
    });
    serviceRows.forEach((row) => {
      const rawName = clampText(row.city, 120);
      if (!rawName) return;
      const key = rawName.toLowerCase();
      const name = formatDisplayCityName(rawName);
      if (!byCity.has(key)) {
        byCity.set(key, { name, placeCount: 0, serviceCount: 0, totalCount: 0 });
      }
      const entry = byCity.get(key);
      entry.serviceCount += Number(row.service_count) || 0;
      entry.totalCount = entry.placeCount + entry.serviceCount;
    });

    let cities = [...byCity.values()];
    if (search) {
      cities = cities.filter((city) => city.name.toLowerCase().includes(search));
    }
    cities.sort((a, b) => {
      if (b.totalCount !== a.totalCount) return b.totalCount - a.totalCount;
      return a.name.localeCompare(b.name);
    });

    return res.status(200).json({
      success: true,
      data: cities.slice(0, limit)
    });
  } catch (error) {
    console.error("Cities GET error:", error);
    return res.status(500).json({ success: false, message: "Server error while fetching cities" });
  }
});

router.get("/cities/:city/places", async (req, res) => {
  try {
    const city = parseCityParam(req.params.city);
    if (!city) {
      return res.status(400).json({ success: false, message: "City is required" });
    }

    const search = clampText(req.query.search, 120).toLowerCase();
    const category = clampText(req.query.category, 80);
    const limit = Math.min(500, Math.max(1, Math.trunc(Number(req.query.limit) || 200)));
    const offset = Math.max(0, Math.trunc(Number(req.query.offset) || 0));

    const where = ["is_deleted = 0", "status = 'published'"];
    const params = [];

    if (city.toLowerCase() !== "all") {
      where.push("LOWER(city) = LOWER(?)");
      params.push(city);
    }
    if (category && category.toLowerCase() !== "all") {
      where.push("(LOWER(category) = LOWER(?) OR LOWER(COALESCE(secondary_category, '')) = LOWER(?))");
      params.push(category, category);
    }
    if (search) {
      const q = `%${search}%`;
      where.push("(LOWER(name) LIKE ? OR LOWER(area) LIKE ? OR LOWER(description) LIKE ?)");
      params.push(q, q, q);
    }

    const whereSql = `WHERE ${where.join(" AND ")}`;
    const [rows] = await pool.query(
      `SELECT *
       FROM places
       ${whereSql}
       ORDER BY featured DESC, priority DESC, updated_at DESC, id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS c
       FROM places
       ${whereSql}`,
      params
    );

    return res.status(200).json({
      success: true,
      data: rows.map(mapPlaceRow),
      pagination: {
        total: Number(countRows[0]?.c || 0),
        limit,
        offset
      }
    });
  } catch (error) {
    console.error("City places GET error:", error);
    return res.status(500).json({ success: false, message: "Server error while fetching city places" });
  }
});

router.get("/cities/:city/services", async (req, res) => {
  try {
    const city = parseCityParam(req.params.city);
    if (!city) {
      return res.status(400).json({ success: false, message: "City is required" });
    }

    const search = clampText(req.query.search, 120).toLowerCase();
    const category = clampText(req.query.category, 80);
    const limit = Math.min(500, Math.max(1, Math.trunc(Number(req.query.limit) || 200)));
    const offset = Math.max(0, Math.trunc(Number(req.query.offset) || 0));

    const where = ["status = 'active'"];
    const params = [];

    if (city.toLowerCase() !== "all") {
      where.push("(LOWER(city) = LOWER(?) OR LOWER(TRIM(city)) IN ('all', 'all india', 'selected cities', 'pan india', 'nationwide'))");
      params.push(city);
    }
    if (category && category.toLowerCase() !== "all") {
      where.push("(LOWER(category) = LOWER(?) OR LOWER(COALESCE(secondary_category, '')) = LOWER(?))");
      params.push(category, category);
    }
    if (search) {
      const q = `%${search}%`;
      where.push("(LOWER(name) LIKE ? OR LOWER(area) LIKE ? OR LOWER(description) LIKE ?)");
      params.push(q, q, q);
    }

    const whereSql = `WHERE ${where.join(" AND ")}`;
    const [rows] = await pool.query(
      `SELECT *
       FROM city_services
       ${whereSql}
       ORDER BY updated_at DESC, id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS c
       FROM city_services
       ${whereSql}`,
      params
    );

    return res.status(200).json({
      success: true,
      data: rows.map(mapServiceRow),
      pagination: {
        total: Number(countRows[0]?.c || 0),
        limit,
        offset
      }
    });
  } catch (error) {
    console.error("City services GET error:", error);
    return res.status(500).json({ success: false, message: "Server error while fetching city services" });
  }
});

router.post("/routes/compute", async (req, res) => {
  try {
    const mode = normalizeMode(req.body?.mode, "car");
    const submittedPoints = req.body?.points || req.body?.coordinates;
    const submittedPointCount = Array.isArray(submittedPoints) ? submittedPoints.length : 0;
    const rawPoints = normalizeRoutePoints(submittedPoints, 16);
    if (rawPoints.length < 2) {
      return res.status(400).json({
        success: false,
        message: "At least 2 valid route points are required"
      });
    }

    const sanitizedInput = sanitizePointsForMode(mode, rawPoints);
    const points = Array.isArray(sanitizedInput.points) ? sanitizedInput.points : [];
    if (points.length < 2) {
      return res.status(400).json({
        success: false,
        message: "Could not build route points for selected mode"
      });
    }

    const alternativesLimit = req.body?.alternatives ?? 2;
    const cacheKey = getRouteCacheKey(mode, points, alternativesLimit);
    const cached = getCachedRoute(cacheKey);
    if (cached) {
      return res.status(200).json({
        success: true,
        data: {
          ...cached,
          cached: true
        }
      });
    }

    let result;
    let warnings = submittedPointCount > 16
      ? ["Only the first 16 route points were used. Please remove extra stops for accurate routing."]
      : [];
    if (Array.isArray(sanitizedInput.warnings) && sanitizedInput.warnings.length) {
      warnings = [...warnings, ...sanitizedInput.warnings];
    }
    try {
      const computed = await computeRouteByMode(points, mode, alternativesLimit);
      result = computed.result;
      if (Array.isArray(computed.warnings) && computed.warnings.length) {
        warnings = [...warnings, ...computed.warnings];
      }
    } catch (error) {
      console.warn("Route providers failed, using estimated local route:", error.message);
      result = buildStraightRoute(points, mode, "estimated_route");
      warnings = [...warnings, "Live road provider unavailable; showing estimated route line."];
    }

    const payload = {
      mode,
      source: result.source,
      distanceKm: Number(Number(result.distanceKm || 0).toFixed(2)),
      durationMinutes: Math.max(1, Math.round(Number(result.durationMinutes || 0))),
      geometry: result.geometry,
      alternatives: Array.isArray(result.alternatives) ? result.alternatives : [],
      points: points.map((point) => ({
        lat: point.lat,
        lng: point.lng,
        name: point.name,
        city: point.city
      })),
      warnings
    };

    setCachedRoute(cacheKey, payload);
    return res.status(200).json({
      success: true,
      data: payload
    });
  } catch (error) {
    console.error("Route compute POST error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while computing route"
    });
  }
});

router.post("/itineraries", requireAuth, async (req, res) => {
  const userId = resolveAuthUserId(req);
  if (!userId) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  const fromCity = clampText(req.body?.fromCity || req.body?.from || req.body?.sourceCity, 120);
  const toCity = clampText(req.body?.toCity || req.body?.to || req.body?.destinationCity, 120);
  if (!fromCity || !toCity) {
    return res.status(400).json({
      success: false,
      message: "fromCity and toCity are required"
    });
  }
  if (cityCompareKey(fromCity) === cityCompareKey(toCity)) {
    return res.status(400).json({
      success: false,
      message: "fromCity and toCity cannot be the same"
    });
  }

  const mode = normalizeMode(req.body?.mode || req.body?.travelMode, "car");
  const title = clampText(req.body?.title, 160) || `${fromCity} to ${toCity}`;
  const distanceKm = parseNonNegativeInt(req.body?.distanceKm || req.body?.distance_km);
  const durationMinutes = parseNonNegativeInt(req.body?.durationMinutes || req.body?.duration_minutes);
  const travelDate = normalizeTravelDate(req.body?.travelDate || req.body?.travel_date);
  const notes = clampText(req.body?.notes, 4000);
  const meta = normalizeMetaObject(req.body?.meta);
  const stops = normalizeStopsInput(req.body?.stops || req.body?.items);

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [result] = await connection.query(
      `INSERT INTO itineraries
        (user_id, title, from_city, to_city, travel_mode, distance_km, duration_minutes, travel_date, notes, meta_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        title,
        fromCity,
        toCity,
        mode,
        distanceKm,
        durationMinutes,
        travelDate,
        notes || null,
        safeJsonStringify(meta, "{}")
      ]
    );
    const itineraryId = Number(result.insertId);

    const stopsForInsert = await resolvePersistableItineraryStops(stops);
    if (stopsForInsert.length) {
      const values = [];
      const placeholders = stopsForInsert
        .map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .join(", ");
      stopsForInsert.forEach((stop, index) => {
        values.push(
          itineraryId,
          stop.placeId,
          stop.name,
          stop.city || null,
          stop.area || null,
          stop.category || null,
          index + 1,
          stop.notes || null,
          safeJsonStringify(stop.meta, "{}")
        );
      });

      await connection.query(
        `INSERT INTO itinerary_items
          (itinerary_id, place_id, stop_name, stop_city, stop_area, stop_category, sequence_no, notes, meta_json)
         VALUES ${placeholders}`,
        values
      );
    }

    await connection.commit();

    const created = await fetchOwnedItinerary(itineraryId, userId, true);
    const itemsById = await fetchItineraryItemsByIds([itineraryId]);
    return res.status(201).json({
      success: true,
      message: "Itinerary saved",
      data: mapItineraryRow(created, itemsById.get(itineraryId) || [])
    });
  } catch (error) {
    await connection.rollback();
    console.error("Itinerary POST error:", error);
    return res.status(500).json({ success: false, message: "Server error while saving itinerary" });
  } finally {
    connection.release();
  }
});

router.get("/itineraries/me", requireAuth, async (req, res) => {
  const userId = resolveAuthUserId(req);
  if (!userId) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  try {
    const includeDeleted = toBoolean(req.query.includeDeleted, false);
    const includeItems = toBoolean(req.query.includeItems, true);
    const search = clampText(req.query.search, 120).toLowerCase();
    const mode = normalizeMode(req.query.mode, "");
    const limit = Math.min(200, Math.max(1, Math.trunc(Number(req.query.limit) || 30)));
    const offset = Math.max(0, Math.trunc(Number(req.query.offset) || 0));

    const where = ["user_id = ?"];
    const params = [userId];
    if (!includeDeleted) {
      where.push("deleted_at IS NULL");
    }
    if (mode) {
      where.push("travel_mode = ?");
      params.push(mode);
    }
    if (search) {
      const q = `%${search}%`;
      where.push("(LOWER(title) LIKE ? OR LOWER(from_city) LIKE ? OR LOWER(to_city) LIKE ?)");
      params.push(q, q, q);
    }

    const whereSql = `WHERE ${where.join(" AND ")}`;
    const [rows] = await pool.query(
      `SELECT *
       FROM itineraries
       ${whereSql}
       ORDER BY updated_at DESC, id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS c
       FROM itineraries
       ${whereSql}`,
      params
    );

    const ids = rows.map((row) => Number(row.id));
    const itemsById = includeItems ? await fetchItineraryItemsByIds(ids) : new Map();

    return res.status(200).json({
      success: true,
      data: rows.map((row) => mapItineraryRow(row, includeItems ? (itemsById.get(Number(row.id)) || []) : [])),
      pagination: {
        total: Number(countRows[0]?.c || 0),
        limit,
        offset
      }
    });
  } catch (error) {
    console.error("Itinerary list GET error:", error);
    return res.status(500).json({ success: false, message: "Server error while fetching itineraries" });
  }
});

router.delete("/itineraries/me", requireAuth, async (req, res) => {
  const userId = resolveAuthUserId(req);
  if (!userId) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  try {
    const [result] = await pool.query(
      `UPDATE itineraries
       SET deleted_at = NOW()
       WHERE user_id = ? AND deleted_at IS NULL`,
      [userId]
    );

    return res.status(200).json({
      success: true,
      message: "Itineraries deleted",
      deletedCount: Number(result.affectedRows || 0)
    });
  } catch (error) {
    console.error("Itinerary bulk DELETE error:", error);
    return res.status(500).json({ success: false, message: "Server error while deleting itineraries" });
  }
});

router.get("/itineraries/:id", requireAuth, async (req, res) => {
  const userId = resolveAuthUserId(req);
  if (!userId) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  try {
    const itineraryId = parsePositiveInt(req.params.id);
    if (!itineraryId) {
      return res.status(400).json({ success: false, message: "Invalid itinerary id" });
    }
    const includeDeleted = toBoolean(req.query.includeDeleted, false);
    const includeItems = toBoolean(req.query.includeItems, true);

    const row = await fetchOwnedItinerary(itineraryId, userId, includeDeleted);
    if (!row) {
      return res.status(404).json({ success: false, message: "Itinerary not found" });
    }

    const itemsById = includeItems ? await fetchItineraryItemsByIds([itineraryId]) : new Map();
    return res.status(200).json({
      success: true,
      data: mapItineraryRow(row, includeItems ? (itemsById.get(itineraryId) || []) : [])
    });
  } catch (error) {
    console.error("Itinerary single GET error:", error);
    return res.status(500).json({ success: false, message: "Server error while fetching itinerary" });
  }
});

router.put("/itineraries/:id", requireAuth, async (req, res) => {
  const userId = resolveAuthUserId(req);
  if (!userId) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  const itineraryId = parsePositiveInt(req.params.id);
  if (!itineraryId) {
    return res.status(400).json({ success: false, message: "Invalid itinerary id" });
  }

  try {
    const existing = await fetchOwnedItinerary(itineraryId, userId, true);
    if (!existing) {
      return res.status(404).json({ success: false, message: "Itinerary not found" });
    }
    if (existing.deleted_at) {
      return res.status(400).json({
        success: false,
        message: "Deleted itinerary cannot be updated"
      });
    }

    const fromCity = clampText(req.body?.fromCity || req.body?.from || req.body?.sourceCity, 120) || existing.from_city;
    const toCity = clampText(req.body?.toCity || req.body?.to || req.body?.destinationCity, 120) || existing.to_city;
    if (!fromCity || !toCity) {
      return res.status(400).json({
        success: false,
        message: "fromCity and toCity are required"
      });
    }
    if (cityCompareKey(fromCity) === cityCompareKey(toCity)) {
      return res.status(400).json({
        success: false,
        message: "fromCity and toCity cannot be the same"
      });
    }

    const title = clampText(req.body?.title, 160) || existing.title || `${fromCity} to ${toCity}`;
    const mode = normalizeMode(req.body?.mode || req.body?.travelMode || existing.travel_mode, "car");
    const distanceKm = req.body?.distanceKm == null && req.body?.distance_km == null
      ? (existing.distance_km == null ? null : Number(existing.distance_km))
      : parseNonNegativeInt(req.body?.distanceKm ?? req.body?.distance_km);
    const durationMinutes = req.body?.durationMinutes == null && req.body?.duration_minutes == null
      ? (existing.duration_minutes == null ? null : Number(existing.duration_minutes))
      : parseNonNegativeInt(req.body?.durationMinutes ?? req.body?.duration_minutes);
    const travelDate = req.body?.travelDate == null && req.body?.travel_date == null
      ? (existing.travel_date ? String(existing.travel_date) : null)
      : normalizeTravelDate(req.body?.travelDate ?? req.body?.travel_date);
    const notes = req.body?.notes == null
      ? clampText(existing.notes, 4000)
      : clampText(req.body?.notes, 4000);
    const meta = req.body?.meta == null
      ? safeJsonParse(existing.meta_json, {})
      : normalizeMetaObject(req.body?.meta);

    const stopsProvided = Array.isArray(req.body?.stops) || Array.isArray(req.body?.items);
    const stops = stopsProvided ? normalizeStopsInput(req.body?.stops || req.body?.items) : [];

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      await connection.query(
        `UPDATE itineraries
         SET title = ?, from_city = ?, to_city = ?, travel_mode = ?, distance_km = ?, duration_minutes = ?,
             travel_date = ?, notes = ?, meta_json = ?
         WHERE id = ? AND user_id = ? AND deleted_at IS NULL
         LIMIT 1`,
        [
          title,
          fromCity,
          toCity,
          mode,
          distanceKm,
          durationMinutes,
          travelDate,
          notes || null,
          safeJsonStringify(meta, "{}"),
          itineraryId,
          userId
        ]
      );

      if (stopsProvided) {
        await connection.query(
          "DELETE FROM itinerary_items WHERE itinerary_id = ?",
          [itineraryId]
        );

        const stopsForInsert = await resolvePersistableItineraryStops(stops);
        if (stopsForInsert.length) {
          const values = [];
          const placeholders = stopsForInsert
            .map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .join(", ");
          stopsForInsert.forEach((stop, index) => {
            values.push(
              itineraryId,
              stop.placeId,
              stop.name,
              stop.city || null,
              stop.area || null,
              stop.category || null,
              index + 1,
              stop.notes || null,
              safeJsonStringify(stop.meta, "{}")
            );
          });

          await connection.query(
            `INSERT INTO itinerary_items
              (itinerary_id, place_id, stop_name, stop_city, stop_area, stop_category, sequence_no, notes, meta_json)
             VALUES ${placeholders}`,
            values
          );
        }
      }

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    const updated = await fetchOwnedItinerary(itineraryId, userId, false);
    const itemsById = await fetchItineraryItemsByIds([itineraryId]);
    return res.status(200).json({
      success: true,
      message: "Itinerary updated",
      data: mapItineraryRow(updated, itemsById.get(itineraryId) || [])
    });
  } catch (error) {
    console.error("Itinerary PUT error:", error);
    return res.status(500).json({ success: false, message: "Server error while updating itinerary" });
  }
});

router.delete("/itineraries/:id", requireAuth, async (req, res) => {
  const userId = resolveAuthUserId(req);
  if (!userId) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  try {
    const itineraryId = parsePositiveInt(req.params.id);
    if (!itineraryId) {
      return res.status(400).json({ success: false, message: "Invalid itinerary id" });
    }

    const existing = await fetchOwnedItinerary(itineraryId, userId, true);
    if (!existing) {
      return res.status(404).json({ success: false, message: "Itinerary not found" });
    }
    if (existing.deleted_at) {
      return res.status(200).json({ success: true, message: "Itinerary already deleted" });
    }

    await pool.query(
      `UPDATE itineraries
       SET deleted_at = NOW()
       WHERE id = ? AND user_id = ? AND deleted_at IS NULL
       LIMIT 1`,
      [itineraryId, userId]
    );

    return res.status(200).json({
      success: true,
      message: "Itinerary deleted"
    });
  } catch (error) {
    console.error("Itinerary DELETE error:", error);
    return res.status(500).json({ success: false, message: "Server error while deleting itinerary" });
  }
});

module.exports = router;










