const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { pool } = require("../src/config/db");

const uploadRoot = path.join(__dirname, "..", "uploads", "images");
const mimeToExt = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
  ["image/avif", "avif"]
]);

function parseDataImage(dataUrl) {
  const raw = String(dataUrl || "").trim();
  const match = raw.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\r\n]+)$/i);
  if (!match) return null;
  const mime = match[1].toLowerCase();
  const ext = mimeToExt.get(mime);
  if (!ext) return null;
  const buffer = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
  if (buffer.length < 12) return null;
  return { mime, ext, buffer };
}

function isValidStoredUrl(value) {
  const raw = String(value || "").trim();
  if (!raw || /^data:/i.test(raw) || raw.length > 4096) return false;
  return /^https?:\/\/[^\s"'<>]+$/i.test(raw) || /^\/uploads\/images\/[a-zA-Z0-9._-]+$/i.test(raw);
}

function normalizeLocalhostUploadUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.startsWith("/uploads/")) return raw;
  try {
    const url = new URL(raw);
    if (["localhost", "127.0.0.1", "::1"].includes(url.hostname) && url.pathname.startsWith("/uploads/")) {
      return url.pathname;
    }
  } catch (error) {}
  return raw;
}

async function migrate() {
  await fs.mkdir(uploadRoot, { recursive: true });
  const [rows] = await pool.query(
    "SELECT uid, memories_json FROM profile_states WHERE memories_json IS NOT NULL AND memories_json <> '' AND memories_json <> '[]'"
  );

  let converted = 0;
  let normalized = 0;
  let skippedMissing = 0;
  let updatedProfiles = 0;

  for (const row of rows) {
    let memories;
    try {
      memories = JSON.parse(row.memories_json);
    } catch (error) {
      continue;
    }
    if (!Array.isArray(memories)) continue;

    let changed = false;
    const next = [];
    for (const memory of memories) {
      if (!memory || typeof memory !== "object") continue;
      const mediaUrl = String(memory.mediaUrl || memory.media_url || "").trim();

      if (/^data:image\//i.test(mediaUrl)) {
        const parsed = parseDataImage(mediaUrl);
        if (!parsed) {
          skippedMissing += 1;
          next.push({ ...memory, mediaUrl: "" });
          changed = true;
          continue;
        }
        const owner = String(row.uid || "user").replace(/[^a-z0-9_-]/gi, "").slice(0, 40) || "user";
        const filename = `${owner}-memory-migrated-${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${parsed.ext}`;
        await fs.writeFile(path.join(uploadRoot, filename), parsed.buffer, { flag: "wx" });
        next.push({ ...memory, mediaType: "image", mediaUrl: `/uploads/images/${filename}` });
        converted += 1;
        changed = true;
        continue;
      }

      if (isValidStoredUrl(mediaUrl)) {
        const normalizedUrl = normalizeLocalhostUploadUrl(mediaUrl);
        next.push({ ...memory, mediaUrl: normalizedUrl });
        if (normalizedUrl !== mediaUrl) {
          normalized += 1;
          changed = true;
        }
      } else {
        skippedMissing += 1;
        next.push({ ...memory, mediaUrl: "" });
      }
    }

    if (changed) {
      await pool.query("UPDATE profile_states SET memories_json = ? WHERE uid = ?", [
        JSON.stringify(next),
        row.uid
      ]);
      updatedProfiles += 1;
    }
  }

  console.log(JSON.stringify({ converted, normalized, skippedMissing, updatedProfiles }, null, 2));
}

migrate()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
