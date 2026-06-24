const { extractBearerToken, verifyAuthToken } = require("../utils/jwt");
const { pool } = require("../config/db");
const crypto = require("crypto");

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeRoleKey(value) {
  return String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
}

const SUPER_ADMIN_EMAIL_SET = new Set(
  String(process.env.SUPER_ADMIN_EMAILS || process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((value) => normalizeEmail(value))
    .filter(Boolean)
);

function parseUserId(decoded) {
  const numeric = Number(decoded?.userId);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;

  const uid = String(decoded?.uid || decoded?.sub || "");
  const match = uid.match(/^user_(\d+)$/i);
  if (match) return Number(match[1]);
  return null;
}

function normalizeAccountStatus(value, fallback = "active") {
  const raw = String(value || "").trim().toLowerCase();
  if (["active", "inactive", "blocked", "deleted"].includes(raw)) return raw;
  return fallback;
}

function resolveAccountAccessMessage(status) {
  if (status === "deleted") return "Unauthorized: account deleted";
  if (status === "blocked") return "Unauthorized: account blocked";
  if (status === "inactive") return "Unauthorized: account inactive";
  return "Unauthorized";
}

function hashAuthToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function isSuperAdminIdentity(identity = {}) {
  const roleKey = normalizeRoleKey(identity.role);
  if (["superadmin", "owner", "rootadmin"].includes(roleKey)) return true;

  const email = normalizeEmail(identity.email);
  if (SUPER_ADMIN_EMAIL_SET.size === 0 && roleKey === "admin") return true;
  return Boolean(email && SUPER_ADMIN_EMAIL_SET.has(email));
}

function isProtectedAdminIdentity(identity = {}) {
  return isSuperAdminIdentity(identity);
}

async function requireAuth(req, res, next) {
  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized: missing bearer token"
    });
  }

  let decoded;
  let userId;
  try {
    decoded = verifyAuthToken(token);
    userId = parseUserId(decoded);
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: invalid token payload"
      });
    }
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized: invalid or expired token"
    });
  }

  try {
    const tokenHash = hashAuthToken(token);
    const [revokedRows] = await pool.query(
      "SELECT id FROM auth_token_revocations WHERE token_hash = ? LIMIT 1",
      [tokenHash]
    );
    if (revokedRows.length > 0) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: token revoked"
      });
    }

    const [rows] = await pool.query(
      "SELECT id, email, role, account_status, deleted_at FROM users WHERE id = ? LIMIT 1",
      [userId]
    );
    if (!rows.length) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: user not found"
      });
    }

    const user = rows[0];
    const accountStatus = user.deleted_at
      ? "deleted"
      : normalizeAccountStatus(user.account_status, "active");
    if (accountStatus !== "active") {
      return res.status(403).json({
        success: false,
        message: resolveAccountAccessMessage(accountStatus)
      });
    }

    req.auth = {
      userId: Number(user.id),
      uid: String(decoded.uid || decoded.sub || `user_${userId}`),
      role: String(user.role || decoded.role || "Traveller"),
      email: String(user.email || decoded.email || ""),
      status: accountStatus
    };
    return next();
  } catch (error) {
    console.error("Auth middleware DB check error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error while validating session"
    });
  }
}

function requireAdminAuth(req, res, next) {
  return requireAuth(req, res, () => {
    const role = String(req.auth?.role || "").trim().toLowerCase();
    if (role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Forbidden: admin access required"
      });
    }
    return next();
  });
}

function requireSuperAdmin(req, res, next) {
  return requireAdminAuth(req, res, () => {
    if (SUPER_ADMIN_EMAIL_SET.size === 0) {
      // Backward-compatible fallback: if no list configured, allow existing admins.
      return next();
    }

    if (!isSuperAdminIdentity(req.auth)) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: super admin access required"
      });
    }

    return next();
  });
}

module.exports = {
  requireAuth,
  requireAdminAuth,
  requireSuperAdmin,
  isSuperAdminIdentity,
  isProtectedAdminIdentity
};
