const jwt = require("jsonwebtoken");

const DEFAULT_DEV_SECRET = "explorex-dev-secret-change-this";

function getJwtSecret() {
  const configured = String(process.env.JWT_SECRET || "").trim();
  if (configured) return configured;

  // Keep local development running while making insecurity explicit.
  if (!global.__EXPLOREX_JWT_WARNED__) {
    global.__EXPLOREX_JWT_WARNED__ = true;
    console.warn("JWT_SECRET is not set. Using insecure development secret.");
  }
  return DEFAULT_DEV_SECRET;
}

function getJwtExpiry() {
  const value = String(process.env.JWT_EXPIRES_IN || "").trim();
  return value || "7d";
}

function getAdminPinExpiry() {
  const value = String(process.env.ADMIN_PIN_EXPIRES_IN || "").trim();
  return value || "2h";
}

function getHotelOwnerExpiry() {
  const value = String(process.env.HOTEL_OWNER_TOKEN_EXPIRES_IN || "").trim();
  return value || "12h";
}

function signAuthToken(user) {
  const userId = Number(user.id || user.userId || 0);
  const uid = user.uid || `user_${userId}`;
  const role = String(user.role || "Traveller");

  return jwt.sign(
    {
      sub: uid,
      uid,
      userId,
      role,
      email: user.email || "",
      name: user.full_name || user.name || ""
    },
    getJwtSecret(),
    { expiresIn: getJwtExpiry() }
  );
}

function verifyAuthToken(token) {
  return jwt.verify(String(token || ""), getJwtSecret());
}

function signAdminPinToken(user, options = {}) {
  const userId = Number(user.id || user.userId || 0);
  const uid = user.uid || `user_${userId}`;
  return jwt.sign(
    {
      type: "admin_pin",
      sub: uid,
      uid,
      userId,
      role: String(user.role || "Admin"),
      email: user.email || "",
      pinUpdatedAt: options.pinUpdatedAt || ""
    },
    getJwtSecret(),
    { expiresIn: getAdminPinExpiry() }
  );
}

function verifyAdminPinToken(token) {
  const decoded = jwt.verify(String(token || ""), getJwtSecret());
  if (decoded?.type !== "admin_pin") {
    throw new Error("Invalid admin PIN token");
  }
  return decoded;
}

function signHotelOwnerToken(owner) {
  const hotelId = String(owner.hotelId || owner.hotel_id || "").trim().toUpperCase();
  return jwt.sign(
    {
      type: "hotel_owner",
      sub: `hotel_owner_${hotelId}`,
      hotelId,
      hotelName: owner.hotelName || owner.hotel_name || "Hotel"
    },
    getJwtSecret(),
    { expiresIn: getHotelOwnerExpiry() }
  );
}

function verifyHotelOwnerToken(token) {
  const decoded = jwt.verify(String(token || ""), getJwtSecret());
  if (decoded?.type !== "hotel_owner" || !decoded?.hotelId) {
    throw new Error("Invalid hotel owner token");
  }
  return decoded;
}

function extractBearerToken(authHeader) {
  const raw = String(authHeader || "").trim();
  if (!raw) return "";
  const [scheme, token] = raw.split(/\s+/, 2);
  if (!scheme || !token) return "";
  if (scheme.toLowerCase() !== "bearer") return "";
  return token.trim();
}

module.exports = {
  signAuthToken,
  verifyAuthToken,
  signAdminPinToken,
  verifyAdminPinToken,
  signHotelOwnerToken,
  verifyHotelOwnerToken,
  extractBearerToken
};
