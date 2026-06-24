const express = require("express");
const { pool } = require("../config/db");
const { requireAuth, isProtectedAdminIdentity } = require("../middleware/auth.middleware");
const { createDeletedUserIdentity } = require("../utils/deletedUserIdentity");

const router = express.Router();

function isValidUid(uid) {
  return /^user_[a-zA-Z0-9]+$/.test(String(uid || ""));
}

function extractUserIdFromUid(uid) {
  const match = String(uid || "").match(/^user_(\d+)$/);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function requireProfileOwner(req, res, next) {
  const uid = String(req.params.uid || "");
  if (!isValidUid(uid)) {
    return res.status(400).json({ success: false, message: "Invalid user id format" });
  }

  const requestedUserId = extractUserIdFromUid(uid);
  const authUserId = Number(req.auth?.userId || 0);
  const authUid = String(req.auth?.uid || "").trim();
  const role = String(req.auth?.role || "").trim().toLowerCase();

  if (role === "admin") return next();
  if (requestedUserId && authUserId && requestedUserId === authUserId) return next();
  if (authUid && authUid === uid) return next();

  return res.status(403).json({
    success: false,
    message: "Forbidden: profile access denied"
  });
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

function safeJsonStringify(value, fallback = "[]") {
  try {
    return JSON.stringify(value == null ? JSON.parse(fallback) : value);
  } catch (error) {
    return fallback;
  }
}

function clampText(value, max = 200) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

const STORED_MEDIA_URL_MAX_LENGTH = 4096;

function normalizeStoredMediaUrl(value, maxLen = STORED_MEDIA_URL_MAX_LENGTH) {
  const s = String(value || "").trim();
  if (!s) return { value: "", tooLarge: false, invalid: false };
  if (/^data:/i.test(s)) return { value: "", tooLarge: false, invalid: true };
  if (s.length > maxLen) return { value: "", tooLarge: true, invalid: false };
  if (/^\/uploads\/images\/[a-zA-Z0-9._-]+$/i.test(s)) {
    return { value: s, tooLarge: false, invalid: false };
  }
  try {
    const url = new URL(s);
    if (["localhost", "127.0.0.1", "::1"].includes(url.hostname) && /^\/uploads\/images\/[a-zA-Z0-9._-]+$/i.test(url.pathname)) {
      return { value: url.pathname, tooLarge: false, invalid: false };
    }
  } catch (error) {}
  const valid = /^https?:\/\/[^\s"'<>]+$/i.test(s);
  return { value: valid ? s : "", tooLarge: false, invalid: !valid };
}

function normalizeImageField(value, maxLen = STORED_MEDIA_URL_MAX_LENGTH) {
  return normalizeStoredMediaUrl(value, maxLen);
}

function normalizeStoredMediaUrlValue(value) {
  return normalizeStoredMediaUrl(value).value;
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

function normalizeVisitedPlaceEntry(item, index = 0) {
  if (!item || typeof item !== "object") return null;
  const rawId = clampText(item.id, 80).replace(/[^a-zA-Z0-9_-]/g, "");
  const id = rawId || `vp_${Date.now()}_${index}`;
  const name = clampText(item.name, 80);
  const area = clampText(item.area || item.city, 80);
  const location = clampText(item.location, 150);
  if (!name || !area || !location) return null;

  const placeIdRaw = Number(item.placeId || item.idRef || 0);
  const placeId = Number.isFinite(placeIdRaw) && placeIdRaw > 0 ? Math.round(placeIdRaw) : null;
  const visitedDateRaw = clampText(item.visitedDate, 12);
  const visitedDate = /^\d{4}-\d{2}-\d{2}$/.test(visitedDateRaw) ? visitedDateRaw : "";
  const description = clampText(item.description, 400);
  const image = normalizeStoredMediaUrlValue(item.image);
  const createdAtRaw = Number(item.createdAt || item.date || Date.now());
  const updatedAtRaw = Number(item.updatedAt || createdAtRaw || Date.now());

  return {
    id,
    placeId,
    name,
    area,
    location,
    description,
    visitedDate,
    image,
    createdAt: Number.isFinite(createdAtRaw) ? createdAtRaw : Date.now(),
    updatedAt: Number.isFinite(updatedAtRaw) ? updatedAtRaw : Date.now()
  };
}

function normalizeVisitedPlacesList(input, limit = 400) {
  const arr = Array.isArray(input) ? input : [];
  const byId = new Map();
  arr.forEach((item, index) => {
    const normalized = normalizeVisitedPlaceEntry(item, index);
    if (!normalized) return;
    byId.set(normalized.id, normalized);
  });
  return [...byId.values()].slice(0, limit);
}

function normalizeSavedPlacesMap(input, limit = 500) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out = {};
  let count = 0;
  Object.keys(input).forEach((k) => {
    if (count >= limit) return;
    const place = input[k];
    if (!place || typeof place !== "object") return;
    const keyNum = Number(k);
    const key = Number.isFinite(keyNum) ? String(Math.round(keyNum)) : clampText(k, 40);
    if (!key) return;
    out[key] = {
      id: Number.isFinite(Number(place.id)) ? Number(place.id) : null,
      name: clampText(place.name || "Saved Place", 120),
      city: clampText(place.city || "Unknown", 120),
      area: clampText(place.area || "", 120),
      dist: Number.isFinite(Number(place.dist)) ? Number(place.dist) : 0,
      rating: Number.isFinite(Number(place.rating)) ? Number(place.rating) : 0,
      lat: Number.isFinite(Number(place.lat)) ? Number(place.lat) : null,
      lng: Number.isFinite(Number(place.lng)) ? Number(place.lng) : null,
      image: normalizeStoredMediaUrlValue(place.image)
    };
    count += 1;
  });
  return out;
}

function normalizeMemoryEntries(input, limit = 80) {
  const arr = Array.isArray(input) ? input : [];
  return arr
    .slice(0, limit)
    .map((m, i) => ({
      id: clampText(m?.id || `mem_${Date.now()}_${i}`, 120),
      privacy: clampText(m?.privacy || "private", 12) === "public" ? "public" : "private",
      location: clampText(m?.location, 160),
      caption: clampText(m?.caption, 400),
      mediaType: clampText(m?.mediaType || "image", 20) === "video" ? "video" : "image",
      mediaUrl: normalizeStoredMediaUrlValue(m?.mediaUrl),
      date: Number.isFinite(Number(m?.date)) ? Number(m.date) : Date.now(),
      status: clampText(m?.status || (m?.privacy === "public" ? "pending" : "private"), 20)
    }))
    .filter((m) => Boolean(m.mediaUrl));
}

function normalizeProfilePayload(body) {
  const savedPlaces = normalizeSavedPlacesMap(body.savedPlaces);
  const visitedPlaces = normalizeVisitedPlacesList(body.visitedPlaces);
  const incomingGoals = Array.isArray(body.goals) ? body.goals : [];
  const goalDefaults = [
    { icon: "map", label: "Visit 10 places this year", current: 0, target: 10, metric: "places" },
    { icon: "city", label: "Explore 5 new cities", current: 0, target: 5, metric: "cities" },
    { icon: "camera", label: "Upload 20 memories", current: 0, target: 20, metric: "memories" }
  ];
  const goals = incomingGoals.slice(0, 6).map((g, i) => normalizeGoalItem(g, goalDefaults[i]));
  const rawInterests = Array.isArray(body.interests) ? body.interests : [];
  const interests = [...new Set(rawInterests.map((v) => clampText(v, 60)).filter(Boolean))].slice(0, 30);
  const memories = normalizeMemoryEntries(body.memories);
  const activity = normalizeActivityEntries(body.activity, 50);

  return {
    name: clampText(body.name || "Traveller", 120) || "Traveller",
    username: (() => {
      const raw = clampText(body.username || "@explorer", 80) || "@explorer";
      return raw.startsWith("@") ? raw.slice(0, 80) : `@${raw.slice(0, 79)}`;
    })(),
    bio: String(body.bio || "").slice(0, 3000),
    location: clampText(body.location || "Nashik, Maharashtra", 150) || "Nashik, Maharashtra",
    avatarUrl: String(body.avatarUrl || ""),
    coverUrl: String(body.coverUrl || ""),
    settings: body.settings && typeof body.settings === "object" ? body.settings : {},
    visitedIds: uniqueNumberList(body.visitedIds),
    visitedPlaces,
    savedIds: uniqueNumberList(body.savedIds),
    savedPlaces,
    activity,
    goals,
    interests,
    memories
  };
}

function uniqueNumberList(input) {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.map((v) => Number(v)).filter((n) => Number.isFinite(n) && n > 0))];
}

function normalizeActivityEntries(input, limit = 50) {
  const arr = Array.isArray(input) ? input : [];
  const uniq = new Map();
  arr.forEach((item) => {
    if (!item || typeof item !== "object") return;
    const type = String(item.type || "note").slice(0, 40);
    const text = String(item.text || "").trim().slice(0, 300);
    const time = Number(item.time || 0);
    if (!text || !Number.isFinite(time) || time <= 0) return;
    const key = `${type}|${time}|${text}`;
    if (!uniq.has(key)) uniq.set(key, { type, text, time });
  });
  return [...uniq.values()].sort((a, b) => b.time - a.time).slice(0, limit);
}

function normalizeGoalItem(goal, fallback) {
  const base = fallback || { icon: "goal", label: "Travel Goal", current: 0, target: 1, metric: "manual" };
  const icon = String(goal?.icon || base.icon || "goal").slice(0, 16);
  const metricRaw = String(goal?.metric || base.metric || "manual").trim().toLowerCase();
  const metricAllowed = ["places", "cities", "memories", "manual"];
  const metric = metricAllowed.includes(metricRaw) ? metricRaw : "manual";
  const label = String(goal?.label || base.label || "Travel Goal").trim().slice(0, 120) || "Travel Goal";
  const current = Math.max(0, Number(goal?.current || base.current || 0));
  const targetRaw = Number(goal?.target || base.target || 1);
  const target = Number.isFinite(targetRaw) && targetRaw > 0 ? Math.round(targetRaw) : 1;
  return { icon, label, current, target, metric };
}

async function getUserIdentityByUid(uid) {
  const userId = extractUserIdFromUid(uid);
  if (!userId) return null;
  const [rows] = await pool.query("SELECT full_name, username FROM users WHERE id = ? LIMIT 1", [userId]);
  if (!rows.length) return null;
  const row = rows[0];
  return {
    name: clampText(row.full_name || "Traveller", 120) || "Traveller",
    username: clampText(row.username || "@explorer", 80) || "@explorer"
  };
}

async function ensureProfileRow(uid) {
  await pool.query(
    `
    INSERT INTO profile_states (
      uid, name, username, bio, location, avatar_url, cover_url,
      settings_json, visited_ids_json, visited_places_json, saved_ids_json, saved_places_json, activity_json,
      goals_json, interests_json, memories_json
    ) VALUES (?, 'Traveller', '@explorer', '', 'Nashik, Maharashtra', '', '', '{}', '[]', '[]', '[]', '{}', '[]', '[]', '[]', '[]')
    ON DUPLICATE KEY UPDATE uid = uid
    `,
    [uid]
  );
}

router.get("/profile/:uid", requireAuth, requireProfileOwner, async (req, res) => {
  try {
    const { uid } = req.params;
    if (!isValidUid(uid)) {
      return res.status(400).json({ success: false, message: "Invalid user id format" });
    }

    const [rows] = await pool.query("SELECT * FROM profile_states WHERE uid = ? LIMIT 1", [uid]);
    const identity = await getUserIdentityByUid(uid);

    if (rows.length === 0) {
      return res.status(200).json({
        success: true,
        profile: {
          uid,
          name: identity?.name || "Traveller",
          username: identity?.username || "@explorer",
          bio: "",
          location: "Nashik, Maharashtra",
          avatarUrl: "",
          coverUrl: "",
          settings: {},
          visitedIds: [],
          visitedPlaces: [],
          savedIds: [],
          savedPlaces: {},
          activity: [],
          goals: [],
          interests: [],
          memories: []
        }
      });
    }

    const row = rows[0];
    const resolvedName = identity?.name || row.name || "Traveller";
    const resolvedUsername = identity?.username || row.username || "@explorer";
    const avatarInfo = normalizeImageField(row.avatar_url);
    const coverInfo = normalizeImageField(row.cover_url);
    return res.status(200).json({
      success: true,
      profile: {
        uid: row.uid,
        name: resolvedName,
        username: resolvedUsername,
        bio: row.bio || "",
        location: row.location || "Nashik, Maharashtra",
        avatarUrl: avatarInfo.value,
        coverUrl: coverInfo.value,
        settings: safeJsonParse(row.settings_json, {}),
        visitedIds: safeJsonParse(row.visited_ids_json, []),
        visitedPlaces: normalizeVisitedPlacesList(safeJsonParse(row.visited_places_json, [])),
        savedIds: safeJsonParse(row.saved_ids_json, []),
        savedPlaces: normalizeSavedPlacesMap(safeJsonParse(row.saved_places_json, {})),
        activity: safeJsonParse(row.activity_json, []),
        goals: safeJsonParse(row.goals_json, []),
        interests: safeJsonParse(row.interests_json, []),
        memories: normalizeMemoryEntries(safeJsonParse(row.memories_json, []))
      }
    });
  } catch (error) {
    console.error("Profile GET error:", error);
    return res.status(500).json({ success: false, message: "Server error while fetching profile" });
  }
});

router.put("/profile/:uid", requireAuth, requireProfileOwner, async (req, res) => {
  try {
    const { uid } = req.params;
    if (!isValidUid(uid)) {
      return res.status(400).json({ success: false, message: "Invalid user id format" });
    }

    const avatarInfo = normalizeImageField(req.body?.avatarUrl);
    const coverInfo = normalizeImageField(req.body?.coverUrl);
    if (avatarInfo.tooLarge || coverInfo.tooLarge) {
      return res.status(413).json({
        success: false,
        message: "Profile image is too large. Please use a smaller image."
      });
    }

    const payload = normalizeProfilePayload(req.body || {});
    payload.avatarUrl = avatarInfo.value;
    payload.coverUrl = coverInfo.value;
    const identity = await getUserIdentityByUid(uid);
    if (identity) {
      if (!payload.name || payload.name === "Traveller") {
        payload.name = identity.name;
      }
      if (!payload.username || payload.username === "@explorer") {
        payload.username = identity.username;
      }
    }

    await pool.query(
      `
      INSERT INTO profile_states (
        uid, name, username, bio, location, avatar_url, cover_url,
        settings_json, visited_ids_json, visited_places_json, saved_ids_json, saved_places_json, activity_json,
        goals_json, interests_json, memories_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        name = VALUES(name),
        username = VALUES(username),
        bio = VALUES(bio),
        location = VALUES(location),
        avatar_url = VALUES(avatar_url),
        cover_url = VALUES(cover_url),
        settings_json = VALUES(settings_json),
        visited_ids_json = VALUES(visited_ids_json),
        visited_places_json = VALUES(visited_places_json),
        saved_ids_json = VALUES(saved_ids_json),
        saved_places_json = VALUES(saved_places_json),
        activity_json = VALUES(activity_json),
        goals_json = VALUES(goals_json),
        interests_json = VALUES(interests_json),
        memories_json = VALUES(memories_json)
      `,
      [
        uid,
        payload.name,
        payload.username,
        payload.bio,
        payload.location,
        payload.avatarUrl,
        payload.coverUrl,
        safeJsonStringify(payload.settings, "{}"),
        safeJsonStringify(payload.visitedIds),
        safeJsonStringify(payload.visitedPlaces),
        safeJsonStringify(payload.savedIds),
        safeJsonStringify(payload.savedPlaces, "{}"),
        safeJsonStringify(payload.activity),
        safeJsonStringify(payload.goals),
        safeJsonStringify(payload.interests),
        safeJsonStringify(payload.memories)
      ]
    );

    return res.status(200).json({
      success: true,
      message: "Profile saved",
      profile: {
        uid,
        ...payload
      }
    });
  } catch (error) {
    console.error("Profile PUT error:", error);
    return res.status(500).json({ success: false, message: "Server error while saving profile" });
  }
});

router.patch("/profile/:uid/identity", requireAuth, requireProfileOwner, async (req, res) => {
  try {
    const { uid } = req.params;
    if (!isValidUid(uid)) {
      return res.status(400).json({ success: false, message: "Invalid user id format" });
    }

    const userId = extractUserIdFromUid(uid);
    if (!userId) {
      return res.status(400).json({ success: false, message: "Identity update requires a database user id" });
    }

    const name = clampText(req.body?.name, 120);
    const username = normalizeUsernameValue(req.body?.username);
    if (!name) {
      return res.status(400).json({ success: false, message: "Please enter your full name" });
    }
    if (!username) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid username (letters, numbers, dot or underscore)"
      });
    }

    const [dupeRows] = await pool.query(
      "SELECT id FROM users WHERE username = ? AND id <> ? LIMIT 1",
      [username, userId]
    );
    if (dupeRows.length > 0) {
      return res.status(409).json({ success: false, message: "This username is already taken" });
    }

    await pool.query("UPDATE users SET full_name = ?, username = ? WHERE id = ? LIMIT 1", [name, username, userId]);

    await ensureProfileRow(uid);
    await pool.query("UPDATE profile_states SET name = ?, username = ? WHERE uid = ?", [name, username, uid]);

    return res.status(200).json({
      success: true,
      message: "Identity updated",
      identity: { name, username }
    });
  } catch (error) {
    console.error("Profile identity PATCH error:", error);
    return res.status(500).json({ success: false, message: "Server error while updating identity" });
  }
});

router.patch("/profile/:uid/visited", requireAuth, requireProfileOwner, async (req, res) => {
  try {
    const { uid } = req.params;
    if (!isValidUid(uid)) {
      return res.status(400).json({ success: false, message: "Invalid user id format" });
    }

    const placeId = Number(req.body?.placeId);
    if (!Number.isFinite(placeId) || placeId <= 0) {
      return res.status(400).json({ success: false, message: "Invalid place id" });
    }

    await ensureProfileRow(uid);

    const [rows] = await pool.query(
      "SELECT visited_ids_json, activity_json FROM profile_states WHERE uid = ? LIMIT 1",
      [uid]
    );
    const row = rows[0] || {};
    const visitedIds = uniqueNumberList(safeJsonParse(row.visited_ids_json, []));
    const activity = Array.isArray(safeJsonParse(row.activity_json, []))
      ? safeJsonParse(row.activity_json, [])
      : [];

    if (!visitedIds.includes(placeId)) {
      visitedIds.push(placeId);
    }

    const act = req.body?.activity;
    if (act && typeof act === "object") {
      const type = String(act.type || "view").slice(0, 40);
      const text = String(act.text || "").slice(0, 300);
      const time = Number(act.time || Date.now());
      if (text) {
        activity.unshift({ type, text, time: Number.isFinite(time) ? time : Date.now() });
      }
    }
    const trimmedActivity = normalizeActivityEntries(activity, 50);

    await pool.query(
      "UPDATE profile_states SET visited_ids_json = ?, activity_json = ? WHERE uid = ?",
      [safeJsonStringify(visitedIds), safeJsonStringify(trimmedActivity), uid]
    );

    return res.status(200).json({
      success: true,
      message: "Visited places updated",
      visitedIds,
      activity: trimmedActivity
    });
  } catch (error) {
    console.error("Profile visited PATCH error:", error);
    return res.status(500).json({ success: false, message: "Server error while updating visited places" });
  }
});

router.patch("/profile/:uid/goals", requireAuth, requireProfileOwner, async (req, res) => {
  try {
    const { uid } = req.params;
    if (!isValidUid(uid)) {
      return res.status(400).json({ success: false, message: "Invalid user id format" });
    }

    const incomingGoals = Array.isArray(req.body?.goals) ? req.body.goals : null;
    if (!incomingGoals || incomingGoals.length === 0) {
      return res.status(400).json({ success: false, message: "Goals list is required" });
    }

    const defaults = [
      { icon: "map", label: "Visit 10 places this year", current: 0, target: 10, metric: "places" },
      { icon: "city", label: "Explore 5 new cities", current: 0, target: 5, metric: "cities" },
      { icon: "camera", label: "Upload 20 memories", current: 0, target: 20, metric: "memories" }
    ];
    const normalizedGoals = incomingGoals.slice(0, 6).map((g, i) => normalizeGoalItem(g, defaults[i]));

    await ensureProfileRow(uid);
    await pool.query("UPDATE profile_states SET goals_json = ? WHERE uid = ?", [
      safeJsonStringify(normalizedGoals),
      uid
    ]);

    return res.status(200).json({
      success: true,
      message: "Goals updated",
      goals: normalizedGoals
    });
  } catch (error) {
    console.error("Profile goals PATCH error:", error);
    return res.status(500).json({ success: false, message: "Server error while updating goals" });
  }
});

router.patch("/profile/:uid/activity", requireAuth, requireProfileOwner, async (req, res) => {
  try {
    const { uid } = req.params;
    if (!isValidUid(uid)) {
      return res.status(400).json({ success: false, message: "Invalid user id format" });
    }

    await ensureProfileRow(uid);

    const [rows] = await pool.query("SELECT activity_json FROM profile_states WHERE uid = ? LIMIT 1", [uid]);
    const current = Array.isArray(safeJsonParse(rows?.[0]?.activity_json, []))
      ? safeJsonParse(rows?.[0]?.activity_json, [])
      : [];

    const mode = String(req.body?.mode || "append").toLowerCase();
    let next = current;

    if (mode === "clear") {
      next = [];
    } else if (mode === "replace") {
      const items = Array.isArray(req.body?.items) ? req.body.items : [];
      next = items.slice(0, 50).map((item) => ({
        type: String(item?.type || "note").slice(0, 40),
        text: String(item?.text || "").slice(0, 300),
        time: Number(item?.time || Date.now())
      }));
    } else {
      const entry = req.body?.entry;
      if (!entry || typeof entry !== "object") {
        return res.status(400).json({ success: false, message: "Activity entry is required" });
      }
      const normalized = {
        type: String(entry.type || "note").slice(0, 40),
        text: String(entry.text || "").slice(0, 300),
        time: Number(entry.time || Date.now())
      };
      if (normalized.text) {
        next = [normalized, ...current];
      }
    }

    next = normalizeActivityEntries(next, 50);

    await pool.query("UPDATE profile_states SET activity_json = ? WHERE uid = ?", [
      safeJsonStringify(next),
      uid
    ]);

    return res.status(200).json({
      success: true,
      message: "Activity updated",
      activity: next
    });
  } catch (error) {
    console.error("Profile activity PATCH error:", error);
    return res.status(500).json({ success: false, message: "Server error while updating activity" });
  }
});

router.delete("/profile/:uid/data", requireAuth, requireProfileOwner, async (req, res) => {
  try {
    const { uid } = req.params;
    if (!isValidUid(uid)) {
      return res.status(400).json({ success: false, message: "Invalid user id format" });
    }

    const userId = extractUserIdFromUid(uid);

    await pool.query("DELETE FROM profile_states WHERE uid = ?", [uid]);
    if (userId) {
      await pool.query("DELETE FROM user_profiles WHERE user_id = ?", [userId]);
      await pool.query(
        "UPDATE itineraries SET deleted_at = NOW() WHERE user_id = ? AND deleted_at IS NULL",
        [userId]
      );
    }
    await pool.query("DELETE FROM memory_moderation WHERE uid = ?", [uid]);

    return res.status(200).json({
      success: true,
      message: "Profile data deleted from database"
    });
  } catch (error) {
    console.error("Profile data DELETE error:", error);
    return res.status(500).json({ success: false, message: "Server error while deleting profile data" });
  }
});

router.delete("/profile/:uid", requireAuth, requireProfileOwner, async (req, res) => {
  const { uid } = req.params;
  if (!isValidUid(uid)) {
    return res.status(400).json({ success: false, message: "Invalid user id format" });
  }

  const userId = extractUserIdFromUid(uid);
  if (!userId) {
    return res.status(400).json({ success: false, message: "Profile deletion requires a database user account" });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [rows] = await connection.query(
      `SELECT id, full_name, email, username, role, account_status, deleted_at,
              deleted_original_email, deleted_original_username
       FROM users
       WHERE id = ?
       LIMIT 1
       FOR UPDATE`,
      [userId]
    );
    if (!rows.length) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: "User account not found" });
    }

    const user = rows[0];
    if (isProtectedAdminIdentity(user)) {
      await connection.rollback();
      return res.status(403).json({
        success: false,
        message: "Super Admin profile cannot be deleted"
      });
    }

    const currentStatus = user.deleted_at ? "deleted" : String(user.account_status || "active").toLowerCase();
    if (currentStatus === "deleted") {
      await connection.rollback();
      return res.status(200).json({
        success: true,
        message: "Profile is already deleted"
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
    await connection.query("DELETE FROM profile_states WHERE uid = ?", [uid]);
    await connection.query("DELETE FROM user_profiles WHERE user_id = ?", [userId]);
    await connection.query("DELETE FROM itineraries WHERE user_id = ?", [userId]);
    await connection.query(
      `INSERT INTO audit_logs (action, entity, entity_id, details, meta_json)
       VALUES ('delete_profile', 'user', ?, ?, ?)`,
      [
        userId,
        `User deleted own profile "${user.full_name}" (${user.email})`,
        safeJsonStringify({
          uid,
          email: user.email,
          username: user.username || "",
          deletedEmail: deletedIdentity.email,
          role: user.role || "Traveller",
          deletedBy: Number(req.auth?.userId || 0) === userId ? "self" : "admin"
        }, "{}")
      ]
    );

    await connection.commit();
    return res.status(200).json({
      success: true,
      message: "Profile deleted successfully",
      deleted: {
        uid,
        userId,
        status: "deleted"
      }
    });
  } catch (error) {
    await connection.rollback();
    console.error("Profile account DELETE error:", error);
    return res.status(500).json({ success: false, message: "Server error while deleting profile" });
  } finally {
    connection.release();
  }
});

module.exports = router;
