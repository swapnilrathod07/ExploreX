const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { pool } = require("../src/config/db");

function normalizeMemoryMediaUrl(value) {
  const raw = String(value || "").trim();
  if (!raw || /^data:/i.test(raw) || raw.length > 4096) return "";
  if (/^\/uploads\/images\/[a-zA-Z0-9._-]+$/i.test(raw)) return raw;

  try {
    const url = new URL(raw);
    if (
      ["localhost", "127.0.0.1", "::1"].includes(url.hostname) &&
      /^\/uploads\/images\/[a-zA-Z0-9._-]+$/i.test(url.pathname)
    ) {
      return url.pathname;
    }
  } catch (error) {}

  return /^https?:\/\/[^\s"'<>]+$/i.test(raw) ? raw : "";
}

async function cleanup() {
  const [rows] = await pool.query(
    "SELECT uid, memories_json FROM profile_states WHERE memories_json IS NOT NULL AND memories_json <> '' AND memories_json <> '[]'"
  );

  let profilesUpdated = 0;
  let removed = 0;
  let normalized = 0;

  for (const row of rows) {
    let memories;
    try {
      memories = JSON.parse(row.memories_json);
    } catch (error) {
      continue;
    }
    if (!Array.isArray(memories)) continue;

    const next = [];
    let changed = false;

    for (const memory of memories) {
      if (!memory || typeof memory !== "object") continue;
      const before = String(memory.mediaUrl || memory.media_url || "").trim();
      const mediaUrl = normalizeMemoryMediaUrl(before);

      if (!mediaUrl) {
        removed += 1;
        changed = true;
        continue;
      }

      if (mediaUrl !== before) {
        normalized += 1;
        changed = true;
      }

      next.push({ ...memory, mediaType: "image", mediaUrl });
    }

    if (changed) {
      await pool.query("UPDATE profile_states SET memories_json = ? WHERE uid = ?", [
        JSON.stringify(next),
        row.uid
      ]);
      profilesUpdated += 1;
    }
  }

  console.log(JSON.stringify({ profilesUpdated, removed, normalized }, null, 2));
}

cleanup()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
