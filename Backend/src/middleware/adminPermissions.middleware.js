const { pool } = require("../config/db");
const { isSuperAdminIdentity } = require("./auth.middleware");

const ADMIN_PERMISSION_DEFINITIONS = Object.freeze([
  { key: "places", label: "Manage Places", description: "Create, edit, publish, restore, or delete places and categories." },
  { key: "users", label: "Users", description: "Create users, update accounts, change status, or reset passwords." },
  { key: "memories", label: "Travel Memories", description: "Approve, reject, bulk-update, or remove traveller memories." },
  { key: "services", label: "City Services", description: "Create, edit, moderate reports, or remove city services." },
  { key: "hotels", label: "Hotel Data", description: "Update hotel bookings, rooms, owner access, and hotel settings." },
  { key: "kumbh", label: "Kumbh Guide", description: "Edit guide settings, content, priority, and publishing status." },
  { key: "homepage", label: "Homepage Control", description: "Edit homepage sections, visibility, order, and content." },
  { key: "audit", label: "Audit Logs", description: "Create or delete audit log records." },
  { key: "support", label: "Support Inbox", description: "Reply to tickets, update status, or delete support tickets." }
]);

const ADMIN_PERMISSION_KEYS = new Set(ADMIN_PERMISSION_DEFINITIONS.map((item) => item.key));

function normalizePermissionKey(value) {
  const key = String(value || "").trim().toLowerCase();
  return ADMIN_PERMISSION_KEYS.has(key) ? key : "";
}

function defaultPermissionMap(value = true) {
  return Object.fromEntries(ADMIN_PERMISSION_DEFINITIONS.map((item) => [item.key, Boolean(value)]));
}

async function getAdminPermissionMap(adminId) {
  const userId = Number(adminId || 0);
  const permissions = defaultPermissionMap(true);
  if (!Number.isFinite(userId) || userId <= 0) return permissions;

  const [rows] = await pool.query(
    "SELECT permission_key, can_edit FROM admin_permissions WHERE admin_id = ?",
    [userId]
  );
  rows.forEach((row) => {
    const key = normalizePermissionKey(row.permission_key);
    if (key) permissions[key] = Boolean(Number(row.can_edit));
  });
  return permissions;
}

async function canAdminEdit(identity, permissionKey) {
  const key = normalizePermissionKey(permissionKey);
  if (!key) return false;
  if (isSuperAdminIdentity(identity)) return true;
  const permissions = await getAdminPermissionMap(identity?.userId);
  return permissions[key] !== false;
}

function requireAdminPermission(permissionKey) {
  const key = normalizePermissionKey(permissionKey);
  if (!key) throw new Error(`Unknown admin permission: ${permissionKey}`);

  return async (req, res, next) => {
    try {
      if (isSuperAdminIdentity(req.auth)) return next();
      const allowed = await canAdminEdit(req.auth, key);
      if (!allowed) {
        return res.status(403).json({
          success: false,
          code: "ADMIN_PERMISSION_DENIED",
          permission: key,
          message: "This edit permission is disabled by Super Admin"
        });
      }
      return next();
    } catch (error) {
      console.error("Admin permission check failed:", error.message);
      return res.status(500).json({
        success: false,
        message: "Server error while checking admin permission"
      });
    }
  };
}

function permissionForAdminRequest(method, originalUrl) {
  const verb = String(method || "GET").toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(verb)) return "";

  const path = String(originalUrl || "").split("?")[0].replace(/^\/api\/admin\/?/, "");
  if (path.startsWith("permission-control")) return "";
  if (path.startsWith("users")) return "users";
  if (path.startsWith("memories")) return "memories";
  if (path.startsWith("places") || path.startsWith("categories")) return "places";
  if (path.startsWith("services")) return "services";
  if (path.startsWith("kumbh-guide")) return "kumbh";
  if (path.startsWith("home-sections")) return "homepage";
  if (path.startsWith("audit-logs")) return "audit";
  return "";
}

async function enforceMappedAdminPermission(req, res, next) {
  const key = permissionForAdminRequest(req.method, req.originalUrl);
  if (!key || isSuperAdminIdentity(req.auth)) return next();
  return requireAdminPermission(key)(req, res, next);
}

module.exports = {
  ADMIN_PERMISSION_DEFINITIONS,
  ADMIN_PERMISSION_KEYS,
  normalizePermissionKey,
  defaultPermissionMap,
  getAdminPermissionMap,
  canAdminEdit,
  requireAdminPermission,
  permissionForAdminRequest,
  enforceMappedAdminPermission
};
