const express = require("express");
const bcrypt = require("bcryptjs");
const { pool, ensureDefaultKumbhItems, ensureDefaultKumbhSettings } = require("../config/db");
const { requireAdminAuth, requireSuperAdmin, isSuperAdminIdentity, isProtectedAdminIdentity } = require("../middleware/auth.middleware");
const {
  ADMIN_PERMISSION_DEFINITIONS,
  ADMIN_PERMISSION_KEYS,
  defaultPermissionMap,
  getAdminPermissionMap,
  normalizePermissionKey,
  enforceMappedAdminPermission
} = require("../middleware/adminPermissions.middleware");
const { runPublishDueOnce } = require("../jobs/publishDue.job");
const { toUsernameSeed } = require("../utils/username");
const { signAdminPinToken, verifyAdminPinToken } = require("../utils/jwt");
const { createDeletedUserIdentity, getDisplayEmail, getDisplayUsername } = require("../utils/deletedUserIdentity");

const router = express.Router();

const PLACE_STATUSES = new Set(["draft", "review", "scheduled", "published", "archived"]);
const SERVICE_STATUSES = new Set(["active", "inactive"]);
const SERVICE_CATEGORIES = new Set(["Transport", "Food", "Grocery", "Emergency"]);
const SERVICE_EVENT_TYPES = new Set(["view", "open", "call", "search"]);
const SERVICE_REPORT_STATUSES = new Set(["pending", "reviewed", "resolved"]);
const KUMBH_ITEM_TYPE_ORDER = ["ticker", "crowd", "date", "facility", "helpline", "route", "tip", "moment"];
const KUMBH_ITEM_TYPES = new Set(KUMBH_ITEM_TYPE_ORDER);
const KUMBH_ITEM_STATUSES = new Set(["active", "draft", "archived"]);
const MEMORY_STATUSES = new Set(["pending", "approved", "rejected"]);
const USER_ROLES = new Set(["Traveller", "Guide", "Admin"]);
const USER_ACCOUNT_STATUSES = new Set(["active", "inactive", "blocked", "deleted"]);
const BACKUP_EXTRA_TABLES = [
  {
    key: "searchAnalytics",
    aliases: ["searchAnalytics", "search_analytics"],
    table: "search_analytics",
    orderBy: "id ASC",
    columns: ["id", "query", "normalized_query", "city", "category", "user_uid", "result_count", "source", "created_at"],
    dateTimeColumns: ["created_at"]
  },
  {
    key: "cityServiceEvents",
    aliases: ["cityServiceEvents", "city_service_events"],
    table: "city_service_events",
    orderBy: "id ASC",
    columns: ["id", "service_id", "event_type", "user_uid", "meta_json", "created_at"],
    jsonColumns: ["meta_json"],
    dateTimeColumns: ["created_at"]
  },
  {
    key: "cityServiceReports",
    aliases: ["cityServiceReports", "city_service_reports"],
    table: "city_service_reports",
    orderBy: "id ASC",
    columns: ["id", "service_id", "reporter_uid", "reason", "details", "status", "created_at", "updated_at"],
    dateTimeColumns: ["created_at", "updated_at"]
  },
  {
    key: "cityServiceRatings",
    aliases: ["cityServiceRatings", "city_service_ratings"],
    table: "city_service_ratings",
    orderBy: "id ASC",
    columns: ["id", "service_id", "user_uid", "rating", "review", "created_at", "updated_at"],
    dateTimeColumns: ["created_at", "updated_at"]
  },
  {
    key: "hotelBookings",
    aliases: ["hotelBookings", "hotel_bookings"],
    table: "hotel_bookings",
    orderBy: "created_at ASC",
    columns: ["id", "user_uid", "user_name", "hotel_id", "owner_hotel_id", "hotel_place_id", "hotel_name", "place_name", "city", "room_key", "room_name", "checkin", "checkout", "guests", "rooms", "nights", "subtotal", "taxes", "total", "commission_rate", "platform_fee", "commission_amount", "hotel_payout", "payout_status", "status", "assigned_room_numbers_json", "meta_json", "created_at", "updated_at"],
    jsonColumns: ["assigned_room_numbers_json", "meta_json"],
    dateTimeColumns: ["created_at", "updated_at"]
  },
  {
    key: "hotelOwnerStates",
    aliases: ["hotelOwnerStates", "hotel_owner_states"],
    table: "hotel_owner_states",
    orderBy: "hotel_id ASC",
    columns: ["hotel_id", "hotel_name", "profile_json", "rooms_json", "settings_json", "created_at", "updated_at"],
    jsonColumns: ["profile_json", "rooms_json", "settings_json"],
    dateTimeColumns: ["created_at", "updated_at"]
  },
  {
    key: "hotelOwnerLogins",
    aliases: ["hotelOwnerLogins", "hotel_owner_logins"],
    table: "hotel_owner_logins",
    orderBy: "hotel_id ASC",
    columns: ["hotel_id", "hotel_name", "password_hash", "place_id", "hotel_place_id", "city", "area", "status", "last_login_at", "created_at", "updated_at"],
    dateTimeColumns: ["last_login_at", "created_at", "updated_at"]
  },
  {
    key: "hotelEnquiries",
    aliases: ["hotelEnquiries", "hotel_enquiries"],
    table: "hotel_enquiries",
    orderBy: "created_at ASC",
    columns: ["id", "user_uid", "user_name", "phone", "email", "topic", "message", "reply_note", "hotel_id", "owner_hotel_id", "hotel_place_id", "hotel_name", "place_name", "city", "room_key", "room_name", "checkin", "checkout", "guests", "rooms", "status", "meta_json", "created_at", "updated_at"],
    jsonColumns: ["meta_json"],
    dateTimeColumns: ["created_at", "updated_at"]
  },
  {
    key: "itineraries",
    aliases: ["itineraries"],
    table: "itineraries",
    orderBy: "id ASC",
    columns: ["id", "user_id", "title", "from_city", "to_city", "travel_mode", "distance_km", "duration_minutes", "travel_date", "notes", "meta_json", "deleted_at", "created_at", "updated_at"],
    jsonColumns: ["meta_json"],
    dateOnlyColumns: ["travel_date"],
    dateTimeColumns: ["deleted_at", "created_at", "updated_at"]
  },
  {
    key: "itineraryItems",
    aliases: ["itineraryItems", "itinerary_items"],
    table: "itinerary_items",
    orderBy: "id ASC",
    columns: ["id", "itinerary_id", "place_id", "stop_name", "stop_city", "stop_area", "stop_category", "sequence_no", "notes", "meta_json", "created_at", "updated_at"],
    jsonColumns: ["meta_json"],
    dateTimeColumns: ["created_at", "updated_at"]
  },
  {
    key: "supportTickets",
    aliases: ["supportTickets", "support_tickets"],
    table: "support_tickets",
    orderBy: "id ASC",
    columns: ["id", "user_id", "subject", "status", "resolved_at", "created_at", "updated_at"],
    dateTimeColumns: ["resolved_at", "created_at", "updated_at"]
  },
  {
    key: "supportMessages",
    aliases: ["supportMessages", "support_messages"],
    table: "support_messages",
    orderBy: "id ASC",
    columns: ["id", "ticket_id", "sender_type", "sender_id", "message", "is_read", "created_at"],
    dateTimeColumns: ["created_at"]
  }
];

const BACKUP_EXTRA_DELETE_ORDER = [
  "supportMessages",
  "supportTickets",
  "itineraryItems",
  "itineraries",
  "cityServiceEvents",
  "cityServiceReports",
  "cityServiceRatings",
  "hotelEnquiries",
  "hotelBookings",
  "hotelOwnerStates",
  "hotelOwnerLogins",
  "searchAnalytics"
];

const BACKUP_EXTRA_INSERT_ORDER = [
  "searchAnalytics",
  "cityServiceEvents",
  "cityServiceReports",
  "cityServiceRatings",
  "hotelOwnerLogins",
  "hotelOwnerStates",
  "hotelBookings",
  "hotelEnquiries",
  "itineraries",
  "itineraryItems",
  "supportTickets",
  "supportMessages"
];

const BACKUP_EXTRA_TABLE_MAP = new Map(BACKUP_EXTRA_TABLES.map((def) => [def.key, def]));

const DEFAULT_PLACE_CATEGORIES = [
  {
    slug: "historical",
    name: "Historical",
    icon: "🏛️",
    description: "Ancient forts, caves, and heritage sites",
    color: "#92400E",
    bgColor: "#FEF3C7",
    coverImage: "https://images.unsplash.com/photo-1564507592333-c60657eea523?w=1200&q=70&fit=crop",
    enabled: true,
    order: 1
  },
  {
    slug: "nature",
    name: "Nature",
    icon: "🌿",
    description: "Mountains, waterfalls, dams, and scenic outdoor spots",
    color: "#065F46",
    bgColor: "#DCFCE7",
    coverImage: "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1200&q=70&fit=crop",
    enabled: true,
    order: 2
  },
  {
    slug: "beaches",
    name: "Beaches",
    icon: "🏖️",
    description: "Sun, sand, and sea near Maharashtra",
    color: "#1E40AF",
    bgColor: "#DBEAFE",
    coverImage: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1200&q=70&fit=crop",
    enabled: true,
    order: 3
  },
  {
    slug: "religious",
    name: "Religious",
    icon: "🛕",
    description: "Temples, sacred shrines, and pilgrimage spots",
    color: "#5B21B6",
    bgColor: "#EDE9FE",
    coverImage: "https://images.unsplash.com/photo-1609766857933-a1b6fcc7a54f?w=1200&q=70&fit=crop",
    enabled: true,
    order: 4
  },
  {
    slug: "food",
    name: "Food",
    icon: "🍽️",
    description: "Restaurants, street food, vineyards, and local eateries",
    color: "#9F1239",
    bgColor: "#FFE4E6",
    coverImage: "https://images.unsplash.com/photo-1585937421612-70a008356fbe?w=1200&q=70&fit=crop",
    enabled: true,
    order: 5
  }
];

const DEFAULT_HOME_SECTIONS = [
  {
    key: "hero",
    label: "Hero Section",
    enabled: true,
    order: 1,
    title: "Explore Places Near You",
    subtitle: "Discover hidden gems, iconic landmarks, and local favourites.",
    meta: {
      badgeText: "Showing",
      backgroundImage: "https://images.unsplash.com/photo-1524492412937-b28074a5d7da?w=1600&q=85&fit=crop",
      ctaText: "Explore Now",
      ctaTarget: "popular",
      overlay: "classic"
    }
  },
  {
    key: "categories",
    label: "Category Cards",
    enabled: true,
    order: 2,
    title: "Browse by Category",
    subtitle: "What kind of place are you looking for?",
    meta: {}
  },
  {
    key: "announcement",
    label: "Announcement Banner",
    enabled: false,
    order: 3,
    title: "Plan smarter with ExploreX",
    subtitle: "Fresh places, travel memories, and route tools are updated regularly by the admin team.",
    meta: {
      kicker: "Admin Update",
      ctaText: "Explore updates",
      ctaTarget: "popular",
      theme: "sunset"
    }
  },
  {
    key: "popular",
    label: "Popular Places",
    enabled: true,
    order: 5,
    title: "Popular Near You",
    subtitle: "Top-rated places around your selected city",
    meta: {}
  },
  {
    key: "personalized",
    label: "Recommended For You",
    enabled: true,
    order: 4,
    title: "Recommended for You",
    subtitle: "Smart picks based on saved places, searches, and viewed spots",
    meta: {}
  },
  {
    key: "trending",
    label: "Featured & Trending",
    enabled: true,
    order: 6,
    title: "Featured & Trending",
    subtitle: "Admin picks and traveller favourites around your selected city",
    meta: {}
  },
  {
    key: "memories",
    label: "Traveller Memories",
    enabled: true,
    order: 7,
    title: "Traveller Memories",
    subtitle: "Recent public memories shared by travellers",
    meta: {}
  }
];

const DEFAULT_KUMBH_SETTINGS = {
  enabled: true,
  badge: "Nashik Kumbh Mela Guide",
  title: "Nashik Kumbh Mela Smart Guide",
  subtitle: "Crowd guidance, smart routes, important dates and emergency help for Nashik Kumbh Mela 2027.",
  emergencyText: "Emergency Help Available 24/7",
  helpline: "112",
  disabledTitle: "Kumbh Guide is temporarily offline",
  disabledMessage: "The admin team is updating guide information. Please check again shortly.",
  sections: {
    ticker: false,
    crowd: true,
    dates: true,
    weather: false,
    route: true,
    facilities: true,
    plan: true,
    suggestions: true,
    memories: false
  }
};

function safeJsonParse(value, fallback) {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed == null ? fallback : parsed;
  } catch (error) {
    return fallback;
  }
}

function safeJsonStringify(value, fallback = "[]") {
  try {
    return JSON.stringify(value == null ? JSON.parse(fallback) : value);
  } catch (error) {
    return fallback;
  }
}

function clampText(value, max = 255) {
  return String(value == null ? "" : value).trim().slice(0, max);
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

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

function normalizePhone(value) {
  return clampText(value, 40);
}

function normalizeAdminPin(value) {
  const pin = String(value == null ? "" : value).trim();
  return /^\d{4}$/.test(pin) ? pin : "";
}

function hasAdminRole(value) {
  return String(value || "").trim().toLowerCase() === "admin";
}

function normalizeUsernameValue(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const base = raw
    .replace(/^@+/, "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9._]/g, "")
    .slice(0, 24);
  return base ? `@${base}` : "";
}

function normalizeUserRole(value, fallback = "Traveller") {
  const role = clampText(value, 32);
  if (USER_ROLES.has(role)) return role;
  return fallback;
}

function normalizeUserAccountStatus(value, fallback = "active") {
  const raw = clampText(value, 24).toLowerCase();
  if (USER_ACCOUNT_STATUSES.has(raw)) return raw;
  return fallback;
}

function accountStatusLabel(statusKey) {
  const key = normalizeUserAccountStatus(statusKey, "active");
  if (key === "inactive") return "Inactive";
  if (key === "blocked") return "Blocked";
  if (key === "deleted") return "Deleted";
  return "Active";
}

function toIso(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
}

function toBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (["1", "true", "yes", "on", "featured"].includes(v)) return true;
    if (["0", "false", "no", "off", "regular"].includes(v)) return false;
  }
  return fallback;
}

function parsePositiveInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

function parseCoordinateOrNull(value, min, max) {
  if (value == null) return { value: null, provided: false, invalid: false };
  const raw = String(value).trim();
  if (!raw) return { value: null, provided: false, invalid: false };
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) {
    return { value: null, provided: true, invalid: true };
  }
  return {
    value: Math.round(n * 1_000_000) / 1_000_000,
    provided: true,
    invalid: false
  };
}

function parseDateOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function toDateOnly(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function toSqlDateOnly(value) {
  const raw = clampText(value, 40);
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return toDateOnly(raw) || null;
}

function slugify(input) {
  return String(input || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 190);
}

function normalizeGalleryInput(input) {
  if (Array.isArray(input)) {
    return input.map(normalizeMemoryMediaUrlForApi).filter(Boolean).slice(0, 40);
  }
  if (typeof input === "string") {
    return input
      .split("\n")
      .map(normalizeMemoryMediaUrlForApi)
      .filter(Boolean)
      .slice(0, 40);
  }
  return [];
}

function normalizeAnalyticsInput(input, fallback = { views: 0, saves: 0, clicks: 0 }) {
  const base = input && typeof input === "object" ? input : fallback;
  return {
    views: Math.max(0, Math.trunc(Number(base.views) || 0)),
    saves: Math.max(0, Math.trunc(Number(base.saves) || 0)),
    clicks: Math.max(0, Math.trunc(Number(base.clicks) || 0))
  };
}

function normalizeCategorySlug(value) {
  return clampText(value, 80)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function normalizePlaceCategoryInput(input = {}, fallbackOrder = 1) {
  const name = clampText(input?.name, 120);
  const slug = normalizeCategorySlug(input?.slug || name);
  if (!slug || !name) return null;
  return {
    slug,
    name,
    icon: clampText(input?.icon, 16) || "🏷️",
    description: clampText(input?.description ?? input?.desc, 255),
    color: clampText(input?.color, 24) || "#1A3CD8",
    bgColor: clampText(input?.bgColor ?? input?.bg_color, 24) || "#DBEAFE",
    coverImage: clampText(input?.coverImage ?? input?.cover_image_url, 2000),
    enabled: toBoolean(input?.enabled, true),
    order: Math.max(1, Math.trunc(Number(input?.order ?? input?.display_order) || fallbackOrder))
  };
}

function mapPlaceCategoryRow(row, count = 0) {
  return {
    slug: row.slug || "",
    name: row.name || "",
    icon: row.icon || "🏷️",
    description: row.description || "",
    color: row.color || "#1A3CD8",
    bgColor: row.bg_color || "#DBEAFE",
    coverImage: row.cover_image_url || "",
    enabled: Boolean(row.enabled),
    order: Number(row.display_order) || 1,
    placeCount: Number(row.place_count ?? count) || 0,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapPlaceRow(row) {
  const lat = row?.latitude == null || row?.latitude === "" ? Number.NaN : Number(row.latitude);
  const lng = row?.longitude == null || row?.longitude === "" ? Number.NaN : Number(row.longitude);
  return {
    id: Number(row.id),
    name: row.name || "",
    city: formatDisplayCityName(row.city),
    area: row.area || "",
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    entryFee: row.entry_fee || "",
    category: row.category || "",
    secondaryCategory: row.secondary_category || "",
    bestTime: row.best_time || "",
    timeRequired: row.time_required || "",
    image: row.image_url || "",
    desc: row.description || "",
    status: row.status || "draft",
    featured: Boolean(row.featured),
    priority: Number(row.priority) || 0,
    scheduledAt: toIso(row.scheduled_at),
    slug: row.slug || "",
    metaTitle: row.meta_title || "",
    metaDescription: row.meta_description || "",
    coverAlt: row.cover_alt || "",
    gallery: safeJsonParse(row.gallery_json, []),
    analytics: normalizeAnalyticsInput(safeJsonParse(row.analytics_json, {})),
    isDeleted: Boolean(row.is_deleted),
    deletedAt: toIso(row.deleted_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function scoreSearchPlaceRow(row, query) {
  const q = String(query || "").toLowerCase();
  const name = String(row?.name || "").toLowerCase();
  const city = String(row?.city || "").toLowerCase();
  const area = String(row?.area || "").toLowerCase();
  const category = String(row?.category || "").toLowerCase();
  const description = String(row?.description || "").toLowerCase();
  let score = 0;
  if (name === q) score += 120;
  if (name.startsWith(q)) score += 80;
  if (name.includes(q)) score += 60;
  if (area.includes(q)) score += 36;
  if (city.includes(q)) score += 30;
  if (category.includes(q)) score += 24;
  if (description.includes(q)) score += 10;
  if (row?.featured) score += 18;
  score += Math.min(25, Number(row?.priority) || 0);
  score += Math.min(20, Math.max(0, Number(row?.reviews) || 0) / 500);
  return score;
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
    availability: row.availability_label || "",
    status: row.status || "active",
    openCount: Number(row.open_count || row.openCount || 0),
    reportCount: Number(row.report_count || row.reportCount || 0),
    ratingCount: Number(row.rating_count || row.ratingCount || 0),
    avgRating: Number(row.avg_rating || row.avgRating || 0),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function serviceStatsJoinSql() {
  return `
    LEFT JOIN (
      SELECT service_id, COUNT(*) AS open_count
      FROM city_service_events
      WHERE event_type IN ('open', 'call', 'search')
      GROUP BY service_id
    ) se ON se.service_id = cs.id
    LEFT JOIN (
      SELECT service_id, COUNT(*) AS report_count
      FROM city_service_reports
      WHERE status IN ('pending', 'reviewed')
      GROUP BY service_id
    ) sr ON sr.service_id = cs.id
    LEFT JOIN (
      SELECT service_id, COUNT(*) AS rating_count, AVG(rating) AS avg_rating
      FROM city_service_ratings
      GROUP BY service_id
    ) rt ON rt.service_id = cs.id
  `;
}

function serviceSelectSql() {
  return `
    SELECT
      cs.*,
      COALESCE(se.open_count, 0) AS open_count,
      COALESCE(sr.report_count, 0) AS report_count,
      COALESCE(rt.rating_count, 0) AS rating_count,
      COALESCE(rt.avg_rating, 0) AS avg_rating
    FROM city_services cs
    ${serviceStatsJoinSql()}
  `;
}

function mapHomeSectionRow(row) {
  return {
    key: row.section_key,
    label: row.label,
    enabled: Boolean(row.enabled),
    order: Number(row.display_order) || 1,
    title: row.title || "",
    subtitle: row.subtitle || "",
    meta: safeJsonParse(row.meta_json, {}),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapKumbhItemRow(row) {
  const itemType = clampText(row.item_type || row.type, 40).toLowerCase();
  const itemKey = clampText(row.item_key || row.key, 120);
  return {
    id: Number(row.id),
    type: itemType,
    itemType,
    key: itemKey,
    itemKey,
    title: row.title || "",
    subtitle: row.subtitle || "",
    desc: row.description || "",
    description: row.description || "",
    icon: row.icon || "",
    category: row.category || "",
    status: row.status || "active",
    priority: Number(row.priority) || 0,
    date: toDateOnly(row.date_value),
    dateValue: toDateOnly(row.date_value),
    meta: safeJsonParse(row.meta_json, {}),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function kumbhTypeOrderSql() {
  return "FIELD(item_type, 'ticker', 'crowd', 'date', 'facility', 'helpline', 'route', 'tip', 'moment')";
}

function groupKumbhItems(rows) {
  const grouped = {
    ticker: [],
    crowd: [],
    dates: [],
    facilities: [],
    helplines: [],
    routes: [],
    tips: [],
    moments: []
  };

  rows.map(mapKumbhItemRow).forEach((item) => {
    const key = item.type === "date"
      ? "dates"
      : item.type === "facility"
        ? "facilities"
        : item.type === "helpline"
          ? "helplines"
          : item.type === "route"
            ? "routes"
            : item.type === "tip"
              ? "tips"
              : item.type === "moment"
                ? "moments"
              : item.type;
    if (Array.isArray(grouped[key])) grouped[key].push(item);
  });

  return grouped;
}

function normalizeKumbhSettingsInput(input = {}, fallback = DEFAULT_KUMBH_SETTINGS) {
  const raw = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const fallbackSections = fallback.sections || DEFAULT_KUMBH_SETTINGS.sections;
  const inputSections = raw.sections && typeof raw.sections === "object" && !Array.isArray(raw.sections)
    ? raw.sections
    : {};
  const sections = {};
  Object.keys(DEFAULT_KUMBH_SETTINGS.sections).forEach((key) => {
    sections[key] = toBoolean(inputSections[key], fallbackSections[key] !== false);
  });
  const requestedHelpline = clampText(raw.helpline ?? fallback.helpline, 40) || DEFAULT_KUMBH_SETTINGS.helpline;
  const helpline = requestedHelpline.replace(/[^\d]/g, "") === "1950" ? "112" : requestedHelpline;
  return {
    enabled: toBoolean(raw.enabled, fallback.enabled !== false),
    badge: clampText(raw.badge ?? fallback.badge, 120) || DEFAULT_KUMBH_SETTINGS.badge,
    title: clampText(raw.title ?? fallback.title, 190) || DEFAULT_KUMBH_SETTINGS.title,
    subtitle: clampText(raw.subtitle ?? fallback.subtitle, 500) || DEFAULT_KUMBH_SETTINGS.subtitle,
    emergencyText: clampText(raw.emergencyText ?? fallback.emergencyText, 190) || DEFAULT_KUMBH_SETTINGS.emergencyText,
    helpline,
    disabledTitle: clampText(raw.disabledTitle ?? fallback.disabledTitle, 190) || DEFAULT_KUMBH_SETTINGS.disabledTitle,
    disabledMessage: clampText(raw.disabledMessage ?? fallback.disabledMessage, 600) || DEFAULT_KUMBH_SETTINGS.disabledMessage,
    sections
  };
}

async function fetchKumbhSettings() {
  await ensureDefaultKumbhSettings();
  const [rows] = await pool.query("SELECT setting_key, setting_value FROM kumbh_settings");
  const raw = {};
  rows.forEach((row) => {
    raw[row.setting_key] = safeJsonParse(row.setting_value, row.setting_value);
  });
  return normalizeKumbhSettingsInput(raw, DEFAULT_KUMBH_SETTINGS);
}

async function saveKumbhSettings(settings) {
  const normalized = normalizeKumbhSettingsInput(settings, DEFAULT_KUMBH_SETTINGS);
  for (const [key, value] of Object.entries(normalized)) {
    await pool.query(
      `
      INSERT INTO kumbh_settings (setting_key, setting_value)
      VALUES (?, ?)
      ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)
      `,
      [key, safeJsonStringify(value, "{}")]
    );
  }
  return normalized;
}

function mapAuditRow(row) {
  return {
    id: Number(row.id),
    action: row.action || "",
    entity: row.entity || "",
    entityId: row.entity_id == null ? null : Number(row.entity_id),
    details: row.details || "",
    meta: safeJsonParse(row.meta_json, null),
    at: toIso(row.created_at)
  };
}

function countJsonArray(value) {
  const parsed = safeJsonParse(value, []);
  return Array.isArray(parsed) ? parsed.length : 0;
}

function mapAdminUserRow(row) {
  const username = getDisplayUsername(row);
  const roleRaw = clampText(row.role, 32);
  const role = roleRaw || "Traveller";
  const statusKey = row.deleted_at
    ? "deleted"
    : normalizeUserAccountStatus(row.account_status, "active");
  const email = getDisplayEmail(row);
  return {
    id: Number(row.id),
    uid: `user_${row.id}`,
    name: row.full_name || "Traveller",
    email,
    loginEmail: row.email || "",
    deletedOriginalEmail: row.deleted_original_email || "",
    deletedOriginalUsername: row.deleted_original_username || "",
    username: username || "",
    role,
    hasAdminPin: Boolean(row.admin_pin_hash),
    isSuperAdmin: isSuperAdminIdentity({ email, role }),
    status: accountStatusLabel(statusKey),
    statusKey,
    deletedAt: toIso(row.deleted_at),
    location: row.location || "",
    bio: row.bio || "",
    savedCount: countJsonArray(row.saved_ids_json),
    visitedCount: countJsonArray(row.visited_ids_json),
    memoriesCount: countJsonArray(row.memories_json),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    profileUpdatedAt: toIso(row.profile_updated_at)
  };
}

function normalizeMemoryStatus(value, fallback = "pending") {
  const raw = String(value || "").trim().toLowerCase();
  if (MEMORY_STATUSES.has(raw)) return raw;
  return fallback;
}

function normalizeMemoryBulkAction(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "approve") return { kind: "status", status: "approved" };
  if (raw === "reject") return { kind: "status", status: "rejected" };
  if (raw === "pending") return { kind: "status", status: "pending" };
  if (raw === "delete") return { kind: "delete" };
  return null;
}

function normalizeMemoryBulkIds(input, max = 200) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const ids = [];
  for (const value of input) {
    const normalized = clampText(value, 400);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    ids.push(normalized);
    if (ids.length >= max) break;
  }
  return ids;
}

function encodeAdminMemoryId(uid, memoryId) {
  const raw = `${uid}::${memoryId}`;
  return Buffer.from(raw, "utf8").toString("base64url");
}

function decodeAdminMemoryId(encoded) {
  try {
    const decoded = Buffer.from(String(encoded || ""), "base64url").toString("utf8");
    const idx = decoded.indexOf("::");
    if (idx <= 0) return null;
    const uid = clampText(decoded.slice(0, idx), 64);
    const memoryId = clampText(decoded.slice(idx + 2), 120);
    if (!uid || !memoryId) return null;
    return { uid, memoryId };
  } catch (error) {
    return null;
  }
}

function buildPublicMemoryItem(profileRow, memoryInput, index, moderationMap) {
  if (!memoryInput || typeof memoryInput !== "object") return null;

  const privacy = clampText(memoryInput.privacy || "private", 12).toLowerCase();
  if (privacy !== "public") return null;

  const uid = clampText(profileRow.uid, 64);
  if (!uid) return null;

  const fallbackId = `mem_${uid}_${index}`;
  const memoryId = clampText(memoryInput.id || fallbackId, 120) || fallbackId;
  const moderation = moderationMap.get(`${uid}::${memoryId}`);

  const dateRaw = Number(memoryInput.date || 0);
  const date = Number.isFinite(dateRaw) && dateRaw > 0 ? new Date(dateRaw) : parseDateOrNull(memoryInput.submittedAt);
  const submittedAt = date && !Number.isNaN(date.getTime()) ? date.toISOString() : new Date().toISOString();

  const status = normalizeMemoryStatus(moderation?.status || memoryInput.status || "pending");
  const reportsRaw = moderation?.reports ?? memoryInput.reports;
  const reports = Math.max(0, Math.trunc(Number(reportsRaw) || 0));
  const mediaType = clampText(memoryInput.mediaType || "image", 20).toLowerCase() === "video" ? "video" : "image";
  const location = clampText(memoryInput.location, 160) || "Unknown";
  const mediaUrl = normalizeMemoryMediaUrlForApi(memoryInput.mediaUrl);
  if (!mediaUrl) return null;

  return {
    id: encodeAdminMemoryId(uid, memoryId),
    sourceId: memoryId,
    uid,
    user: clampText(profileRow.full_name || "Traveller", 120) || "Traveller",
    userEmail: clampText(profileRow.email, 190),
    place: location,
    location,
    caption: clampText(memoryInput.caption, 400),
    emoji: mediaType === "video" ? "🎬" : "📷",
    mediaType,
    mediaUrl,
    status,
    reports,
    submittedAt,
    moderatedAt: toIso(moderation?.moderated_at)
  };
}

function normalizeMemoryMediaUrlForApi(value) {
  const raw = String(value || "").trim();
  if (!raw || /^data:/i.test(raw)) return "";
  if (raw.length > 4096) return "";
  if (/^\/uploads\/images\/[a-zA-Z0-9._-]+$/i.test(raw)) return raw;
  try {
    const url = new URL(raw);
    if (["localhost", "127.0.0.1", "::1"].includes(url.hostname) && /^\/uploads\/images\/[a-zA-Z0-9._-]+$/i.test(url.pathname)) {
      return url.pathname;
    }
  } catch (error) {}
  return /^https?:\/\/[^\s"'<>]+$/i.test(raw) ? raw : "";
}

async function getAllPublicMemories() {
  const [profileRows] = await pool.query(
    `
    SELECT
      ps.uid,
      ps.memories_json,
      u.full_name,
      u.email
    FROM profile_states ps
    LEFT JOIN users u
      ON u.id = CAST(SUBSTRING(ps.uid, 6) AS UNSIGNED)
    WHERE ps.memories_json IS NOT NULL
      AND ps.memories_json <> ''
      AND ps.memories_json <> '[]'
    `
  );

  const [moderationRows] = await pool.query(
    "SELECT uid, memory_id, status, reports, moderated_at FROM memory_moderation"
  );
  const moderationMap = new Map(
    moderationRows.map((row) => [`${row.uid}::${row.memory_id}`, row])
  );

  const memories = [];
  profileRows.forEach((row) => {
    const list = safeJsonParse(row.memories_json, []);
    if (!Array.isArray(list) || list.length === 0) return;
    list.forEach((memory, index) => {
      const normalized = buildPublicMemoryItem(row, memory, index, moderationMap);
      if (normalized) memories.push(normalized);
    });
  });

  memories.sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
  return memories;
}

function mapPublicMemoryFeedItem(memory) {
  const submittedAt = toIso(memory?.submittedAt) || new Date().toISOString();
  const submittedMs = new Date(submittedAt).getTime();
  const date = Number.isFinite(submittedMs) && submittedMs > 0 ? submittedMs : Date.now();
  const sourceId = clampText(memory?.sourceId || memory?.id, 120);
  const uid = clampText(memory?.uid, 64);
  const mediaType = clampText(memory?.mediaType || "image", 20).toLowerCase() === "video" ? "video" : "image";
  const mediaUrl = normalizeMemoryMediaUrlForApi(memory?.mediaUrl);

  return {
    id: sourceId || `mem_${uid || "user"}_${date}`,
    sourceId: sourceId || "",
    uid,
    userId: uid,
    userLabel: clampText(memory?.user || "Traveller", 120) || "Traveller",
    user: clampText(memory?.user || "Traveller", 120) || "Traveller",
    userEmail: clampText(memory?.userEmail, 190),
    privacy: "public",
    location: clampText(memory?.location, 160) || "Unknown",
    caption: clampText(memory?.caption, 400),
    mediaType,
    mediaUrl,
    status: normalizeMemoryStatus(memory?.status, "pending"),
    reports: Math.max(0, Math.trunc(Number(memory?.reports) || 0)),
    date,
    submittedAt,
    moderatedAt: toIso(memory?.moderatedAt)
  };
}

async function createAuditLog(action, entity, details, entityId = null, meta = null) {
  try {
    await pool.query(
      `INSERT INTO audit_logs (action, entity, entity_id, details, meta_json)
       VALUES (?, ?, ?, ?, ?)`,
      [
        clampText(action, 80) || "update",
        clampText(entity, 80) || "system",
        entityId == null ? null : Number(entityId),
        clampText(details, 1000) || "No details",
        meta == null ? null : safeJsonStringify(meta, "{}")
      ]
    );
  } catch (error) {
    console.error("Audit log write failed:", error.message);
  }
}

async function ensureDefaultHomeSections() {
  await ensureHomeSectionsSchema();
  const [rows] = await pool.query("SELECT section_key FROM home_sections");
  const existing = new Set(rows.map((row) => row.section_key));
  for (const section of DEFAULT_HOME_SECTIONS) {
    const meta = normalizeHomeSectionMeta(section.key, section.meta);
    if (existing.has(section.key)) continue;
    await pool.query(
      `INSERT INTO home_sections (section_key, label, enabled, display_order, title, subtitle, meta_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        section.key,
        section.label,
        section.enabled ? 1 : 0,
        section.order,
        section.title,
        section.subtitle,
        safeJsonStringify(meta, "{}")
      ]
    );
  }

  const defaultKeys = DEFAULT_HOME_SECTIONS.map((section) => section.key);
  const placeholders = defaultKeys.map(() => "?").join(", ");
  const [orderRows] = await pool.query(
    `SELECT section_key, display_order FROM home_sections WHERE section_key IN (${placeholders})`,
    defaultKeys
  );
  const seenOrders = new Set();
  const hasDuplicateOrders = orderRows.some((row) => {
    const order = Number(row.display_order);
    if (!Number.isFinite(order)) return true;
    if (seenOrders.has(order)) return true;
    seenOrders.add(order);
    return false;
  });
  if (hasDuplicateOrders) {
    for (const section of DEFAULT_HOME_SECTIONS) {
      await pool.query(
        "UPDATE home_sections SET display_order = ? WHERE section_key = ?",
        [section.order, section.key]
      );
    }
  }

  for (const section of DEFAULT_HOME_SECTIONS) {
    const meta = normalizeHomeSectionMeta(section.key, section.meta);
    if (Object.keys(meta).length === 0) continue;
    await pool.query(
      "UPDATE home_sections SET meta_json = ? WHERE section_key = ? AND (meta_json IS NULL OR meta_json = '' OR meta_json = '{}')",
      [safeJsonStringify(meta, "{}"), section.key]
    );
  }
}

async function ensureHomeSectionsSchema() {
  const [rows] = await pool.query(
    `
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'home_sections'
      AND COLUMN_NAME = 'meta_json'
    LIMIT 1
    `
  );
  if (rows.length > 0) return;
  await pool.query("ALTER TABLE home_sections ADD COLUMN meta_json LONGTEXT NULL AFTER subtitle");
}

async function ensurePlaceCategoriesSchema() {
  await pool.query(
    `
    CREATE TABLE IF NOT EXISTS place_categories (
      slug VARCHAR(80) NOT NULL,
      name VARCHAR(120) NOT NULL,
      icon VARCHAR(16) NOT NULL DEFAULT '🏷️',
      description VARCHAR(255) NULL,
      color VARCHAR(24) NOT NULL DEFAULT '#1A3CD8',
      bg_color VARCHAR(24) NOT NULL DEFAULT '#DBEAFE',
      cover_image_url LONGTEXT NULL,
      enabled TINYINT(1) NOT NULL DEFAULT 1,
      display_order INT UNSIGNED NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (slug),
      KEY idx_place_categories_order (display_order),
      KEY idx_place_categories_enabled (enabled)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `
  );
}

async function ensureSearchAnalyticsSchema() {
  await pool.query(
    `
    CREATE TABLE IF NOT EXISTS search_analytics (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      query VARCHAR(180) NOT NULL,
      normalized_query VARCHAR(180) NOT NULL,
      city VARCHAR(120) NULL,
      category VARCHAR(80) NULL,
      user_uid VARCHAR(80) NULL,
      result_count INT UNSIGNED NOT NULL DEFAULT 0,
      source VARCHAR(40) NOT NULL DEFAULT 'home',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_search_analytics_query (normalized_query),
      KEY idx_search_analytics_city (city),
      KEY idx_search_analytics_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `
  );
}

async function ensureDefaultPlaceCategories() {
  await ensurePlaceCategoriesSchema();
  for (const category of DEFAULT_PLACE_CATEGORIES) {
    const normalized = normalizePlaceCategoryInput(category, category.order);
    if (!normalized) continue;
    await pool.query(
      `
      INSERT INTO place_categories (
        slug, name, icon, description, color, bg_color, cover_image_url, enabled, display_order
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        name = VALUES(name),
        icon = COALESCE(NULLIF(icon, ''), VALUES(icon)),
        description = COALESCE(NULLIF(description, ''), VALUES(description)),
        color = COALESCE(NULLIF(color, ''), VALUES(color)),
        bg_color = COALESCE(NULLIF(bg_color, ''), VALUES(bg_color)),
        cover_image_url = COALESCE(NULLIF(cover_image_url, ''), VALUES(cover_image_url))
      `,
      [
        normalized.slug,
        normalized.name,
        normalized.icon,
        normalized.description,
        normalized.color,
        normalized.bgColor,
        normalized.coverImage,
        normalized.enabled ? 1 : 0,
        normalized.order
      ]
    );
  }
}

async function getAdminUserById(id, queryable = pool) {
  const [rows] = await queryable.query(
    `
    SELECT
      u.id,
      u.full_name,
      u.email,
      u.username,
      u.role,
      u.admin_pin_hash,
      u.account_status,
      u.deleted_at,
      u.deleted_original_email,
      u.deleted_original_username,
      u.created_at,
      u.updated_at,
      ps.location,
      ps.bio,
      ps.saved_ids_json,
      ps.visited_ids_json,
      ps.memories_json,
      ps.updated_at AS profile_updated_at
    FROM users u
    LEFT JOIN profile_states ps ON ps.uid = CONCAT('user_', u.id)
    WHERE u.id = ?
    LIMIT 1
    `,
    [id]
  );
  return rows[0] ? mapAdminUserRow(rows[0]) : null;
}

async function ensureUserProfileRows(connection, user) {
  const uid = `user_${user.id}`;
  await connection.query(
    `
    INSERT INTO profile_states (
      uid, name, username, bio, location, avatar_url, cover_url,
      settings_json, visited_ids_json, visited_places_json, saved_ids_json, saved_places_json,
      activity_json, goals_json, interests_json, memories_json
    ) VALUES (?, ?, ?, '', 'Nashik, Maharashtra', '', '', '{}', '[]', '[]', '[]', '{}', '[]', '[]', '[]', '[]')
    ON DUPLICATE KEY UPDATE
      name = VALUES(name),
      username = VALUES(username)
    `,
    [uid, user.name, user.username]
  );

  await connection.query(
    `
    INSERT INTO user_profiles (
      user_id, name, username, bio, location, avatar_url, cover_url,
      settings_json, visited_ids_json, saved_ids_json, activity_json,
      goals_json, interests_json, memories_json
    ) VALUES (?, ?, ?, '', 'Nashik, Maharashtra', '', '', '{}', '[]', '[]', '[]', '[]', '[]', '[]')
    ON DUPLICATE KEY UPDATE
      name = VALUES(name),
      username = VALUES(username)
    `,
    [user.id, user.name, user.username]
  );
}

async function getPlaceById(id) {
  const [rows] = await pool.query("SELECT * FROM places WHERE id = ? LIMIT 1", [id]);
  return rows[0] || null;
}

async function getServiceById(id) {
  const [rows] = await pool.query("SELECT * FROM city_services WHERE id = ? LIMIT 1", [id]);
  return rows[0] || null;
}

async function getKumbhItemById(id) {
  const [rows] = await pool.query("SELECT * FROM kumbh_items WHERE id = ? LIMIT 1", [id]);
  return rows[0] || null;
}

function normalizePlaceInput(body = {}, existing = null) {
  const name = clampText(body.name ?? existing?.name, 160);
  const city = clampText(body.city ?? existing?.city, 120);
  const area = clampText(body.area ?? existing?.area, 160);
  const hasLatInBody = Object.prototype.hasOwnProperty.call(body, "lat")
    || Object.prototype.hasOwnProperty.call(body, "latitude");
  const hasLngInBody = Object.prototype.hasOwnProperty.call(body, "lng")
    || Object.prototype.hasOwnProperty.call(body, "longitude");
  const latParsed = parseCoordinateOrNull(
    body.lat ?? body.latitude ?? existing?.latitude,
    -90,
    90
  );
  const lngParsed = parseCoordinateOrNull(
    body.lng ?? body.longitude ?? existing?.longitude,
    -180,
    180
  );
  const entryFee = clampText(body.entryFee ?? body.entry_fee ?? existing?.entry_fee, 80);
  const category = clampText(body.category ?? existing?.category, 80);
  const secondaryCategory = clampText(
    body.secondaryCategory ?? body.secondary_category ?? existing?.secondary_category,
    80
  );
  const bestTime = clampText(body.bestTime ?? body.best_time ?? existing?.best_time, 160);
  const timeRequired = clampText(body.timeRequired ?? body.time_required ?? existing?.time_required, 120);
  const imageInput = body.image ?? body.imageUrl ?? body.image_url ?? existing?.image_url;
  const image = normalizeMemoryMediaUrlForApi(imageInput);
  const desc = String(body.desc ?? body.description ?? existing?.description ?? "").slice(0, 20_000);

  const statusRaw = clampText(body.status ?? existing?.status, 24).toLowerCase();
  const status = PLACE_STATUSES.has(statusRaw) ? statusRaw : "draft";

  const featured = body.featured == null ? Boolean(existing?.featured) : toBoolean(body.featured);
  const priorityInput = body.priority ?? existing?.priority ?? 0;
  const priority = Math.max(0, Math.trunc(Number(priorityInput) || 0));

  const slugInput = clampText(body.slug ?? existing?.slug, 190);
  const slug = slugInput || slugify(name);
  const metaTitle = clampText(body.metaTitle ?? body.meta_title ?? existing?.meta_title ?? name, 190);
  const metaDescription = String(body.metaDescription ?? body.meta_description ?? existing?.meta_description ?? "").slice(0, 5000);
  const coverAlt = clampText(body.coverAlt ?? body.cover_alt ?? existing?.cover_alt ?? name, 190);

  const galleryRaw = body.gallery == null ? safeJsonParse(existing?.gallery_json, []) : normalizeGalleryInput(body.gallery);
  const gallery = normalizeGalleryInput(galleryRaw);

  const analyticsRaw = body.analytics == null
    ? safeJsonParse(existing?.analytics_json, { views: 0, saves: 0, clicks: 0 })
    : body.analytics;
  const analytics = normalizeAnalyticsInput(analyticsRaw);

  const scheduledAtInput = body.scheduledAt ?? body.scheduled_at ?? existing?.scheduled_at;
  const scheduledAt = status === "scheduled" ? parseDateOrNull(scheduledAtInput) : null;

  const isDeleted = body.isDeleted == null ? Boolean(existing?.is_deleted) : toBoolean(body.isDeleted);
  let deletedAt = existing?.deleted_at ? new Date(existing.deleted_at) : null;
  if (isDeleted) {
    if (!deletedAt) deletedAt = new Date();
    const explicitDeletedAt = parseDateOrNull(body.deletedAt ?? body.deleted_at);
    if (explicitDeletedAt) deletedAt = explicitDeletedAt;
  } else {
    deletedAt = null;
  }

  if (!name) return { error: "Place name is required" };
  if (!city) return { error: "City is required" };
  if (!category) return { error: "Category is required" };
  if (secondaryCategory && secondaryCategory.toLowerCase() === category.toLowerCase()) {
    return { error: "Secondary category must be different from primary category" };
  }
  if (!slug) return { error: "Slug is required" };
  if (String(imageInput || "").trim() && !image) {
    return { error: "Place image must be a valid HTTP image URL or uploaded image path" };
  }
  if (latParsed.invalid) return { error: "Latitude must be between -90 and 90" };
  if (lngParsed.invalid) return { error: "Longitude must be between -180 and 180" };
  let latitude = latParsed.value;
  let longitude = lngParsed.value;
  if ((latitude == null) !== (longitude == null)) {
    if (hasLatInBody || hasLngInBody) {
      return { error: "Please provide both latitude and longitude, or leave both empty" };
    }
    latitude = null;
    longitude = null;
  }
  if (status === "scheduled" && !scheduledAt) {
    return { error: "Scheduled status requires a valid schedule date/time" };
  }

  return {
    value: {
      name,
      city,
      area,
      latitude,
      longitude,
      entryFee,
      category,
      secondaryCategory,
      bestTime,
      timeRequired,
      image,
      desc,
      status,
      featured,
      priority,
      scheduledAt,
      slug,
      metaTitle,
      metaDescription,
      coverAlt,
      gallery,
      analytics,
      isDeleted,
      deletedAt
    }
  };
}

function normalizeServiceInput(body = {}, existing = null) {
  const name = clampText(body.name ?? existing?.name, 160);
  const city = clampText(body.city ?? existing?.city, 120);
  const area = clampText(body.area ?? existing?.area, 160);

  const categoryRaw = clampText(body.category ?? (existing?.category || "Transport"), 80);
  const category = SERVICE_CATEGORIES.has(categoryRaw) ? categoryRaw : "Transport";

  const desc = String(body.desc ?? body.description ?? existing?.description ?? "").slice(0, 8000);
  const link = clampText(body.link ?? existing?.link, 700);
  const availability = clampText(
    body.availability ?? body.availabilityLabel ?? body.availability_label ?? existing?.availability_label,
    120
  );

  const statusRaw = clampText(body.status ?? (existing?.status || "active"), 24).toLowerCase();
  const status = SERVICE_STATUSES.has(statusRaw) ? statusRaw : "active";

  if (!name) return { error: "Service name is required" };
  if (!city) return { error: "City is required" };

  return {
    value: {
      name,
      city,
      area,
      category,
      desc,
      link,
      availability,
      status
    }
  };
}

function normalizeKumbhItemInput(body = {}, existing = null) {
  const typeRaw = clampText(body.type ?? body.itemType ?? body.item_type ?? existing?.item_type, 40).toLowerCase();
  const type = KUMBH_ITEM_TYPES.has(typeRaw) ? typeRaw : "";
  const itemKey = clampText(body.key ?? body.itemKey ?? body.item_key ?? existing?.item_key, 120)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const title = clampText(body.title ?? existing?.title, 190);
  const subtitle = clampText(body.subtitle ?? existing?.subtitle, 255);
  const description = String(body.desc ?? body.description ?? existing?.description ?? "").slice(0, 12000);
  const icon = clampText(body.icon ?? existing?.icon, 24);
  const category = clampText(body.category ?? existing?.category, 80);
  const statusRaw = clampText(body.status ?? existing?.status ?? "active", 24).toLowerCase();
  const status = KUMBH_ITEM_STATUSES.has(statusRaw) ? statusRaw : "active";
  const priority = Math.max(0, Math.trunc(Number(body.priority ?? existing?.priority ?? 0) || 0));
  const dateValue = toSqlDateOnly(body.date ?? body.dateValue ?? body.date_value ?? existing?.date_value);

  let meta = {};
  const metaInput = body.meta ?? body.metaJson ?? body.meta_json;
  if (metaInput == null) {
    meta = safeJsonParse(existing?.meta_json, {});
  } else if (typeof metaInput === "string") {
    const parsed = safeJsonParse(metaInput, null);
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { error: "Meta JSON must be a valid object" };
    }
    meta = parsed;
  } else if (typeof metaInput === "object" && !Array.isArray(metaInput)) {
    meta = metaInput;
  } else {
    return { error: "Meta JSON must be an object" };
  }

  if (!type) return { error: "Valid item type is required" };
  if (!itemKey) return { error: "Unique key is required" };
  if (!title) return { error: "Title is required" };
  const typeError = validateKumbhItemByType({ type, subtitle, dateValue, meta });
  if (typeError) return { error: typeError };

  return {
    value: {
      type,
      itemKey,
      title,
      subtitle,
      description,
      icon,
      category,
      status,
      priority,
      dateValue,
      meta
    }
  };
}

function validateKumbhItemByType(item) {
  const type = item?.type;
  const meta = item?.meta && typeof item.meta === "object" && !Array.isArray(item.meta) ? item.meta : {};

  if (type === "date" && !item.dateValue) {
    return "Date items require a valid date";
  }

  if (type === "crowd") {
    const level = Number(meta.level ?? meta.crowdLevel ?? 0);
    const percent = Number(meta.percent ?? meta.pct ?? 0);
    if (meta.level != null && (!Number.isFinite(level) || level < 1 || level > 3)) {
      return "Crowd level must be between 1 and 3";
    }
    if (meta.percent != null && (!Number.isFinite(percent) || percent < 0 || percent > 100)) {
      return "Crowd percent must be between 0 and 100";
    }
  }

  if (type === "route") {
    const from = clampText(meta.from, 80);
    const to = clampText(meta.to, 80);
    if (!from || !to) {
      return "Route items require meta.from and meta.to";
    }
  }

  if (type === "moment") {
    const image = clampText(meta.image ?? meta.imageUrl, 3000);
    if (!image) {
      return "Kumbh Moment requires meta.image";
    }
  }

  if (type === "helpline") {
    const phone = clampText(item.subtitle || meta.phone, 80);
    if (!phone) {
      return "Helpline items require subtitle or meta.phone";
    }
  }

  return "";
}

function normalizeKumbhIds(input, max = 200) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const ids = [];
  for (const value of input) {
    const id = parsePositiveInt(value);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= max) break;
  }
  return ids;
}

function normalizeKumbhStatus(value, fallback = "active") {
  const raw = clampText(value, 24).toLowerCase();
  return KUMBH_ITEM_STATUSES.has(raw) ? raw : fallback;
}

function parseKumbhPriority(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(100000, Math.trunc(n));
}

function normalizeBulkServiceCity(value) {
  const cityRaw = clampText(value, 120);
  const key = cityRaw.toLowerCase();
  if (key === "all india" || key === "selected cities" || key === "pan india" || key === "nationwide") {
    return "All";
  }
  return cityRaw;
}

function normalizeBulkServiceLink(value) {
  const linkRaw = clampText(value, 700);
  const key = linkRaw.toLowerCase();
  if (key === "swiggy instamart app") return "https://www.swiggy.com/instamart";
  if (key === "blinkit app") return "https://www.blinkit.com";
  if (key === "zepto app") return "https://www.zeptonow.com";
  if (key === "local bus service") return "";
  return linkRaw;
}

function normalizeBulkServicesInput(input) {
  if (!Array.isArray(input)) {
    return { error: "services must be an array" };
  }

  const output = [];
  const seenKeys = new Set();
  let invalidCount = 0;
  let duplicateCount = 0;

  input.forEach((row, index) => {
    const safeRow = row && typeof row === "object" ? row : {};
    const normalized = normalizeServiceInput({
      ...safeRow,
      city: normalizeBulkServiceCity(safeRow.city),
      link: normalizeBulkServiceLink(safeRow.link)
    });
    if (normalized.error) {
      invalidCount += 1;
      return;
    }

    const service = normalized.value;
    const key = `${service.name.toLowerCase()}::${service.city.toLowerCase()}`;
    if (seenKeys.has(key)) {
      duplicateCount += 1;
      return;
    }
    seenKeys.add(key);

    output.push({
      ...service,
      _inputIndex: index
    });
  });

  if (!output.length) {
    return { error: "No valid service records found in services array" };
  }

  return {
    value: output,
    meta: {
      received: input.length,
      valid: output.length,
      invalid: invalidCount,
      duplicates: duplicateCount
    }
  };
}

function normalizeHomeSectionsInput(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const normalized = [];
  for (const item of input) {
    const key = clampText(item?.key, 60).toLowerCase().replace(/[^a-z0-9_-]/g, "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    normalized.push({
      key,
      label: clampText(item?.label || key, 120),
      enabled: toBoolean(item?.enabled, true),
      order: Math.max(1, Math.trunc(Number(item?.order) || normalized.length + 1)),
      title: clampText(item?.title, 190),
      subtitle: clampText(item?.subtitle, 255),
      meta: normalizeHomeSectionMeta(key, item?.meta ?? safeJsonParse(item?.meta_json, {}))
    });
  }
  return normalized;
}

function normalizeHomeSectionMeta(key, input) {
  const raw = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const commonTargets = new Set(["popular", "personalized", "trending", "categories", "memories", "route-planner"]);
  if (key === "announcement") {
    const allowedThemes = new Set(["sunset", "ocean", "forest", "midnight", "minimal"]);
    const ctaTarget = clampText(raw.ctaTarget, 40).toLowerCase();
    const theme = clampText(raw.theme, 40).toLowerCase();
    return {
      kicker: clampText(raw.kicker, 80) || "Admin Update",
      ctaText: clampText(raw.ctaText, 80) || "Explore updates",
      ctaTarget: commonTargets.has(ctaTarget) ? ctaTarget : "popular",
      theme: allowedThemes.has(theme) ? theme : "sunset"
    };
  }
  if (key !== "hero") return {};
  const allowedOverlays = new Set(["classic", "sunset", "ocean", "forest", "midnight"]);
  const ctaTarget = clampText(raw.ctaTarget, 40).toLowerCase();
  const overlay = clampText(raw.overlay, 40).toLowerCase();
  return {
    badgeText: clampText(raw.badgeText, 80) || "Showing",
    backgroundImage: clampText(raw.backgroundImage, 2000),
    ctaText: clampText(raw.ctaText, 80) || "Explore Now",
    ctaTarget: commonTargets.has(ctaTarget) ? ctaTarget : "popular",
    overlay: allowedOverlays.has(overlay) ? overlay : "classic"
  };
}

function toSqlDateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function normalizeJsonForDb(value, fallback = "[]") {
  if (value == null || value === "") return fallback;
  if (typeof value === "string") {
    const parsed = safeJsonParse(value, null);
    return parsed == null ? fallback : safeJsonStringify(parsed, fallback);
  }
  return safeJsonStringify(value, fallback);
}

function normalizeOptionalJsonForDb(value) {
  if (value == null || value === "") return null;
  if (typeof value === "string") {
    const parsed = safeJsonParse(value, null);
    return parsed == null ? null : safeJsonStringify(parsed, "[]");
  }
  return safeJsonStringify(value, "[]");
}

function pickArray(source, keys) {
  for (const key of keys) {
    const value = source?.[key];
    if (Array.isArray(value)) return value;
  }
  return null;
}

function resolveBackupDataSource(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (payload.data && typeof payload.data === "object") {
    if (payload.data.data && typeof payload.data.data === "object") {
      return payload.data.data;
    }
    return payload.data;
  }
  return payload;
}

function resolveSectionForImport(inputRows, normalizedRows, label, warnings = []) {
  if (!Array.isArray(inputRows)) return null;
  if (inputRows.length > 0 && (!Array.isArray(normalizedRows) || normalizedRows.length === 0)) {
    warnings.push(`${label} section ignored because no valid records were found.`);
    return null;
  }
  return normalizedRows;
}

function normalizeBackupUsers(rows = [], warnings = []) {
  const seenIds = new Set();
  const seenEmails = new Set();
  const output = [];
  let skippedMissingPassword = 0;
  let skippedDuplicates = 0;

  rows.forEach((row) => {
    const id = parsePositiveInt(row?.id);
    const fullName = clampText(row?.full_name ?? row?.fullName ?? row?.name, 120);
    const email = clampText(row?.email, 190).toLowerCase();
    const passwordHash = clampText(row?.password_hash ?? row?.passwordHash, 255);
    if (!id || !fullName || !email || !isValidEmail(email)) return;

    if (!passwordHash) {
      skippedMissingPassword++;
      return;
    }

    if (seenIds.has(id) || seenEmails.has(email)) {
      skippedDuplicates++;
      return;
    }
    seenIds.add(id);
    seenEmails.add(email);

    const username = clampText(row?.username, 80);
    const role = clampText(row?.role, 32) || "Traveller";
    const phone = normalizePhone(row?.phone);
    const adminPinHash = clampText(row?.admin_pin_hash ?? row?.adminPinHash, 255) || null;
    const adminPinUpdatedAt = toSqlDateTime(row?.admin_pin_updated_at ?? row?.adminPinUpdatedAt);
    const adminPinFailedAttempts = Math.max(0, Math.trunc(Number(row?.admin_pin_failed_attempts ?? row?.adminPinFailedAttempts) || 0));
    const adminPinLockedUntil = toSqlDateTime(row?.admin_pin_locked_until ?? row?.adminPinLockedUntil);
    const deletedAt = toSqlDateTime(row?.deleted_at ?? row?.deletedAt);
    const deletedOriginalEmail = clampText(row?.deleted_original_email ?? row?.deletedOriginalEmail, 190).toLowerCase() || null;
    const deletedOriginalUsername = clampText(row?.deleted_original_username ?? row?.deletedOriginalUsername, 80) || null;
    const inputStatus = row?.account_status ?? row?.accountStatus ?? row?.status;
    const accountStatus = deletedAt
      ? "deleted"
      : normalizeUserAccountStatus(inputStatus, "active");

    output.push({
      id,
      full_name: fullName,
      email,
      password_hash: passwordHash,
      username: username || null,
      role,
      phone: phone || null,
      admin_pin_hash: adminPinHash,
      admin_pin_updated_at: adminPinUpdatedAt,
      admin_pin_failed_attempts: adminPinFailedAttempts,
      admin_pin_locked_until: adminPinLockedUntil,
      account_status: accountStatus,
      deleted_at: deletedAt,
      deleted_original_email: deletedOriginalEmail,
      deleted_original_username: deletedOriginalUsername,
      created_at: toSqlDateTime(row?.created_at ?? row?.createdAt),
      updated_at: toSqlDateTime(row?.updated_at ?? row?.updatedAt)
    });
  });

  if (skippedMissingPassword > 0) {
    warnings.push(
      `${skippedMissingPassword} user record(s) skipped because password hash was missing.`
    );
  }
  if (skippedDuplicates > 0) {
    warnings.push(`${skippedDuplicates} duplicate user record(s) were skipped.`);
  }
  return output;
}

function normalizeBackupUserProfiles(rows = []) {
  const seen = new Set();
  const output = [];
  rows.forEach((row) => {
    const userId = parsePositiveInt(row?.user_id ?? row?.userId ?? row?.id);
    if (!userId || seen.has(userId)) return;
    seen.add(userId);

    output.push({
      user_id: userId,
      name: clampText(row?.name, 120) || "Traveller",
      username: clampText(row?.username, 80) || "@explorer",
      bio: String(row?.bio ?? "").trim() || null,
      location: clampText(row?.location, 190) || null,
      avatar_url: clampText(row?.avatar_url ?? row?.avatarUrl, 8_000_000) || null,
      cover_url: clampText(row?.cover_url ?? row?.coverUrl, 8_000_000) || null,
      settings_json: normalizeJsonForDb(row?.settings_json ?? row?.settingsJson, "{}"),
      visited_ids_json: normalizeJsonForDb(row?.visited_ids_json ?? row?.visitedIdsJson, "[]"),
      saved_ids_json: normalizeJsonForDb(row?.saved_ids_json ?? row?.savedIdsJson, "[]"),
      activity_json: normalizeJsonForDb(row?.activity_json ?? row?.activityJson, "[]"),
      goals_json: normalizeJsonForDb(row?.goals_json ?? row?.goalsJson, "[]"),
      interests_json: normalizeJsonForDb(row?.interests_json ?? row?.interestsJson, "[]"),
      memories_json: normalizeJsonForDb(row?.memories_json ?? row?.memoriesJson, "[]"),
      created_at: toSqlDateTime(row?.created_at ?? row?.createdAt),
      updated_at: toSqlDateTime(row?.updated_at ?? row?.updatedAt)
    });
  });
  return output;
}

function normalizeBackupProfileStates(rows = []) {
  const seen = new Set();
  const output = [];
  rows.forEach((row) => {
    const userId = parsePositiveInt(row?.user_id ?? row?.userId);
    const uidRaw = row?.uid ?? (userId ? `user_${userId}` : "");
    const uid = clampText(uidRaw, 64);
    if (!uid || seen.has(uid)) return;
    seen.add(uid);

    output.push({
      uid,
      name: clampText(row?.name, 120) || "Traveller",
      username: clampText(row?.username, 80) || "@explorer",
      bio: String(row?.bio ?? "").trim() || null,
      location: clampText(row?.location, 150) || "Nashik, Maharashtra",
      avatar_url: clampText(row?.avatar_url ?? row?.avatarUrl, 8_000_000) || null,
      cover_url: clampText(row?.cover_url ?? row?.coverUrl, 8_000_000) || null,
      settings_json: normalizeOptionalJsonForDb(row?.settings_json ?? row?.settingsJson),
      visited_ids_json: normalizeOptionalJsonForDb(row?.visited_ids_json ?? row?.visitedIdsJson),
      visited_places_json: normalizeOptionalJsonForDb(
        row?.visited_places_json ?? row?.visitedPlacesJson
      ),
      saved_ids_json: normalizeOptionalJsonForDb(row?.saved_ids_json ?? row?.savedIdsJson),
      saved_places_json: normalizeOptionalJsonForDb(row?.saved_places_json ?? row?.savedPlacesJson),
      activity_json: normalizeOptionalJsonForDb(row?.activity_json ?? row?.activityJson),
      goals_json: normalizeOptionalJsonForDb(row?.goals_json ?? row?.goalsJson),
      interests_json: normalizeOptionalJsonForDb(row?.interests_json ?? row?.interestsJson),
      memories_json: normalizeOptionalJsonForDb(row?.memories_json ?? row?.memoriesJson),
      created_at: toSqlDateTime(row?.created_at ?? row?.createdAt),
      updated_at: toSqlDateTime(row?.updated_at ?? row?.updatedAt)
    });
  });
  return output;
}

function normalizeBackupPlaces(rows = [], warnings = []) {
  const output = [];
  let skippedInvalid = 0;

  rows.forEach((row) => {
    const normalized = normalizePlaceInput(row, null);
    if (normalized.error) {
      skippedInvalid++;
      return;
    }
    const place = normalized.value;
    const id = parsePositiveInt(row?.id);

    output.push({
      id: id || null,
      name: place.name,
      city: place.city,
      area: place.area || null,
      latitude: place.latitude,
      longitude: place.longitude,
      entry_fee: place.entryFee || null,
      category: place.category,
      secondary_category: place.secondaryCategory || null,
      best_time: place.bestTime || null,
      time_required: place.timeRequired || null,
      image_url: place.image || null,
      description: place.desc || null,
      status: place.status,
      featured: place.featured ? 1 : 0,
      priority: place.priority,
      scheduled_at: toSqlDateTime(place.scheduledAt),
      slug: place.slug,
      meta_title: place.metaTitle || null,
      meta_description: place.metaDescription || null,
      cover_alt: place.coverAlt || null,
      gallery_json: safeJsonStringify(place.gallery),
      analytics_json: safeJsonStringify(place.analytics, "{}"),
      is_deleted: place.isDeleted ? 1 : 0,
      deleted_at: toSqlDateTime(place.deletedAt),
      created_at: toSqlDateTime(row?.created_at ?? row?.createdAt),
      updated_at: toSqlDateTime(row?.updated_at ?? row?.updatedAt)
    });
  });

  if (skippedInvalid > 0) {
    warnings.push(`${skippedInvalid} place record(s) were skipped due to invalid required fields.`);
  }
  return output;
}

function normalizeBackupServices(rows = [], warnings = []) {
  const output = [];
  let skippedInvalid = 0;

  rows.forEach((row) => {
    const normalized = normalizeServiceInput(row, null);
    if (normalized.error) {
      skippedInvalid++;
      return;
    }
    const service = normalized.value;
    const id = parsePositiveInt(row?.id);
    output.push({
      id: id || null,
      name: service.name,
      city: service.city,
      area: service.area || null,
      category: service.category,
      description: service.desc || null,
      link: service.link || null,
      availability_label: service.availability || null,
      status: service.status,
      created_at: toSqlDateTime(row?.created_at ?? row?.createdAt),
      updated_at: toSqlDateTime(row?.updated_at ?? row?.updatedAt)
    });
  });

  if (skippedInvalid > 0) {
    warnings.push(`${skippedInvalid} service record(s) were skipped due to invalid required fields.`);
  }
  return output;
}

function normalizeBackupKumbhItems(rows = [], warnings = []) {
  const output = [];
  let skippedInvalid = 0;

  rows.forEach((row) => {
    const normalized = normalizeKumbhItemInput(row, null);
    if (normalized.error) {
      skippedInvalid++;
      return;
    }
    const item = normalized.value;
    const id = parsePositiveInt(row?.id);
    output.push({
      id: id || null,
      item_type: item.type,
      item_key: item.itemKey,
      title: item.title,
      subtitle: item.subtitle || null,
      description: item.description || null,
      icon: item.icon || null,
      category: item.category || null,
      status: item.status,
      priority: item.priority,
      date_value: item.dateValue,
      meta_json: safeJsonStringify(item.meta || {}, "{}"),
      created_at: toSqlDateTime(row?.created_at ?? row?.createdAt),
      updated_at: toSqlDateTime(row?.updated_at ?? row?.updatedAt)
    });
  });

  if (skippedInvalid > 0) {
    warnings.push(`${skippedInvalid} Kumbh guide record(s) were skipped due to invalid required fields.`);
  }
  return output;
}

function normalizeBackupRawValue(value, column, def) {
  if (value === undefined || value === null) return null;
  if (def.jsonColumns?.includes(column)) return normalizeOptionalJsonForDb(value);
  if (def.dateOnlyColumns?.includes(column)) return toSqlDateOnly(value);
  if (def.dateTimeColumns?.includes(column)) return toSqlDateTime(value);
  if (value instanceof Date) return toSqlDateTime(value);
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "object") return safeJsonStringify(value, "{}");
  return value;
}

function mapRawBackupRows(rows = []) {
  return rows.map((row) => {
    const mapped = {};
    Object.entries(row || {}).forEach(([key, value]) => {
      mapped[key] = value instanceof Date ? toIso(value) : value;
    });
    return mapped;
  });
}

function normalizeBackupExtraRows(def, rows = [], warnings = []) {
  const output = [];
  let skipped = 0;
  rows.forEach((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      skipped++;
      return;
    }
    const normalized = {};
    def.columns.forEach((column) => {
      if (Object.prototype.hasOwnProperty.call(row, column)) {
        normalized[column] = normalizeBackupRawValue(row[column], column, def);
      }
    });
    const hasUsefulValue = Object.values(normalized).some((value) => value !== null && value !== "");
    if (!hasUsefulValue) {
      skipped++;
      return;
    }
    output.push(normalized);
  });
  if (skipped > 0) warnings.push(`${skipped} ${def.key} backup row(s) were skipped due to invalid shape.`);
  return output;
}

async function fetchBackupExtraData() {
  const data = {};
  for (const def of BACKUP_EXTRA_TABLES) {
    const [rows] = await pool.query(`SELECT * FROM ${def.table} ORDER BY ${def.orderBy}`);
    data[def.key] = mapRawBackupRows(rows);
  }
  return data;
}

async function importBackupExtraTable(connection, def, rows) {
  if (!Array.isArray(rows)) return 0;
  await connection.query(`DELETE FROM ${def.table}`);
  for (const row of rows) {
    const columns = def.columns.filter((column) => Object.prototype.hasOwnProperty.call(row, column));
    if (!columns.length) continue;
    const placeholders = columns.map(() => "?").join(", ");
    const values = columns.map((column) => row[column]);
    await connection.query(
      `INSERT INTO ${def.table} (${columns.join(", ")}) VALUES (${placeholders})`,
      values
    );
  }
  return rows.length;
}
function normalizeBackupHomeSections(rows = []) {
  const rawByKey = new Map();
  rows.forEach((row) => {
    const key = clampText(row?.key ?? row?.section_key, 60).toLowerCase();
    if (key) rawByKey.set(key, row);
  });
  const normalized = normalizeHomeSectionsInput(rows);
  return normalized.map((section) => {
    const raw = rawByKey.get(section.key);
    return {
      section_key: section.key,
      label: section.label,
      enabled: section.enabled ? 1 : 0,
      display_order: section.order,
      title: section.title || null,
      subtitle: section.subtitle || null,
      meta_json: safeJsonStringify(section.meta || {}, "{}"),
      created_at: toSqlDateTime(raw?.created_at ?? raw?.createdAt),
      updated_at: toSqlDateTime(raw?.updated_at ?? raw?.updatedAt)
    };
  });
}

function normalizeBackupAuditLogs(rows = [], warnings = []) {
  const output = [];
  const maxRows = 10_000;
  const cappedRows = rows.slice(0, maxRows);
  if (rows.length > maxRows) {
    warnings.push(`Audit logs were capped to ${maxRows} records during import.`);
  }

  cappedRows.forEach((row) => {
    const action = clampText(row?.action, 80);
    const entity = clampText(row?.entity, 80);
    const details = clampText(row?.details, 1000);
    if (!action || !entity || !details) return;

    const id = parsePositiveInt(row?.id);
    const entityId = parsePositiveInt(row?.entity_id ?? row?.entityId);
    const metaRaw = row?.meta_json ?? row?.meta;
    const metaJson = metaRaw == null ? null : normalizeJsonForDb(metaRaw, "{}");

    output.push({
      id: id || null,
      action,
      entity,
      entity_id: entityId || null,
      details,
      meta_json: metaJson,
      created_at: toSqlDateTime(row?.created_at ?? row?.createdAt ?? row?.at)
    });
  });
  return output;
}

function normalizeBackupMemoryModeration(rows = []) {
  const seen = new Set();
  const output = [];
  rows.forEach((row) => {
    const uid = clampText(row?.uid, 64);
    const memoryId = clampText(row?.memory_id ?? row?.memoryId, 120);
    if (!uid || !memoryId) return;
    const key = `${uid}::${memoryId}`;
    if (seen.has(key)) return;
    seen.add(key);

    const moderatedBy = parsePositiveInt(row?.moderated_by ?? row?.moderatedBy);
    output.push({
      uid,
      memory_id: memoryId,
      status: normalizeMemoryStatus(row?.status, "pending"),
      reports: Math.max(0, Math.trunc(Number(row?.reports) || 0)),
      moderated_by: moderatedBy || null,
      moderated_at: toSqlDateTime(row?.moderated_at ?? row?.moderatedAt),
      created_at: toSqlDateTime(row?.created_at ?? row?.createdAt),
      updated_at: toSqlDateTime(row?.updated_at ?? row?.updatedAt)
    });
  });
  return output;
}

function normalizeBackupMemoryModerationFromMemories(rows = []) {
  const seen = new Set();
  const output = [];
  rows.forEach((row) => {
    const decoded = decodeAdminMemoryId(row?.id);
    const uid = clampText(row?.uid ?? decoded?.uid, 64);
    const memoryId = clampText(row?.sourceId ?? decoded?.memoryId, 120);
    if (!uid || !memoryId) return;
    const key = `${uid}::${memoryId}`;
    if (seen.has(key)) return;
    seen.add(key);

    output.push({
      uid,
      memory_id: memoryId,
      status: normalizeMemoryStatus(row?.status, "pending"),
      reports: Math.max(0, Math.trunc(Number(row?.reports) || 0)),
      moderated_by: null,
      moderated_at: toSqlDateTime(row?.moderatedAt ?? row?.submittedAt),
      created_at: null,
      updated_at: null
    });
  });
  return output;
}

async function fetchPlaceCategories({ includeDisabled = false } = {}) {
  await ensureDefaultPlaceCategories();
  const where = includeDisabled ? "" : "WHERE c.enabled = 1";
  const [rows] = await pool.query(
    `
    SELECT
      c.*,
      COALESCE(pc.place_count, 0) AS place_count
    FROM place_categories c
    LEFT JOIN (
      SELECT LOWER(category_name) AS category_name, COUNT(DISTINCT id) AS place_count
      FROM (
        SELECT id, category AS category_name
        FROM places
        WHERE is_deleted = 0 AND status = 'published' AND category IS NOT NULL AND category <> ''
        UNION ALL
        SELECT id, secondary_category AS category_name
        FROM places
        WHERE is_deleted = 0 AND status = 'published' AND secondary_category IS NOT NULL AND secondary_category <> ''
      ) category_rows
      GROUP BY LOWER(category_name)
    ) pc ON pc.category_name = LOWER(c.name)
    ${where}
    ORDER BY c.display_order ASC, c.name ASC
    `
  );
  return rows.map(mapPlaceCategoryRow);
}

// Public read-only data for traveller-facing pages.
router.get("/categories", async (req, res) => {
  try {
    const data = await fetchPlaceCategories({ includeDisabled: false });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("Public categories GET error:", error);
    return res.status(500).json({ success: false, message: "Server error while fetching categories" });
  }
});

router.get("/places", async (req, res) => {
  try {
    const search = clampText(req.query.search, 120).toLowerCase();
    const city = clampText(req.query.city, 120);
    const category = clampText(req.query.category, 80);
    const featuredOnly = toBoolean(req.query.featured, false);
    const limit = Math.min(500, Math.max(1, Math.trunc(Number(req.query.limit) || 200)));
    const offset = Math.max(0, Math.trunc(Number(req.query.offset) || 0));

    const where = ["is_deleted = 0", "status = 'published'"];
    const params = [];

    if (city && city.toLowerCase() !== "all") {
      where.push("LOWER(city) = LOWER(?)");
      params.push(city);
    }
    if (category && category.toLowerCase() !== "all") {
      where.push("(LOWER(category) = LOWER(?) OR LOWER(COALESCE(secondary_category, '')) = LOWER(?))");
      params.push(category, category);
    }
    if (featuredOnly) {
      where.push("featured = 1");
    }
    if (search) {
      where.push("(LOWER(name) LIKE ? OR LOWER(city) LIKE ? OR LOWER(area) LIKE ? OR LOWER(description) LIKE ?)");
      const q = `%${search}%`;
      params.push(q, q, q, q);
    }

    const whereSql = `WHERE ${where.join(" AND ")}`;
    const [rows] = await pool.query(
      `
      SELECT *
      FROM places
      ${whereSql}
      ORDER BY featured DESC, priority DESC, updated_at DESC, id DESC
      LIMIT ? OFFSET ?
      `,
      [...params, limit, offset]
    );
    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS c FROM places ${whereSql}`,
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
    console.error("Public places GET error:", error);
    return res.status(500).json({ success: false, message: "Server error while fetching places" });
  }
});

router.get("/search", async (req, res) => {
  try {
    const query = clampText(req.query.q ?? req.query.query ?? req.query.search, 120).toLowerCase();
    const city = clampText(req.query.city, 120);
    const category = clampText(req.query.category, 80);
    const limit = Math.min(100, Math.max(1, Math.trunc(Number(req.query.limit) || 40)));
    if (!query) {
      return res.status(200).json({ success: true, data: [], meta: { query: "", count: 0 } });
    }

    const where = ["is_deleted = 0", "status = 'published'"];
    const params = [];
    if (city && city.toLowerCase() !== "all" && city.toLowerCase() !== "your location") {
      where.push("LOWER(city) = LOWER(?)");
      params.push(city);
    }
    if (category && category.toLowerCase() !== "all") {
      where.push("(LOWER(category) = LOWER(?) OR LOWER(COALESCE(secondary_category, '')) = LOWER(?))");
      params.push(category, category);
    }
    where.push("(LOWER(name) LIKE ? OR LOWER(city) LIKE ? OR LOWER(area) LIKE ? OR LOWER(category) LIKE ? OR LOWER(COALESCE(secondary_category, '')) LIKE ? OR LOWER(description) LIKE ?)");
    const like = `%${query}%`;
    params.push(like, like, like, like, like, like);

    const [rows] = await pool.query(
      `
      SELECT *
      FROM places
      WHERE ${where.join(" AND ")}
      ORDER BY featured DESC, priority DESC, updated_at DESC, id DESC
      LIMIT ?
      `,
      [...params, Math.max(limit * 3, limit)]
    );
    const ranked = rows
      .map((row) => ({ row, score: scoreSearchPlaceRow(row, query) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || Number(b.row.priority || 0) - Number(a.row.priority || 0))
      .slice(0, limit);

    return res.status(200).json({
      success: true,
      data: ranked.map((item) => ({ ...mapPlaceRow(item.row), searchScore: Math.round(item.score) })),
      meta: {
        query,
        count: ranked.length,
        source: "mysql"
      }
    });
  } catch (error) {
    console.error("Public search GET error:", error);
    return res.status(500).json({ success: false, message: "Server error while searching places" });
  }
});

router.post("/search-analytics", async (req, res) => {
  try {
    await ensureSearchAnalyticsSchema();
    const query = clampText(req.body?.query ?? req.body?.q ?? req.body?.search, 180);
    const normalized = query.toLowerCase().replace(/\s+/g, " ").trim();
    if (!normalized || normalized.length < 2) {
      return res.status(400).json({ success: false, message: "Search query is required" });
    }
    const city = clampText(req.body?.city, 120) || null;
    const category = clampText(req.body?.category, 80) || null;
    const userUid = clampText(req.body?.userUid ?? req.body?.uid, 80) || null;
    const resultCount = Math.max(0, Math.trunc(Number(req.body?.resultCount) || 0));
    const source = clampText(req.body?.source, 40) || "home";

    await pool.query(
      `INSERT INTO search_analytics
       (query, normalized_query, city, category, user_uid, result_count, source)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [query, normalized, city, category, userUid, resultCount, source]
    );

    return res.status(201).json({ success: true, message: "Search analytics saved" });
  } catch (error) {
    console.error("Search analytics POST error:", error);
    return res.status(500).json({ success: false, message: "Server error while saving search analytics" });
  }
});

function parseRecommendationIds(value) {
  return String(value || "")
    .split(/[,\s]+/)
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item > 0)
    .slice(0, 80);
}

function scoreRecommendationPlaceRow(row, signals = {}) {
  const analytics = normalizeAnalyticsInput(safeJsonParse(row.analytics_json, {}));
  const savedIds = signals.savedIds || new Set();
  const viewedIds = signals.viewedIds || new Set();
  const recent = signals.recent || "";
  const category = clampText(row.category, 80).toLowerCase();
  const haystack = [
    row.name,
    row.city,
    row.area,
    row.category,
    row.secondary_category,
    row.description
  ].map((item) => clampText(item, 500).toLowerCase()).join(" ");

  let score = 0;
  score += Number(row.featured || 0) ? 80 : 0;
  score += Math.max(0, Number(row.priority || 0)) * 10;
  score += analytics.views * 0.25 + analytics.clicks * 0.9 + analytics.saves * 2.5;
  if (savedIds.has(Number(row.id))) score += 22;
  if (viewedIds.has(Number(row.id))) score -= 8;
  if (signals.category && category === signals.category) score += 55;
  if (recent && haystack.includes(recent)) score += 42;
  return score;
}

router.get("/recommendations", async (req, res) => {
  try {
    const city = clampText(req.query.city, 120);
    const category = normalizeCategorySlug(req.query.category);
    const recent = clampText(req.query.recent, 120).toLowerCase();
    const limit = Math.min(24, Math.max(1, Math.trunc(Number(req.query.limit) || 6)));
    const savedIds = new Set(parseRecommendationIds(req.query.savedIds));
    const viewedIds = new Set(parseRecommendationIds(req.query.viewedIds));

    const where = ["is_deleted = 0", "status = 'published'"];
    const params = [];
    if (city && city.toLowerCase() !== "all" && city.toLowerCase() !== "your location") {
      where.push("(LOWER(city) = LOWER(?) OR LOWER(area) = LOWER(?))");
      params.push(city, city);
    }
    if (category && category !== "all") {
      where.push("(LOWER(category) = LOWER(?) OR LOWER(COALESCE(secondary_category, '')) = LOWER(?))");
      params.push(category, category);
    }

    const [rows] = await pool.query(
      `
      SELECT *
      FROM places
      WHERE ${where.join(" AND ")}
      ORDER BY featured DESC, priority DESC, updated_at DESC, id DESC
      LIMIT 160
      `,
      params
    );

    const signals = { savedIds, viewedIds, category, recent };
    const ranked = rows
      .map((row) => ({ row, score: scoreRecommendationPlaceRow(row, signals) }))
      .sort((a, b) => b.score - a.score || Number(b.row.priority || 0) - Number(a.row.priority || 0))
      .slice(0, limit);

    return res.status(200).json({
      success: true,
      data: ranked.map((item) => ({ ...mapPlaceRow(item.row), recommendationScore: Math.round(item.score) })),
      meta: {
        source: "mysql",
        count: ranked.length
      }
    });
  } catch (error) {
    console.error("Public recommendations GET error:", error);
    return res.status(500).json({ success: false, message: "Server error while fetching recommendations" });
  }
});

router.post("/places/:id/metrics", async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      return res.status(400).json({ success: false, message: "Invalid place id" });
    }

    const metric = clampText(req.body?.metric, 24).toLowerCase();
    if (!["views", "saves", "clicks"].includes(metric)) {
      return res.status(400).json({
        success: false,
        message: "metric must be one of: views, saves, clicks"
      });
    }

    const deltaRaw = Number(req.body?.delta ?? 1);
    const delta = Number.isFinite(deltaRaw)
      ? Math.max(1, Math.min(25, Math.trunc(deltaRaw)))
      : 1;

    const [rows] = await pool.query(
      "SELECT id, analytics_json FROM places WHERE id = ? AND is_deleted = 0 LIMIT 1",
      [id]
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, message: "Place not found" });
    }

    const analytics = normalizeAnalyticsInput(safeJsonParse(rows[0].analytics_json, {}));
    analytics[metric] = Math.max(0, Math.trunc(Number(analytics[metric] || 0)) + delta);

    await pool.query(
      "UPDATE places SET analytics_json = ?, updated_at = updated_at WHERE id = ? LIMIT 1",
      [safeJsonStringify(analytics, "{}"), id]
    );

    return res.status(200).json({
      success: true,
      message: "Metric updated",
      data: {
        id,
        metric,
        delta,
        analytics
      }
    });
  } catch (error) {
    console.error("Public place metrics POST error:", error);
    return res.status(500).json({ success: false, message: "Server error while updating metric" });
  }
});

router.get("/home-sections", async (req, res) => {
  try {
    await ensureDefaultHomeSections();
    const [rows] = await pool.query(
      "SELECT * FROM home_sections ORDER BY display_order ASC, section_key ASC"
    );
    return res.status(200).json({
      success: true,
      data: rows.map(mapHomeSectionRow)
    });
  } catch (error) {
    console.error("Public home sections GET error:", error);
    return res.status(500).json({ success: false, message: "Server error while fetching home sections" });
  }
});

router.get("/services", async (req, res) => {
  try {
    const city = clampText(req.query.city, 120);
    const search = clampText(req.query.search, 120).toLowerCase();
    const category = clampText(req.query.category, 80);
    const limit = Math.min(500, Math.max(1, Math.trunc(Number(req.query.limit) || 200)));
    const offset = Math.max(0, Math.trunc(Number(req.query.offset) || 0));

    const where = ["cs.status = 'active'"];
    const params = [];

    if (city && city.toLowerCase() !== "all") {
      where.push("(LOWER(cs.city) = LOWER(?) OR LOWER(TRIM(cs.city)) IN ('all', 'all india', 'selected cities', 'pan india', 'nationwide'))");
      params.push(city);
    }
    if (category && category.toLowerCase() !== "all") {
      where.push("LOWER(cs.category) = LOWER(?)");
      params.push(category);
    }
    if (search) {
      where.push("(LOWER(cs.name) LIKE ? OR LOWER(cs.city) LIKE ? OR LOWER(cs.area) LIKE ? OR LOWER(cs.description) LIKE ?)");
      const q = `%${search}%`;
      params.push(q, q, q, q);
    }

    const whereSql = `WHERE ${where.join(" AND ")}`;
    const [rows] = await pool.query(
      `
      ${serviceSelectSql()}
      ${whereSql}
      ORDER BY COALESCE(se.open_count, 0) DESC, cs.updated_at DESC, cs.id DESC
      LIMIT ? OFFSET ?
      `,
      [...params, limit, offset]
    );
    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS c FROM city_services cs ${whereSql}`,
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
    console.error("Public services GET error:", error);
    return res.status(500).json({ success: false, message: "Server error while fetching services" });
  }
});

router.get("/services/popular", async (req, res) => {
  try {
    const city = clampText(req.query.city, 120);
    const category = clampText(req.query.category, 80);
    const limit = Math.min(12, Math.max(1, Math.trunc(Number(req.query.limit) || 5)));

    const where = ["cs.status = 'active'"];
    const params = [];
    if (city && city.toLowerCase() !== "all") {
      where.push("(LOWER(cs.city) = LOWER(?) OR LOWER(TRIM(cs.city)) IN ('all', 'all india', 'selected cities', 'pan india', 'nationwide'))");
      params.push(city);
    }
    if (category && category.toLowerCase() !== "all") {
      where.push("LOWER(cs.category) = LOWER(?)");
      params.push(category);
    }

    const [rows] = await pool.query(
      `
      ${serviceSelectSql()}
      WHERE ${where.join(" AND ")}
      ORDER BY COALESCE(se.open_count, 0) DESC, COALESCE(rt.avg_rating, 0) DESC, cs.updated_at DESC, cs.id DESC
      LIMIT ?
      `,
      [...params, limit]
    );

    return res.status(200).json({
      success: true,
      data: rows.map(mapServiceRow)
    });
  } catch (error) {
    console.error("Popular services GET error:", error);
    return res.status(500).json({ success: false, message: "Server error while fetching popular services" });
  }
});

router.post("/services/:id/track", async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid service id" });

    const service = await getServiceById(id);
    if (!service || service.status !== "active") {
      return res.status(404).json({ success: false, message: "Service not found" });
    }

    const requestedType = clampText(req.body?.eventType ?? req.body?.type, 32).toLowerCase();
    const eventType = SERVICE_EVENT_TYPES.has(requestedType) ? requestedType : "open";
    await pool.query(
      `
      INSERT INTO city_service_events (service_id, event_type, city, category, user_uid, session_id)
      VALUES (?, ?, ?, ?, ?, ?)
      `,
      [
        id,
        eventType,
        clampText(req.body?.city || service.city, 120) || null,
        service.category || null,
        clampText(req.body?.userUid, 80) || null,
        clampText(req.body?.sessionId, 120) || null
      ]
    );

    return res.status(201).json({ success: true, message: "Service event tracked" });
  } catch (error) {
    console.error("Service track POST error:", error);
    return res.status(500).json({ success: false, message: "Server error while tracking service" });
  }
});

router.post("/services/:id/report", async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid service id" });

    const service = await getServiceById(id);
    if (!service) return res.status(404).json({ success: false, message: "Service not found" });

    const reason = clampText(req.body?.reason, 80) || "wrong_info";
    const details = String(req.body?.details || "").trim().slice(0, 1200);
    await pool.query(
      `
      INSERT INTO city_service_reports (service_id, reason, details, city, reporter_uid, status)
      VALUES (?, ?, ?, ?, ?, 'pending')
      `,
      [
        id,
        reason,
        details || null,
        clampText(req.body?.city || service.city, 120) || null,
        clampText(req.body?.userUid, 80) || null
      ]
    );

    await createAuditLog("report", "service", `Service reported: ${service.name}`, id, { reason });
    return res.status(201).json({
      success: true,
      message: "Report received. Admin will review it."
    });
  } catch (error) {
    console.error("Service report POST error:", error);
    return res.status(500).json({ success: false, message: "Server error while reporting service" });
  }
});

router.post("/services/:id/rating", async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid service id" });

    const service = await getServiceById(id);
    if (!service || service.status !== "active") {
      return res.status(404).json({ success: false, message: "Service not found" });
    }

    const ratingInput = Math.trunc(Number(req.body?.rating));
    if (!Number.isFinite(ratingInput) || ratingInput < 1 || ratingInput > 5) {
      return res.status(400).json({ success: false, message: "Rating must be between 1 and 5" });
    }
    const rating = ratingInput;

    await pool.query(
      `
      INSERT INTO city_service_ratings (service_id, rating, city, user_uid, session_id)
      VALUES (?, ?, ?, ?, ?)
      `,
      [
        id,
        rating,
        clampText(req.body?.city || service.city, 120) || null,
        clampText(req.body?.userUid, 80) || null,
        clampText(req.body?.sessionId, 120) || null
      ]
    );

    return res.status(201).json({ success: true, message: "Thanks for rating this service" });
  } catch (error) {
    console.error("Service rating POST error:", error);
    return res.status(500).json({ success: false, message: "Server error while rating service" });
  }
});

router.get("/kumbh-guide", async (req, res) => {
  try {
    await ensureDefaultKumbhItems();
    const settings = await fetchKumbhSettings();
    const [rows] = await pool.query(
      `
      SELECT *
      FROM kumbh_items
      WHERE status = 'active'
      ORDER BY
        ${kumbhTypeOrderSql()},
        priority DESC,
        COALESCE(date_value, '9999-12-31') ASC,
        updated_at DESC
      `
    );
    const grouped = groupKumbhItems(rows);
    const counts = Object.fromEntries(
      Object.entries(grouped).map(([key, value]) => [key, Array.isArray(value) ? value.length : 0])
    );
    const lastUpdated = rows.reduce((latest, row) => {
      const current = row?.updated_at ? new Date(row.updated_at).getTime() : 0;
      return current > latest ? current : latest;
    }, 0);
    return res.status(200).json({
      success: true,
      data: {
        settings,
        counts,
        lastUpdated: lastUpdated ? new Date(lastUpdated).toISOString() : "",
        ...grouped
      }
    });
  } catch (error) {
    console.error("Kumbh guide GET error:", error);
    return res.status(500).json({ success: false, message: "Server error while fetching Kumbh guide" });
  }
});

router.get("/memories", async (req, res) => {
  try {
    const statusRaw = clampText(req.query.status, 24).toLowerCase();
    const statusFilter = statusRaw === "all"
      ? "all"
      : normalizeMemoryStatus(statusRaw || "approved", "approved");
    const uidFilter = clampText(req.query.uid, 64);
    const cityFilter = clampText(req.query.city, 120).toLowerCase();
    const search = clampText(req.query.search, 120).toLowerCase();
    const limit = Math.min(500, Math.max(1, Math.trunc(Number(req.query.limit) || 200)));
    const offset = Math.max(0, Math.trunc(Number(req.query.offset) || 0));

    const all = await getAllPublicMemories();
    const filtered = all
      .filter((memory) => (statusFilter === "all" ? true : memory.status === statusFilter))
      .filter((memory) => (uidFilter ? clampText(memory.uid, 64) === uidFilter : true))
      .filter((memory) => {
        if (!cityFilter) return true;
        return String(memory.location || "").toLowerCase().includes(cityFilter);
      })
      .filter((memory) => {
        if (!search) return true;
        return (
          String(memory.user || "").toLowerCase().includes(search) ||
          String(memory.userEmail || "").toLowerCase().includes(search) ||
          String(memory.location || "").toLowerCase().includes(search) ||
          String(memory.caption || "").toLowerCase().includes(search)
        );
      })
      .map(mapPublicMemoryFeedItem);

    const total = filtered.length;
    const data = filtered.slice(offset, offset + limit);

    return res.status(200).json({
      success: true,
      data,
      pagination: {
        total,
        limit,
        offset
      }
    });
  } catch (error) {
    console.error("Public memories GET error:", error);
    return res.status(500).json({ success: false, message: "Server error while fetching memories" });
  }
});

router.use("/admin", requireAdminAuth);

function getAdminPinVersion(row) {
  return row?.admin_pin_updated_at ? toIso(row.admin_pin_updated_at) : "";
}

function readAdminPinHeader(req) {
  return String(req.headers["x-admin-pin-token"] || req.headers["x-explorex-admin-pin"] || "").trim();
}

async function requireAdminPinSession(req, res, next) {
  if (isSuperAdminIdentity(req.auth)) return next();

  const pinToken = readAdminPinHeader(req);
  if (!pinToken) {
    return res.status(403).json({
      success: false,
      code: "ADMIN_PIN_REQUIRED",
      message: "Admin PIN verification required"
    });
  }

  let decoded;
  try {
    decoded = verifyAdminPinToken(pinToken);
  } catch (error) {
    return res.status(403).json({
      success: false,
      code: "ADMIN_PIN_INVALID",
      message: "Admin PIN session expired. Please enter PIN again."
    });
  }

  if (Number(decoded.userId || 0) !== Number(req.auth?.userId || 0)) {
    return res.status(403).json({
      success: false,
      code: "ADMIN_PIN_INVALID",
      message: "Admin PIN session does not match current user"
    });
  }

  try {
    const [rows] = await pool.query(
      "SELECT id, email, role, admin_pin_hash, admin_pin_updated_at FROM users WHERE id = ? LIMIT 1",
      [req.auth.userId]
    );
    if (!rows.length || !hasAdminRole(rows[0].role)) {
      return res.status(403).json({ success: false, code: "ADMIN_PIN_INVALID", message: "Admin access denied" });
    }
    if (!rows[0].admin_pin_hash) {
      return res.status(403).json({
        success: false,
        code: "ADMIN_PIN_NOT_SET",
        message: "Admin PIN is not set. Contact Super Admin."
      });
    }
    if (String(decoded.pinUpdatedAt || "") !== getAdminPinVersion(rows[0])) {
      return res.status(403).json({
        success: false,
        code: "ADMIN_PIN_EXPIRED",
        message: "Admin PIN was changed. Please enter PIN again."
      });
    }
    req.adminPin = { verified: true };
    return next();
  } catch (error) {
    console.error("Admin PIN middleware error:", error);
    return res.status(500).json({ success: false, message: "Server error while verifying admin PIN" });
  }
}

router.get("/admin/verify", async (req, res) => {
  const isSuperAdmin = isSuperAdminIdentity(req.auth);
  const permissions = isSuperAdmin
    ? defaultPermissionMap(true)
    : await getAdminPermissionMap(req.auth?.userId).catch(() => defaultPermissionMap(true));
  let pinVerified = false;
  const pinToken = readAdminPinHeader(req);

  if (isSuperAdmin) {
    pinVerified = true;
  } else if (pinToken) {
    try {
      const decoded = verifyAdminPinToken(pinToken);
      if (Number(decoded.userId || 0) === Number(req.auth?.userId || 0)) {
        const [rows] = await pool.query(
          "SELECT admin_pin_hash, admin_pin_updated_at FROM users WHERE id = ? LIMIT 1",
          [req.auth.userId]
        );
        pinVerified = Boolean(rows[0]?.admin_pin_hash)
          && String(decoded.pinUpdatedAt || "") === getAdminPinVersion(rows[0]);
      }
    } catch (error) {
      pinVerified = false;
    }
  }

  return res.status(200).json({
    success: true,
    message: "Admin access verified",
    admin: {
      userId: req.auth?.userId,
      role: req.auth?.role,
      email: req.auth?.email,
      isSuperAdmin,
      isProtectedAdmin: isProtectedAdminIdentity(req.auth),
      pinRequired: !isSuperAdmin,
      pinVerified,
      permissions
    }
  });
});

router.get("/admin/pin-status", async (req, res) => {
  try {
    const isSuperAdmin = isSuperAdminIdentity(req.auth);
    const [rows] = await pool.query(
      "SELECT admin_pin_hash, admin_pin_locked_until FROM users WHERE id = ? LIMIT 1",
      [req.auth.userId]
    );
    return res.status(200).json({
      success: true,
      data: {
        pinRequired: !isSuperAdmin,
        hasPin: Boolean(rows[0]?.admin_pin_hash),
        lockedUntil: toIso(rows[0]?.admin_pin_locked_until)
      }
    });
  } catch (error) {
    console.error("Admin PIN status error:", error);
    return res.status(500).json({ success: false, message: "Server error while checking admin PIN status" });
  }
});

router.post("/admin/verify-pin", async (req, res) => {
  const pin = normalizeAdminPin(req.body?.pin);
  if (!pin) {
    return res.status(400).json({ success: false, message: "Please enter a valid 4 digit admin PIN" });
  }

  try {
    const [rows] = await pool.query(
      `SELECT id, full_name, email, role, admin_pin_hash, admin_pin_updated_at,
              admin_pin_failed_attempts, admin_pin_locked_until
       FROM users
       WHERE id = ?
       LIMIT 1`,
      [req.auth.userId]
    );
    if (!rows.length || !hasAdminRole(rows[0].role)) {
      return res.status(403).json({ success: false, message: "Admin access denied" });
    }

    const admin = rows[0];
    if (!admin.admin_pin_hash) {
      return res.status(403).json({
        success: false,
        code: "ADMIN_PIN_NOT_SET",
        message: "Admin PIN is not set. Contact Super Admin."
      });
    }

    const lockedUntil = admin.admin_pin_locked_until ? new Date(admin.admin_pin_locked_until) : null;
    if (lockedUntil && lockedUntil.getTime() > Date.now()) {
      return res.status(423).json({
        success: false,
        code: "ADMIN_PIN_LOCKED",
        message: "Too many wrong PIN attempts. Try again later.",
        lockedUntil: lockedUntil.toISOString()
      });
    }

    const matches = await bcrypt.compare(pin, admin.admin_pin_hash);
    if (!matches) {
      const attempts = Number(admin.admin_pin_failed_attempts || 0) + 1;
      const shouldLock = attempts >= 5;
      await pool.query(
        `UPDATE users
         SET admin_pin_failed_attempts = ?,
             admin_pin_locked_until = ${shouldLock ? "DATE_ADD(NOW(), INTERVAL 15 MINUTE)" : "NULL"}
         WHERE id = ? LIMIT 1`,
        [shouldLock ? 0 : attempts, admin.id]
      );
      await createAuditLog("admin_pin_failed", "user", `Wrong admin PIN attempt for "${admin.full_name}"`, admin.id);
      return res.status(401).json({
        success: false,
        code: shouldLock ? "ADMIN_PIN_LOCKED" : "ADMIN_PIN_WRONG",
        message: shouldLock ? "Too many wrong attempts. Admin PIN locked for 15 minutes." : "Incorrect admin PIN"
      });
    }

    await pool.query(
      "UPDATE users SET admin_pin_failed_attempts = 0, admin_pin_locked_until = NULL WHERE id = ? LIMIT 1",
      [admin.id]
    );
    const adminPinToken = signAdminPinToken(admin, { pinUpdatedAt: getAdminPinVersion(admin) });
    await createAuditLog("admin_pin_verified", "user", `Admin PIN verified for "${admin.full_name}"`, admin.id);

    return res.status(200).json({
      success: true,
      message: "Admin PIN verified",
      adminPinToken,
      expiresIn: process.env.ADMIN_PIN_EXPIRES_IN || "2h"
    });
  } catch (error) {
    console.error("Admin PIN verify error:", error);
    return res.status(500).json({ success: false, message: "Server error while verifying admin PIN" });
  }
});

router.use("/admin", requireAdminPinSession);

router.get("/admin/permission-control", requireSuperAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, full_name, email, role, account_status, created_at, updated_at
       FROM users
       WHERE LOWER(COALESCE(role, '')) = 'admin'
         AND deleted_at IS NULL
       ORDER BY full_name ASC, id ASC`
    );

    const admins = [];
    for (const row of rows) {
      if (isSuperAdminIdentity(row)) continue;
      admins.push({
        id: Number(row.id),
        name: row.full_name || "Admin",
        email: row.email || "",
        role: row.role || "Admin",
        status: normalizeUserAccountStatus(row.account_status, "active"),
        permissions: await getAdminPermissionMap(row.id),
        createdAt: toIso(row.created_at),
        updatedAt: toIso(row.updated_at)
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        definitions: ADMIN_PERMISSION_DEFINITIONS,
        admins
      }
    });
  } catch (error) {
    console.error("Permission control GET error:", error);
    return res.status(500).json({ success: false, message: "Server error while loading admin permissions" });
  }
});

router.put("/admin/permission-control/:adminId", requireSuperAdmin, async (req, res) => {
  const adminId = Math.trunc(Number(req.params.adminId));
  const input = req.body?.permissions;
  if (!Number.isFinite(adminId) || adminId <= 0) {
    return res.status(400).json({ success: false, message: "Invalid admin id" });
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return res.status(400).json({ success: false, message: "Permissions object is required" });
  }

  try {
    const [rows] = await pool.query(
      `SELECT id, full_name, email, role, account_status, deleted_at
       FROM users WHERE id = ? LIMIT 1`,
      [adminId]
    );
    const target = rows[0];
    if (!target || target.deleted_at || String(target.role || "").trim().toLowerCase() !== "admin") {
      return res.status(404).json({ success: false, message: "Normal Admin account not found" });
    }
    if (isSuperAdminIdentity(target)) {
      return res.status(403).json({ success: false, message: "Super Admin permissions cannot be restricted" });
    }

    const nextPermissions = defaultPermissionMap(true);
    Object.entries(input).forEach(([rawKey, value]) => {
      const key = normalizePermissionKey(rawKey);
      if (key) nextPermissions[key] = Boolean(value);
    });

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      for (const [key, canEdit] of Object.entries(nextPermissions)) {
        await connection.query(
          `INSERT INTO admin_permissions (admin_id, permission_key, can_edit, updated_by)
           VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             can_edit = VALUES(can_edit),
             updated_by = VALUES(updated_by),
             updated_at = CURRENT_TIMESTAMP`,
          [adminId, key, canEdit ? 1 : 0, Number(req.auth?.userId || 0) || null]
        );
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    const enabledCount = Object.values(nextPermissions).filter(Boolean).length;
    await createAuditLog(
      "admin_permissions_update",
      "admin_permission",
      `Updated edit permissions for \"${target.full_name || target.email}\" (${enabledCount}/${ADMIN_PERMISSION_DEFINITIONS.length} enabled)`,
      adminId,
      { permissions: nextPermissions, updatedBy: Number(req.auth?.userId || 0) }
    );

    return res.status(200).json({
      success: true,
      message: "Admin permissions updated successfully",
      data: { adminId, permissions: nextPermissions }
    });
  } catch (error) {
    console.error("Permission control PUT error:", error);
    return res.status(500).json({ success: false, message: "Server error while saving admin permissions" });
  }
});

router.use("/admin", enforceMappedAdminPermission);

router.get("/admin/search-analytics", async (req, res) => {
  try {
    await ensureSearchAnalyticsSchema();
    const days = Math.min(90, Math.max(1, Math.trunc(Number(req.query.days) || 30)));
    const [topQueries] = await pool.query(
      `
      SELECT
        normalized_query AS query,
        COUNT(*) AS searches,
        COALESCE(SUM(result_count), 0) AS total_results,
        ROUND(AVG(result_count), 1) AS avg_results,
        MAX(created_at) AS last_searched
      FROM search_analytics
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY normalized_query
      ORDER BY searches DESC, last_searched DESC
      LIMIT 12
      `,
      [days]
    );
    const [topCities] = await pool.query(
      `
      SELECT COALESCE(NULLIF(city, ''), 'Unknown') AS city, COUNT(*) AS searches
      FROM search_analytics
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY COALESCE(NULLIF(city, ''), 'Unknown')
      ORDER BY searches DESC
      LIMIT 8
      `,
      [days]
    );
    const [noResultRows] = await pool.query(
      `
      SELECT normalized_query AS query, COUNT(*) AS searches, MAX(created_at) AS last_searched
      FROM search_analytics
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        AND result_count = 0
      GROUP BY normalized_query
      ORDER BY searches DESC, last_searched DESC
      LIMIT 8
      `,
      [days]
    );
    const [recent] = await pool.query(
      `
      SELECT query, city, category, result_count, source, created_at
      FROM search_analytics
      ORDER BY created_at DESC
      LIMIT 10
      `
    );

    return res.status(200).json({
      success: true,
      data: {
        days,
        topQueries,
        topCities,
        noResults: noResultRows,
        recent
      }
    });
  } catch (error) {
    console.error("Admin search analytics GET error:", error);
    return res.status(500).json({ success: false, message: "Server error while fetching search analytics" });
  }
});

// ─────────────────────────────────────────────────────────
// Overview
// ─────────────────────────────────────────────────────────
router.get("/admin/overview", async (req, res) => {
  try {
    const [[placesCountRow]] = await pool.query("SELECT COUNT(*) AS c FROM places WHERE is_deleted = 0");
    const [[servicesCountRow]] = await pool.query("SELECT COUNT(*) AS c FROM city_services");
    const [[usersCountRow]] = await pool.query(
      "SELECT COUNT(*) AS c FROM users WHERE LOWER(COALESCE(account_status, 'active')) <> 'deleted'"
    );
    const [[memoriesCountRow]] = await pool.query(
      "SELECT COALESCE(SUM(JSON_LENGTH(memories_json)), 0) AS c FROM profile_states"
    );

    return res.status(200).json({
      success: true,
      data: {
        places: Number(placesCountRow?.c || 0),
        services: Number(servicesCountRow?.c || 0),
        users: Number(usersCountRow?.c || 0),
        memories: Number(memoriesCountRow?.c || 0)
      }
    });
  } catch (error) {
    console.error("Admin overview GET error:", error);
    return res.status(500).json({ success: false, message: "Server error while fetching overview" });
  }
});

// ─────────────────────────────────────────────────────────
// Users
// ─────────────────────────────────────────────────────────
router.get("/admin/users", async (req, res) => {
  try {
    const search = clampText(req.query.search, 120).toLowerCase();
    const statusRaw = clampText(req.query.status, 24).toLowerCase();
    const roleRaw = clampText(req.query.role, 32).toLowerCase();
    const includeDeleted = toBoolean(req.query.includeDeleted, true);
    const limit = Math.min(500, Math.max(1, Math.trunc(Number(req.query.limit) || 200)));
    const offset = Math.max(0, Math.trunc(Number(req.query.offset) || 0));
    const roleFilterMap = new Map([
      ["traveller", "traveller"],
      ["guide", "guide"],
      ["admin", "admin"]
    ]);

    const where = [];
    const params = [];
    if (statusRaw && statusRaw !== "all") {
      const status = normalizeUserAccountStatus(statusRaw, "active");
      where.push("LOWER(COALESCE(u.account_status, 'active')) = ?");
      params.push(status);
    } else if (!includeDeleted) {
      where.push("LOWER(COALESCE(u.account_status, 'active')) <> 'deleted'");
    }
    if (roleRaw && roleRaw !== "all") {
      const role = roleFilterMap.get(roleRaw);
      if (!role) {
        return res.status(400).json({ success: false, message: "Invalid user role filter" });
      }
      where.push("LOWER(COALESCE(u.role, '')) = ?");
      params.push(role);
    }
    if (search) {
      where.push(
        "(LOWER(u.full_name) LIKE ? OR LOWER(u.email) LIKE ? OR LOWER(COALESCE(u.deleted_original_email,'')) LIKE ? OR LOWER(COALESCE(u.username,'')) LIKE ? OR LOWER(COALESCE(u.deleted_original_username,'')) LIKE ? OR LOWER(COALESCE(u.role,'')) LIKE ? OR LOWER(COALESCE(ps.location,'')) LIKE ?)"
      );
      const q = `%${search}%`;
      params.push(q, q, q, q, q, q, q);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const [rows] = await pool.query(
      `
      SELECT
        u.id,
        u.full_name,
        u.email,
        u.username,
        u.role,
        u.admin_pin_hash,
        u.account_status,
        u.deleted_at,
        u.deleted_original_email,
        u.deleted_original_username,
        u.created_at,
        u.updated_at,
        ps.location,
        ps.bio,
        ps.saved_ids_json,
        ps.visited_ids_json,
        ps.memories_json,
        ps.updated_at AS profile_updated_at
      FROM users u
      LEFT JOIN profile_states ps ON ps.uid = CONCAT('user_', u.id)
      ${whereSql}
      ORDER BY u.created_at DESC, u.id DESC
      LIMIT ? OFFSET ?
      `,
      [...params, limit, offset]
    );

    const [countRows] = await pool.query(
      `
      SELECT COUNT(*) AS c
      FROM users u
      LEFT JOIN profile_states ps ON ps.uid = CONCAT('user_', u.id)
      ${whereSql}
      `,
      params
    );

    return res.status(200).json({
      success: true,
      data: rows.map(mapAdminUserRow),
      pagination: {
        total: Number(countRows[0]?.c || 0),
        limit,
        offset
      }
    });
  } catch (error) {
    console.error("Admin users GET error:", error);
    return res.status(500).json({ success: false, message: "Server error while fetching users" });
  }
});

router.post("/admin/users", async (req, res) => {
  const name = clampText(req.body?.name, 120);
  const email = clampText(req.body?.email, 190).toLowerCase();
  const role = normalizeUserRole(req.body?.role, "Traveller");
  const accountStatus = normalizeUserAccountStatus(req.body?.status, "active");
  const password = String(req.body?.password || "");
  const requestedUsername = normalizeUsernameValue(req.body?.username);
  const adminPinRaw = String(req.body?.adminPin || "").trim();
  const adminPin = normalizeAdminPin(adminPinRaw);

  if (!name) {
    return res.status(400).json({ success: false, message: "Please enter full name" });
  }
  if (!email || !isValidEmail(email)) {
    return res.status(400).json({ success: false, message: "Please enter a valid email address" });
  }
  if (!password || password.length < 6) {
    return res.status(400).json({ success: false, message: "Password must be at least 6 characters" });
  }
  if (accountStatus === "deleted") {
    return res.status(400).json({ success: false, message: "New user cannot be created with deleted status" });
  }
  if (hasAdminRole(role)) {
    if (!isSuperAdminIdentity(req.auth)) {
      return res.status(403).json({ success: false, message: "Only Super Admin can create admin users" });
    }
    if (!adminPin) {
      return res.status(400).json({ success: false, message: "4 digit admin PIN is required for admin users" });
    }
  } else if (adminPinRaw) {
    return res.status(400).json({ success: false, message: "Admin PIN can be set only for Admin role" });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [emailRows] = await connection.query(
      "SELECT id FROM users WHERE email = ? AND deleted_at IS NULL LIMIT 1",
      [email]
    );
    if (emailRows.length > 0) {
      await connection.rollback();
      return res.status(409).json({ success: false, message: "An account with this email already exists" });
    }

    if (requestedUsername) {
      const [usernameRows] = await connection.query(
        "SELECT id FROM users WHERE username = ? LIMIT 1",
        [requestedUsername]
      );
      if (usernameRows.length > 0) {
        await connection.rollback();
        return res.status(409).json({ success: false, message: "This username is already taken" });
      }
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const adminPinHash = hasAdminRole(role) ? await bcrypt.hash(adminPin, 12) : null;
    const [insertResult] = await connection.query(
      `INSERT INTO users
       (full_name, email, password_hash, username, role, admin_pin_hash, admin_pin_updated_at, account_status, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      [name, email, passwordHash, requestedUsername || null, role, adminPinHash, adminPinHash ? new Date() : null, accountStatus]
    );

    const userId = Number(insertResult.insertId);
    const username = requestedUsername || `@${toUsernameSeed(name)}${userId}`;
    if (!requestedUsername) {
      await connection.query("UPDATE users SET username = ? WHERE id = ?", [username, userId]);
    }

    await ensureUserProfileRows(connection, { id: userId, name, username });
    await connection.commit();

    await createAuditLog(
      "create",
      "user",
      `Created user "${name}" (${email})`,
      userId,
      { role, accountStatus, adminPinSet: Boolean(adminPinHash) }
    );

    const created = await getAdminUserById(userId);
    return res.status(201).json({
      success: true,
      message: "User created successfully",
      data: created
    });
  } catch (error) {
    await connection.rollback();
    if (error?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ success: false, message: "Email or username already exists" });
    }
    console.error("Admin user POST error:", error);
    return res.status(500).json({ success: false, message: "Server error while creating user" });
  } finally {
    connection.release();
  }
});

router.put("/admin/users/:id", async (req, res) => {
  const userId = parsePositiveInt(req.params.id);
  if (!userId) {
    return res.status(400).json({ success: false, message: "Invalid user id" });
  }

  const name = clampText(req.body?.name, 120);
  const email = clampText(req.body?.email, 190).toLowerCase();
  const role = normalizeUserRole(req.body?.role, "Traveller");
  const statusInputRaw = req.body?.status;
  const statusProvided = statusInputRaw != null && String(statusInputRaw).trim() !== "";
  const requestedStatus = statusProvided
    ? normalizeUserAccountStatus(statusInputRaw, "__invalid__")
    : null;
  const nextPassword = String(req.body?.password || "");
  const requestedUsername = normalizeUsernameValue(req.body?.username);
  const adminPinRaw = String(req.body?.adminPin || "").trim();
  const adminPin = normalizeAdminPin(adminPinRaw);

  if (!name) {
    return res.status(400).json({ success: false, message: "Please enter full name" });
  }
  if (!email || !isValidEmail(email)) {
    return res.status(400).json({ success: false, message: "Please enter a valid email address" });
  }
  if (nextPassword && nextPassword.length < 6) {
    return res.status(400).json({ success: false, message: "Password must be at least 6 characters" });
  }
  if (statusProvided && (requestedStatus === "__invalid__" || requestedStatus === "deleted")) {
    return res.status(400).json({ success: false, message: "Invalid account status for update" });
  }
  if (adminPinRaw && !adminPin) {
    return res.status(400).json({ success: false, message: "Admin PIN must be exactly 4 digits" });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [rows] = await connection.query(
      "SELECT id, full_name, email, username, role, admin_pin_hash, account_status, deleted_at FROM users WHERE id = ? LIMIT 1",
      [userId]
    );
    if (!rows.length) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: "User not found" });
    }
    const existing = rows[0];

    const [emailRows] = await connection.query(
      "SELECT id FROM users WHERE email = ? AND id <> ? AND deleted_at IS NULL LIMIT 1",
      [email, userId]
    );
    if (emailRows.length > 0) {
      await connection.rollback();
      return res.status(409).json({ success: false, message: "This email is already used by another account" });
    }

    let username = requestedUsername || normalizeUsernameValue(existing.username);
    if (!username) {
      username = `@${toUsernameSeed(name)}${userId}`;
    }

    const [usernameRows] = await connection.query(
      "SELECT id FROM users WHERE username = ? AND id <> ? LIMIT 1",
      [username, userId]
    );
    if (usernameRows.length > 0) {
      await connection.rollback();
      return res.status(409).json({ success: false, message: "This username is already taken" });
    }

    const currentStatus = rows[0].deleted_at
      ? "deleted"
      : normalizeUserAccountStatus(rows[0].account_status, "active");
    const accountStatus = statusProvided ? requestedStatus : currentStatus;
    if (Number(req.auth?.userId || 0) === userId && accountStatus !== "active") {
      await connection.rollback();
      return res.status(400).json({ success: false, message: "You cannot change your own account to inactive/blocked" });
    }
    if (isProtectedAdminIdentity(existing)) {
      const existingEmail = String(existing.email || "").trim().toLowerCase();
      const existingRole = String(existing.role || "Admin").trim();
      if (email !== existingEmail || role !== existingRole || accountStatus !== "active" || Boolean(nextPassword)) {
        await connection.rollback();
        return res.status(403).json({
          success: false,
          message: "Super Admin account identity, role, password and status are protected"
        });
      }
    }
    const deletedAt = accountStatus === "deleted" ? (rows[0].deleted_at || new Date()) : null;
    const existingWasAdmin = hasAdminRole(existing.role);
    const nextIsAdmin = hasAdminRole(role);
    const pinRequiredForAdmin = nextIsAdmin && (!existingWasAdmin || !existing.admin_pin_hash);
    if ((nextIsAdmin || existingWasAdmin || adminPinRaw) && !isSuperAdminIdentity(req.auth)) {
      await connection.rollback();
      return res.status(403).json({ success: false, message: "Only Super Admin can manage admin role or admin PIN" });
    }
    if (pinRequiredForAdmin && !adminPin) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: "4 digit admin PIN is required when promoting a user to Admin" });
    }
    if (!nextIsAdmin && adminPinRaw) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: "Admin PIN can be set only for Admin role" });
    }

    const adminPinHash = nextIsAdmin && adminPin ? await bcrypt.hash(adminPin, 12) : null;
    const adminPinUpdatedAt = adminPinHash ? new Date() : null;

    if (nextPassword) {
      const passwordHash = await bcrypt.hash(nextPassword, 12);
      await connection.query(
        `UPDATE users
         SET full_name = ?, email = ?, role = ?, username = ?, account_status = ?, deleted_at = ?,
             password_hash = ?,
             admin_pin_hash = CASE WHEN ? = 1 THEN ? WHEN ? = 1 THEN NULL ELSE admin_pin_hash END,
             admin_pin_updated_at = CASE WHEN ? = 1 THEN ? WHEN ? = 1 THEN NULL ELSE admin_pin_updated_at END,
             admin_pin_failed_attempts = CASE WHEN ? = 1 OR ? = 1 THEN 0 ELSE admin_pin_failed_attempts END,
             admin_pin_locked_until = CASE WHEN ? = 1 OR ? = 1 THEN NULL ELSE admin_pin_locked_until END
         WHERE id = ? LIMIT 1`,
        [
          name, email, role, username, accountStatus, deletedAt, passwordHash,
          adminPinHash ? 1 : 0, adminPinHash, nextIsAdmin ? 0 : 1,
          adminPinHash ? 1 : 0, adminPinUpdatedAt, nextIsAdmin ? 0 : 1,
          adminPinHash ? 1 : 0, nextIsAdmin ? 0 : 1,
          adminPinHash ? 1 : 0, nextIsAdmin ? 0 : 1,
          userId
        ]
      );
    } else {
      await connection.query(
        `UPDATE users
         SET full_name = ?, email = ?, role = ?, username = ?, account_status = ?, deleted_at = ?,
             admin_pin_hash = CASE WHEN ? = 1 THEN ? WHEN ? = 1 THEN NULL ELSE admin_pin_hash END,
             admin_pin_updated_at = CASE WHEN ? = 1 THEN ? WHEN ? = 1 THEN NULL ELSE admin_pin_updated_at END,
             admin_pin_failed_attempts = CASE WHEN ? = 1 OR ? = 1 THEN 0 ELSE admin_pin_failed_attempts END,
             admin_pin_locked_until = CASE WHEN ? = 1 OR ? = 1 THEN NULL ELSE admin_pin_locked_until END
         WHERE id = ? LIMIT 1`,
        [
          name, email, role, username, accountStatus, deletedAt,
          adminPinHash ? 1 : 0, adminPinHash, nextIsAdmin ? 0 : 1,
          adminPinHash ? 1 : 0, adminPinUpdatedAt, nextIsAdmin ? 0 : 1,
          adminPinHash ? 1 : 0, nextIsAdmin ? 0 : 1,
          adminPinHash ? 1 : 0, nextIsAdmin ? 0 : 1,
          userId
        ]
      );
    }

    await ensureUserProfileRows(connection, { id: userId, name, username });
    await connection.commit();

    await createAuditLog(
      "update",
      "user",
      `Updated user "${existing.full_name}" -> "${name}"`,
      userId,
      { email, role, accountStatus, passwordUpdated: Boolean(nextPassword), adminPinUpdated: Boolean(adminPinHash) }
    );

    const updated = await getAdminUserById(userId);
    return res.status(200).json({
      success: true,
      message: "User updated successfully",
      data: updated
    });
  } catch (error) {
    await connection.rollback();
    if (error?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ success: false, message: "Email or username already exists" });
    }
    console.error("Admin user PUT error:", error);
    return res.status(500).json({ success: false, message: "Server error while updating user" });
  } finally {
    connection.release();
  }
});

router.delete("/admin/users/:id", async (req, res) => {
  const userId = parsePositiveInt(req.params.id);
  if (!userId) {
    return res.status(400).json({ success: false, message: "Invalid user id" });
  }
  if (Number(req.auth?.userId || 0) === userId) {
    return res.status(400).json({ success: false, message: "You cannot delete your own admin account" });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [rows] = await connection.query(
      `SELECT id, full_name, email, username, role, account_status, deleted_at,
              deleted_original_email, deleted_original_username
       FROM users
       WHERE id = ?
       LIMIT 1`,
      [userId]
    );
    if (!rows.length) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const user = rows[0];
    if (isProtectedAdminIdentity(user)) {
      await connection.rollback();
      return res.status(403).json({
        success: false,
        message: "Super Admin account cannot be deleted"
      });
    }
    if (hasAdminRole(user.role) && !isSuperAdminIdentity(req.auth)) {
      await connection.rollback();
      return res.status(403).json({
        success: false,
        message: "Only Super Admin can delete admin users"
      });
    }

    const currentStatus = user.deleted_at
      ? "deleted"
      : normalizeUserAccountStatus(user.account_status, "active");

    if (currentStatus === "deleted") {
      await connection.rollback();
      return res.status(200).json({
        success: true,
        message: "User is already deleted"
      });
    }

    const deletedIdentity = createDeletedUserIdentity(user);
    await connection.query(
      `UPDATE users
       SET account_status = 'deleted',
           deleted_at = NOW(),
           deleted_original_email = COALESCE(deleted_original_email, ?),
           deleted_original_username = COALESCE(deleted_original_username, ?),
           email = ?,
           username = ?
       WHERE id = ?
       LIMIT 1`,
      [
        deletedIdentity.originalEmail,
        deletedIdentity.originalUsername,
        deletedIdentity.email,
        deletedIdentity.username,
        userId
      ]
    );

    await connection.commit();
    await createAuditLog(
      "delete",
      "user",
      `Soft deleted user "${user.full_name}" (${user.email})`,
      userId,
      { originalEmail: user.email, deletedEmail: deletedIdentity.email }
    );

    return res.status(200).json({
      success: true,
      message: "User moved to deleted state"
    });
  } catch (error) {
    await connection.rollback();
    console.error("Admin user DELETE error:", error);
    return res.status(500).json({ success: false, message: "Server error while deleting user" });
  } finally {
    connection.release();
  }
});

// ─────────────────────────────────────────────────────────
// Places
// ─────────────────────────────────────────────────────────
router.post("/admin/users/:id/restore", async (req, res) => {
  const userId = parsePositiveInt(req.params.id);
  if (!userId) {
    return res.status(400).json({ success: false, message: "Invalid user id" });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT id, full_name, email, username, account_status, deleted_at,
              deleted_original_email, deleted_original_username
       FROM users
       WHERE id = ?
       LIMIT 1
       FOR UPDATE`,
      [userId]
    );
    if (!rows.length) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const user = rows[0];
    let nextEmail = user.email;
    let nextUsername = user.username;
    const originalEmail = String(user.deleted_original_email || "").trim().toLowerCase();
    const originalUsername = String(user.deleted_original_username || "").trim();

    if (originalEmail) {
      const [emailRows] = await connection.query(
        "SELECT id FROM users WHERE email = ? AND id <> ? LIMIT 1",
        [originalEmail, userId]
      );
      if (emailRows.length > 0) {
        await connection.rollback();
        return res.status(409).json({
          success: false,
          message: "Cannot restore this user because the original email is now used by another account"
        });
      }
      nextEmail = originalEmail;
    }

    if (originalUsername) {
      const [usernameRows] = await connection.query(
        "SELECT id FROM users WHERE username = ? AND id <> ? LIMIT 1",
        [originalUsername, userId]
      );
      if (usernameRows.length === 0) {
        nextUsername = originalUsername;
      }
    }

    await connection.query(
      `UPDATE users
       SET account_status = 'active',
           deleted_at = NULL,
           deleted_original_email = NULL,
           deleted_original_username = NULL,
           email = ?,
           username = ?
       WHERE id = ?
       LIMIT 1`,
      [nextEmail, nextUsername, userId]
    );
    await connection.commit();

    await createAuditLog(
      "restore",
      "user",
      `Restored user "${user.full_name}" (${nextEmail})`,
      userId
    );

    const updated = await getAdminUserById(userId);
    return res.status(200).json({
      success: true,
      message: "User restored successfully",
      data: updated
    });
  } catch (error) {
    await connection.rollback();
    console.error("Admin user RESTORE error:", error);
    return res.status(500).json({ success: false, message: "Server error while restoring user" });
  } finally {
    connection.release();
  }
});

router.patch("/admin/users/:id/status", async (req, res) => {
  const userId = parsePositiveInt(req.params.id);
  if (!userId) {
    return res.status(400).json({ success: false, message: "Invalid user id" });
  }

  const status = normalizeUserAccountStatus(req.body?.status, "__invalid__");
  if (!["active", "inactive", "blocked"].includes(status)) {
    return res.status(400).json({
      success: false,
      message: "status must be one of: active, inactive, blocked"
    });
  }
  if (Number(req.auth?.userId || 0) === userId && status !== "active") {
    return res.status(400).json({ success: false, message: "You cannot block/inactivate your own account" });
  }

  try {
    const [rows] = await pool.query(
      "SELECT id, full_name, email, role FROM users WHERE id = ? LIMIT 1",
      [userId]
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    if (isProtectedAdminIdentity(rows[0]) && status !== "active") {
      return res.status(403).json({
        success: false,
        message: "Super Admin account cannot be blocked or inactivated"
      });
    }
    if (hasAdminRole(rows[0].role) && !isSuperAdminIdentity(req.auth)) {
      return res.status(403).json({
        success: false,
        message: "Only Super Admin can change admin user status"
      });
    }

    await pool.query(
      "UPDATE users SET account_status = ?, deleted_at = NULL WHERE id = ? LIMIT 1",
      [status, userId]
    );

    await createAuditLog(
      "status",
      "user",
      `Set user "${rows[0].full_name}" status to ${status}`,
      userId,
      { status }
    );

    const updated = await getAdminUserById(userId);
    return res.status(200).json({
      success: true,
      message: `User status updated to ${status}`,
      data: updated
    });
  } catch (error) {
    console.error("Admin user status PATCH error:", error);
    return res.status(500).json({ success: false, message: "Server error while updating user status" });
  }
});

router.post("/admin/users/:id/reset-password", requireSuperAdmin, async (req, res) => {
  const userId = parsePositiveInt(req.params.id);
  if (!userId) {
    return res.status(400).json({ success: false, message: "Invalid user id" });
  }

  const newPassword = String(req.body?.newPassword || "");
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ success: false, message: "New password must be at least 6 characters" });
  }

  try {
    const [rows] = await pool.query(
      "SELECT id, full_name, email FROM users WHERE id = ? LIMIT 1",
      [userId]
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await pool.query("UPDATE users SET password_hash = ? WHERE id = ? LIMIT 1", [passwordHash, userId]);

    await createAuditLog(
      "reset_password",
      "user",
      `Admin reset password for "${rows[0].full_name}"`,
      userId
    );

    return res.status(200).json({
      success: true,
      message: "User password reset successfully"
    });
  } catch (error) {
    console.error("Admin user reset password error:", error);
    return res.status(500).json({ success: false, message: "Server error while resetting password" });
  }
});

router.get("/admin/me", async (req, res) => {
  try {
    const adminId = Number(req.auth?.userId || 0);
    if (!Number.isFinite(adminId) || adminId <= 0) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const [rows] = await pool.query(
      `
      SELECT id, full_name, email, phone, role, created_at, updated_at
      FROM users
      WHERE id = ?
      LIMIT 1
      `,
      [adminId]
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, message: "Admin user not found" });
    }

    const row = rows[0];
    return res.status(200).json({
      success: true,
      data: {
        id: Number(row.id),
        uid: `user_${row.id}`,
        name: row.full_name || "",
        email: row.email || "",
        phone: row.phone || "",
        role: row.role || "Admin",
        isSuperAdmin: isSuperAdminIdentity(row),
        createdAt: toIso(row.created_at),
        updatedAt: toIso(row.updated_at)
      }
    });
  } catch (error) {
    console.error("Admin profile GET error:", error);
    return res.status(500).json({ success: false, message: "Server error while fetching admin profile" });
  }
});

router.put("/admin/me", async (req, res) => {
  try {
    const adminId = Number(req.auth?.userId || 0);
    if (!Number.isFinite(adminId) || adminId <= 0) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const name = clampText(req.body?.name, 120);
    const email = clampText(req.body?.email, 190).toLowerCase();
    const phone = normalizePhone(req.body?.phone);

    if (!name) {
      return res.status(400).json({ success: false, message: "Please enter full name" });
    }
    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ success: false, message: "Please enter a valid email address" });
    }

    const [dupeRows] = await pool.query(
      "SELECT id FROM users WHERE email = ? AND id <> ? AND deleted_at IS NULL LIMIT 1",
      [email, adminId]
    );
    if (dupeRows.length) {
      return res.status(409).json({ success: false, message: "This email is already used by another account" });
    }

    await pool.query(
      "UPDATE users SET full_name = ?, email = ?, phone = ? WHERE id = ? LIMIT 1",
      [name, email, phone || null, adminId]
    );

    await createAuditLog(
      "update",
      "admin_profile",
      `Updated admin profile "${name}"`,
      adminId,
      { email, phone }
    );

    const [rows] = await pool.query(
      "SELECT id, full_name, email, phone, role, created_at, updated_at FROM users WHERE id = ? LIMIT 1",
      [adminId]
    );
    const row = rows[0];
    return res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      data: {
        id: Number(row.id),
        uid: `user_${row.id}`,
        name: row.full_name || "",
        email: row.email || "",
        phone: row.phone || "",
        role: row.role || "Admin",
        isSuperAdmin: isSuperAdminIdentity(row),
        createdAt: toIso(row.created_at),
        updatedAt: toIso(row.updated_at)
      }
    });
  } catch (error) {
    console.error("Admin profile PUT error:", error);
    return res.status(500).json({ success: false, message: "Server error while updating admin profile" });
  }
});

router.put("/admin/me/password", async (req, res) => {
  try {
    const adminId = Number(req.auth?.userId || 0);
    if (!Number.isFinite(adminId) || adminId <= 0) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const currentPassword = String(req.body?.currentPassword || "");
    const newPassword = String(req.body?.newPassword || "");

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: "Current and new password are required" });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: "New password must be at least 6 characters" });
    }

    const [rows] = await pool.query(
      "SELECT id, full_name, password_hash FROM users WHERE id = ? LIMIT 1",
      [adminId]
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, message: "Admin user not found" });
    }

    const admin = rows[0];
    const matches = await bcrypt.compare(currentPassword, admin.password_hash);
    if (!matches) {
      return res.status(401).json({ success: false, message: "Current password is incorrect" });
    }
    if (currentPassword === newPassword) {
      return res.status(400).json({ success: false, message: "New password must be different from current password" });
    }

    const newHash = await bcrypt.hash(newPassword, 12);
    await pool.query("UPDATE users SET password_hash = ? WHERE id = ? LIMIT 1", [newHash, adminId]);

    await createAuditLog(
      "update_password",
      "admin_profile",
      `Updated admin password for "${admin.full_name || `user_${adminId}`}"`,
      adminId
    );

    return res.status(200).json({
      success: true,
      message: "Password updated successfully"
    });
  } catch (error) {
    console.error("Admin password PUT error:", error);
    return res.status(500).json({ success: false, message: "Server error while updating password" });
  }
});

router.get("/admin/memories", async (req, res) => {
  try {
    const statusRaw = clampText(req.query.status, 24).toLowerCase();
    const statusFilter = statusRaw === "all" || !statusRaw
      ? "all"
      : normalizeMemoryStatus(statusRaw, "all");
    const search = clampText(req.query.search, 120).toLowerCase();
    const limit = Math.min(500, Math.max(1, Math.trunc(Number(req.query.limit) || 200)));
    const offset = Math.max(0, Math.trunc(Number(req.query.offset) || 0));

    const all = await getAllPublicMemories();
    const filtered = all
      .filter((memory) => (statusFilter === "all" ? true : memory.status === statusFilter))
      .filter((memory) => {
        if (!search) return true;
        return (
          String(memory.user || "").toLowerCase().includes(search) ||
          String(memory.userEmail || "").toLowerCase().includes(search) ||
          String(memory.place || "").toLowerCase().includes(search) ||
          String(memory.caption || "").toLowerCase().includes(search)
        );
      });

    return res.status(200).json({
      success: true,
      data: filtered.slice(offset, offset + limit),
      pagination: {
        total: filtered.length,
        limit,
        offset
      }
    });
  } catch (error) {
    console.error("Admin memories GET error:", error);
    return res.status(500).json({ success: false, message: "Server error while fetching memories" });
  }
});

router.put("/admin/memories/:id/status", async (req, res) => {
  try {
    const decoded = decodeAdminMemoryId(req.params.id);
    if (!decoded) {
      return res.status(400).json({ success: false, message: "Invalid memory id" });
    }

    const requestedStatus = String(req.body?.status || "").trim().toLowerCase();
    if (!MEMORY_STATUSES.has(requestedStatus)) {
      return res.status(400).json({
        success: false,
        message: "status must be one of: pending, approved, rejected"
      });
    }

    const [profileRows] = await pool.query(
      "SELECT memories_json FROM profile_states WHERE uid = ? LIMIT 1",
      [decoded.uid]
    );
    if (!profileRows.length) {
      return res.status(404).json({ success: false, message: "Memory owner not found" });
    }

    const memories = safeJsonParse(profileRows[0].memories_json, []);
    if (!Array.isArray(memories)) {
      return res.status(404).json({ success: false, message: "Memory not found" });
    }
    const found = memories.find((m) => clampText(m?.id, 120) === decoded.memoryId);
    if (!found || clampText(found?.privacy, 12).toLowerCase() !== "public") {
      return res.status(404).json({ success: false, message: "Memory not found" });
    }

    const [existingRows] = await pool.query(
      "SELECT reports FROM memory_moderation WHERE uid = ? AND memory_id = ? LIMIT 1",
      [decoded.uid, decoded.memoryId]
    );
    const providedReports = req.body?.reports;
    const baseReports = existingRows[0]?.reports ?? found?.reports;
    const reports = providedReports == null
      ? Math.max(0, Math.trunc(Number(baseReports) || 0))
      : Math.max(0, Math.trunc(Number(providedReports) || 0));

    await pool.query(
      `
      INSERT INTO memory_moderation (uid, memory_id, status, reports, moderated_by, moderated_at)
      VALUES (?, ?, ?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE
        status = VALUES(status),
        reports = VALUES(reports),
        moderated_by = VALUES(moderated_by),
        moderated_at = NOW()
      `,
      [decoded.uid, decoded.memoryId, requestedStatus, reports, req.auth?.userId || null]
    );

    await createAuditLog(
      "moderate",
      "memory",
      `Marked memory "${decoded.memoryId}" as ${requestedStatus}`,
      null,
      {
        uid: decoded.uid,
        memoryId: decoded.memoryId,
        status: requestedStatus,
        reports
      }
    );

    const all = await getAllPublicMemories();
    const updated = all.find((m) => m.id === req.params.id) || null;
    return res.status(200).json({
      success: true,
      message: `Memory marked as ${requestedStatus}`,
      data: updated
    });
  } catch (error) {
    console.error("Admin memory status PUT error:", error);
    return res.status(500).json({ success: false, message: "Server error while updating memory status" });
  }
});

router.post("/admin/memories/bulk", async (req, res) => {
  try {
    const action = normalizeMemoryBulkAction(req.body?.action);
    if (!action) {
      return res.status(400).json({
        success: false,
        message: "action must be one of: approve, reject, pending, delete"
      });
    }

    const ids = normalizeMemoryBulkIds(req.body?.ids, 300);
    if (ids.length === 0) {
      return res.status(400).json({ success: false, message: "ids must contain at least one memory id" });
    }

    const summary = {
      requested: ids.length,
      processed: 0,
      updatedCount: 0,
      deletedCount: 0,
      failedCount: 0,
      failed: []
    };
    const actorUserId = req.auth?.userId || null;
    const providedReports = req.body?.reports;
    const requestedReports = providedReports == null ? null : Math.max(0, Math.trunc(Number(providedReports) || 0));

    for (const encodedId of ids) {
      const decoded = decodeAdminMemoryId(encodedId);
      if (!decoded) {
        summary.failedCount += 1;
        if (summary.failed.length < 25) {
          summary.failed.push({ id: encodedId, message: "Invalid memory id" });
        }
        continue;
      }

      try {
        if (action.kind === "delete") {
          const connection = await pool.getConnection();
          try {
            await connection.beginTransaction();
            const [rows] = await connection.query(
              "SELECT memories_json FROM profile_states WHERE uid = ? LIMIT 1",
              [decoded.uid]
            );
            if (!rows.length) {
              throw new Error("Memory owner not found");
            }

            const memories = safeJsonParse(rows[0].memories_json, []);
            if (!Array.isArray(memories)) {
              throw new Error("Memory not found");
            }
            const target = memories.find((m) => clampText(m?.id, 120) === decoded.memoryId);
            if (!target) {
              throw new Error("Memory not found");
            }

            const next = memories.filter((m) => clampText(m?.id, 120) !== decoded.memoryId);
            await connection.query(
              "UPDATE profile_states SET memories_json = ? WHERE uid = ?",
              [safeJsonStringify(next), decoded.uid]
            );
            await connection.query(
              "DELETE FROM memory_moderation WHERE uid = ? AND memory_id = ?",
              [decoded.uid, decoded.memoryId]
            );
            await connection.commit();
          } catch (error) {
            await connection.rollback();
            throw error;
          } finally {
            connection.release();
          }

          summary.deletedCount += 1;
          summary.processed += 1;
          continue;
        }

        const [profileRows] = await pool.query(
          "SELECT memories_json FROM profile_states WHERE uid = ? LIMIT 1",
          [decoded.uid]
        );
        if (!profileRows.length) {
          throw new Error("Memory owner not found");
        }

        const memories = safeJsonParse(profileRows[0].memories_json, []);
        if (!Array.isArray(memories)) {
          throw new Error("Memory not found");
        }

        const found = memories.find((m) => clampText(m?.id, 120) === decoded.memoryId);
        if (!found || clampText(found?.privacy, 12).toLowerCase() !== "public") {
          throw new Error("Memory not found");
        }

        const [existingRows] = await pool.query(
          "SELECT reports FROM memory_moderation WHERE uid = ? AND memory_id = ? LIMIT 1",
          [decoded.uid, decoded.memoryId]
        );
        const baseReports = existingRows[0]?.reports ?? found?.reports;
        const reports = requestedReports == null
          ? Math.max(0, Math.trunc(Number(baseReports) || 0))
          : requestedReports;

        await pool.query(
          `
          INSERT INTO memory_moderation (uid, memory_id, status, reports, moderated_by, moderated_at)
          VALUES (?, ?, ?, ?, ?, NOW())
          ON DUPLICATE KEY UPDATE
            status = VALUES(status),
            reports = VALUES(reports),
            moderated_by = VALUES(moderated_by),
            moderated_at = NOW()
          `,
          [decoded.uid, decoded.memoryId, action.status, reports, actorUserId]
        );

        summary.updatedCount += 1;
        summary.processed += 1;
      } catch (error) {
        summary.failedCount += 1;
        if (summary.failed.length < 25) {
          summary.failed.push({
            id: encodedId,
            message: clampText(error?.message || "Operation failed", 180)
          });
        }
      }
    }

    await createAuditLog(
      action.kind === "delete" ? "bulk_delete" : "bulk_moderate",
      "memory",
      action.kind === "delete"
        ? `Bulk deleted ${summary.deletedCount}/${summary.requested} memories`
        : `Bulk updated ${summary.updatedCount}/${summary.requested} memories to ${action.status}`,
      null,
      {
        action: action.kind === "delete" ? "delete" : action.status,
        requested: summary.requested,
        processed: summary.processed,
        updatedCount: summary.updatedCount,
        deletedCount: summary.deletedCount,
        failedCount: summary.failedCount,
        sampleFailed: summary.failed.slice(0, 5)
      }
    );

    return res.status(200).json({
      success: true,
      message: summary.failedCount > 0
        ? `Bulk action finished with ${summary.failedCount} failure(s)`
        : "Bulk action completed successfully",
      data: summary
    });
  } catch (error) {
    console.error("Admin memory bulk POST error:", error);
    return res.status(500).json({ success: false, message: "Server error while processing bulk memory action" });
  }
});

router.delete("/admin/memories/:id", async (req, res) => {
  const decoded = decodeAdminMemoryId(req.params.id);
  if (!decoded) {
    return res.status(400).json({ success: false, message: "Invalid memory id" });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [rows] = await connection.query(
      "SELECT memories_json FROM profile_states WHERE uid = ? LIMIT 1",
      [decoded.uid]
    );
    if (!rows.length) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: "Memory owner not found" });
    }

    const memories = safeJsonParse(rows[0].memories_json, []);
    if (!Array.isArray(memories)) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: "Memory not found" });
    }

    const target = memories.find((m) => clampText(m?.id, 120) === decoded.memoryId);
    if (!target) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: "Memory not found" });
    }

    const next = memories.filter((m) => clampText(m?.id, 120) !== decoded.memoryId);
    await connection.query(
      "UPDATE profile_states SET memories_json = ? WHERE uid = ?",
      [safeJsonStringify(next), decoded.uid]
    );
    await connection.query(
      "DELETE FROM memory_moderation WHERE uid = ? AND memory_id = ?",
      [decoded.uid, decoded.memoryId]
    );

    await connection.commit();
    await createAuditLog(
      "delete",
      "memory",
      `Deleted memory "${decoded.memoryId}"`,
      null,
      { uid: decoded.uid, memoryId: decoded.memoryId }
    );

    return res.status(200).json({
      success: true,
      message: "Memory deleted successfully"
    });
  } catch (error) {
    await connection.rollback();
    console.error("Admin memory DELETE error:", error);
    return res.status(500).json({ success: false, message: "Server error while deleting memory" });
  } finally {
    connection.release();
  }
});

router.post("/admin/places/publish-due", async (req, res) => {
  try {
    const result = await runPublishDueOnce({ source: "manual", writeAudit: true });
    const affected = Number(result?.affectedRows || 0);
    return res.status(200).json({
      success: true,
      source: "manual",
      message: affected > 0 ? `${affected} place(s) published` : "No scheduled places are due",
      affectedRows: affected
    });
  } catch (error) {
    console.error("Publish due places error:", error);
    return res.status(500).json({ success: false, message: "Server error while publishing due places" });
  }
});

router.get("/admin/places", async (req, res) => {
  try {
    const search = clampText(req.query.search, 120).toLowerCase();
    const status = clampText(req.query.status, 24).toLowerCase();
    const city = clampText(req.query.city, 120);
    const featured = clampText(req.query.featured, 30).toLowerCase();
    const coordinates = clampText(req.query.coordinates || req.query.coords, 30).toLowerCase();
    const includeDeleted = toBoolean(req.query.includeDeleted, false);
    const limit = Math.min(500, Math.max(1, Math.trunc(Number(req.query.limit) || 200)));
    const offset = Math.max(0, Math.trunc(Number(req.query.offset) || 0));

    const where = [];
    const params = [];
    if (!includeDeleted) {
      where.push("is_deleted = 0");
    }
    if (status && status !== "all" && PLACE_STATUSES.has(status)) {
      where.push("status = ?");
      params.push(status);
    }
    if (city && city.toLowerCase() !== "all") {
      where.push("LOWER(city) = LOWER(?)");
      params.push(city);
    }
    if (featured === "featured") {
      where.push("featured = 1");
    } else if (featured === "regular") {
      where.push("featured = 0");
    }
    if (coordinates === "ready" || coordinates === "with") {
      where.push("latitude IS NOT NULL AND longitude IS NOT NULL");
    } else if (coordinates === "missing") {
      where.push("(latitude IS NULL OR longitude IS NULL)");
    }
    if (search) {
      where.push("(LOWER(name) LIKE ? OR LOWER(city) LIKE ? OR LOWER(area) LIKE ? OR LOWER(category) LIKE ? OR LOWER(COALESCE(secondary_category, '')) LIKE ? OR LOWER(slug) LIKE ?)");
      const q = `%${search}%`;
      params.push(q, q, q, q, q, q);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const [rows] = await pool.query(
      `
      SELECT *
      FROM places
      ${whereSql}
      ORDER BY priority DESC, updated_at DESC, id DESC
      LIMIT ? OFFSET ?
      `,
      [...params, limit, offset]
    );

    const [countRows] = await pool.query(`SELECT COUNT(*) AS c FROM places ${whereSql}`, params);

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
    console.error("Places GET error:", error);
    return res.status(500).json({ success: false, message: "Server error while fetching places" });
  }
});

router.get("/admin/places/:id", async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      return res.status(400).json({ success: false, message: "Invalid place id" });
    }
    const row = await getPlaceById(id);
    if (!row) {
      return res.status(404).json({ success: false, message: "Place not found" });
    }
    return res.status(200).json({ success: true, data: mapPlaceRow(row) });
  } catch (error) {
    console.error("Place GET by id error:", error);
    return res.status(500).json({ success: false, message: "Server error while fetching place" });
  }
});

router.post("/admin/places", async (req, res) => {
  try {
    const normalized = normalizePlaceInput(req.body);
    if (normalized.error) {
      return res.status(400).json({ success: false, message: normalized.error });
    }
    const place = normalized.value;

    const [result] = await pool.query(
      `
      INSERT INTO places (
        name, city, area, latitude, longitude, entry_fee, category, secondary_category, best_time, time_required,
        image_url, description, status, featured, priority,
        scheduled_at, slug, meta_title, meta_description, cover_alt, gallery_json, analytics_json,
        is_deleted, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        place.name,
        place.city,
        place.area || null,
        place.latitude,
        place.longitude,
        place.entryFee || null,
        place.category,
        place.secondaryCategory || null,
        place.bestTime || null,
        place.timeRequired || null,
        place.image || null,
        place.desc || null,
        place.status,
        place.featured ? 1 : 0,
        place.priority,
        place.scheduledAt,
        place.slug,
        place.metaTitle || null,
        place.metaDescription || null,
        place.coverAlt || null,
        safeJsonStringify(place.gallery),
        safeJsonStringify(place.analytics, "{}"),
        place.isDeleted ? 1 : 0,
        place.deletedAt
      ]
    );

    const created = await getPlaceById(result.insertId);
    await createAuditLog("create", "place", `Created place "${place.name}"`, result.insertId, {
      city: place.city,
      category: place.category
    });

    return res.status(201).json({
      success: true,
      message: "Place created successfully",
      data: created ? mapPlaceRow(created) : null
    });
  } catch (error) {
    if (error?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        success: false,
        message: "Place slug already exists. Please use a different slug."
      });
    }
    console.error("Place POST error:", error);
    return res.status(500).json({ success: false, message: "Server error while creating place" });
  }
});

router.put("/admin/places/:id", async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      return res.status(400).json({ success: false, message: "Invalid place id" });
    }
    const existing = await getPlaceById(id);
    if (!existing) {
      return res.status(404).json({ success: false, message: "Place not found" });
    }

    const normalized = normalizePlaceInput(req.body, existing);
    if (normalized.error) {
      return res.status(400).json({ success: false, message: normalized.error });
    }
    const place = normalized.value;

    await pool.query(
      `
      UPDATE places
      SET
        name = ?,
        city = ?,
        area = ?,
        latitude = ?,
        longitude = ?,
        entry_fee = ?,
        category = ?,
        secondary_category = ?,
        best_time = ?,
        time_required = ?,
        image_url = ?,
        description = ?,
        status = ?,
        featured = ?,
        priority = ?,
        scheduled_at = ?,
        slug = ?,
        meta_title = ?,
        meta_description = ?,
        cover_alt = ?,
        gallery_json = ?,
        analytics_json = ?,
        is_deleted = ?,
        deleted_at = ?
      WHERE id = ?
      `,
      [
        place.name,
        place.city,
        place.area || null,
        place.latitude,
        place.longitude,
        place.entryFee || null,
        place.category,
        place.secondaryCategory || null,
        place.bestTime || null,
        place.timeRequired || null,
        place.image || null,
        place.desc || null,
        place.status,
        place.featured ? 1 : 0,
        place.priority,
        place.scheduledAt,
        place.slug,
        place.metaTitle || null,
        place.metaDescription || null,
        place.coverAlt || null,
        safeJsonStringify(place.gallery),
        safeJsonStringify(place.analytics, "{}"),
        place.isDeleted ? 1 : 0,
        place.deletedAt,
        id
      ]
    );

    const updated = await getPlaceById(id);
    await createAuditLog("update", "place", `Updated place "${place.name}"`, id, {
      status: place.status,
      featured: place.featured
    });

    return res.status(200).json({
      success: true,
      message: "Place updated successfully",
      data: updated ? mapPlaceRow(updated) : null
    });
  } catch (error) {
    if (error?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        success: false,
        message: "Place slug already exists. Please use a different slug."
      });
    }
    console.error("Place PUT error:", error);
    return res.status(500).json({ success: false, message: "Server error while updating place" });
  }
});

router.delete("/admin/places/:id", async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      return res.status(400).json({ success: false, message: "Invalid place id" });
    }

    const existing = await getPlaceById(id);
    if (!existing) {
      return res.status(404).json({ success: false, message: "Place not found" });
    }

    await pool.query(
      "UPDATE places SET is_deleted = 1, deleted_at = COALESCE(deleted_at, NOW()) WHERE id = ?",
      [id]
    );
    await createAuditLog("trash", "place", `Moved place "${existing.name}" to trash`, id);

    return res.status(200).json({
      success: true,
      message: "Place moved to trash"
    });
  } catch (error) {
    console.error("Place DELETE error:", error);
    return res.status(500).json({ success: false, message: "Server error while deleting place" });
  }
});

router.post("/admin/places/:id/restore", async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      return res.status(400).json({ success: false, message: "Invalid place id" });
    }

    const existing = await getPlaceById(id);
    if (!existing) {
      return res.status(404).json({ success: false, message: "Place not found" });
    }

    await pool.query("UPDATE places SET is_deleted = 0, deleted_at = NULL WHERE id = ?", [id]);
    await createAuditLog("restore", "place", `Restored place "${existing.name}" from trash`, id);

    return res.status(200).json({
      success: true,
      message: "Place restored successfully"
    });
  } catch (error) {
    console.error("Place restore error:", error);
    return res.status(500).json({ success: false, message: "Server error while restoring place" });
  }
});

router.delete("/admin/places/:id/permanent", async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      return res.status(400).json({ success: false, message: "Invalid place id" });
    }
    const existing = await getPlaceById(id);
    if (!existing) {
      return res.status(404).json({ success: false, message: "Place not found" });
    }

    await pool.query("DELETE FROM places WHERE id = ?", [id]);
    await createAuditLog("delete_permanent", "place", `Permanently deleted place "${existing.name}"`, id);

    return res.status(200).json({
      success: true,
      message: "Place permanently deleted"
    });
  } catch (error) {
    console.error("Place permanent DELETE error:", error);
    return res.status(500).json({ success: false, message: "Server error while permanently deleting place" });
  }
});

// ─────────────────────────────────────────────────────────
// Services
// ─────────────────────────────────────────────────────────
router.get("/admin/services", async (req, res) => {
  try {
    const search = clampText(req.query.search, 120).toLowerCase();
    const status = clampText(req.query.status, 24).toLowerCase();
    const city = clampText(req.query.city, 120);
    const category = clampText(req.query.category, 80);
    const limit = Math.min(500, Math.max(1, Math.trunc(Number(req.query.limit) || 200)));
    const offset = Math.max(0, Math.trunc(Number(req.query.offset) || 0));

    const where = [];
    const params = [];
    if (status && status !== "all" && SERVICE_STATUSES.has(status)) {
      where.push("cs.status = ?");
      params.push(status);
    }
    if (city && city.toLowerCase() !== "all") {
      where.push("LOWER(cs.city) = LOWER(?)");
      params.push(city);
    }
    if (category && category.toLowerCase() !== "all" && SERVICE_CATEGORIES.has(category)) {
      where.push("cs.category = ?");
      params.push(category);
    }
    if (search) {
      where.push("(LOWER(cs.name) LIKE ? OR LOWER(cs.city) LIKE ? OR LOWER(cs.area) LIKE ? OR LOWER(cs.category) LIKE ? OR LOWER(cs.description) LIKE ? OR LOWER(cs.link) LIKE ?)");
      const q = `%${search}%`;
      params.push(q, q, q, q, q, q);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const [rows] = await pool.query(
      `
      ${serviceSelectSql()}
      ${whereSql}
      ORDER BY CASE WHEN cs.status = 'active' THEN 0 ELSE 1 END, COALESCE(sr.report_count, 0) DESC, cs.updated_at DESC, cs.id DESC
      LIMIT ? OFFSET ?
      `,
      [...params, limit, offset]
    );
    const [countRows] = await pool.query(`SELECT COUNT(*) AS c FROM city_services cs ${whereSql}`, params);

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
    console.error("Services GET error:", error);
    return res.status(500).json({ success: false, message: "Server error while fetching services" });
  }
});

router.get("/admin/services/reports", async (req, res) => {
  try {
    const status = clampText(req.query.status, 24).toLowerCase();
    const limit = Math.min(200, Math.max(1, Math.trunc(Number(req.query.limit) || 50)));
    const offset = Math.max(0, Math.trunc(Number(req.query.offset) || 0));
    const where = [];
    const params = [];
    if (status && status !== "all" && SERVICE_REPORT_STATUSES.has(status)) {
      where.push("r.status = ?");
      params.push(status);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const [rows] = await pool.query(
      `
      SELECT
        r.*,
        s.name AS service_name,
        s.city AS service_city,
        s.category AS service_category
      FROM city_service_reports r
      INNER JOIN city_services s ON s.id = r.service_id
      ${whereSql}
      ORDER BY CASE WHEN r.status = 'pending' THEN 0 ELSE 1 END, r.created_at DESC
      LIMIT ? OFFSET ?
      `,
      [...params, limit, offset]
    );
    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS c FROM city_service_reports r ${whereSql}`,
      params
    );

    return res.status(200).json({
      success: true,
      data: rows.map((row) => ({
        id: Number(row.id),
        serviceId: Number(row.service_id),
        serviceName: row.service_name || "",
        serviceCity: formatDisplayCityName(row.service_city || row.city || ""),
        serviceCategory: row.service_category || "",
        reason: row.reason || "wrong_info",
        details: row.details || "",
        city: formatDisplayCityName(row.city || ""),
        reporterUid: row.reporter_uid || "",
        status: row.status || "pending",
        createdAt: toIso(row.created_at),
        updatedAt: toIso(row.updated_at)
      })),
      pagination: {
        total: Number(countRows[0]?.c || 0),
        limit,
        offset
      }
    });
  } catch (error) {
    console.error("Service reports GET error:", error);
    return res.status(500).json({ success: false, message: "Server error while fetching service reports" });
  }
});

router.patch("/admin/services/reports/:id/status", async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid report id" });

    const status = clampText(req.body?.status, 24).toLowerCase();
    if (!SERVICE_REPORT_STATUSES.has(status)) {
      return res.status(400).json({ success: false, message: "Invalid report status" });
    }

    const [result] = await pool.query(
      `UPDATE city_service_reports SET status = ? WHERE id = ? LIMIT 1`,
      [status, id]
    );
    if (!result.affectedRows) {
      return res.status(404).json({ success: false, message: "Report not found" });
    }

    await createAuditLog("update", "service_report", `Updated service report #${id} to ${status}`, id);
    return res.status(200).json({ success: true, message: "Report status updated" });
  } catch (error) {
    console.error("Service report status PATCH error:", error);
    return res.status(500).json({ success: false, message: "Server error while updating service report" });
  }
});

router.get("/admin/services/:id", async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      return res.status(400).json({ success: false, message: "Invalid service id" });
    }
    const row = await getServiceById(id);
    if (!row) {
      return res.status(404).json({ success: false, message: "Service not found" });
    }
    return res.status(200).json({ success: true, data: mapServiceRow(row) });
  } catch (error) {
    console.error("Service GET by id error:", error);
    return res.status(500).json({ success: false, message: "Server error while fetching service" });
  }
});

router.post("/admin/services", async (req, res) => {
  try {
    const normalized = normalizeServiceInput(req.body);
    if (normalized.error) {
      return res.status(400).json({ success: false, message: normalized.error });
    }
    const service = normalized.value;

    const [result] = await pool.query(
      `
      INSERT INTO city_services (name, city, area, category, description, link, availability_label, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        service.name,
        service.city,
        service.area || null,
        service.category,
        service.desc || null,
        service.link || null,
        service.availability || null,
        service.status
      ]
    );

    const created = await getServiceById(result.insertId);
    await createAuditLog("create", "service", `Created service "${service.name}"`, result.insertId, {
      city: service.city,
      category: service.category
    });

    return res.status(201).json({
      success: true,
      message: "Service created successfully",
      data: created ? mapServiceRow(created) : null
    });
  } catch (error) {
    console.error("Service POST error:", error);
    return res.status(500).json({ success: false, message: "Server error while creating service" });
  }
});

router.post("/admin/services/bulk", async (req, res) => {
  const rawInput = Array.isArray(req.body?.services) ? req.body.services : req.body;
  const normalized = normalizeBulkServicesInput(rawInput);
  if (normalized.error) {
    return res.status(400).json({ success: false, message: normalized.error });
  }

  const services = normalized.value;
  if (services.length > 500) {
    return res.status(400).json({
      success: false,
      message: "Bulk import limit is 500 services per request"
    });
  }

  const connection = await pool.getConnection();
  let inserted = 0;
  let updated = 0;
  const upsertedIds = [];

  try {
    await connection.beginTransaction();

    for (const service of services) {
      const [existingRows] = await connection.query(
        `
        SELECT id
        FROM city_services
        WHERE LOWER(name) = LOWER(?) AND LOWER(city) = LOWER(?)
        LIMIT 1
        `,
        [service.name, service.city]
      );

      if (existingRows.length) {
        const id = Number(existingRows[0].id);
        await connection.query(
          `
          UPDATE city_services
          SET area = ?, category = ?, description = ?, link = ?, availability_label = ?, status = ?
          WHERE id = ?
          `,
          [
            service.area || null,
            service.category,
            service.desc || null,
            service.link || null,
            service.availability || null,
            service.status,
            id
          ]
        );
        updated += 1;
        upsertedIds.push(id);
      } else {
        const [insertResult] = await connection.query(
          `
          INSERT INTO city_services (name, city, area, category, description, link, availability_label, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            service.name,
            service.city,
            service.area || null,
            service.category,
            service.desc || null,
            service.link || null,
            service.availability || null,
            service.status
          ]
        );
        inserted += 1;
        upsertedIds.push(Number(insertResult.insertId || 0));
      }
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    console.error("Service bulk POST error:", error);
    return res.status(500).json({ success: false, message: "Server error while importing services" });
  } finally {
    connection.release();
  }

  try {
    await createAuditLog(
      "bulk_upsert",
      "service",
      `Bulk import completed: ${inserted} inserted, ${updated} updated`,
      null,
      {
        inserted,
        updated,
        received: normalized.meta.received,
        valid: normalized.meta.valid,
        invalid: normalized.meta.invalid,
        duplicates: normalized.meta.duplicates
      }
    );
  } catch (error) {
    console.error("Service bulk audit log error:", error);
  }

  let latestRows = [];
  try {
    const [rows] = await pool.query(
      `
      SELECT *
      FROM city_services
      WHERE id IN (?)
      ORDER BY FIELD(id, ${upsertedIds.map(() => "?").join(",")})
      `,
      [upsertedIds, ...upsertedIds]
    );
    latestRows = rows;
  } catch (error) {
    console.error("Service bulk response fetch error:", error);
  }

  return res.status(200).json({
    success: true,
    message: "Bulk services import completed",
    summary: {
      inserted,
      updated,
      received: normalized.meta.received,
      valid: normalized.meta.valid,
      invalid: normalized.meta.invalid,
      duplicates: normalized.meta.duplicates
    },
    data: latestRows.map(mapServiceRow)
  });
});

router.put("/admin/services/:id", async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      return res.status(400).json({ success: false, message: "Invalid service id" });
    }
    const existing = await getServiceById(id);
    if (!existing) {
      return res.status(404).json({ success: false, message: "Service not found" });
    }

    const normalized = normalizeServiceInput(req.body, existing);
    if (normalized.error) {
      return res.status(400).json({ success: false, message: normalized.error });
    }
    const service = normalized.value;

    await pool.query(
      `
      UPDATE city_services
      SET name = ?, city = ?, area = ?, category = ?, description = ?, link = ?, availability_label = ?, status = ?
      WHERE id = ?
      `,
      [
        service.name,
        service.city,
        service.area || null,
        service.category,
        service.desc || null,
        service.link || null,
        service.availability || null,
        service.status,
        id
      ]
    );

    const updated = await getServiceById(id);
    await createAuditLog("update", "service", `Updated service "${service.name}"`, id, {
      status: service.status
    });

    return res.status(200).json({
      success: true,
      message: "Service updated successfully",
      data: updated ? mapServiceRow(updated) : null
    });
  } catch (error) {
    console.error("Service PUT error:", error);
    return res.status(500).json({ success: false, message: "Server error while updating service" });
  }
});

router.delete("/admin/services/:id", async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      return res.status(400).json({ success: false, message: "Invalid service id" });
    }
    const existing = await getServiceById(id);
    if (!existing) {
      return res.status(404).json({ success: false, message: "Service not found" });
    }
    await pool.query("DELETE FROM city_services WHERE id = ?", [id]);
    await createAuditLog("delete", "service", `Deleted service "${existing.name}"`, id);
    return res.status(200).json({
      success: true,
      message: "Service deleted successfully"
    });
  } catch (error) {
    console.error("Service DELETE error:", error);
    return res.status(500).json({ success: false, message: "Server error while deleting service" });
  }
});

// ─────────────────────────────────────────────────────────
// Kumbh Guide
router.get("/admin/kumbh-guide", async (req, res) => {
  try {
    await ensureDefaultKumbhItems();
    const type = clampText(req.query.type, 40).toLowerCase();
    const status = clampText(req.query.status, 24).toLowerCase();
    const search = clampText(req.query.search, 120).toLowerCase();
    const limit = Math.min(500, Math.max(1, Math.trunc(Number(req.query.limit) || 200)));
    const offset = Math.max(0, Math.trunc(Number(req.query.offset) || 0));

    const where = [];
    const params = [];
    if (type && type !== "all" && KUMBH_ITEM_TYPES.has(type)) {
      where.push("item_type = ?");
      params.push(type);
    }
    if (status && status !== "all" && KUMBH_ITEM_STATUSES.has(status)) {
      where.push("status = ?");
      params.push(status);
    }
    if (search) {
      where.push(
        "(LOWER(title) LIKE ? OR LOWER(item_key) LIKE ? OR LOWER(COALESCE(category,'')) LIKE ? OR LOWER(COALESCE(description,'')) LIKE ?)"
      );
      const q = `%${search}%`;
      params.push(q, q, q, q);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const [rows] = await pool.query(
      `
      SELECT *
      FROM kumbh_items
      ${whereSql}
      ORDER BY
        ${kumbhTypeOrderSql()},
        priority DESC,
        COALESCE(date_value, '9999-12-31') ASC,
        updated_at DESC
      LIMIT ? OFFSET ?
      `,
      [...params, limit, offset]
    );
    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS c FROM kumbh_items ${whereSql}`,
      params
    );

    return res.status(200).json({
      success: true,
      data: rows.map(mapKumbhItemRow),
      pagination: {
        total: Number(countRows[0]?.c || 0),
        limit,
        offset
      }
    });
  } catch (error) {
    console.error("Admin Kumbh guide GET error:", error);
    return res.status(500).json({ success: false, message: "Server error while fetching Kumbh guide items" });
  }
});

router.post("/admin/kumbh-guide/seed", async (req, res) => {
  try {
    await ensureDefaultKumbhItems();
    const [rows] = await pool.query(
      `
      SELECT *
      FROM kumbh_items
      ORDER BY
        ${kumbhTypeOrderSql()},
        priority DESC,
        id ASC
      `
    );
    await createAuditLog("seed", "kumbh_guide", "Seeded Kumbh guide defaults");
    return res.status(200).json({
      success: true,
      message: "Kumbh guide defaults are ready",
      data: rows.map(mapKumbhItemRow)
    });
  } catch (error) {
    console.error("Admin Kumbh guide seed error:", error);
    return res.status(500).json({ success: false, message: "Server error while seeding Kumbh guide" });
  }
});

router.get("/admin/kumbh-guide/settings", async (req, res) => {
  try {
    const settings = await fetchKumbhSettings();
    return res.status(200).json({
      success: true,
      data: settings
    });
  } catch (error) {
    console.error("Admin Kumbh settings GET error:", error);
    return res.status(500).json({ success: false, message: "Server error while fetching Kumbh settings" });
  }
});

router.put("/admin/kumbh-guide/settings", async (req, res) => {
  try {
    const settings = await saveKumbhSettings(req.body || {});
    await createAuditLog("update", "kumbh_settings", "Updated Kumbh guide page settings", null, {
      enabled: settings.enabled
    });
    return res.status(200).json({
      success: true,
      message: "Kumbh guide settings saved",
      data: settings
    });
  } catch (error) {
    console.error("Admin Kumbh settings PUT error:", error);
    return res.status(500).json({ success: false, message: "Server error while saving Kumbh settings" });
  }
});

router.get("/admin/kumbh-guide/stats", async (req, res) => {
  try {
    await ensureDefaultKumbhItems();
    const settings = await fetchKumbhSettings();
    const [[totals]] = await pool.query(
      `
      SELECT
        COUNT(*) AS total,
        SUM(status = 'active') AS active,
        SUM(status = 'draft') AS draft,
        SUM(status = 'archived') AS archived
      FROM kumbh_items
      `
    );
    const [typeRows] = await pool.query(
      `
      SELECT item_type AS type, COUNT(*) AS total, SUM(status = 'active') AS active
      FROM kumbh_items
      GROUP BY item_type
      ORDER BY ${kumbhTypeOrderSql()}, item_type ASC
      `
    );
    const [statusRows] = await pool.query(
      `
      SELECT status, COUNT(*) AS total
      FROM kumbh_items
      GROUP BY status
      ORDER BY FIELD(status, 'active', 'draft', 'archived'), status ASC
      `
    );

    return res.status(200).json({
      success: true,
      data: {
        settings,
        totals: {
          total: Number(totals?.total || 0),
          active: Number(totals?.active || 0),
          draft: Number(totals?.draft || 0),
          archived: Number(totals?.archived || 0)
        },
        byType: typeRows.map((row) => ({
          type: row.type || "",
          total: Number(row.total || 0),
          active: Number(row.active || 0)
        })),
        byStatus: statusRows.map((row) => ({
          status: row.status || "",
          total: Number(row.total || 0)
        }))
      }
    });
  } catch (error) {
    console.error("Admin Kumbh stats GET error:", error);
    return res.status(500).json({ success: false, message: "Server error while fetching Kumbh stats" });
  }
});

router.post("/admin/kumbh-guide/bulk", async (req, res) => {
  const action = clampText(req.body?.action, 24).toLowerCase();
  const ids = normalizeKumbhIds(req.body?.ids);
  if (!ids.length) {
    return res.status(400).json({ success: false, message: "ids array is required" });
  }
  if (!["activate", "draft", "archive", "delete"].includes(action)) {
    return res.status(400).json({ success: false, message: "Invalid bulk action" });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    let affected = 0;
    if (action === "delete") {
      const [result] = await connection.query("DELETE FROM kumbh_items WHERE id IN (?)", [ids]);
      affected = Number(result.affectedRows || 0);
    } else {
      const status = action === "activate" ? "active" : action === "archive" ? "archived" : "draft";
      const [result] = await connection.query(
        "UPDATE kumbh_items SET status = ? WHERE id IN (?)",
        [status, ids]
      );
      affected = Number(result.affectedRows || 0);
    }
    await connection.commit();
    await createAuditLog("bulk", "kumbh_guide", `Bulk ${action} applied to ${affected} Kumbh item(s)`, null, {
      ids,
      action,
      affected
    });
    return res.status(200).json({
      success: true,
      message: `Bulk ${action} completed`,
      affected
    });
  } catch (error) {
    await connection.rollback();
    console.error("Admin Kumbh bulk POST error:", error);
    return res.status(500).json({ success: false, message: "Server error while applying Kumbh bulk action" });
  } finally {
    connection.release();
  }
});

router.post("/admin/kumbh-guide/reorder", async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  const normalized = [];
  const seen = new Set();
  for (const item of items) {
    const id = parsePositiveInt(item?.id);
    const priority = parseKumbhPriority(item?.priority);
    if (!id || priority == null || seen.has(id)) continue;
    seen.add(id);
    normalized.push({ id, priority });
    if (normalized.length >= 300) break;
  }
  if (!normalized.length) {
    return res.status(400).json({ success: false, message: "items array with id and priority is required" });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    for (const item of normalized) {
      await connection.query("UPDATE kumbh_items SET priority = ? WHERE id = ?", [item.priority, item.id]);
    }
    await connection.commit();
    await createAuditLog("reorder", "kumbh_guide", `Reordered ${normalized.length} Kumbh item(s)`, null, {
      count: normalized.length
    });
    return res.status(200).json({
      success: true,
      message: "Kumbh guide order updated",
      updated: normalized.length
    });
  } catch (error) {
    await connection.rollback();
    console.error("Admin Kumbh reorder POST error:", error);
    return res.status(500).json({ success: false, message: "Server error while reordering Kumbh guide" });
  } finally {
    connection.release();
  }
});

router.post("/admin/kumbh-guide", async (req, res) => {
  try {
    const normalized = normalizeKumbhItemInput(req.body);
    if (normalized.error) {
      return res.status(400).json({ success: false, message: normalized.error });
    }
    const item = normalized.value;
    const [result] = await pool.query(
      `
      INSERT INTO kumbh_items (
        item_type, item_key, title, subtitle, description, icon, category,
        status, priority, date_value, meta_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        item.type,
        item.itemKey,
        item.title,
        item.subtitle || null,
        item.description || null,
        item.icon || null,
        item.category || null,
        item.status,
        item.priority,
        item.dateValue,
        safeJsonStringify(item.meta || {}, "{}")
      ]
    );

    const created = await getKumbhItemById(result.insertId);
    await createAuditLog("create", "kumbh_guide", `Created Kumbh item "${item.title}"`, result.insertId, {
      type: item.type,
      key: item.itemKey
    });
    return res.status(201).json({
      success: true,
      message: "Kumbh guide item created",
      data: created ? mapKumbhItemRow(created) : null
    });
  } catch (error) {
    if (error && error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ success: false, message: "This type/key already exists" });
    }
    console.error("Admin Kumbh guide POST error:", error);
    return res.status(500).json({ success: false, message: "Server error while creating Kumbh guide item" });
  }
});

router.get("/admin/kumbh-guide/:id", async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid Kumbh guide item id" });
    const row = await getKumbhItemById(id);
    if (!row) return res.status(404).json({ success: false, message: "Kumbh guide item not found" });
    return res.status(200).json({ success: true, data: mapKumbhItemRow(row) });
  } catch (error) {
    console.error("Admin Kumbh guide item GET error:", error);
    return res.status(500).json({ success: false, message: "Server error while fetching Kumbh guide item" });
  }
});

router.patch("/admin/kumbh-guide/:id/status", async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid Kumbh guide item id" });
    const existing = await getKumbhItemById(id);
    if (!existing) return res.status(404).json({ success: false, message: "Kumbh guide item not found" });
    const status = normalizeKumbhStatus(req.body?.status, "");
    if (!status) return res.status(400).json({ success: false, message: "Invalid Kumbh item status" });

    await pool.query("UPDATE kumbh_items SET status = ? WHERE id = ?", [status, id]);
    const updated = await getKumbhItemById(id);
    await createAuditLog("status", "kumbh_guide", `Kumbh item "${existing.title}" changed to ${status}`, id, {
      previousStatus: existing.status,
      status
    });
    return res.status(200).json({
      success: true,
      message: "Kumbh item status updated",
      data: updated ? mapKumbhItemRow(updated) : null
    });
  } catch (error) {
    console.error("Admin Kumbh status PATCH error:", error);
    return res.status(500).json({ success: false, message: "Server error while updating Kumbh status" });
  }
});

router.patch("/admin/kumbh-guide/:id/priority", async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid Kumbh guide item id" });
    const existing = await getKumbhItemById(id);
    if (!existing) return res.status(404).json({ success: false, message: "Kumbh guide item not found" });
    const priority = parseKumbhPriority(req.body?.priority);
    if (priority == null) return res.status(400).json({ success: false, message: "Priority must be a positive number" });

    await pool.query("UPDATE kumbh_items SET priority = ? WHERE id = ?", [priority, id]);
    const updated = await getKumbhItemById(id);
    await createAuditLog("priority", "kumbh_guide", `Kumbh item "${existing.title}" priority updated`, id, {
      previousPriority: Number(existing.priority || 0),
      priority
    });
    return res.status(200).json({
      success: true,
      message: "Kumbh item priority updated",
      data: updated ? mapKumbhItemRow(updated) : null
    });
  } catch (error) {
    console.error("Admin Kumbh priority PATCH error:", error);
    return res.status(500).json({ success: false, message: "Server error while updating Kumbh priority" });
  }
});

router.put("/admin/kumbh-guide/:id", async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid Kumbh guide item id" });
    const existing = await getKumbhItemById(id);
    if (!existing) return res.status(404).json({ success: false, message: "Kumbh guide item not found" });

    const normalized = normalizeKumbhItemInput(req.body, existing);
    if (normalized.error) {
      return res.status(400).json({ success: false, message: normalized.error });
    }
    const item = normalized.value;

    await pool.query(
      `
      UPDATE kumbh_items
      SET item_type = ?, item_key = ?, title = ?, subtitle = ?, description = ?,
          icon = ?, category = ?, status = ?, priority = ?, date_value = ?, meta_json = ?
      WHERE id = ?
      `,
      [
        item.type,
        item.itemKey,
        item.title,
        item.subtitle || null,
        item.description || null,
        item.icon || null,
        item.category || null,
        item.status,
        item.priority,
        item.dateValue,
        safeJsonStringify(item.meta || {}, "{}"),
        id
      ]
    );

    const updated = await getKumbhItemById(id);
    await createAuditLog("update", "kumbh_guide", `Updated Kumbh item "${item.title}"`, id, {
      type: item.type,
      status: item.status
    });
    return res.status(200).json({
      success: true,
      message: "Kumbh guide item updated",
      data: updated ? mapKumbhItemRow(updated) : null
    });
  } catch (error) {
    if (error && error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ success: false, message: "This type/key already exists" });
    }
    console.error("Admin Kumbh guide PUT error:", error);
    return res.status(500).json({ success: false, message: "Server error while updating Kumbh guide item" });
  }
});

router.delete("/admin/kumbh-guide/:id", async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid Kumbh guide item id" });
    const existing = await getKumbhItemById(id);
    if (!existing) return res.status(404).json({ success: false, message: "Kumbh guide item not found" });
    await pool.query("DELETE FROM kumbh_items WHERE id = ?", [id]);
    await createAuditLog("delete", "kumbh_guide", `Deleted Kumbh item "${existing.title}"`, id, {
      type: existing.item_type
    });
    return res.status(200).json({
      success: true,
      message: "Kumbh guide item deleted"
    });
  } catch (error) {
    console.error("Admin Kumbh guide DELETE error:", error);
    return res.status(500).json({ success: false, message: "Server error while deleting Kumbh guide item" });
  }
});

// Home Sections
// ─────────────────────────────────────────────────────────
// Place Categories
router.get("/admin/categories", async (req, res) => {
  try {
    const data = await fetchPlaceCategories({ includeDisabled: true });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("Admin categories GET error:", error);
    return res.status(500).json({ success: false, message: "Server error while fetching categories" });
  }
});

router.post("/admin/categories", async (req, res) => {
  try {
    await ensureDefaultPlaceCategories();
    const category = normalizePlaceCategoryInput(req.body, DEFAULT_PLACE_CATEGORIES.length + 1);
    if (!category) {
      return res.status(400).json({ success: false, message: "Category name is required" });
    }
    await pool.query(
      `
      INSERT INTO place_categories (
        slug, name, icon, description, color, bg_color, cover_image_url, enabled, display_order
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        category.slug,
        category.name,
        category.icon,
        category.description,
        category.color,
        category.bgColor,
        category.coverImage,
        category.enabled ? 1 : 0,
        category.order
      ]
    );
    await createAuditLog("create", "place_category", `Created category "${category.name}"`);
    const rows = await fetchPlaceCategories({ includeDisabled: true });
    return res.status(201).json({
      success: true,
      message: "Category created",
      data: rows.find((row) => row.slug === category.slug) || category
    });
  } catch (error) {
    if (error && error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ success: false, message: "Category slug already exists" });
    }
    console.error("Admin categories POST error:", error);
    return res.status(500).json({ success: false, message: "Server error while creating category" });
  }
});

router.put("/admin/categories/:slug", async (req, res) => {
  try {
    await ensureDefaultPlaceCategories();
    const currentSlug = normalizeCategorySlug(req.params.slug);
    const category = normalizePlaceCategoryInput({ ...req.body, slug: currentSlug }, 1);
    if (!currentSlug || !category) {
      return res.status(400).json({ success: false, message: "Invalid category" });
    }
    const [result] = await pool.query(
      `
      UPDATE place_categories
      SET name = ?, icon = ?, description = ?, color = ?, bg_color = ?,
          cover_image_url = ?, enabled = ?, display_order = ?
      WHERE slug = ?
      `,
      [
        category.name,
        category.icon,
        category.description,
        category.color,
        category.bgColor,
        category.coverImage,
        category.enabled ? 1 : 0,
        category.order,
        currentSlug
      ]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Category not found" });
    }
    await createAuditLog("update", "place_category", `Updated category "${category.name}"`);
    const rows = await fetchPlaceCategories({ includeDisabled: true });
    return res.status(200).json({
      success: true,
      message: "Category updated",
      data: rows.find((row) => row.slug === currentSlug) || category
    });
  } catch (error) {
    console.error("Admin categories PUT error:", error);
    return res.status(500).json({ success: false, message: "Server error while updating category" });
  }
});

router.delete("/admin/categories/:slug", async (req, res) => {
  try {
    await ensureDefaultPlaceCategories();
    const slug = normalizeCategorySlug(req.params.slug);
    if (!slug) return res.status(400).json({ success: false, message: "Invalid category slug" });
    const [rows] = await pool.query("SELECT * FROM place_categories WHERE slug = ? LIMIT 1", [slug]);
    if (!rows[0]) return res.status(404).json({ success: false, message: "Category not found" });
    const [countRows] = await pool.query(
      "SELECT COUNT(*) AS c FROM places WHERE (LOWER(category) = LOWER(?) OR LOWER(COALESCE(secondary_category, '')) = LOWER(?)) AND is_deleted = 0",
      [rows[0].name, rows[0].name]
    );
    const usedCount = Number(countRows[0]?.c || 0);
    if (usedCount > 0) {
      return res.status(409).json({
        success: false,
        message: `Category is used by ${usedCount} place(s). Disable it instead or move those places first.`
      });
    }
    await pool.query("DELETE FROM place_categories WHERE slug = ?", [slug]);
    await createAuditLog("delete", "place_category", `Deleted category "${rows[0].name}"`);
    return res.status(200).json({ success: true, message: "Category deleted" });
  } catch (error) {
    console.error("Admin categories DELETE error:", error);
    return res.status(500).json({ success: false, message: "Server error while deleting category" });
  }
});

router.get("/admin/home-sections", async (req, res) => {
  try {
    await ensureDefaultHomeSections();
    const [rows] = await pool.query("SELECT * FROM home_sections ORDER BY display_order ASC, section_key ASC");
    return res.status(200).json({
      success: true,
      data: rows.map(mapHomeSectionRow)
    });
  } catch (error) {
    console.error("Home sections GET error:", error);
    return res.status(500).json({ success: false, message: "Server error while fetching home sections" });
  }
});

router.put("/admin/home-sections", async (req, res) => {
  const payload = Array.isArray(req.body?.sections) ? req.body.sections : req.body;
  const sections = normalizeHomeSectionsInput(payload);
  if (!sections.length) {
    return res.status(400).json({
      success: false,
      message: "sections array is required with at least one valid section"
    });
  }

  const connection = await pool.getConnection();
  try {
    await ensureDefaultHomeSections();
    await connection.beginTransaction();

    for (const section of sections) {
      await connection.query(
        `
        INSERT INTO home_sections (section_key, label, enabled, display_order, title, subtitle, meta_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          label = VALUES(label),
          enabled = VALUES(enabled),
          display_order = VALUES(display_order),
          title = VALUES(title),
          subtitle = VALUES(subtitle),
          meta_json = VALUES(meta_json)
        `,
        [
          section.key,
          section.label,
          section.enabled ? 1 : 0,
          section.order,
          section.title || null,
          section.subtitle || null,
          safeJsonStringify(section.meta || {}, "{}")
        ]
      );
    }

    const sectionKeys = sections.map((s) => s.key);
    const placeholders = sectionKeys.map(() => "?").join(", ");
    await connection.query(
      `DELETE FROM home_sections WHERE section_key NOT IN (${placeholders})`,
      sectionKeys
    );

    await connection.commit();
    await createAuditLog("update", "home_sections", "Homepage section configuration updated");

    const [rows] = await pool.query("SELECT * FROM home_sections ORDER BY display_order ASC, section_key ASC");
    return res.status(200).json({
      success: true,
      message: "Home sections updated successfully",
      data: rows.map(mapHomeSectionRow)
    });
  } catch (error) {
    await connection.rollback();
    console.error("Home sections PUT error:", error);
    return res.status(500).json({ success: false, message: "Server error while saving home sections" });
  } finally {
    connection.release();
  }
});

// ─────────────────────────────────────────────────────────
// Audit Logs
// ─────────────────────────────────────────────────────────
router.get("/admin/audit-logs", async (req, res) => {
  try {
    const action = clampText(req.query.action, 80).toLowerCase();
    const entity = clampText(req.query.entity, 80).toLowerCase();
    const search = clampText(req.query.search, 120).toLowerCase();
    const dateFromRaw = clampText(req.query.date_from ?? req.query.dateFrom, 40);
    const dateToRaw = clampText(req.query.date_to ?? req.query.dateTo, 40);
    const limit = Math.min(500, Math.max(1, Math.trunc(Number(req.query.limit) || 200)));
    const offset = Math.max(0, Math.trunc(Number(req.query.offset) || 0));

    const where = [];
    const params = [];
    if (action && action !== "all") {
      where.push("LOWER(action) = ?");
      params.push(action);
    }
    if (entity && entity !== "all") {
      where.push("LOWER(entity) = ?");
      params.push(entity);
    }
    if (search) {
      where.push("(LOWER(action) LIKE ? OR LOWER(entity) LIKE ? OR LOWER(details) LIKE ?)");
      const q = `%${search}%`;
      params.push(q, q, q);
    }
    if (dateFromRaw) {
      const dateFrom = parseDateOrNull(dateFromRaw);
      if (!dateFrom) {
        return res.status(400).json({ success: false, message: "Invalid date_from value" });
      }
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateFromRaw)) {
        dateFrom.setHours(0, 0, 0, 0);
      }
      where.push("created_at >= ?");
      params.push(dateFrom);
    }
    if (dateToRaw) {
      const dateTo = parseDateOrNull(dateToRaw);
      if (!dateTo) {
        return res.status(400).json({ success: false, message: "Invalid date_to value" });
      }
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateToRaw)) {
        dateTo.setHours(23, 59, 59, 999);
      }
      where.push("created_at <= ?");
      params.push(dateTo);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const [rows] = await pool.query(
      `
      SELECT *
      FROM audit_logs
      ${whereSql}
      ORDER BY created_at DESC, id DESC
      LIMIT ? OFFSET ?
      `,
      [...params, limit, offset]
    );
    const [countRows] = await pool.query(`SELECT COUNT(*) AS c FROM audit_logs ${whereSql}`, params);

    return res.status(200).json({
      success: true,
      data: rows.map(mapAuditRow),
      pagination: {
        total: Number(countRows[0]?.c || 0),
        limit,
        offset
      }
    });
  } catch (error) {
    console.error("Audit logs GET error:", error);
    return res.status(500).json({ success: false, message: "Server error while fetching audit logs" });
  }
});

router.post("/admin/audit-logs", async (req, res) => {
  try {
    const action = clampText(req.body?.action, 80);
    const entity = clampText(req.body?.entity, 80);
    const details = clampText(req.body?.details, 1000);
    const entityId = req.body?.entityId == null ? null : parsePositiveInt(req.body.entityId);
    const meta = req.body?.meta && typeof req.body.meta === "object" ? req.body.meta : null;

    if (!action || !entity || !details) {
      return res.status(400).json({
        success: false,
        message: "action, entity and details are required"
      });
    }

    const [result] = await pool.query(
      `INSERT INTO audit_logs (action, entity, entity_id, details, meta_json)
       VALUES (?, ?, ?, ?, ?)`,
      [action, entity, entityId, details, meta ? safeJsonStringify(meta, "{}") : null]
    );

    const [rows] = await pool.query("SELECT * FROM audit_logs WHERE id = ? LIMIT 1", [result.insertId]);
    return res.status(201).json({
      success: true,
      message: "Audit log created",
      data: rows[0] ? mapAuditRow(rows[0]) : null
    });
  } catch (error) {
    console.error("Audit logs POST error:", error);
    return res.status(500).json({ success: false, message: "Server error while creating audit log" });
  }
});

router.delete("/admin/audit-logs/:id", async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      return res.status(400).json({ success: false, message: "Invalid audit log id" });
    }

    const [rows] = await pool.query(
      "SELECT id, action, entity, details FROM audit_logs WHERE id = ? LIMIT 1",
      [id]
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, message: "Audit log not found" });
    }

    await pool.query("DELETE FROM audit_logs WHERE id = ? LIMIT 1", [id]);

    return res.status(200).json({
      success: true,
      message: "Audit log deleted successfully"
    });
  } catch (error) {
    console.error("Audit logs DELETE error:", error);
    return res.status(500).json({ success: false, message: "Server error while deleting audit log" });
  }
});

router.delete("/admin/audit-logs", requireSuperAdmin, async (req, res) => {
  try {
    const [countRows] = await pool.query("SELECT COUNT(*) AS c FROM audit_logs");
    const total = Number(countRows[0]?.c || 0);
    await pool.query("DELETE FROM audit_logs");
    return res.status(200).json({
      success: true,
      message: `Cleared ${total} audit log(s)`,
      deletedCount: total
    });
  } catch (error) {
    console.error("Audit logs CLEAR error:", error);
    return res.status(500).json({ success: false, message: "Server error while clearing audit logs" });
  }
});

router.get("/admin/backup/export", requireSuperAdmin, async (req, res) => {
  try {
    const [usersRows] = await pool.query(
      `SELECT id, full_name, email, password_hash, username, role, phone,
              admin_pin_hash, admin_pin_updated_at, admin_pin_failed_attempts, admin_pin_locked_until,
              account_status, deleted_at, deleted_original_email, deleted_original_username,
              created_at, updated_at
       FROM users
       ORDER BY id ASC`
    );
    const [userProfilesRows] = await pool.query(
      `SELECT user_id, name, username, bio, location, avatar_url, cover_url,
              settings_json, visited_ids_json, saved_ids_json, activity_json,
              goals_json, interests_json, memories_json, created_at, updated_at
       FROM user_profiles
       ORDER BY user_id ASC`
    );
    const [profileStateRows] = await pool.query(
      `SELECT uid, name, username, bio, location, avatar_url, cover_url,
              settings_json, visited_ids_json, visited_places_json, saved_ids_json,
              saved_places_json, activity_json, goals_json, interests_json,
              memories_json, created_at, updated_at
       FROM profile_states
       ORDER BY uid ASC`
    );
    const [placeRows] = await pool.query("SELECT * FROM places ORDER BY id ASC");
    const [serviceRows] = await pool.query("SELECT * FROM city_services ORDER BY id ASC");
    const [kumbhRows] = await pool.query("SELECT * FROM kumbh_items ORDER BY item_type ASC, priority DESC, id ASC");
    const kumbhSettings = await fetchKumbhSettings();
    const [homeSectionRows] = await pool.query(
      "SELECT * FROM home_sections ORDER BY display_order ASC, section_key ASC"
    );
    const [auditRows] = await pool.query("SELECT * FROM audit_logs ORDER BY id ASC");
    const [memoryModerationRows] = await pool.query(
      "SELECT * FROM memory_moderation ORDER BY uid ASC, memory_id ASC"
    );
    const [adminPermissionRows] = await pool.query(
      "SELECT admin_id, permission_key, can_edit, updated_by, created_at, updated_at FROM admin_permissions ORDER BY admin_id ASC, permission_key ASC"
    );

    const extraBackupData = await fetchBackupExtraData();

    const backupPayload = {
      version: 2,
      kind: "explorex-admin-backup",
      exportedAt: new Date().toISOString(),
      exportedBy: {
        userId: Number(req.auth?.userId || 0),
        email: clampText(req.auth?.email, 190)
      },
      data: {
        users: usersRows.map((row) => ({
          id: Number(row.id),
          fullName: row.full_name || "",
          email: row.email || "",
          passwordHash: row.password_hash || "",
          username: row.username || "",
          role: row.role || "Traveller",
          phone: row.phone || "",
          adminPinHash: row.admin_pin_hash || "",
          adminPinUpdatedAt: toIso(row.admin_pin_updated_at),
          adminPinFailedAttempts: Number(row.admin_pin_failed_attempts || 0),
          adminPinLockedUntil: toIso(row.admin_pin_locked_until),
          accountStatus: normalizeUserAccountStatus(row.account_status, "active"),
          deletedAt: toIso(row.deleted_at),
          deletedOriginalEmail: row.deleted_original_email || "",
          deletedOriginalUsername: row.deleted_original_username || "",
          createdAt: toIso(row.created_at),
          updatedAt: toIso(row.updated_at)
        })),
        userProfiles: userProfilesRows.map((row) => ({
          userId: Number(row.user_id),
          name: row.name || "",
          username: row.username || "",
          bio: row.bio || "",
          location: row.location || "",
          avatarUrl: row.avatar_url || "",
          coverUrl: row.cover_url || "",
          settingsJson: safeJsonParse(row.settings_json, {}),
          visitedIdsJson: safeJsonParse(row.visited_ids_json, []),
          savedIdsJson: safeJsonParse(row.saved_ids_json, []),
          activityJson: safeJsonParse(row.activity_json, []),
          goalsJson: safeJsonParse(row.goals_json, []),
          interestsJson: safeJsonParse(row.interests_json, []),
          memoriesJson: safeJsonParse(row.memories_json, []),
          createdAt: toIso(row.created_at),
          updatedAt: toIso(row.updated_at)
        })),
        profileStates: profileStateRows.map((row) => ({
          uid: row.uid || "",
          name: row.name || "",
          username: row.username || "",
          bio: row.bio || "",
          location: row.location || "",
          avatarUrl: row.avatar_url || "",
          coverUrl: row.cover_url || "",
          settingsJson: safeJsonParse(row.settings_json, null),
          visitedIdsJson: safeJsonParse(row.visited_ids_json, null),
          visitedPlacesJson: safeJsonParse(row.visited_places_json, null),
          savedIdsJson: safeJsonParse(row.saved_ids_json, null),
          savedPlacesJson: safeJsonParse(row.saved_places_json, null),
          activityJson: safeJsonParse(row.activity_json, null),
          goalsJson: safeJsonParse(row.goals_json, null),
          interestsJson: safeJsonParse(row.interests_json, null),
          memoriesJson: safeJsonParse(row.memories_json, null),
          createdAt: toIso(row.created_at),
          updatedAt: toIso(row.updated_at)
        })),
        places: placeRows.map(mapPlaceRow),
        services: serviceRows.map(mapServiceRow),
        kumbhItems: kumbhRows.map(mapKumbhItemRow),
        kumbhSettings,
        homeSections: homeSectionRows.map(mapHomeSectionRow),
        auditLogs: auditRows.map(mapAuditRow),
        adminPermissions: adminPermissionRows.map((row) => ({
          adminId: Number(row.admin_id),
          permissionKey: row.permission_key || "",
          canEdit: Boolean(Number(row.can_edit)),
          updatedBy: row.updated_by == null ? null : Number(row.updated_by),
          createdAt: toIso(row.created_at),
          updatedAt: toIso(row.updated_at)
        })),
        memoryModeration: memoryModerationRows.map((row) => ({
          uid: row.uid || "",
          memoryId: row.memory_id || "",
          status: normalizeMemoryStatus(row.status, "pending"),
          reports: Math.max(0, Math.trunc(Number(row.reports) || 0)),
          moderatedBy: row.moderated_by == null ? null : Number(row.moderated_by),
          moderatedAt: toIso(row.moderated_at),
          createdAt: toIso(row.created_at),
          updatedAt: toIso(row.updated_at)
        })),
        ...extraBackupData
      }
    };

    await createAuditLog(
      "backup_export",
      "system",
      "Admin backup exported",
      null,
      {
        exportedBy: Number(req.auth?.userId || 0),
        users: backupPayload.data.users.length,
        places: backupPayload.data.places.length
      }
    );

    return res.status(200).json({
      success: true,
      message: "Backup exported successfully",
      data: backupPayload
    });
  } catch (error) {
    console.error("Backup export error:", error);
    return res.status(500).json({ success: false, message: "Server error while exporting backup" });
  }
});

router.post("/admin/backup/import", requireSuperAdmin, async (req, res) => {
  const source = resolveBackupDataSource(req.body);
  if (!source || typeof source !== "object") {
    return res.status(400).json({
      success: false,
      message: "Invalid backup payload"
    });
  }

  const warnings = [];
  const usersInput = pickArray(source, ["users"]);
  const userProfilesInput = pickArray(source, ["userProfiles", "user_profiles"]);
  const profileStatesInput = pickArray(source, ["profileStates", "profile_states"]);
  const placesInput = pickArray(source, ["places"]);
  const servicesInput = pickArray(source, ["services", "cityServices", "city_services"]);
  const kumbhItemsInput = pickArray(source, ["kumbhItems", "kumbh_items", "kumbhGuide"]);
  const kumbhSettingsInput = source.kumbhSettings || source.kumbh_settings || null;
  const homeSectionsInput = pickArray(source, ["homeSections", "home_sections"]);
  const auditLogsInput = pickArray(source, ["auditLogs", "audit_logs"]);
  const adminPermissionsInput = pickArray(source, ["adminPermissions", "admin_permissions"]);
  const memoryModerationInput = pickArray(source, ["memoryModeration", "memory_moderation"]);
  const memoriesInput = pickArray(source, ["memories"]);
  const extraBackupInputs = {};
  for (const def of BACKUP_EXTRA_TABLES) {
    extraBackupInputs[def.key] = pickArray(source, def.aliases);
  }

  let usersRows = usersInput ? normalizeBackupUsers(usersInput, warnings) : null;
  let userProfilesRows = userProfilesInput ? normalizeBackupUserProfiles(userProfilesInput) : null;
  let profileStatesRows = profileStatesInput ? normalizeBackupProfileStates(profileStatesInput) : null;
  let placesRows = placesInput ? normalizeBackupPlaces(placesInput, warnings) : null;
  let servicesRows = servicesInput ? normalizeBackupServices(servicesInput, warnings) : null;
  let kumbhItemsRows = kumbhItemsInput ? normalizeBackupKumbhItems(kumbhItemsInput, warnings) : null;
  let kumbhSettingsValue = kumbhSettingsInput && typeof kumbhSettingsInput === "object" && !Array.isArray(kumbhSettingsInput)
    ? normalizeKumbhSettingsInput(kumbhSettingsInput, DEFAULT_KUMBH_SETTINGS)
    : null;
  let homeSectionsRows = homeSectionsInput ? normalizeBackupHomeSections(homeSectionsInput) : null;
  let auditLogsRows = auditLogsInput ? normalizeBackupAuditLogs(auditLogsInput, warnings) : null;
  let adminPermissionsRows = adminPermissionsInput
    ? adminPermissionsInput.map((row) => {
        const adminId = Math.trunc(Number(row?.adminId ?? row?.admin_id));
        const permissionKey = normalizePermissionKey(row?.permissionKey ?? row?.permission_key);
        if (!Number.isFinite(adminId) || adminId <= 0 || !ADMIN_PERMISSION_KEYS.has(permissionKey)) return null;
        const updatedByRaw = Number(row?.updatedBy ?? row?.updated_by);
        const canEditRaw = row?.canEdit ?? row?.can_edit;
        return {
          admin_id: adminId,
          permission_key: permissionKey,
          can_edit: (canEditRaw === false || canEditRaw === 0 || String(canEditRaw).trim() === "0") ? 0 : 1,
          updated_by: Number.isFinite(updatedByRaw) && updatedByRaw > 0 ? Math.trunc(updatedByRaw) : null,
          created_at: toSqlDateTime(row?.createdAt ?? row?.created_at),
          updated_at: toSqlDateTime(row?.updatedAt ?? row?.updated_at)
        };
      }).filter(Boolean)
    : null;
  let memoryModerationRows = memoryModerationInput
    ? normalizeBackupMemoryModeration(memoryModerationInput)
    : null;
  const extraBackupRows = {};
  for (const def of BACKUP_EXTRA_TABLES) {
    extraBackupRows[def.key] = extraBackupInputs[def.key]
      ? normalizeBackupExtraRows(def, extraBackupInputs[def.key], warnings)
      : null;
  }

  if (!memoryModerationRows && memoriesInput) {
    memoryModerationRows = normalizeBackupMemoryModerationFromMemories(memoriesInput);
    warnings.push(
      "memoryModeration section was not found; generated moderation records from memories where possible."
    );
  }

  if (source.homePlaces || source.placeAnalytics || source.place_analytics) {
    warnings.push(
      "homePlaces/placeAnalytics were ignored because analytics is now stored inside places."
    );
  }

  usersRows = resolveSectionForImport(usersInput, usersRows, "users", warnings);
  userProfilesRows = resolveSectionForImport(userProfilesInput, userProfilesRows, "userProfiles", warnings);
  profileStatesRows = resolveSectionForImport(profileStatesInput, profileStatesRows, "profileStates", warnings);
  placesRows = resolveSectionForImport(placesInput, placesRows, "places", warnings);
  servicesRows = resolveSectionForImport(servicesInput, servicesRows, "services", warnings);
  kumbhItemsRows = resolveSectionForImport(kumbhItemsInput, kumbhItemsRows, "kumbhItems", warnings);
  homeSectionsRows = resolveSectionForImport(homeSectionsInput, homeSectionsRows, "homeSections", warnings);
  auditLogsRows = resolveSectionForImport(auditLogsInput, auditLogsRows, "auditLogs", warnings);
  adminPermissionsRows = resolveSectionForImport(
    adminPermissionsInput,
    adminPermissionsRows,
    "adminPermissions",
    warnings
  );
  memoryModerationRows = resolveSectionForImport(
    memoryModerationInput ?? memoriesInput,
    memoryModerationRows,
    "memoryModeration",
    warnings
  );

  for (const def of BACKUP_EXTRA_TABLES) {
    extraBackupRows[def.key] = resolveSectionForImport(
      extraBackupInputs[def.key],
      extraBackupRows[def.key],
      def.key,
      warnings
    );
  }
  const hasAnySection = [
    usersRows,
    userProfilesRows,
    profileStatesRows,
    placesRows,
    servicesRows,
    kumbhItemsRows,
    kumbhSettingsValue,
    homeSectionsRows,
    auditLogsRows,
    adminPermissionsRows,
    memoryModerationRows,
    ...Object.values(extraBackupRows)
  ].some((value) => value !== null);

  if (!hasAnySection) {
    return res.status(400).json({
      success: false,
      message: "No importable sections found in backup payload"
    });
  }

  const connection = await pool.getConnection();
  const counts = {};
  try {
    if (homeSectionsRows !== null) await ensureHomeSectionsSchema();
    await connection.beginTransaction();

    for (const key of BACKUP_EXTRA_DELETE_ORDER) {
      if (extraBackupRows[key] !== null) {
        const def = BACKUP_EXTRA_TABLE_MAP.get(key);
        if (def) await connection.query(`DELETE FROM ${def.table}`);
      }
    }
    if (usersRows !== null) {
      await connection.query("DELETE FROM user_profiles");
      await connection.query("DELETE FROM users");
      for (const row of usersRows) {
        await connection.query(
          `
          INSERT INTO users (
            id, full_name, email, password_hash, username, role, phone,
            admin_pin_hash, admin_pin_updated_at, admin_pin_failed_attempts, admin_pin_locked_until,
            account_status, deleted_at, deleted_original_email, deleted_original_username,
            created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, NOW()), COALESCE(?, NOW()))
          `,
          [
            row.id,
            row.full_name,
            row.email,
            row.password_hash,
            row.username,
            row.role,
            row.phone,
            row.admin_pin_hash,
            row.admin_pin_updated_at,
            row.admin_pin_failed_attempts,
            row.admin_pin_locked_until,
            row.account_status,
            row.deleted_at,
            row.deleted_original_email,
            row.deleted_original_username,
            row.created_at,
            row.updated_at
          ]
        );
      }
      counts.users = usersRows.length;
    }

    if (adminPermissionsRows !== null) {
      await connection.query("DELETE FROM admin_permissions");
      for (const row of adminPermissionsRows) {
        await connection.query(
          `INSERT INTO admin_permissions (
             admin_id, permission_key, can_edit, updated_by, created_at, updated_at
           ) VALUES (?, ?, ?, ?, COALESCE(?, NOW()), COALESCE(?, NOW()))`,
          [
            row.admin_id,
            row.permission_key,
            row.can_edit,
            row.updated_by,
            row.created_at,
            row.updated_at
          ]
        );
      }
      counts.adminPermissions = adminPermissionsRows.length;
    }

    if (userProfilesRows !== null) {
      await connection.query("DELETE FROM user_profiles");
      for (const row of userProfilesRows) {
        await connection.query(
          `
          INSERT INTO user_profiles (
            user_id, name, username, bio, location, avatar_url, cover_url,
            settings_json, visited_ids_json, saved_ids_json, activity_json,
            goals_json, interests_json, memories_json, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, NOW()), COALESCE(?, NOW()))
          `,
          [
            row.user_id,
            row.name,
            row.username,
            row.bio,
            row.location,
            row.avatar_url,
            row.cover_url,
            row.settings_json,
            row.visited_ids_json,
            row.saved_ids_json,
            row.activity_json,
            row.goals_json,
            row.interests_json,
            row.memories_json,
            row.created_at,
            row.updated_at
          ]
        );
      }
      counts.userProfiles = userProfilesRows.length;
    }

    if (profileStatesRows !== null) {
      await connection.query("DELETE FROM profile_states");
      for (const row of profileStatesRows) {
        await connection.query(
          `
          INSERT INTO profile_states (
            uid, name, username, bio, location, avatar_url, cover_url,
            settings_json, visited_ids_json, visited_places_json,
            saved_ids_json, saved_places_json, activity_json, goals_json,
            interests_json, memories_json, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, NOW()), COALESCE(?, NOW()))
          `,
          [
            row.uid,
            row.name,
            row.username,
            row.bio,
            row.location,
            row.avatar_url,
            row.cover_url,
            row.settings_json,
            row.visited_ids_json,
            row.visited_places_json,
            row.saved_ids_json,
            row.saved_places_json,
            row.activity_json,
            row.goals_json,
            row.interests_json,
            row.memories_json,
            row.created_at,
            row.updated_at
          ]
        );
      }
      counts.profileStates = profileStatesRows.length;
    }

    if (placesRows !== null) {
      await connection.query("DELETE FROM places");
      for (const row of placesRows) {
        await connection.query(
          `
          INSERT INTO places (
            id, name, city, area, latitude, longitude, entry_fee, category, secondary_category,
            best_time, time_required, image_url, description,
            status, featured, priority, scheduled_at, slug, meta_title,
            meta_description, cover_alt, gallery_json, analytics_json,
            is_deleted, deleted_at, created_at, updated_at
          )
          VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
            COALESCE(?, NOW()), COALESCE(?, NOW())
          )
          `,
          [
            row.id,
            row.name,
            row.city,
            row.area,
            row.latitude,
            row.longitude,
            row.entry_fee,
            row.category,
            row.secondary_category,
            row.best_time,
            row.time_required,
            row.image_url,
            row.description,
            row.status,
            row.featured,
            row.priority,
            row.scheduled_at,
            row.slug,
            row.meta_title,
            row.meta_description,
            row.cover_alt,
            row.gallery_json,
            row.analytics_json,
            row.is_deleted,
            row.deleted_at,
            row.created_at,
            row.updated_at
          ]
        );
      }
      counts.places = placesRows.length;
    }

    if (servicesRows !== null) {
      await connection.query("DELETE FROM city_services");
      for (const row of servicesRows) {
        await connection.query(
          `
          INSERT INTO city_services (
            id, name, city, area, category, description, link, availability_label, status, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, NOW()), COALESCE(?, NOW()))
          `,
          [
            row.id,
            row.name,
            row.city,
            row.area,
            row.category,
            row.description,
            row.link,
            row.availability_label,
            row.status,
            row.created_at,
            row.updated_at
          ]
        );
      }
      counts.services = servicesRows.length;
    }

    if (kumbhItemsRows !== null) {
      await connection.query("DELETE FROM kumbh_items");
      for (const row of kumbhItemsRows) {
        await connection.query(
          `
          INSERT INTO kumbh_items (
            id, item_type, item_key, title, subtitle, description, icon, category,
            status, priority, date_value, meta_json, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, NOW()), COALESCE(?, NOW()))
          `,
          [
            row.id,
            row.item_type,
            row.item_key,
            row.title,
            row.subtitle,
            row.description,
            row.icon,
            row.category,
            row.status,
            row.priority,
            row.date_value,
            row.meta_json,
            row.created_at,
            row.updated_at
          ]
        );
      }
      counts.kumbhItems = kumbhItemsRows.length;
    }

    if (kumbhSettingsValue !== null) {
      await connection.query("DELETE FROM kumbh_settings");
      for (const [key, value] of Object.entries(kumbhSettingsValue)) {
        await connection.query(
          `
          INSERT INTO kumbh_settings (setting_key, setting_value)
          VALUES (?, ?)
          `,
          [key, safeJsonStringify(value, "{}")]
        );
      }
      counts.kumbhSettings = Object.keys(kumbhSettingsValue).length;
    }

    if (homeSectionsRows !== null) {
      await connection.query("DELETE FROM home_sections");
      for (const row of homeSectionsRows) {
        await connection.query(
          `
          INSERT INTO home_sections (
            section_key, label, enabled, display_order, title, subtitle, meta_json, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, NOW()), COALESCE(?, NOW()))
          `,
          [
            row.section_key,
            row.label,
            row.enabled,
            row.display_order,
            row.title,
            row.subtitle,
            row.meta_json,
            row.created_at,
            row.updated_at
          ]
        );
      }
      counts.homeSections = homeSectionsRows.length;
    }

    if (auditLogsRows !== null) {
      await connection.query("DELETE FROM audit_logs");
      for (const row of auditLogsRows) {
        await connection.query(
          `
          INSERT INTO audit_logs (id, action, entity, entity_id, details, meta_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, NOW()))
          `,
          [
            row.id,
            row.action,
            row.entity,
            row.entity_id,
            row.details,
            row.meta_json,
            row.created_at
          ]
        );
      }
      counts.auditLogs = auditLogsRows.length;
    }

    if (memoryModerationRows !== null) {
      await connection.query("DELETE FROM memory_moderation");
      for (const row of memoryModerationRows) {
        await connection.query(
          `
          INSERT INTO memory_moderation (
            uid, memory_id, status, reports, moderated_by, moderated_at, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, NOW()), COALESCE(?, NOW()))
          `,
          [
            row.uid,
            row.memory_id,
            row.status,
            row.reports,
            row.moderated_by,
            row.moderated_at,
            row.created_at,
            row.updated_at
          ]
        );
      }
      counts.memoryModeration = memoryModerationRows.length;
    }

    for (const key of BACKUP_EXTRA_INSERT_ORDER) {
      const rows = extraBackupRows[key];
      if (rows !== null) {
        const def = BACKUP_EXTRA_TABLE_MAP.get(key);
        if (def) counts[key] = await importBackupExtraTable(connection, def, rows);
      }
    }
    await connection.commit();

    await createAuditLog("backup_import", "system", "Admin backup imported", null, {
      importedBy: Number(req.auth?.userId || 0),
      counts,
      warnings
    });

    return res.status(200).json({
      success: true,
      message: "Backup imported successfully",
      counts,
      warnings
    });
  } catch (error) {
    await connection.rollback();
    console.error("Backup import error:", error);
    return res.status(500).json({
      success: false,
      message: error?.code === "ER_NO_REFERENCED_ROW_2"
        ? "Import failed due to invalid user/profile references"
        : "Server error while importing backup"
    });
  } finally {
    connection.release();
  }
});
module.exports = router;
