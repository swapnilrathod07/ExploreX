const express = require("express");
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { requireAuth } = require("../middleware/auth.middleware");
const { pool } = require("../config/db");
const { extractBearerToken, verifyHotelOwnerToken } = require("../utils/jwt");

const router = express.Router();
const uploadRoot = path.join(__dirname, "..", "..", "uploads", "images");
const allowedMimeToExt = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
  ["image/avif", "avif"]
]);
const maxImageBytes = Math.max(
  256 * 1024,
  Math.min(12 * 1024 * 1024, Number(process.env.UPLOAD_IMAGE_MAX_BYTES || 6 * 1024 * 1024))
);

function parseDataImage(dataUrl) {
  const raw = String(dataUrl || "").trim();
  const match = raw.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\r\n]+)$/i);
  if (!match) return null;
  const mime = match[1].toLowerCase();
  const ext = allowedMimeToExt.get(mime);
  if (!ext) return null;
  const buffer = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
  if (!looksLikeImageBuffer(buffer, mime)) return null;
  return { mime, ext, buffer };
}

function looksLikeImageBuffer(buffer, mime) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  if (mime === "image/jpeg") {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mime === "image/png") {
    return buffer.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (mime === "image/gif") {
    return buffer.slice(0, 6).toString("ascii") === "GIF87a" ||
      buffer.slice(0, 6).toString("ascii") === "GIF89a";
  }
  if (mime === "image/webp") {
    return buffer.slice(0, 4).toString("ascii") === "RIFF" &&
      buffer.slice(8, 12).toString("ascii") === "WEBP";
  }
  if (mime === "image/avif") {
    return buffer.slice(4, 8).toString("ascii") === "ftyp" &&
      buffer.slice(8, 16).toString("ascii").includes("avif");
  }
  return false;
}

function buildPublicUploadUrl(req, filename) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const protocol = forwardedProto || req.protocol || "http";
  const host = req.get("host");
  return `${protocol}://${host}/uploads/images/${encodeURIComponent(filename)}`;
}

async function requireImageUploadAuth(req, res, next) {
  const token = extractBearerToken(req.headers.authorization);
  if (token) {
    try {
      const decoded = verifyHotelOwnerToken(token);
      const hotelId = String(decoded.hotelId || "").trim().toUpperCase();
      const [rows] = await pool.query(
        "SELECT hotel_id, hotel_name FROM hotel_owner_logins WHERE hotel_id = ? AND status = 'active' LIMIT 1",
        [hotelId]
      );
      if (rows.length) {
        req.auth = {
          uid: `hotel_owner_${hotelId}`,
          role: "HotelOwner",
          hotelId,
          hotelName: rows[0].hotel_name || decoded.hotelName || "Hotel"
        };
        return next();
      }
    } catch (error) {
      // A normal user/admin token is checked by requireAuth below.
    }
  }
  return requireAuth(req, res, next);
}

router.post("/uploads/image", requireImageUploadAuth, async (req, res) => {
  try {
    const parsed = parseDataImage(req.body?.dataUrl);
    if (!parsed) {
      return res.status(400).json({
        success: false,
        message: "Only JPEG, PNG, WebP, GIF, or AVIF image uploads are allowed."
      });
    }
    if (parsed.buffer.length > maxImageBytes) {
      return res.status(413).json({
        success: false,
        message: `Image is too large. Max size is ${Math.round(maxImageBytes / 1024 / 1024)}MB.`
      });
    }

    const kind = String(req.body?.kind || "image").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 24) || "image";
    const owner = String(req.auth?.uid || req.auth?.userId || "user").replace(/[^a-z0-9_-]/gi, "").slice(0, 40) || "user";
    const nonce = crypto.randomBytes(8).toString("hex");
    const filename = `${owner}-${kind}-${Date.now()}-${nonce}.${parsed.ext}`;

    await fs.mkdir(uploadRoot, { recursive: true });
    await fs.writeFile(path.join(uploadRoot, filename), parsed.buffer, { flag: "wx" });

    return res.status(201).json({
      success: true,
      message: "Image uploaded",
      data: {
        url: buildPublicUploadUrl(req, filename),
        relativeUrl: `/uploads/images/${encodeURIComponent(filename)}`,
        filename,
        mime: parsed.mime,
        size: parsed.buffer.length
      }
    });
  } catch (error) {
    console.error("Image upload error:", error);
    return res.status(500).json({ success: false, message: "Server error while uploading image" });
  }
});

module.exports = router;
