const express = require("express");
const bcrypt = require("bcryptjs");
const { pool } = require("../config/db");
const { requireAuth, requireAdminAuth } = require("../middleware/auth.middleware");
const { canAdminEdit, requireAdminPermission } = require("../middleware/adminPermissions.middleware");
const { extractBearerToken, signHotelOwnerToken, verifyAuthToken, verifyHotelOwnerToken } = require("../utils/jwt");

const router = express.Router();
const HOTEL_BOOKING_REQUEST_EXPIRY_HOURS = 48;

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function requireHotelPermissionForAdmin(req, res, next) {
  if (req.hotelOwner) return next();
  if (String(req.auth?.role || "").trim().toLowerCase() === "admin") {
    return requireAdminPermission("hotels")(req, res, next);
  }
  return next();
}

function clean(value, max = 255) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function cleanId(value) {
  return clean(value, 80).replace(/[^\w:-]/g, "_") || `H${Date.now()}`;
}

function intValue(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.trunc(n));
}

function moneyValue(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n * 100) / 100);
}

function safeJson(value, fallback = null) {
  try {
    return JSON.stringify(value == null ? fallback : value);
  } catch (error) {
    return JSON.stringify(fallback);
  }
}

function parseJson(value, fallback = null) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch (error) {
    return fallback;
  }
}

function normalizeBookingStatusKey(value, fallback = "requested") {
  const raw = clean(value || fallback, 32).toLowerCase().replace(/-/g, "_");
  return raw || fallback;
}

function bookingStatusLabel(status) {
  const key = normalizeBookingStatusKey(status);
  return key.replace(/_/g, " ");
}

function bookingStatusHistory(meta = {}) {
  return Array.isArray(meta.statusHistory)
    ? meta.statusHistory
      .map((entry) => ({
        status: normalizeBookingStatusKey(entry?.status),
        note: clean(entry?.note, 700),
        actor: clean(entry?.actor || "ExploreX", 160),
        at: Number(entry?.at || Date.now())
      }))
      .filter((entry) => entry.status && Number.isFinite(entry.at))
      .slice(-16)
    : [];
}

function appendBookingStatusHistory(meta = {}, status, note, actor = "ExploreX", at = Date.now()) {
  const nextMeta = meta && typeof meta === "object" ? { ...meta } : {};
  const entry = {
    status: normalizeBookingStatusKey(status),
    note: clean(note || `Booking status changed to ${bookingStatusLabel(status)}.`, 700),
    actor: clean(actor || "ExploreX", 160),
    at: Number(at || Date.now())
  };
  const history = bookingStatusHistory(nextMeta);
  const last = history[history.length - 1];
  if (!last || last.status !== entry.status || last.note !== entry.note) {
    history.push(entry);
  }
  nextMeta.statusHistory = history.slice(-16);
  return nextMeta;
}

function roomDiscountPercent(room = {}) {
  const raw = room.discountPercent
    ?? room.discount_percent
    ?? room.discountPercentage
    ?? room.discount_percentage
    ?? room.discount
    ?? 0;
  const value = Number(raw);
  if (!Number.isFinite(value)) return 0;
  return Math.min(80, Math.max(0, Math.round(value)));
}

function normalizeStoredImageUrl(value) {
  const raw = clean(value, 4096);
  if (!raw || /^data:/i.test(raw)) return "";
  if (/^\/uploads\/images\/[a-zA-Z0-9._-]+$/i.test(raw)) return raw;
  try {
    const url = new URL(raw);
    if (
      ["localhost", "127.0.0.1", "::1"].includes(url.hostname) &&
      /^\/uploads\/images\/[a-zA-Z0-9._-]+$/i.test(url.pathname)
    ) {
      return url.pathname;
    }
    if (!["http:", "https:"].includes(url.protocol)) return "";
    const host = url.hostname.toLowerCase();
    const trustedImageHosts = [
      "images.unsplash.com",
      "images.pexels.com",
      "res.cloudinary.com",
      "lh3.googleusercontent.com",
      "cdn.pixabay.com"
    ];
    const imageLikePath = /\.(jpe?g|png|webp|gif|avif)(?:$|[?#])/i.test(url.pathname + url.search);
    const explicitImageFormat = /(?:format|fm|auto)=?(?:jpg|jpeg|png|webp|gif|avif|format)/i.test(url.search);
    if (trustedImageHosts.some((domain) => host === domain || host.endsWith(`.${domain}`)) || imageLikePath || explicitImageFormat) {
      return raw;
    }
  } catch (error) {
    return "";
  }
  return "";
}

function normalizeOwnerStateRooms(rooms = []) {
  if (!Array.isArray(rooms)) return [];
  return rooms
    .filter((room) => room && typeof room === "object")
    .map((room) => {
      const { duplicateNumbers, _duplicateNumbers, ...cleanRoom } = room;
      return {
        ...cleanRoom,
        discountPercent: roomDiscountPercent(room),
        photo: normalizeStoredImageUrl(room.photo)
      };
    });
}

const ROOM_BLOCK_REASONS = new Set(["offline", "maintenance", "owner_hold", "cleaning", "other"]);

function normalizeRoomBlockDate(value) {
  const raw = clean(value, 32);
  if (!raw) return "";
  const time = bookingStayDateValue(raw);
  if (!time) return "";
  const date = new Date(time);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function normalizeRoomBlockReason(value) {
  const reason = clean(value || "offline", 40).toLowerCase().replace(/[\s-]+/g, "_");
  return ROOM_BLOCK_REASONS.has(reason) ? reason : "other";
}

function normalizeRoomBlockStatus(value) {
  const status = clean(value || "active", 32).toLowerCase().replace(/[\s-]+/g, "_");
  return ["active", "cancelled", "deleted"].includes(status) ? status : "active";
}

function normalizeOwnerRoomBlock(block = {}, index = 0, options = {}) {
  if (!block || typeof block !== "object") return null;
  const startDate = normalizeRoomBlockDate(block.startDate || block.start_date || block.checkin);
  const endDate = normalizeRoomBlockDate(block.endDate || block.end_date || block.checkout);
  if (!startDate || !endDate || bookingStayDateValue(endDate) <= bookingStayDateValue(startDate)) return null;
  const roomKey = bookingRoomKeyValue({
    roomKey: block.roomKey || block.room_key,
    roomName: block.roomName || block.room_name
  });
  if (!roomKey) return null;
  const roomNumbers = ownerRoomNumbers(block.roomNumbers || block.room_numbers || []);
  const roomsBlocked = Math.max(1, intValue(block.roomsBlocked ?? block.rooms_blocked ?? roomNumbers.length, 1));
  const normalized = {
    id: cleanId(block.id || block.blockId || `RB${Date.now()}_${index}`),
    roomKey,
    roomName: clean(block.roomName || block.room_name || roomKey.replace(/_/g, " "), 160),
    roomsBlocked,
    startDate,
    endDate,
    reason: normalizeRoomBlockReason(block.reason),
    status: normalizeRoomBlockStatus(block.status),
    createdAt: Number(block.createdAt || block.created_at || Date.now()),
    updatedAt: Number(block.updatedAt || block.updated_at || Date.now())
  };
  if (!options.publicView) {
    normalized.roomNumbers = roomNumbers;
    normalized.note = clean(block.note, 700);
  }
  return normalized;
}

function normalizeRoomBlocks(blocks = [], options = {}) {
  if (!Array.isArray(blocks)) return [];
  return blocks
    .map((block, index) => normalizeOwnerRoomBlock(block, index, options))
    .filter(Boolean)
    .filter((block) => !options.publicView || roomBlockIsActive(block))
    .slice(0, 300);
}

function normalizeOwnerSettings(settings = {}) {
  const cleanSettings = settings && typeof settings === "object" ? { ...settings } : {};
  cleanSettings.roomBlocks = normalizeRoomBlocks(cleanSettings.roomBlocks || cleanSettings.room_blocks || []);
  delete cleanSettings.room_blocks;
  return cleanSettings;
}

function roomBlockMergeKey(block = {}) {
  return clean(block.id, 80) || [
    bookingRoomKeyValue({ roomKey: block.roomKey, roomName: block.roomName }),
    normalizeRoomBlockDate(block.startDate),
    normalizeRoomBlockDate(block.endDate),
    normalizeRoomBlockReason(block.reason)
  ].join("|");
}

function mergeRoomBlocksPreservingPrivate(existingBlocks = [], incomingBlocks = []) {
  const existing = normalizeRoomBlocks(existingBlocks);
  const byKey = new Map(existing.map((block) => [roomBlockMergeKey(block), block]));
  return normalizeRoomBlocks(incomingBlocks).map((block) => {
    const current = byKey.get(roomBlockMergeKey(block));
    if ((!block.roomNumbers || !block.roomNumbers.length) && current?.roomNumbers?.length) {
      return {
        ...block,
        roomNumbers: current.roomNumbers,
        roomsBlocked: Math.max(intValue(block.roomsBlocked, 1), current.roomNumbers.length)
      };
    }
    return block;
  });
}

function roomBlockIsActive(block = {}) {
  if (normalizeRoomBlockStatus(block.status) !== "active") return false;
  const endDateValue = bookingStayDateValue(block.endDate || block.end_date || block.checkout);
  if (!endDateValue) return true;
  const todayValue = bookingStayDateValue(new Date().toISOString().slice(0, 10));
  return endDateValue >= todayValue;
}

function rowTime(value) {
  if (!value) return 0;
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isFinite(time) ? time : 0;
}

function assignedRoomNumbersFromBody(body = {}) {
  const value = Array.isArray(body.assignedRoomNumbers)
    ? body.assignedRoomNumbers
    : (Array.isArray(body.assigned_room_numbers) ? body.assigned_room_numbers : null);
  const list = value || String(body.assignedRoomNo || body.assigned_room_no || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return [...new Set(list.map(String).map((item) => item.trim()).filter(Boolean))];
}

function bookingFromBody(body = {}) {
  const meta = body.meta && typeof body.meta === "object" ? { ...body.meta } : {};
  if ((body.email || body.userEmail || body.user_email) && !meta.userEmail) {
    meta.userEmail = clean(body.email || body.userEmail || body.user_email, 190);
  }
  if ((body.phone || body.userPhone || body.user_phone) && !meta.userPhone) {
    meta.userPhone = clean(body.phone || body.userPhone || body.user_phone, 80);
  }
  if (Object.prototype.hasOwnProperty.call(body, "ownerLinked") && !Object.prototype.hasOwnProperty.call(meta, "ownerLinked")) {
    meta.ownerLinked = Boolean(body.ownerLinked);
  }
  const subtotal = moneyValue(body.subtotal);
  const taxes = moneyValue(body.taxes);
  const total = moneyValue(body.total);
  const commissionRate = Number.isFinite(Number(body.commissionRate ?? body.commission_rate ?? meta.commissionRate))
    ? Math.max(0, Number(body.commissionRate ?? body.commission_rate ?? meta.commissionRate))
    : 8;
  const platformFee = moneyValue(body.platformFee ?? body.platform_fee ?? meta.platformFee);
  const postedCommission = moneyValue(body.commissionAmount ?? body.commission_amount ?? meta.commissionAmount);
  const commissionAmount = postedCommission || moneyValue((subtotal * commissionRate / 100) + platformFee);
  const postedHotelPayout = moneyValue(body.hotelPayout ?? body.hotel_payout ?? meta.hotelPayout);
  const hotelPayout = postedHotelPayout || moneyValue(Math.max(0, total - commissionAmount));
  return {
    id: cleanId(body.id),
    userUid: clean(body.userUid || body.user_uid, 120),
    userName: clean(body.userName || body.user_name || "Traveller", 160),
    hotelId: clean(body.hotelId || body.hotel_id, 120),
    ownerHotelId: clean(body.ownerHotelId || body.owner_hotel_id || body.hotelId || body.hotel_id, 120),
    hotelPlaceId: clean(body.hotelPlaceId || body.hotel_place_id || body.placeId || body.place_id, 120),
    hotelName: clean(body.hotelName || body.hotel_name || "Hotel", 190),
    placeName: clean(body.placeName || body.place_name || body.hotelName || body.hotel_name || "Hotel", 190),
    city: clean(body.city, 120),
    roomKey: clean(body.roomKey || body.room_key, 80),
    roomName: clean(body.roomName || body.room_name || "Room", 160),
    checkin: clean(body.checkin, 32),
    checkout: clean(body.checkout, 32),
    guests: intValue(body.guests, 1) || 1,
    rooms: intValue(body.rooms, 1) || 1,
    nights: intValue(body.nights, 1) || 1,
    subtotal,
    taxes,
    total,
    commissionRate,
    platformFee,
    commissionAmount,
    hotelPayout,
    payoutStatus: clean(body.payoutStatus || body.payout_status || "pending", 32).toLowerCase() || "pending",
    status: clean(body.status || "requested", 32).toLowerCase() || "requested",
    assignedRoomNumbers: assignedRoomNumbersFromBody(body),
    meta
  };
}

function enquiryFromBody(body = {}) {
  const meta = body.meta && typeof body.meta === "object" ? { ...body.meta } : {};
  if (Object.prototype.hasOwnProperty.call(body, "ownerLinked") && !Object.prototype.hasOwnProperty.call(meta, "ownerLinked")) {
    meta.ownerLinked = Boolean(body.ownerLinked);
  }
  return {
    id: cleanId(body.id),
    userUid: clean(body.userUid || body.user_uid, 120),
    userName: clean(body.userName || body.user_name || "Traveller", 160),
    phone: clean(body.phone, 80),
    email: clean(body.email, 190),
    topic: clean(body.topic || "Room availability", 160),
    message: clean(body.message, 2000),
    replyNote: clean(body.replyNote || body.reply_note, 2000),
    hotelId: clean(body.hotelId || body.hotel_id, 120),
    ownerHotelId: clean(body.ownerHotelId || body.owner_hotel_id || body.hotelId || body.hotel_id, 120),
    hotelPlaceId: clean(body.hotelPlaceId || body.hotel_place_id || body.placeId || body.place_id, 120),
    hotelName: clean(body.hotelName || body.hotel_name || "Hotel", 190),
    placeName: clean(body.placeName || body.place_name || body.hotelName || body.hotel_name || "Hotel", 190),
    city: clean(body.city, 120),
    roomKey: clean(body.roomKey || body.room_key, 80),
    roomName: clean(body.roomName || body.room_name || "Room", 160),
    checkin: clean(body.checkin, 32),
    checkout: clean(body.checkout, 32),
    guests: intValue(body.guests, 1) || 1,
    rooms: intValue(body.rooms, 1) || 1,
    status: clean(body.status || "new", 32).toLowerCase() || "new",
    meta
  };
}

function mapBooking(row) {
  const meta = parseJson(row.meta_json, {});
  return {
    id: row.id,
    userUid: row.user_uid || "",
    userName: row.user_name || "Traveller",
    hotelId: row.hotel_id || "",
    ownerHotelId: row.owner_hotel_id || "",
    hotelPlaceId: row.hotel_place_id || "",
    hotelName: row.hotel_name || "Hotel",
    placeName: row.place_name || row.hotel_name || "Hotel",
    city: row.city || "",
    roomKey: row.room_key || "",
    roomName: row.room_name || "Room",
    checkin: row.checkin || "",
    checkout: row.checkout || "",
    guests: Number(row.guests || 1),
    rooms: Number(row.rooms || 1),
    nights: Number(row.nights || 1),
    subtotal: Number(row.subtotal || 0),
    taxes: Number(row.taxes || 0),
    total: Number(row.total || 0),
    commissionRate: Number(row.commission_rate || 0),
    platformFee: Number(row.platform_fee || 0),
    commissionAmount: Number(row.commission_amount || 0),
    hotelPayout: Number(row.hotel_payout || 0),
    payoutStatus: row.payout_status || "pending",
    status: row.status || "requested",
    assignedRoomNumbers: parseJson(row.assigned_room_numbers_json, []),
    ownerLinked: Boolean(meta.ownerLinked),
    meta,
    createdAt: rowTime(row.created_at),
    updatedAt: rowTime(row.updated_at)
  };
}

function sanitizeBookingForTraveller(booking = {}) {
  const meta = booking.meta && typeof booking.meta === "object" ? { ...booking.meta } : {};
  delete meta.ownerPrivateNote;
  delete meta.ownerInternalNote;
  delete meta.ownerCallLog;
  return { ...booking, meta };
}

function mapEnquiry(row) {
  const meta = parseJson(row.meta_json, {});
  return {
    id: row.id,
    userUid: row.user_uid || "",
    userName: row.user_name || "Traveller",
    phone: row.phone || "",
    email: row.email || "",
    topic: row.topic || "Room availability",
    message: row.message || "",
    replyNote: row.reply_note || "",
    hotelId: row.hotel_id || "",
    ownerHotelId: row.owner_hotel_id || "",
    hotelPlaceId: row.hotel_place_id || "",
    hotelName: row.hotel_name || "Hotel",
    placeName: row.place_name || row.hotel_name || "Hotel",
    city: row.city || "",
    roomKey: row.room_key || "",
    roomName: row.room_name || "Room",
    checkin: row.checkin || "",
    checkout: row.checkout || "",
    guests: Number(row.guests || 1),
    rooms: Number(row.rooms || 1),
    status: row.status || "new",
    ownerLinked: Boolean(meta.ownerLinked),
    meta,
    createdAt: rowTime(row.created_at),
    updatedAt: rowTime(row.updated_at)
  };
}

async function hotelReadWhere(req) {
  const hotelId = clean(req.query.hotelId || req.query.ownerHotelId, 120);
  const placeId = clean(req.query.placeId || req.query.hotelPlaceId, 120);
  const userUid = clean(req.query.userUid || req.query.userId || req.query.uid, 120);
  const values = [];
  const filterClauses = [];
  if (hotelId) {
    filterClauses.push("(owner_hotel_id = ? OR hotel_id = ?)");
    values.push(hotelId, hotelId);
  }
  if (placeId) {
    filterClauses.push("hotel_place_id = ?");
    values.push(placeId);
  }
  if (userUid) {
    filterClauses.push("user_uid = ?");
    values.push(userUid);
  }
  const owner = await resolveOptionalHotelOwner(req);
  const auth = await resolveOptionalAuthIdentity(req);
  const visibleClause = "LOWER(COALESCE(status, '')) <> 'deleted'";
  const allClauses = [visibleClause];
  if (filterClauses.length) {
    allClauses.push(`(${filterClauses.join(" OR ")})`);
  }
  if (owner) {
    allClauses.push("(owner_hotel_id = ? OR hotel_id = ?)");
    values.push(owner.hotelId, owner.hotelId);
  } else if (auth?.isAdmin) {
    // Admin dashboard can inspect all hotel rows.
  } else if (userUid && auth?.uid && userUid === auth.uid) {
    // Traveller can fetch only their own hotel updates.
  } else {
    allClauses.push("1 = 0");
  }
  return {
    where: `WHERE ${allClauses.join(" AND ")}`,
    values,
    userUidOnly: Boolean(userUid && !hotelId && !placeId && !owner && !auth?.isAdmin)
  };
}

function ownerStateFromBody(body = {}, id = "") {
  const hotelId = normalizeHotelOwnerId(id || body.hotelId || body.hotel_id);
  return {
    hotelId,
    hotelName: clean(body.hotelName || body.hotel_name || body.name || "Hotel", 190),
    profile: body.profile && typeof body.profile === "object" ? body.profile : {},
    rooms: normalizeOwnerStateRooms(body.rooms),
    settings: normalizeOwnerSettings(body.settings)
  };
}

function mapOwnerState(row) {
  return {
    hotelId: row.hotel_id || "",
    hotelName: row.hotel_name || "Hotel",
    profile: parseJson(row.profile_json, {}),
    rooms: normalizeOwnerStateRooms(parseJson(row.rooms_json, [])),
    settings: normalizeOwnerSettings(parseJson(row.settings_json, {})),
    createdAt: rowTime(row.created_at),
    updatedAt: rowTime(row.updated_at)
  };
}

function mapPublicOwnerState(row) {
  const state = mapOwnerState(row);
  const profile = state.profile && typeof state.profile === "object" ? state.profile : {};
  const settings = state.settings && typeof state.settings === "object" ? state.settings : {};
  return {
    hotelId: state.hotelId,
    hotelName: state.hotelName,
    profile: {
      name: clean(profile.name || state.hotelName, 190),
      city: clean(profile.city, 120),
      area: clean(profile.area, 160),
      facilities: Array.isArray(profile.facilities) ? profile.facilities.slice(0, 30) : [],
      checkin: clean(profile.checkin || settings.checkin, 80),
      checkout: clean(profile.checkout || settings.checkout, 80)
    },
    rooms: state.rooms.map((room, index) => ({
      key: clean(room.key || `room_${index + 1}`, 80),
      name: clean(room.name || "Room", 160),
      price: moneyValue(room.price ?? room.basePrice),
      basePrice: moneyValue(room.basePrice ?? room.price),
      weekendPrice: moneyValue(room.weekendPrice ?? room.price),
      extraGuestCharge: moneyValue(room.extraGuestCharge ?? room.extra_guest_charge),
      discountPercent: roomDiscountPercent(room),
      maxGuests: Math.max(1, intValue(room.maxGuests ?? room.max_guests, 2)),
      minNights: Math.max(1, intValue(room.minNights ?? room.min_nights, 1)),
      available: intValue(room.available, 0),
      status: clean(room.status || (room.soldOut ? "sold_out" : "available"), 32),
      soldOut: Boolean(room.soldOut),
      photo: normalizeStoredImageUrl(room.photo),
      amenities: Array.isArray(room.amenities)
        ? room.amenities.map((item) => clean(item, 80)).filter(Boolean).slice(0, 30)
        : []
    })),
    settings: {
      taxRate: moneyValue(settings.taxRate ?? settings.tax_rate ?? 0),
      extraGuestCharge: moneyValue(settings.extraGuestCharge ?? settings.extra_guest_charge ?? 0),
      weekendMarkup: moneyValue(settings.weekendMarkup ?? settings.weekend_markup ?? 0),
      advanceDiscount: moneyValue(settings.advanceDiscount ?? settings.advance_discount ?? 0),
      cancelPolicy: clean(settings.cancelPolicy || settings.policy, 700),
      houseRules: clean(settings.houseRules, 700),
      paymentNote: clean(settings.paymentNote, 700),
      checkin: clean(settings.checkin, 80),
      checkout: clean(settings.checkout, 80),
      roomBlocks: normalizeRoomBlocks(settings.roomBlocks, { publicView: true }),
      updatedAt: Number(settings.updatedAt || state.updatedAt || Date.now())
    },
    updatedAt: state.updatedAt
  };
}

function ownerLoginFromBody(body = {}, fallbackHotelId = "") {
  return {
    hotelId: clean(fallbackHotelId || body.hotelId || body.hotel_id, 120).toUpperCase(),
    hotelName: clean(body.hotelName || body.hotel_name || "Hotel", 190) || "Hotel",
    password: clean(body.password, 160),
    placeId: clean(body.placeId || body.place_id, 120),
    hotelPlaceId: clean(body.hotelPlaceId || body.hotel_place_id || body.placeId || body.place_id, 120),
    city: clean(body.city, 120),
    area: clean(body.area, 160),
    status: clean(body.status || "active", 24).toLowerCase() || "active"
  };
}

function mapOwnerLogin(row) {
  return {
    hotelId: row.hotel_id || "",
    hotelName: row.hotel_name || "Hotel",
    placeId: row.place_id || "",
    hotelPlaceId: row.hotel_place_id || row.place_id || "",
    city: row.city || "",
    area: row.area || "",
    status: row.status || "active",
    lastLoginAt: rowTime(row.last_login_at),
    createdAt: rowTime(row.created_at),
    updatedAt: rowTime(row.updated_at)
  };
}

function normalizeHotelOwnerId(value) {
  return clean(value, 120).toUpperCase();
}

function userUidFromAuthToken(token) {
  const decoded = verifyAuthToken(token);
  const uid = clean(decoded?.uid || decoded?.sub, 120);
  if (uid) return uid;
  const userId = Number(decoded?.userId);
  return Number.isFinite(userId) && userId > 0 ? `user_${userId}` : "";
}

function authUserIdFromDecoded(decoded = {}) {
  const numeric = Number(decoded?.userId);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const match = String(decoded?.uid || decoded?.sub || "").match(/^user_(\d+)$/i);
  return match ? Number(match[1]) : 0;
}

async function resolveOptionalAuthIdentity(req) {
  const token = extractBearerToken(req.headers.authorization);
  if (!token) return null;
  try {
    const decoded = verifyAuthToken(token);
    const userId = authUserIdFromDecoded(decoded);
    if (!userId) return null;
    const [rows] = await pool.query(
      "SELECT id, email, role, account_status, deleted_at FROM users WHERE id = ? LIMIT 1",
      [userId]
    );
    const user = rows[0];
    if (!user || user.deleted_at || String(user.account_status || "active").toLowerCase() !== "active") {
      return null;
    }
    const role = String(user.role || decoded.role || "Traveller").trim().toLowerCase();
    return {
      userId,
      uid: clean(decoded.uid || decoded.sub || `user_${userId}`, 120),
      email: clean(user.email || decoded.email, 190).toLowerCase(),
      role,
      isAdmin: role === "admin"
    };
  } catch (error) {
    return null;
  }
}

async function resolveOptionalHotelOwner(req) {
  try {
    return await resolveHotelOwnerFromRequest(req);
  } catch (error) {
    return null;
  }
}

async function resolveHotelOwnerFromRequest(req) {
  const token = extractBearerToken(req.headers.authorization);
  if (!token) return null;
  const decoded = verifyHotelOwnerToken(token);
  const hotelId = normalizeHotelOwnerId(decoded.hotelId);
  if (!hotelId) return null;
  const [rows] = await pool.query(
    `SELECT hotel_id, hotel_name, place_id, hotel_place_id, city, area, status, last_login_at, created_at, updated_at
     FROM hotel_owner_logins
     WHERE hotel_id = ? AND status = 'active'
     LIMIT 1`,
    [hotelId]
  );
  return rows[0] ? mapOwnerLogin(rows[0]) : null;
}

function hotelOwnerCanAccessItem(owner = {}, item = {}) {
  const ownerId = normalizeHotelOwnerId(owner.hotelId);
  if (!ownerId) return false;
  return [item.ownerHotelId, item.hotelId, item.owner_hotel_id, item.hotel_id]
    .map(normalizeHotelOwnerId)
    .some((value) => value && value === ownerId);
}

function bindHotelItemToAuthUser(item = {}, auth = {}) {
  const authUid = clean(auth.uid || (auth.userId ? `user_${auth.userId}` : ""), 120);
  if (authUid) item.userUid = authUid;
  item.meta = item.meta && typeof item.meta === "object" ? { ...item.meta } : {};
  if (auth.userId) item.meta.authUserId = Number(auth.userId);
  if (auth.email) {
    item.meta.accountEmail = clean(auth.email, 190).toLowerCase();
    if (!item.meta.userEmail) item.meta.userEmail = item.meta.accountEmail;
    if (Object.prototype.hasOwnProperty.call(item, "email") && !item.email) {
      item.email = item.meta.accountEmail;
    }
  }
  return item;
}

async function hotelItemIdBelongsToOtherUser(tableName, item = {}) {
  const safeTables = new Set(["hotel_bookings", "hotel_enquiries"]);
  if (!safeTables.has(tableName) || !item.id) return false;
  const [rows] = await pool.query(
    `SELECT user_uid FROM ${tableName} WHERE id = ? LIMIT 1`,
    [item.id]
  );
  const existingUid = clean(rows?.[0]?.user_uid, 120);
  return Boolean(existingUid && item.userUid && existingUid !== item.userUid);
}

function requireHotelOwnerOrAdmin(req, res, next) {
  return Promise.resolve(resolveHotelOwnerFromRequest(req))
    .then((owner) => {
      if (owner) {
        req.hotelOwner = owner;
        return next();
      }
      return requireAdminAuth(req, res, next);
    })
    .catch(() => requireAdminAuth(req, res, next));
}

function ensureHotelOwnerCanAccess(req, res, item = {}) {
  if (!req.hotelOwner) return true;
  if (hotelOwnerCanAccessItem(req.hotelOwner, item)) return true;
  res.status(403).json({
    success: false,
    message: "Forbidden: this hotel owner cannot modify another hotel's data"
  });
  return false;
}

async function findActiveOwnerLoginForItem(item = {}) {
  const values = [];
  const clauses = [];
  if (item.ownerHotelId) {
    clauses.push("hotel_id = ?");
    values.push(item.ownerHotelId);
  }
  if (item.hotelId && item.hotelId !== item.ownerHotelId) {
    clauses.push("hotel_id = ?");
    values.push(item.hotelId);
  }
  if (item.hotelPlaceId) {
    clauses.push("(hotel_place_id = ? OR place_id = ?)");
    values.push(item.hotelPlaceId, item.hotelPlaceId);
  }
  if (!clauses.length) return null;
  const [rows] = await pool.query(
    `
    SELECT hotel_id, hotel_name, place_id, hotel_place_id, city, area, status
    FROM hotel_owner_logins
    WHERE status = 'active' AND (${clauses.join(" OR ")})
    LIMIT 1
    `,
    values
  );
  return rows[0] || null;
}

function applyOwnerLoginToItem(item, login) {
  if (!login) return item;
  item.ownerHotelId = login.hotel_id || item.ownerHotelId || item.hotelId;
  item.hotelId = login.hotel_id || item.hotelId || item.ownerHotelId;
  item.hotelName = login.hotel_name || item.hotelName;
  item.hotelPlaceId = login.hotel_place_id || login.place_id || item.hotelPlaceId;
  item.city = login.city || item.city;
  item.area = login.area || item.area;
  item.meta = item.meta && typeof item.meta === "object" ? item.meta : {};
  item.meta.ownerLinked = true;
  return item;
}

function bookingStayDateValue(value) {
  const raw = clean(value, 64);
  if (!raw) return 0;
  const time = Date.parse(raw.length <= 10 ? `${raw}T00:00:00` : raw);
  return Number.isFinite(time) ? time : 0;
}

function bookingStayDatesOverlap(a = {}, b = {}) {
  const aStart = bookingStayDateValue(a.checkin);
  const aEnd = bookingStayDateValue(a.checkout) || aStart;
  const bStart = bookingStayDateValue(b.checkin || b.check_in);
  const bEnd = bookingStayDateValue(b.checkout || b.check_out) || bStart;
  if (!aStart || !aEnd || !bStart || !bEnd) return true;
  return aStart < bEnd && bStart < aEnd;
}

function bookingRoomKeyValue(row = {}) {
  const raw = clean(row.roomKey || row.room_key || row.roomName || row.room_name, 160).toLowerCase();
  if (raw.includes("family")) return "family";
  if (raw.includes("deluxe")) return "deluxe";
  if (raw.includes("standard")) return "standard";
  return raw.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "standard";
}

function assignedRoomsFromRow(row = {}) {
  if (Array.isArray(row.assignedRoomNumbers)) return row.assignedRoomNumbers.map(String).filter(Boolean);
  if (Array.isArray(row.assigned_room_numbers)) return row.assigned_room_numbers.map(String).filter(Boolean);
  return parseJson(row.assigned_room_numbers_json, []);
}

function ownerRoomNumbers(room = {}) {
  const raw = Array.isArray(room.roomNumbers)
    ? room.roomNumbers
    : (Array.isArray(room.room_numbers) ? room.room_numbers : String(room.roomNumbers || room.room_numbers || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean));
  const expanded = [];
  raw.map(String).map((value) => value.trim()).filter(Boolean).forEach((part) => {
    const match = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (match) {
      const start = Number(match[1]);
      const end = Number(match[2]);
      if (Number.isFinite(start) && Number.isFinite(end) && end >= start && end - start <= 80) {
        for (let no = start; no <= end; no += 1) expanded.push(String(no));
        return;
      }
    }
    expanded.push(part);
  });
  return [...new Set(expanded)];
}

function ownerRoomStatusKey(room = {}) {
  return clean(room.status || (room.soldOut ? "sold_out" : "available"), 32).toLowerCase().replace(/-/g, "_");
}

function ownerRoomCapacity(room = {}) {
  const status = ownerRoomStatusKey(room);
  if (status === "maintenance" || status === "sold_out" || room.soldOut) return 0;
  const numbers = ownerRoomNumbers(room);
  const hasAvailable = room.available !== undefined && room.available !== null && String(room.available) !== "";
  const available = hasAvailable ? intValue(room.available, 0) : (numbers.length || 0);
  return numbers.length ? Math.min(available, numbers.length) : available;
}

function ownerRoomMatchesBooking(room = {}, item = {}) {
  const targetKey = bookingRoomKeyValue(item);
  const roomKey = bookingRoomKeyValue({ roomKey: room.key, roomName: room.name });
  const directRoomKey = clean(room.key, 80).toLowerCase();
  const itemRoomKey = clean(item.roomKey || item.room_key, 80).toLowerCase();
  if (directRoomKey && itemRoomKey && directRoomKey === itemRoomKey) return true;
  return Boolean(targetKey && roomKey && targetKey === roomKey);
}

async function getOwnerStateForBooking(item = {}) {
  const hotelIds = [...new Set([item.ownerHotelId, item.hotelId].map((value) => clean(value, 120)).filter(Boolean))];
  if (!hotelIds.length) return { rooms: [], settings: {} };
  const placeholders = hotelIds.map(() => "?").join(", ");
  const [rows] = await pool.query(
    `SELECT rooms_json, settings_json FROM hotel_owner_states WHERE hotel_id IN (${placeholders}) ORDER BY updated_at DESC LIMIT 1`,
    hotelIds
  );
  return {
    rooms: normalizeOwnerStateRooms(parseJson(rows?.[0]?.rooms_json, [])),
    settings: normalizeOwnerSettings(parseJson(rows?.[0]?.settings_json, {}))
  };
}

async function getOwnerStateRoomForBooking(item = {}) {
  const state = await getOwnerStateForBooking(item);
  return state.rooms.find((room) => ownerRoomMatchesBooking(room, item)) || null;
}

function roomBlockMatchesBooking(block = {}, item = {}) {
  if (!roomBlockIsActive(block)) return false;
  if (bookingRoomKeyValue({ roomKey: block.roomKey, roomName: block.roomName }) !== bookingRoomKeyValue(item)) return false;
  return bookingStayDatesOverlap(item, { checkin: block.startDate, checkout: block.endDate });
}

async function countOverlappingRoomBlocks(item = {}, ownerState = null) {
  const state = ownerState || await getOwnerStateForBooking(item);
  return normalizeRoomBlocks(state.settings?.roomBlocks || []).reduce((sum, block) => {
    if (!roomBlockMatchesBooking(block, item)) return sum;
    return sum + Math.max(1, intValue(block.roomsBlocked, 1));
  }, 0);
}

async function countOverlappingRoomRequests(item = {}, currentId = "") {
  const clauses = [];
  const values = [currentId];
  if (item.ownerHotelId) {
    clauses.push("owner_hotel_id = ?");
    values.push(item.ownerHotelId);
  }
  if (item.hotelId && item.hotelId !== item.ownerHotelId) {
    clauses.push("hotel_id = ?");
    values.push(item.hotelId);
  }
  if (item.hotelPlaceId) {
    clauses.push("hotel_place_id = ?");
    values.push(item.hotelPlaceId);
  }
  if (!clauses.length) return 0;
  const [rows] = await pool.query(
    `
    SELECT id, room_key, room_name, checkin, checkout, rooms
    FROM hotel_bookings
    WHERE id <> ?
      AND LOWER(COALESCE(status, 'requested')) IN ('requested', 'accepted', 'checked_in')
      AND NOT (
        LOWER(COALESCE(status, 'requested')) = 'requested'
        AND created_at < (NOW() - INTERVAL ${HOTEL_BOOKING_REQUEST_EXPIRY_HOURS} HOUR)
      )
      AND (${clauses.join(" OR ")})
    LIMIT 300
    `,
    values
  );
  const targetKey = bookingRoomKeyValue(item);
  return rows.reduce((sum, row) => {
    if (bookingRoomKeyValue(row) !== targetKey) return sum;
    if (!bookingStayDatesOverlap(item, row)) return sum;
    return sum + Math.max(1, Number(row.rooms || 1));
  }, 0);
}

async function getDateWiseRoomAvailability(item = {}) {
  const ownerState = await getOwnerStateForBooking(item);
  const ownerRoom = ownerState.rooms.find((room) => ownerRoomMatchesBooking(room, item)) || null;
  const requestedRooms = Math.max(1, Number(item.rooms || 1));
  const roomLabel = clean(ownerRoom?.name || item.roomName || "selected room", 160);
  if (!ownerRoom) {
    return {
      available: true,
      enforced: false,
      reason: "owner_room_not_configured",
      message: `${roomLabel} availability will be confirmed by the hotel owner.`,
      roomKey: bookingRoomKeyValue(item),
      roomName: roomLabel,
      requestedRooms,
      remainingRooms: null,
      capacity: null,
      bookedRooms: 0,
      blockedRooms: 0
    };
  }
  const capacity = ownerRoomCapacity(ownerRoom);
  if (capacity <= 0) {
    return {
      available: false,
      enforced: true,
      reason: "room_unavailable",
      message: `${roomLabel} is currently sold out or unavailable for booking.`,
      roomKey: clean(ownerRoom.key || item.roomKey, 80) || bookingRoomKeyValue(item),
      roomName: roomLabel,
      requestedRooms,
      remainingRooms: 0,
      capacity,
      bookedRooms: 0,
      blockedRooms: 0
    };
  }
  const alreadyRequested = await countOverlappingRoomRequests(item, item.id);
  const blockedByOwner = await countOverlappingRoomBlocks(item, ownerState);
  const remaining = Math.max(0, capacity - alreadyRequested - blockedByOwner);
  const available = requestedRooms <= remaining;
  const message = available
    ? `${remaining} ${roomLabel} room${remaining === 1 ? "" : "s"} available for selected dates.`
    : (remaining > 0
      ? `Only ${remaining} ${roomLabel} room${remaining === 1 ? "" : "s"} available for selected dates.`
      : `${roomLabel} is fully booked for selected dates. Please choose another date or room type.`);
  return {
    available,
    enforced: true,
    reason: available ? "available" : "insufficient_rooms",
    message,
    roomKey: clean(ownerRoom.key || item.roomKey, 80) || bookingRoomKeyValue(item),
    roomName: roomLabel,
    requestedRooms,
    remainingRooms: remaining,
    capacity,
    bookedRooms: alreadyRequested,
    blockedRooms: blockedByOwner
  };
}

async function validateDateWiseRoomAvailability(item = {}) {
  const availability = await getDateWiseRoomAvailability(item);
  if (!availability || availability.available) return null;
  return availability.message;
}

async function validateHotelBookingBasics(item = {}) {
  if (!item.hotelName && !item.hotelId) {
    return "Hotel details are required";
  }
  const checkinTime = bookingStayDateValue(item.checkin);
  const checkoutTime = bookingStayDateValue(item.checkout);
  if (!checkinTime || !checkoutTime) {
    return "Check-in and check-out dates are required";
  }
  if (checkoutTime <= checkinTime) {
    return "Check-out date must be after check-in";
  }
  return "";
}

async function getBookingById(id) {
  const [rows] = await pool.query("SELECT * FROM hotel_bookings WHERE id = ? LIMIT 1", [id]);
  return rows[0] ? mapBooking(rows[0]) : null;
}

async function expireOldRequestedHotelBookings() {
  const [rows] = await pool.query(
    `
    SELECT *
    FROM hotel_bookings
    WHERE LOWER(COALESCE(status, 'requested')) = 'requested'
      AND created_at < (NOW() - INTERVAL ${HOTEL_BOOKING_REQUEST_EXPIRY_HOURS} HOUR)
    LIMIT 100
    `
  );
  if (!rows.length) return 0;

  for (const row of rows) {
    const booking = mapBooking(row);
    const baseMeta = {
      ...(booking.meta || {}),
      ownerStatusNote: `Booking request expired because hotel owner did not respond within ${HOTEL_BOOKING_REQUEST_EXPIRY_HOURS} hours.`,
      ownerStatusLabel: "expired",
      expiredAt: Date.now(),
      expiryHours: HOTEL_BOOKING_REQUEST_EXPIRY_HOURS
    };
    const meta = appendBookingStatusHistory(
      baseMeta,
      "expired",
      baseMeta.ownerStatusNote,
      "ExploreX system",
      baseMeta.expiredAt
    );
    await pool.query(
      "UPDATE hotel_bookings SET status = 'expired', assigned_room_numbers_json = '[]', meta_json = ?, updated_at = NOW() WHERE id = ? AND LOWER(COALESCE(status, 'requested')) = 'requested'",
      [safeJson(meta, {}), booking.id]
    );
  }
  return rows.length;
}

async function getEnquiryById(id) {
  const [rows] = await pool.query("SELECT * FROM hotel_enquiries WHERE id = ? LIMIT 1", [id]);
  return rows[0] ? mapEnquiry(rows[0]) : null;
}

async function findRoomBlockConflict(item = {}) {
  const selected = assignedRoomNumbersFromBody(item);
  if (!selected.length) return null;
  const selectedSet = new Set(selected.map(String));
  const ownerState = await getOwnerStateForBooking(item);
  return normalizeRoomBlocks(ownerState.settings?.roomBlocks || []).find((block) => {
    if (!roomBlockMatchesBooking(block, item)) return false;
    const blockedNumbers = ownerRoomNumbers(block.roomNumbers);
    return blockedNumbers.some((roomNo) => selectedSet.has(String(roomNo)));
  }) || null;
}

async function findAssignedRoomConflict(item = {}, currentId = "") {
  const selected = assignedRoomNumbersFromBody(item);
  if (!selected.length) return null;
  const values = [currentId];
  const clauses = [];
  if (item.ownerHotelId) {
    clauses.push("owner_hotel_id = ?");
    values.push(item.ownerHotelId);
  }
  if (item.hotelId && item.hotelId !== item.ownerHotelId) {
    clauses.push("hotel_id = ?");
    values.push(item.hotelId);
  }
  if (item.hotelPlaceId) {
    clauses.push("hotel_place_id = ?");
    values.push(item.hotelPlaceId);
  }
  if (!clauses.length) return null;
  const [rows] = await pool.query(
    `
    SELECT id, user_name, room_key, room_name, checkin, checkout, assigned_room_numbers_json
    FROM hotel_bookings
    WHERE id <> ?
      AND LOWER(COALESCE(status, 'requested')) IN ('requested', 'accepted', 'checked_in')
      AND (${clauses.join(" OR ")})
    LIMIT 200
    `,
    values
  );
  const selectedSet = new Set(selected.map(String));
  const targetRoomKey = bookingRoomKeyValue(item);
  const bookingConflict = rows.find((row) => {
    if (bookingRoomKeyValue(row) !== targetRoomKey) return false;
    if (!bookingStayDatesOverlap(item, row)) return false;
    return assignedRoomsFromRow(row).some((roomNo) => selectedSet.has(String(roomNo)));
  }) || null;
  if (bookingConflict) return { type: "booking", ...bookingConflict };
  const blockConflict = await findRoomBlockConflict(item);
  return blockConflict ? { type: "room_block", ...blockConflict } : null;
}

router.get("/hotel/owner-logins", requireAdminAuth, asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT hotel_id, hotel_name, place_id, hotel_place_id, city, area, status, last_login_at, created_at, updated_at
     FROM hotel_owner_logins
     ORDER BY updated_at DESC
     LIMIT 200`
  );
  return res.json({ success: true, data: rows.map(mapOwnerLogin) });
}));

router.get("/hotel/public-owner-logins", asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT hotel_id, hotel_name, place_id, hotel_place_id, city, area, status, created_at, updated_at
     FROM hotel_owner_logins
     WHERE status = 'active'
     ORDER BY updated_at DESC
     LIMIT 200`
  );
  return res.json({ success: true, data: rows.map(mapOwnerLogin) });
}));

router.put("/hotel/owner-logins/:hotelId", requireAdminAuth, requireAdminPermission("hotels"), asyncHandler(async (req, res) => {
  const item = ownerLoginFromBody(req.body || {}, req.params.hotelId);
  if (!item.hotelId) {
    return res.status(400).json({ success: false, message: "Hotel ID is required" });
  }
  const [existingRows] = await pool.query(
    "SELECT hotel_id FROM hotel_owner_logins WHERE hotel_id = ? LIMIT 1",
    [item.hotelId]
  );
  const exists = Boolean(existingRows[0]);
  const linkedPlaceId = item.hotelPlaceId || item.placeId;
  if (linkedPlaceId) {
    const [duplicateRows] = await pool.query(
      `
      SELECT hotel_id, hotel_name
      FROM hotel_owner_logins
      WHERE hotel_id <> ? AND (place_id = ? OR hotel_place_id = ?)
      LIMIT 1
      `,
      [item.hotelId, linkedPlaceId, linkedPlaceId]
    );
    if (duplicateRows[0]) {
      return res.status(409).json({
        success: false,
        message: `This hotel place already has owner login ${duplicateRows[0].hotel_id}`
      });
    }
  }
  if (!exists && (!item.password || item.password.length < 4)) {
    return res.status(400).json({ success: false, message: "Hotel password must be at least 4 characters" });
  }
  if (item.password && item.password.length < 4) {
    return res.status(400).json({ success: false, message: "Hotel password must be at least 4 characters" });
  }
  if (!item.password && exists) {
    await pool.query(
      `
      UPDATE hotel_owner_logins
      SET hotel_name = ?, place_id = ?, hotel_place_id = ?, city = ?, area = ?, status = ?
      WHERE hotel_id = ?
      `,
      [item.hotelName, item.placeId || null, item.hotelPlaceId || null, item.city, item.area, item.status, item.hotelId]
    );
    return res.json({ success: true, message: "Hotel owner login updated", data: { ...item, password: undefined } });
  }
  const passwordHash = await bcrypt.hash(item.password, 10);
  await pool.query(
    `
    INSERT INTO hotel_owner_logins (
      hotel_id, hotel_name, password_hash, place_id, hotel_place_id, city, area, status
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      hotel_name = VALUES(hotel_name),
      password_hash = VALUES(password_hash),
      place_id = VALUES(place_id),
      hotel_place_id = VALUES(hotel_place_id),
      city = VALUES(city),
      area = VALUES(area),
      status = VALUES(status)
    `,
    [
      item.hotelId,
      item.hotelName,
      passwordHash,
      item.placeId || null,
      item.hotelPlaceId || null,
      item.city,
      item.area,
      item.status
    ]
  );
  return res.json({ success: true, message: "Hotel owner login saved", data: { ...item, password: undefined } });
}));

router.post("/hotel/owner-login", asyncHandler(async (req, res) => {
  const hotelId = clean(req.body?.hotelId || req.body?.identifier, 120).toUpperCase();
  const password = clean(req.body?.password, 160);
  if (!hotelId || !password) {
    return res.status(400).json({ success: false, message: "Hotel ID and password are required" });
  }
  const [rows] = await pool.query("SELECT * FROM hotel_owner_logins WHERE hotel_id = ? LIMIT 1", [hotelId]);
  const account = rows[0];
  if (!account || String(account.status || "active").toLowerCase() !== "active") {
    return res.status(401).json({ success: false, message: "Invalid hotel ID or password" });
  }
  const ok = await bcrypt.compare(password, account.password_hash || "");
  if (!ok) {
    return res.status(401).json({ success: false, message: "Invalid hotel ID or password" });
  }
  await pool.query("UPDATE hotel_owner_logins SET last_login_at = NOW() WHERE hotel_id = ?", [hotelId]);
  const owner = mapOwnerLogin(account);
  const token = signHotelOwnerToken(owner);
  return res.json({
    success: true,
    message: "Hotel owner login successful",
    data: { ...owner, token, tokenType: "Bearer" }
  });
}));

router.post("/hotel/owner-refresh", asyncHandler(async (req, res) => {
  let owner = null;
  try {
    owner = await resolveHotelOwnerFromRequest(req);
  } catch (error) {
    owner = null;
  }
  if (!owner) {
    return res.status(401).json({
      success: false,
      message: "Hotel owner session expired. Please login again."
    });
  }
  const token = signHotelOwnerToken(owner);
  return res.json({
    success: true,
    message: "Hotel owner session refreshed",
    data: { ...owner, token, tokenType: "Bearer" }
  });
}));

router.delete("/hotel/owner-logins/:hotelId", requireAdminAuth, requireAdminPermission("hotels"), asyncHandler(async (req, res) => {
  const hotelId = clean(req.params.hotelId, 120);
  if (!hotelId) {
    return res.status(400).json({ success: false, message: "Hotel ID is required" });
  }
  await pool.query("DELETE FROM hotel_owner_logins WHERE hotel_id = ?", [hotelId]);
  return res.json({ success: true, message: "Hotel owner login deleted", data: { hotelId } });
}));

router.get("/hotel/public-owner-states", asyncHandler(async (req, res) => {
  const hotelId = normalizeHotelOwnerId(req.query.hotelId || req.query.ownerHotelId);
  if (!hotelId) {
    return res.status(400).json({ success: false, message: "Hotel ID is required" });
  }
  const [rows] = await pool.query(
    `SELECT states.*
     FROM hotel_owner_states states
     INNER JOIN hotel_owner_logins logins ON logins.hotel_id = states.hotel_id
     WHERE states.hotel_id = ? AND logins.status = 'active'
     LIMIT 1`,
    [hotelId]
  );
  return res.json({
    success: true,
    data: rows.map(mapPublicOwnerState)
  });
}));

router.get("/hotel/owner-states", requireHotelOwnerOrAdmin, requireHotelPermissionForAdmin, asyncHandler(async (req, res) => {
  const hotelId = normalizeHotelOwnerId(req.query.hotelId || req.query.ownerHotelId);
  const owner = await resolveOptionalHotelOwner(req);
  const auth = await resolveOptionalAuthIdentity(req);
  const values = [];
  let where = "";
  if (hotelId) {
    if (owner && normalizeHotelOwnerId(owner.hotelId) !== normalizeHotelOwnerId(hotelId)) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: this hotel owner cannot view another hotel's profile"
      });
    }
    where = "WHERE hotel_id = ?";
    values.push(hotelId);
  } else if (owner) {
    where = "WHERE hotel_id = ?";
    values.push(owner.hotelId);
  } else if (!auth?.isAdmin) {
    return res.status(401).json({
      success: false,
      message: "Admin or hotel owner access required"
    });
  }
  const [rows] = await pool.query(
    `SELECT * FROM hotel_owner_states ${where} ORDER BY updated_at DESC LIMIT 200`,
    values
  );
  return res.json({ success: true, data: rows.map(mapOwnerState) });
}));

router.put("/hotel/owner-states/:hotelId", requireHotelOwnerOrAdmin, requireHotelPermissionForAdmin, asyncHandler(async (req, res) => {
  const item = ownerStateFromBody(req.body || {}, req.params.hotelId);
  if (!item.hotelId) {
    return res.status(400).json({ success: false, message: "Hotel ID is required" });
  }
  if (req.hotelOwner && normalizeHotelOwnerId(req.hotelOwner.hotelId) !== normalizeHotelOwnerId(item.hotelId)) {
    return res.status(403).json({
      success: false,
      message: "Forbidden: this hotel owner cannot update another hotel's profile"
    });
  }
  const [existingStateRows] = await pool.query(
    "SELECT settings_json FROM hotel_owner_states WHERE hotel_id = ? LIMIT 1",
    [item.hotelId]
  );
  if (existingStateRows[0]) {
    const existingSettings = normalizeOwnerSettings(parseJson(existingStateRows[0].settings_json, {}));
    item.settings.roomBlocks = mergeRoomBlocksPreservingPrivate(existingSettings.roomBlocks, item.settings.roomBlocks);
  }
  await pool.query(
    `
    INSERT INTO hotel_owner_states (
      hotel_id, hotel_name, profile_json, rooms_json, settings_json
    )
    VALUES (?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      hotel_name = VALUES(hotel_name),
      profile_json = VALUES(profile_json),
      rooms_json = VALUES(rooms_json),
      settings_json = VALUES(settings_json),
      updated_at = NOW()
    `,
    [
      item.hotelId,
      item.hotelName,
      safeJson(item.profile, {}),
      safeJson(item.rooms, []),
      safeJson(item.settings, {})
    ]
  );
  const [rows] = await pool.query(
    "SELECT * FROM hotel_owner_states WHERE hotel_id = ? LIMIT 1",
    [item.hotelId]
  );
  return res.json({
    success: true,
    message: "Hotel owner state saved",
    data: rows[0] ? mapOwnerState(rows[0]) : item
  });
}));

router.delete("/hotel/owner-states/:hotelId", requireHotelOwnerOrAdmin, requireHotelPermissionForAdmin, asyncHandler(async (req, res) => {
  const hotelId = normalizeHotelOwnerId(req.params.hotelId);
  if (!hotelId) {
    return res.status(400).json({ success: false, message: "Hotel ID is required" });
  }
  if (req.hotelOwner && normalizeHotelOwnerId(req.hotelOwner.hotelId) !== normalizeHotelOwnerId(hotelId)) {
    return res.status(403).json({
      success: false,
      message: "Forbidden: this hotel owner cannot delete another hotel's profile"
    });
  }
  await pool.query("DELETE FROM hotel_owner_states WHERE hotel_id = ?", [hotelId]);
  return res.json({ success: true, message: "Hotel owner state deleted", data: { hotelId } });
}));

router.post("/hotel/bookings/availability", requireAuth, asyncHandler(async (req, res) => {
  const item = bookingFromBody(req.body || {});
  bindHotelItemToAuthUser(item, req.auth);
  const basicMessage = await validateHotelBookingBasics(item);
  if (basicMessage) {
    return res.status(400).json({ success: false, message: basicMessage });
  }
  const ownerLogin = await findActiveOwnerLoginForItem(item);
  if (!ownerLogin) {
    return res.json({
      success: true,
      message: "Hotel owner login is not active for this hotel. Please try another hotel.",
      data: {
        available: false,
        enforced: true,
        reason: "owner_login_inactive",
        message: "Hotel owner login is not active for this hotel. Please try another hotel.",
        requestedRooms: Math.max(1, Number(item.rooms || 1)),
        remainingRooms: 0
      }
    });
  }
  applyOwnerLoginToItem(item, ownerLogin);
  const availability = await getDateWiseRoomAvailability(item);
  return res.json({
    success: true,
    message: availability.message,
    data: availability
  });
}));

router.post("/hotel/bookings", requireAuth, asyncHandler(async (req, res) => {
  await expireOldRequestedHotelBookings();
  const item = bookingFromBody(req.body || {});
  bindHotelItemToAuthUser(item, req.auth);
  const basicMessage = await validateHotelBookingBasics(item);
  if (basicMessage) {
    return res.status(400).json({ success: false, message: basicMessage });
  }
  if (await hotelItemIdBelongsToOtherUser("hotel_bookings", item)) {
    return res.status(403).json({
      success: false,
      message: "Forbidden: this hotel booking belongs to another user"
    });
  }
  const ownerLogin = await findActiveOwnerLoginForItem(item);
  if (!ownerLogin) {
    return res.status(409).json({
      success: false,
      message: "Hotel owner login is not active for this hotel. Please try another hotel."
    });
  }
  applyOwnerLoginToItem(item, ownerLogin);
  const availability = await getDateWiseRoomAvailability(item);
  const availabilityMessage = availability.available ? "" : availability.message;
  if (availabilityMessage) {
    return res.status(409).json({ success: false, message: availabilityMessage, data: availability });
  }
  if (!bookingStatusHistory(item.meta).length) {
    item.meta = appendBookingStatusHistory(
      item.meta,
      item.status || "requested",
      "Booking request sent by traveller.",
      item.userName || "Traveller",
      Date.now()
    );
  }
  if (item.userUid) {
    const [dailyRows] = await pool.query(
      `
      SELECT COUNT(*) AS total
      FROM hotel_bookings
      WHERE user_uid = ?
        AND id <> ?
        AND created_at >= (NOW() - INTERVAL 1 DAY)
        AND LOWER(COALESCE(status, '')) <> 'deleted'
      `,
      [item.userUid, item.id]
    );
    if (Number(dailyRows?.[0]?.total || 0) >= 3) {
      return res.status(429).json({
        success: false,
        message: "Daily hotel booking request limit reached. Please try again tomorrow."
      });
    }

    const hotelClauses = [];
    const hotelValues = [item.userUid, item.id];
    if (item.ownerHotelId) {
      hotelClauses.push("owner_hotel_id = ?");
      hotelValues.push(item.ownerHotelId);
    }
    if (item.hotelId) {
      hotelClauses.push("hotel_id = ?");
      hotelValues.push(item.hotelId);
    }
    if (item.hotelPlaceId) {
      hotelClauses.push("hotel_place_id = ?");
      hotelValues.push(item.hotelPlaceId);
    }
    if (hotelClauses.length) {
      const [activeRows] = await pool.query(
        `
        SELECT id
        FROM hotel_bookings
        WHERE user_uid = ?
          AND id <> ?
          AND LOWER(COALESCE(status, 'requested')) IN ('requested', 'accepted', 'checked_in')
          AND NOT (
            LOWER(COALESCE(status, 'requested')) = 'requested'
            AND created_at < (NOW() - INTERVAL ${HOTEL_BOOKING_REQUEST_EXPIRY_HOURS} HOUR)
          )
          AND (${hotelClauses.join(" OR ")})
        LIMIT 1
        `,
        hotelValues
      );
      if (activeRows.length) {
        return res.status(409).json({
          success: false,
          message: "You already have an active booking request with this hotel."
        });
      }
    }
  }

  await pool.query(
    `
    INSERT INTO hotel_bookings (
      id, user_uid, user_name, hotel_id, owner_hotel_id, hotel_place_id,
      hotel_name, place_name, city, room_key, room_name, checkin, checkout,
      guests, rooms, nights, subtotal, taxes, total, commission_rate, platform_fee,
      commission_amount, hotel_payout, payout_status, status,
      assigned_room_numbers_json, meta_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      user_uid = VALUES(user_uid),
      user_name = VALUES(user_name),
      hotel_id = VALUES(hotel_id),
      owner_hotel_id = VALUES(owner_hotel_id),
      hotel_place_id = VALUES(hotel_place_id),
      hotel_name = VALUES(hotel_name),
      place_name = VALUES(place_name),
      city = VALUES(city),
      room_key = VALUES(room_key),
      room_name = VALUES(room_name),
      checkin = VALUES(checkin),
      checkout = VALUES(checkout),
      guests = VALUES(guests),
      rooms = VALUES(rooms),
      nights = VALUES(nights),
      subtotal = VALUES(subtotal),
      taxes = VALUES(taxes),
      total = VALUES(total),
      commission_rate = VALUES(commission_rate),
      platform_fee = VALUES(platform_fee),
      commission_amount = VALUES(commission_amount),
      hotel_payout = VALUES(hotel_payout),
      payout_status = VALUES(payout_status),
      status = VALUES(status),
      assigned_room_numbers_json = VALUES(assigned_room_numbers_json),
      meta_json = VALUES(meta_json)
    `,
    [
      item.id, item.userUid, item.userName, item.hotelId, item.ownerHotelId, item.hotelPlaceId,
      item.hotelName, item.placeName, item.city, item.roomKey, item.roomName, item.checkin, item.checkout,
      item.guests, item.rooms, item.nights, item.subtotal, item.taxes, item.total,
      item.commissionRate, item.platformFee, item.commissionAmount, item.hotelPayout, item.payoutStatus, item.status,
      safeJson(item.assignedRoomNumbers, []), safeJson(item.meta, {})
    ]
  );

  return res.status(201).json({ success: true, message: "Hotel booking saved", data: item });
}));

router.get("/hotel/bookings", asyncHandler(async (req, res) => {
  await expireOldRequestedHotelBookings();
  const { where, values, userUidOnly } = await hotelReadWhere(req);
  const [rows] = await pool.query(
    `SELECT * FROM hotel_bookings ${where} ORDER BY updated_at DESC LIMIT 200`,
    values
  );
  const data = rows.map(mapBooking).map(row => userUidOnly ? sanitizeBookingForTraveller(row) : row);
  return res.json({ success: true, data });
}));

router.patch("/hotel/bookings/:id/cancel", requireAuth, asyncHandler(async (req, res) => {
  await expireOldRequestedHotelBookings();
  const id = cleanId(req.params.id);
  const existing = await getBookingById(id);
  if (!existing) {
    return res.status(404).json({ success: false, message: "Hotel booking not found" });
  }

  const authUid = clean(req.auth?.uid, 120);
  const authEmail = clean(req.auth?.email, 190).toLowerCase();
  const bookingUid = clean(existing.userUid, 120);
  const bookingEmail = clean(existing.meta?.userEmail || existing.email, 190).toLowerCase();
  const ownsBooking = (authUid && bookingUid && authUid === bookingUid) ||
    (authEmail && bookingEmail && authEmail === bookingEmail);
  if (!ownsBooking) {
    return res.status(403).json({
      success: false,
      message: "Forbidden: you can cancel only your own hotel booking"
    });
  }

  const currentStatus = clean(existing.status || "requested", 32).toLowerCase().replace(/-/g, "_");
  if (!["requested", "accepted"].includes(currentStatus)) {
    return res.status(409).json({
      success: false,
      message: `Cannot cancel a ${currentStatus.replace(/_/g, " ")} booking`
    });
  }

  const reason = clean(req.body?.reason || req.body?.cancelReason || "", 600) ||
    "Traveller cancelled from ExploreX";
  const now = Date.now();
  const baseMeta = {
    ...(existing.meta || {}),
    userCancelReason: reason,
    userCancelledAt: now,
    ownerStatusNote: `Booking cancelled by traveller. Reason: ${reason}`,
    ownerStatusLabel: "cancelled"
  };
  const meta = appendBookingStatusHistory(
    baseMeta,
    "cancelled",
    baseMeta.ownerStatusNote,
    existing.userName || "Traveller",
    now
  );

  await pool.query(
    `
    UPDATE hotel_bookings
    SET status = 'cancelled',
        assigned_room_numbers_json = '[]',
        meta_json = ?,
        updated_at = NOW()
    WHERE id = ?
    `,
    [safeJson(meta, {}), id]
  );

  const updated = await getBookingById(id);
  return res.json({
    success: true,
    message: "Hotel booking cancelled",
    data: sanitizeBookingForTraveller(updated || { ...existing, status: "cancelled", meta, updatedAt: now })
  });
}));

router.patch("/hotel/bookings/:id/payment-proof", requireAuth, asyncHandler(async (req, res) => {
  await expireOldRequestedHotelBookings();
  const id = cleanId(req.params.id);
  const existing = await getBookingById(id);
  if (!existing) {
    return res.status(404).json({ success: false, message: "Hotel booking not found" });
  }

  const authUid = clean(req.auth?.uid, 120);
  const authEmail = clean(req.auth?.email, 190).toLowerCase();
  const bookingUid = clean(existing.userUid, 120);
  const bookingEmail = clean(existing.meta?.userEmail || existing.email, 190).toLowerCase();
  const ownsBooking = (authUid && bookingUid && authUid === bookingUid) ||
    (authEmail && bookingEmail && authEmail === bookingEmail);
  if (!ownsBooking) {
    return res.status(403).json({
      success: false,
      message: "Forbidden: you can update payment proof only for your own hotel booking"
    });
  }

  const currentStatus = normalizeBookingStatusKey(existing.status || "requested");
  if (!["accepted", "checked_in"].includes(currentStatus)) {
    return res.status(409).json({
      success: false,
      message: "Payment proof can be submitted only after hotel owner accepts the booking"
    });
  }

  const currentPaymentStatus = clean(existing.meta?.paymentStatus || "unpaid", 32).toLowerCase().replace(/[\s-]+/g, "_");
  if (currentPaymentStatus === "paid") {
    return res.status(409).json({ success: false, message: "Payment is already verified by hotel owner" });
  }

  const methodRaw = clean(req.body?.method || req.body?.paymentMethod || "upi", 40).toLowerCase().replace(/[\s-]+/g, "_");
  const allowedMethods = new Set(["upi", "card", "cash", "bank_transfer", "net_banking", "wallet", "other"]);
  const method = allowedMethods.has(methodRaw) ? methodRaw : "other";
  const reference = clean(req.body?.reference || req.body?.transactionId || req.body?.transaction_id || "", 120);
  const note = clean(req.body?.note || req.body?.message || "", 500);
  const amount = moneyValue(req.body?.amount || existing.total || 0);
  if (!reference && !note) {
    return res.status(400).json({ success: false, message: "Add transaction/reference ID or a short payment note" });
  }
  if (!amount) {
    return res.status(400).json({ success: false, message: "Enter a valid paid amount" });
  }

  const now = Date.now();
  const actor = existing.userName || "Traveller";
  const proof = {
    status: "submitted",
    amount,
    method,
    reference,
    note,
    submittedAt: now,
    submittedBy: actor
  };
  const baseMeta = {
    ...(existing.meta || {}),
    paymentProof: proof,
    paymentProofStatus: "submitted",
    paymentMethod: method,
    paymentStatus: currentPaymentStatus === "refunded" ? "refunded" : "unpaid",
    paymentVerified: false
  };
  const meta = appendBookingStatusHistory(
    baseMeta,
    "payment_proof_submitted",
    `Payment proof submitted by traveller. Amount: ₹${Math.round(amount).toLocaleString("en-IN")}.`,
    actor,
    now
  );

  await pool.query(
    "UPDATE hotel_bookings SET meta_json = ?, updated_at = NOW() WHERE id = ?",
    [safeJson(meta, {}), id]
  );

  const updated = await getBookingById(id);
  return res.json({
    success: true,
    message: "Payment proof submitted",
    data: sanitizeBookingForTraveller(updated || { ...existing, meta, updatedAt: now })
  });
}));

router.patch("/hotel/bookings/:id", requireHotelOwnerOrAdmin, requireHotelPermissionForAdmin, asyncHandler(async (req, res) => {
  const id = cleanId(req.params.id);
  const item = bookingFromBody({ ...req.body, id });
  const hasBodyField = (...names) => names.some(name => Object.prototype.hasOwnProperty.call(req.body || {}, name));
  const existing = await getBookingById(id);
  if (!existing) {
    return res.status(404).json({ success: false, message: "Hotel booking not found" });
  }
  if (req.hotelOwner && !hotelOwnerCanAccessItem(req.hotelOwner, existing) && !hotelOwnerCanAccessItem(req.hotelOwner, item)) {
    return res.status(403).json({
      success: false,
      message: "Forbidden: this hotel owner cannot modify another hotel's data"
    });
  }
  const currentStatus = normalizeBookingStatusKey(existing.status || "requested");
  const nextStatus = normalizeBookingStatusKey(item.status || currentStatus);
  const releasesAssignedRooms = hasBodyField("status") && ["rejected", "cancelled", "expired"].includes(nextStatus);
  const shouldUpdateAssignedRooms = releasesAssignedRooms || hasBodyField("assignedRoomNumbers", "assigned_room_numbers", "assignedRoomNo", "assigned_room_no");
  if (releasesAssignedRooms) item.assignedRoomNumbers = [];
  const currentAssignedRooms = assignedRoomsFromRow(existing).map(String);
  const nextAssignedRooms = shouldUpdateAssignedRooms ? item.assignedRoomNumbers.map(String) : currentAssignedRooms;
  const normalizedRoomList = (list) => [...new Set(list.map(String).filter(Boolean))].sort();
  const assignmentChanged = JSON.stringify(normalizedRoomList(nextAssignedRooms)) !== JSON.stringify(normalizedRoomList(currentAssignedRooms));
  const statusTransitionRequiresRooms = hasBodyField("status") &&
    nextStatus !== currentStatus &&
    ["accepted", "checked_in"].includes(nextStatus);
  const shouldValidateAssignment = !releasesAssignedRooms && (assignmentChanged || statusTransitionRequiresRooms);
  if (shouldValidateAssignment) {
    const roomsNeeded = Math.max(1, Number(hasBodyField("rooms") ? item.rooms : existing.rooms) || 1);
    if (nextAssignedRooms.length < roomsNeeded) {
      return res.status(400).json({
        success: false,
        message: `Assign ${roomsNeeded} room number(s) before updating this booking.`
      });
    }
    const candidate = { ...(existing || {}), assignedRoomNumbers: nextAssignedRooms };
    const conflict = await findAssignedRoomConflict(candidate, id);
    if (conflict) {
      const message = conflict.type === "room_block"
        ? `Room ${nextAssignedRooms.join(", ")} is blocked by hotel owner from ${conflict.startDate} to ${conflict.endDate}.`
        : `Room ${nextAssignedRooms.join(", ")} is already assigned for overlapping dates.`;
      return res.status(409).json({
        success: false,
        message
      });
    }
  }
  if (hasBodyField("status") && nextStatus !== currentStatus) {
    const actor = req.hotelOwner?.hotelName || req.auth?.email || "ExploreX admin";
    const note = clean(item.meta?.ownerStatusNote, 700) ||
      `Booking status changed from ${bookingStatusLabel(currentStatus)} to ${bookingStatusLabel(nextStatus)}.`;
    item.meta = appendBookingStatusHistory(item.meta, nextStatus, note, actor, Date.now());
  }
  const metaJson = hasBodyField("meta", "ownerLinked", "email", "userEmail", "user_email", "phone", "userPhone", "user_phone") || (hasBodyField("status") && nextStatus !== currentStatus)
    ? safeJson(item.meta, {})
    : null;
  await pool.query(
    `
    UPDATE hotel_bookings
    SET hotel_id = COALESCE(NULLIF(?, ''), hotel_id),
        owner_hotel_id = COALESCE(NULLIF(?, ''), owner_hotel_id),
        hotel_place_id = COALESCE(NULLIF(?, ''), hotel_place_id),
        hotel_name = COALESCE(NULLIF(?, ''), hotel_name),
        commission_rate = COALESCE(?, commission_rate),
        platform_fee = COALESCE(?, platform_fee),
        commission_amount = COALESCE(?, commission_amount),
        hotel_payout = COALESCE(?, hotel_payout),
        payout_status = COALESCE(NULLIF(?, ''), payout_status),
        status = COALESCE(NULLIF(?, ''), status),
        assigned_room_numbers_json = COALESCE(?, assigned_room_numbers_json),
        meta_json = COALESCE(?, meta_json)
    WHERE id = ?
    `,
    [
      item.hotelId, item.ownerHotelId, item.hotelPlaceId,
      hasBodyField("hotelName", "hotel_name") ? item.hotelName : "",
      hasBodyField("commissionRate", "commission_rate") ? item.commissionRate : null,
      hasBodyField("platformFee", "platform_fee") ? item.platformFee : null,
      hasBodyField("commissionAmount", "commission_amount") ? item.commissionAmount : null,
      hasBodyField("hotelPayout", "hotel_payout") ? item.hotelPayout : null,
      hasBodyField("payoutStatus", "payout_status") ? item.payoutStatus : "",
      hasBodyField("status") ? item.status : "",
      shouldUpdateAssignedRooms ? safeJson(item.assignedRoomNumbers, []) : null,
      metaJson,
      id
    ]
  );
  const updated = await getBookingById(id);
  return res.json({
    success: true,
    message: "Hotel booking updated",
    data: updated || { ...existing, ...item, id, updatedAt: Date.now() }
  });
}));

router.delete("/hotel/bookings/:id", requireHotelOwnerOrAdmin, requireHotelPermissionForAdmin, asyncHandler(async (req, res) => {
  const id = cleanId(req.params.id);
  const existing = await getBookingById(id);
  if (!existing) {
    return res.status(404).json({ success: false, message: "Hotel booking not found" });
  }
  if (!ensureHotelOwnerCanAccess(req, res, existing)) return;
  const clearedAt = Date.now();
  const clearedBy = clean(req.hotelOwner?.hotelName || req.auth?.role || "ExploreX", 120);
  const clearedMeta = safeJson({
    clearedAt,
    clearedBy,
    cleanupReason: "customer_data_cleared",
    ownerStatusNote: "Customer booking data cleared by hotel owner.",
    ownerStatusUpdatedAt: clearedAt,
    ownerStatusUpdatedBy: clearedBy
  });
  await pool.query(
    `UPDATE hotel_bookings
     SET user_uid = NULL,
         user_name = 'Cleared guest',
         status = 'deleted',
         assigned_room_numbers_json = '[]',
         meta_json = ?,
         updated_at = NOW()
     WHERE id = ?`,
    [clearedMeta, id]
  );
  return res.json({
    success: true,
    message: "Hotel booking deleted",
    data: { id, status: "deleted", updatedAt: Date.now() }
  });
}));

router.post("/hotel/enquiries", requireAuth, asyncHandler(async (req, res) => {
  const item = enquiryFromBody(req.body || {});
  bindHotelItemToAuthUser(item, req.auth);
  if (!item.message) {
    return res.status(400).json({ success: false, message: "Message is required" });
  }
  if (await hotelItemIdBelongsToOtherUser("hotel_enquiries", item)) {
    return res.status(403).json({
      success: false,
      message: "Forbidden: this hotel enquiry belongs to another user"
    });
  }
  const ownerLogin = await findActiveOwnerLoginForItem(item);
  if (!ownerLogin) {
    return res.status(409).json({
      success: false,
      message: "Hotel owner login is not active for this hotel. Please try another hotel."
    });
  }
  applyOwnerLoginToItem(item, ownerLogin);

  const [dailyRows] = await pool.query(
    `
    SELECT COUNT(*) AS total
    FROM hotel_enquiries
    WHERE user_uid = ?
      AND id <> ?
      AND created_at >= (NOW() - INTERVAL 1 DAY)
      AND LOWER(COALESCE(status, '')) <> 'deleted'
    `,
    [item.userUid, item.id]
  );
  if (Number(dailyRows?.[0]?.total || 0) >= 10) {
    return res.status(429).json({
      success: false,
      message: "Daily hotel enquiry limit reached. Please try again tomorrow."
    });
  }

  const hotelClauses = [];
  const hotelValues = [item.userUid, item.id];
  if (item.ownerHotelId) {
    hotelClauses.push("owner_hotel_id = ?");
    hotelValues.push(item.ownerHotelId);
  }
  if (item.hotelId) {
    hotelClauses.push("hotel_id = ?");
    hotelValues.push(item.hotelId);
  }
  if (item.hotelPlaceId) {
    hotelClauses.push("hotel_place_id = ?");
    hotelValues.push(item.hotelPlaceId);
  }
  if (hotelClauses.length) {
    const [openRows] = await pool.query(
      `
      SELECT id
      FROM hotel_enquiries
      WHERE user_uid = ?
        AND id <> ?
        AND LOWER(COALESCE(status, 'new')) NOT IN ('closed', 'converted', 'deleted')
        AND (${hotelClauses.join(" OR ")})
      LIMIT 3
      `,
      hotelValues
    );
    if (openRows.length >= 3) {
      return res.status(409).json({
        success: false,
        message: "You already have 3 open enquiries with this hotel. Please wait for reply or close old ones."
      });
    }
  }

  await pool.query(
    `
    INSERT INTO hotel_enquiries (
      id, user_uid, user_name, phone, email, topic, message, reply_note,
      hotel_id, owner_hotel_id, hotel_place_id, hotel_name, place_name, city,
      room_key, room_name, checkin, checkout, guests, rooms, status, meta_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      user_uid = VALUES(user_uid),
      user_name = VALUES(user_name),
      phone = VALUES(phone),
      email = VALUES(email),
      topic = VALUES(topic),
      message = VALUES(message),
      reply_note = VALUES(reply_note),
      hotel_id = VALUES(hotel_id),
      owner_hotel_id = VALUES(owner_hotel_id),
      hotel_place_id = VALUES(hotel_place_id),
      hotel_name = VALUES(hotel_name),
      place_name = VALUES(place_name),
      city = VALUES(city),
      room_key = VALUES(room_key),
      room_name = VALUES(room_name),
      checkin = VALUES(checkin),
      checkout = VALUES(checkout),
      guests = VALUES(guests),
      rooms = VALUES(rooms),
      status = VALUES(status),
      meta_json = VALUES(meta_json)
    `,
    [
      item.id, item.userUid, item.userName, item.phone, item.email, item.topic, item.message, item.replyNote,
      item.hotelId, item.ownerHotelId, item.hotelPlaceId, item.hotelName, item.placeName, item.city,
      item.roomKey, item.roomName, item.checkin, item.checkout, item.guests, item.rooms, item.status, safeJson(item.meta, {})
    ]
  );

  return res.status(201).json({ success: true, message: "Hotel enquiry saved", data: item });
}));

router.get("/hotel/enquiries", asyncHandler(async (req, res) => {
  const { where, values } = await hotelReadWhere(req);
  const [rows] = await pool.query(
    `SELECT * FROM hotel_enquiries ${where} ORDER BY updated_at DESC LIMIT 200`,
    values
  );
  return res.json({ success: true, data: rows.map(mapEnquiry) });
}));

router.patch("/hotel/enquiries/:id", requireHotelOwnerOrAdmin, requireHotelPermissionForAdmin, asyncHandler(async (req, res) => {
  const id = cleanId(req.params.id);
  const item = enquiryFromBody({ ...req.body, id });
  const hasBodyField = (...names) => names.some(name => Object.prototype.hasOwnProperty.call(req.body || {}, name));
  const existing = await getEnquiryById(id);
  if (!existing) {
    return res.status(404).json({ success: false, message: "Hotel enquiry not found" });
  }
  if (req.hotelOwner && !hotelOwnerCanAccessItem(req.hotelOwner, existing) && !hotelOwnerCanAccessItem(req.hotelOwner, item)) {
    return res.status(403).json({
      success: false,
      message: "Forbidden: this hotel owner cannot modify another hotel's data"
    });
  }
  const metaJson = hasBodyField("meta", "ownerLinked") ? safeJson(item.meta, {}) : null;
  await pool.query(
    `
    UPDATE hotel_enquiries
    SET hotel_id = COALESCE(NULLIF(?, ''), hotel_id),
        owner_hotel_id = COALESCE(NULLIF(?, ''), owner_hotel_id),
        hotel_place_id = COALESCE(NULLIF(?, ''), hotel_place_id),
        hotel_name = COALESCE(NULLIF(?, ''), hotel_name),
        reply_note = COALESCE(NULLIF(?, ''), reply_note),
        status = COALESCE(NULLIF(?, ''), status),
        meta_json = COALESCE(?, meta_json)
    WHERE id = ?
    `,
    [
      item.hotelId, item.ownerHotelId, item.hotelPlaceId,
      hasBodyField("hotelName", "hotel_name") ? item.hotelName : "",
      hasBodyField("replyNote", "reply_note") ? item.replyNote : "",
      hasBodyField("status") ? item.status : "",
      metaJson,
      id
    ]
  );
  const updated = await getEnquiryById(id);
  return res.json({
    success: true,
    message: "Hotel enquiry updated",
    data: updated || { ...existing, ...item, id, updatedAt: Date.now() }
  });
}));

router.delete("/hotel/enquiries/:id", asyncHandler(async (req, res) => {
  const id = cleanId(req.params.id);
  const existing = await getEnquiryById(id);
  if (!existing) {
    return res.status(404).json({ success: false, message: "Hotel enquiry not found" });
  }
  const token = extractBearerToken(req.headers.authorization);
  let allowed = false;
  if (token) {
    try {
      const owner = await resolveHotelOwnerFromRequest(req);
      allowed = Boolean(owner && hotelOwnerCanAccessItem(owner, existing));
    } catch (error) {
      allowed = false;
    }
    if (!allowed) {
      try {
        const uid = userUidFromAuthToken(token);
        const decoded = verifyAuthToken(token);
        const role = clean(decoded?.role, 60).toLowerCase();
        if (role === "admin") {
          allowed = await canAdminEdit({ ...decoded, userId: Number(decoded?.userId || 0) }, "hotels");
        } else {
          allowed = Boolean(uid && uid === existing.userUid);
        }
      } catch (error) {
        allowed = false;
      }
    }
  }
  if (!allowed) {
    return res.status(403).json({
      success: false,
      message: "Forbidden: you cannot delete this hotel enquiry"
    });
  }
  const clearedAt = Date.now();
  const clearedMeta = safeJson({
    clearedAt,
    cleanupReason: "customer_data_cleared",
    ownerStatusNote: "Customer enquiry data cleared."
  });
  await pool.query(
    `UPDATE hotel_enquiries
     SET user_uid = NULL,
         user_name = 'Cleared guest',
         phone = NULL,
         email = NULL,
         message = NULL,
         reply_note = NULL,
         status = 'deleted',
         meta_json = ?,
         updated_at = NOW()
     WHERE id = ?`,
    [clearedMeta, id]
  );
  return res.json({
    success: true,
    message: "Hotel enquiry deleted",
    data: { id, status: "deleted", updatedAt: Date.now() }
  });
}));

module.exports = router;
