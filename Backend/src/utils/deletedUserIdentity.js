function normalizeDeletedOriginalEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!email || email.endsWith("@deleted.explorex.local")) return null;
  return email;
}

function normalizeDeletedOriginalUsername(value) {
  const username = String(value || "").trim();
  if (!username || username.startsWith("@deleted_")) return null;
  return username.slice(0, 80);
}

function createDeletedUserIdentity(user) {
  const id = Number(user?.id || 0);
  const stamp = Date.now();
  return {
    email: `deleted+${id || "user"}+${stamp}@deleted.explorex.local`,
    username: `@deleted_${id || "user"}_${stamp}`.slice(0, 80),
    originalEmail: normalizeDeletedOriginalEmail(user?.email),
    originalUsername: normalizeDeletedOriginalUsername(user?.username)
  };
}

function getDisplayEmail(row) {
  if (row?.deleted_at && row?.deleted_original_email) {
    return String(row.deleted_original_email || "").trim().toLowerCase();
  }
  return String(row?.email || "").trim().toLowerCase();
}

function getDisplayUsername(row) {
  if (row?.deleted_at && row?.deleted_original_username) {
    return String(row.deleted_original_username || "").trim();
  }
  return String(row?.username || "").trim();
}

module.exports = {
  createDeletedUserIdentity,
  getDisplayEmail,
  getDisplayUsername
};
