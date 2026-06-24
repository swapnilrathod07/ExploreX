const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { pool } = require("../config/db");
const { toUsernameSeed } = require("../utils/username");
const { signAuthToken, extractBearerToken, verifyAuthToken } = require("../utils/jwt");
const { getOtpSmsProvider, sendOtpSms, shouldExposeOtpForProvider } = require("../utils/smsOtp");
const { sendPasswordResetEmail, sendSignupOtpEmail } = require("../utils/email");
const { requireAuth } = require("../middleware/auth.middleware");

const router = express.Router();
const ADMIN_EMAIL_SET = new Set(
  String(process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((value) => normalizeEmail(value))
    .filter(Boolean)
);
const PASSWORD_RESET_TOKEN_TTL_MINUTES = Math.max(
  5,
  Math.min(240, Number(process.env.PASSWORD_RESET_TOKEN_TTL_MINUTES || 30))
);
const PASSWORD_RESET_MAX_ATTEMPTS = 5;
const PHONE_OTP_TTL_MINUTES = Math.max(
  2,
  Math.min(30, Number(process.env.PHONE_OTP_TTL_MINUTES || 10))
);
const PHONE_OTP_MAX_ATTEMPTS = 5;
const PHONE_OTP_RESEND_COOLDOWN_SECONDS = Math.max(
  10,
  Math.min(120, Number(process.env.PHONE_OTP_RESEND_COOLDOWN_SECONDS || 25))
);
const EMAIL_OTP_TTL_MINUTES = Math.max(
  2,
  Math.min(30, Number(process.env.EMAIL_OTP_TTL_MINUTES || 10))
);
const EMAIL_OTP_MAX_ATTEMPTS = 5;
const EMAIL_OTP_RESEND_COOLDOWN_SECONDS = Math.max(
  10,
  Math.min(120, Number(process.env.EMAIL_OTP_RESEND_COOLDOWN_SECONDS || 25))
);

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizePhone(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const compact = raw.replace(/[\s().-]/g, "");
  if (/^\+91[6-9]\d{9}$/.test(compact)) return compact;
  const digits = compact.replace(/\D/g, "");
  if (/^[6-9]\d{9}$/.test(digits)) return `+91${digits}`;
  if (/^91[6-9]\d{9}$/.test(digits)) return `+${digits}`;
  return "";
}

function normalizeUsername(value) {
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

function resolveRegistrationRole(email) {
  if (ADMIN_EMAIL_SET.has(email)) return "Admin";
  return "Traveller";
}

function normalizeAccountStatus(value, fallback = "active") {
  const raw = String(value || "").trim().toLowerCase();
  if (["active", "inactive", "blocked", "deleted"].includes(raw)) return raw;
  return fallback;
}

function resolveClientIp(req) {
  const forwardedFor = String(req.headers["x-forwarded-for"] || "").trim();
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  return String(req.socket?.remoteAddress || req.ip || "");
}

function hashResetToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function hashPasswordResetCode(email, code) {
  return crypto
    .createHash("sha256")
    .update(`password-reset:${normalizeEmail(email)}:${String(code || "").trim()}`)
    .digest("hex");
}

function safeHashEquals(a, b) {
  const left = Buffer.from(String(a || ""), "utf8");
  const right = Buffer.from(String(b || ""), "utf8");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function hashOtp(phone, otp, purpose = "signup") {
  return crypto
    .createHash("sha256")
    .update(`${purpose}:${phone}:${String(otp || "").trim()}`)
    .digest("hex");
}

function hashEmailOtp(email, otp, purpose = "signup") {
  return crypto
    .createHash("sha256")
    .update(`${purpose}:${normalizeEmail(email)}:${String(otp || "").trim()}`)
    .digest("hex");
}

function hashPhoneVerificationToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function createPasswordResetCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function createPhoneOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

function createEmailOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

function getRetryAfterSeconds(createdAt, cooldownSeconds) {
  const createdMs = new Date(createdAt).getTime();
  if (!Number.isFinite(createdMs)) return cooldownSeconds;
  const elapsedSeconds = Math.floor((Date.now() - createdMs) / 1000);
  return Math.max(1, cooldownSeconds - elapsedSeconds);
}

function createPhoneVerificationToken() {
  return crypto.randomBytes(32).toString("hex");
}

function hashAuthToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function resolveTokenExpiry(decoded) {
  const expSeconds = Number(decoded?.exp || 0);
  if (Number.isFinite(expSeconds) && expSeconds > 0) {
    return new Date(expSeconds * 1000);
  }
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
}

function shouldExposeResetCode() {
  const raw = String(
    process.env.EXPOSE_PASSWORD_RESET_CODE_IN_RESPONSE || process.env.EXPOSE_RESET_TOKEN_IN_RESPONSE || ""
  ).trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(raw);
}

function shouldExposeOtp() {
  return shouldExposeOtpForProvider();
}

function shouldExposeEmailOtp() {
  const raw = String(process.env.EXPOSE_EMAIL_OTP_IN_RESPONSE || "").trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(raw);
}

function toPublicUser(row) {
  const status = normalizeAccountStatus(row.account_status, "active");
  return {
    uid: `user_${row.id}`,
    name: row.full_name,
    email: row.email,
    username: row.username,
    phone: row.phone || "",
    role: row.role || "Traveller",
    status
  };
}

function phoneOtpConfigHandler(req, res) {
  const provider = getOtpSmsProvider();
  const smsEnabled = !["dev", "local", "console"].includes(provider);
  return res.status(200).json({
    success: true,
    provider,
    smsEnabled,
    devOtpVisible: shouldExposeOtp(),
    message: smsEnabled
      ? `Phone OTP SMS delivery is active via ${provider}.`
      : "Demo OTP mode is active for local testing. Configure MSG91 or Twilio only when you want real SMS."
  });
}

async function sendPhoneOtpHandler(req, res) {
  try {
    const phone = normalizePhone(req.body.phone);
    const purpose = String(req.body.purpose || "signup").trim().toLowerCase() || "signup";
    if (purpose !== "signup") {
      return res.status(400).json({ success: false, message: "Invalid OTP purpose" });
    }
    if (!phone) {
      return res.status(400).json({ success: false, message: "Please enter a valid 10 digit mobile number" });
    }

    const [existingRows] = await pool.query(
      "SELECT id FROM users WHERE phone = ? AND deleted_at IS NULL LIMIT 1",
      [phone]
    );
    if (existingRows.length > 0) {
      return res.status(409).json({ success: false, message: "This mobile number is already registered" });
    }

    const [recentRows] = await pool.query(
      `SELECT id, created_at
       FROM phone_otp_verifications
       WHERE phone = ? AND purpose = ? AND created_at > (NOW() - INTERVAL ${PHONE_OTP_RESEND_COOLDOWN_SECONDS} SECOND)
       ORDER BY id DESC
       LIMIT 1`,
      [phone, purpose]
    );
    if (recentRows.length > 0) {
      const retryAfterSeconds = getRetryAfterSeconds(
        recentRows[0].created_at,
        PHONE_OTP_RESEND_COOLDOWN_SECONDS
      );
      return res.status(429).json({
        success: false,
        code: "PHONE_OTP_COOLDOWN",
        message: `OTP already sent. Please wait ${retryAfterSeconds}s before requesting again.`,
        retryAfterSeconds
      });
    }

    const otp = createPhoneOtp();
    const expiresAt = new Date(Date.now() + PHONE_OTP_TTL_MINUTES * 60 * 1000);
    await pool.query(
      "DELETE FROM phone_otp_verifications WHERE phone = ? AND purpose = ? AND (expires_at < NOW() OR verified_at IS NOT NULL)",
      [phone, purpose]
    );
    await pool.query(
      `INSERT INTO phone_otp_verifications (phone, purpose, otp_hash, requested_ip, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
      [phone, purpose, hashOtp(phone, otp, purpose), resolveClientIp(req), expiresAt]
    );

    let delivery;
    try {
      delivery = await sendOtpSms({
        phone,
        otp,
        purpose,
        expiresInMinutes: PHONE_OTP_TTL_MINUTES
      });
    } catch (smsError) {
      await pool.query(
        "DELETE FROM phone_otp_verifications WHERE phone = ? AND purpose = ? AND otp_hash = ? AND verified_at IS NULL",
        [phone, purpose, hashOtp(phone, otp, purpose)]
      );
      console.error("OTP SMS delivery error:", smsError);
      return res.status(502).json({
        success: false,
        message: smsError.message || "Could not send OTP SMS. Please try again."
      });
    }

    const response = {
      success: true,
      message: delivery?.sent
        ? "OTP sent to your mobile number"
        : "OTP generated successfully",
      phone,
      expiresInMinutes: PHONE_OTP_TTL_MINUTES,
      resendAfterSeconds: PHONE_OTP_RESEND_COOLDOWN_SECONDS,
      delivery: {
        provider: delivery?.provider || getOtpSmsProvider(),
        sent: Boolean(delivery?.sent)
      }
    };
    if (shouldExposeOtp()) {
      response.devOnly = {
        otp,
        note: "Use this OTP only in local/dev mode. Configure SMS_OTP_PROVIDER for real SMS delivery."
      };
    }
    return res.status(200).json(response);
  } catch (error) {
    console.error("Send phone OTP error:", error);
    return res.status(500).json({ success: false, message: "Server error while sending OTP" });
  }
}

async function verifyPhoneOtpHandler(req, res) {
  const phone = normalizePhone(req.body.phone);
  const otp = String(req.body.otp || "").trim();
  const purpose = String(req.body.purpose || "signup").trim().toLowerCase() || "signup";

  if (purpose !== "signup") {
    return res.status(400).json({ success: false, message: "Invalid OTP purpose" });
  }
  if (!phone) {
    return res.status(400).json({ success: false, message: "Please enter a valid 10 digit mobile number" });
  }
  if (!/^\d{6}$/.test(otp)) {
    return res.status(400).json({ success: false, message: "Please enter the 6 digit OTP" });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT id, otp_hash, attempts, expires_at, verified_at
       FROM phone_otp_verifications
       WHERE phone = ? AND purpose = ?
       ORDER BY id DESC
       LIMIT 1
       FOR UPDATE`,
      [phone, purpose]
    );

    if (!rows.length) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: "Please request OTP first" });
    }

    const row = rows[0];
    if (row.verified_at) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: "OTP is already used. Please request a new OTP." });
    }
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: "OTP expired. Please request a new OTP." });
    }
    if (Number(row.attempts || 0) >= PHONE_OTP_MAX_ATTEMPTS) {
      await connection.rollback();
      return res.status(429).json({ success: false, message: "Too many wrong attempts. Please request a new OTP." });
    }

    const expectedHash = hashOtp(phone, otp, purpose);
    if (expectedHash !== row.otp_hash) {
      await connection.query(
        "UPDATE phone_otp_verifications SET attempts = attempts + 1 WHERE id = ?",
        [row.id]
      );
      await connection.commit();
      return res.status(400).json({ success: false, message: "Invalid OTP" });
    }

    const verificationToken = createPhoneVerificationToken();
    await connection.query(
      `UPDATE phone_otp_verifications
       SET verified_at = NOW(), verification_token_hash = ?
       WHERE id = ?`,
      [hashPhoneVerificationToken(verificationToken), row.id]
    );
    await connection.commit();

    return res.status(200).json({
      success: true,
      message: "Mobile number verified",
      phone,
      phoneVerificationToken: verificationToken
    });
  } catch (error) {
    await connection.rollback();
    console.error("Verify phone OTP error:", error);
    return res.status(500).json({ success: false, message: "Server error while verifying OTP" });
  } finally {
    connection.release();
  }
}

async function sendEmailOtpHandler(req, res) {
  try {
    const email = normalizeEmail(req.body.email);
    const purpose = String(req.body.purpose || "signup").trim().toLowerCase() || "signup";
    if (purpose !== "signup") {
      return res.status(400).json({ success: false, message: "Invalid OTP purpose" });
    }
    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ success: false, message: "Please enter a valid email address" });
    }

    const [existingRows] = await pool.query(
      "SELECT id FROM users WHERE email = ? AND deleted_at IS NULL LIMIT 1",
      [email]
    );
    if (existingRows.length > 0) {
      return res.status(409).json({ success: false, message: "An account with this email already exists" });
    }

    const [recentRows] = await pool.query(
      `SELECT id, created_at
       FROM email_otp_verifications
       WHERE email = ? AND purpose = ? AND created_at > (NOW() - INTERVAL ${EMAIL_OTP_RESEND_COOLDOWN_SECONDS} SECOND)
       ORDER BY id DESC
       LIMIT 1`,
      [email, purpose]
    );
    if (recentRows.length > 0) {
      const retryAfterSeconds = getRetryAfterSeconds(
        recentRows[0].created_at,
        EMAIL_OTP_RESEND_COOLDOWN_SECONDS
      );
      return res.status(429).json({
        success: false,
        code: "EMAIL_OTP_COOLDOWN",
        message: `OTP already sent. Please check your inbox or wait ${retryAfterSeconds}s before requesting again.`,
        retryAfterSeconds
      });
    }

    const otp = createEmailOtp();
    const expiresAt = new Date(Date.now() + EMAIL_OTP_TTL_MINUTES * 60 * 1000);
    const otpHash = hashEmailOtp(email, otp, purpose);

    await pool.query(
      "DELETE FROM email_otp_verifications WHERE email = ? AND purpose = ? AND (expires_at < NOW() OR verified_at IS NOT NULL)",
      [email, purpose]
    );
    await pool.query(
      `INSERT INTO email_otp_verifications (email, purpose, otp_hash, requested_ip, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
      [email, purpose, otpHash, resolveClientIp(req), expiresAt]
    );

    let delivery;
    try {
      delivery = await sendSignupOtpEmail({
        email,
        otp,
        expiresInMinutes: EMAIL_OTP_TTL_MINUTES
      });
    } catch (emailError) {
      await pool.query(
        "DELETE FROM email_otp_verifications WHERE email = ? AND purpose = ? AND otp_hash = ? AND verified_at IS NULL",
        [email, purpose, otpHash]
      );
      console.error("Signup email OTP delivery error:", emailError);
      return res.status(502).json({
        success: false,
        message: emailError.message || "Could not send OTP email. Please try again."
      });
    }

    const response = {
      success: true,
      message: delivery?.delivered
        ? "OTP sent to your email"
        : "OTP generated successfully. Check the backend terminal or configure Gmail SMTP.",
      email,
      expiresInMinutes: EMAIL_OTP_TTL_MINUTES,
      resendAfterSeconds: EMAIL_OTP_RESEND_COOLDOWN_SECONDS,
      delivery: {
        provider: delivery?.provider || "unknown",
        sent: Boolean(delivery?.delivered)
      }
    };
    if (shouldExposeEmailOtp()) {
      response.devOnly = {
        otp,
        note: "Use this only in local/dev mode. Keep EXPOSE_EMAIL_OTP_IN_RESPONSE=false for normal testing."
      };
    }
    return res.status(200).json(response);
  } catch (error) {
    console.error("Send email OTP error:", error);
    return res.status(500).json({ success: false, message: "Server error while sending email OTP" });
  }
}

async function registerHandler(req, res) {
  let connection;
  try {
    const name = String(req.body.name || "").trim();
    const email = normalizeEmail(req.body.email);
    const phone = normalizePhone(req.body.phone);
    const password = String(req.body.password || "");
    const requestedUsername = normalizeUsername(req.body.username);
    const emailOtp = String(req.body.emailOtp || req.body.otp || "").trim();

    if (!name) {
      return res.status(400).json({ success: false, message: "Please enter your full name" });
    }
    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ success: false, message: "Please enter a valid email address" });
    }
    if (!phone) {
      return res.status(400).json({ success: false, message: "Please enter a valid mobile number" });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ success: false, message: "Password must be at least 6 characters" });
    }
    if (!/^\d{6}$/.test(emailOtp)) {
      return res.status(400).json({ success: false, message: "Please enter the 6 digit email OTP" });
    }
    if (req.body.username && !requestedUsername) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid username (letters, numbers, dot or underscore)"
      });
    }

    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [otpRows] = await connection.query(
      `SELECT id, otp_hash, attempts, expires_at, verified_at
       FROM email_otp_verifications
       WHERE email = ? AND purpose = 'signup'
       ORDER BY id DESC
       LIMIT 1
       FOR UPDATE`,
      [email]
    );
    if (!otpRows.length) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: "Please send email OTP first" });
    }

    const otpRow = otpRows[0];
    if (otpRow.verified_at) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: "OTP is already used. Please request a new OTP." });
    }
    if (new Date(otpRow.expires_at).getTime() <= Date.now()) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: "OTP expired. Please request a new OTP." });
    }
    if (Number(otpRow.attempts || 0) >= EMAIL_OTP_MAX_ATTEMPTS) {
      await connection.rollback();
      return res.status(429).json({ success: false, message: "Too many wrong OTP attempts. Please request a new OTP." });
    }

    if (hashEmailOtp(email, emailOtp, "signup") !== otpRow.otp_hash) {
      await connection.query(
        "UPDATE email_otp_verifications SET attempts = attempts + 1 WHERE id = ?",
        [otpRow.id]
      );
      await connection.commit();
      return res.status(400).json({ success: false, message: "Invalid email OTP" });
    }

    const [existingRows] = await connection.query(
      "SELECT id FROM users WHERE email = ? AND deleted_at IS NULL LIMIT 1",
      [email]
    );
    if (existingRows.length > 0) {
      await connection.rollback();
      return res.status(409).json({ success: false, message: "An account with this email already exists" });
    }

    const [phoneRows] = await connection.query(
      "SELECT id FROM users WHERE phone = ? AND deleted_at IS NULL LIMIT 1",
      [phone]
    );
    if (phoneRows.length > 0) {
      await connection.rollback();
      return res.status(409).json({ success: false, message: "This mobile number is already registered" });
    }

    if (requestedUsername) {
      const [usernameRows] = await connection.query("SELECT id FROM users WHERE username = ? LIMIT 1", [requestedUsername]);
      if (usernameRows.length > 0) {
        await connection.rollback();
        return res.status(409).json({ success: false, message: "This username is already taken" });
      }
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const role = resolveRegistrationRole(email);
    const [result] = await connection.query(
      "INSERT INTO users (full_name, email, password_hash, username, role, phone) VALUES (?, ?, ?, ?, ?, ?)",
      [name, email, passwordHash, requestedUsername || null, role, phone]
    );

    let username = requestedUsername;
    if (!username) {
      const seed = toUsernameSeed(name);
      username = `@${seed}${result.insertId}`;
      await connection.query("UPDATE users SET username = ? WHERE id = ?", [username, result.insertId]);
    }

    await connection.query(
      "UPDATE email_otp_verifications SET verified_at = NOW() WHERE id = ? AND verified_at IS NULL LIMIT 1",
      [otpRow.id]
    );
    await connection.query(
      "DELETE FROM email_otp_verifications WHERE email = ? AND id <> ?",
      [email, otpRow.id]
    );
    await connection.commit();

    const user = {
      id: result.insertId,
      full_name: name,
      email,
      username,
      role,
      phone
    };
    const token = signAuthToken(user);

    return res.status(201).json({
      success: true,
      message: "Account created successfully",
      user: toPublicUser(user),
      token
    });
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {}
    }
    console.error("Register error:", error);
    return res.status(500).json({ success: false, message: "Server error while creating account" });
  } finally {
    if (connection) connection.release();
  }
}

async function loginHandler(req, res) {
  try {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || "");

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ success: false, message: "Please enter a valid email address" });
    }
    if (!password) {
      return res.status(400).json({ success: false, message: "Please enter your password" });
    }

    const [rows] = await pool.query(
      "SELECT id, full_name, email, username, phone, role, password_hash, account_status, deleted_at FROM users WHERE email = ? LIMIT 1",
      [email]
    );

    if (rows.length === 0) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    const user = rows[0];
    const accountStatus = user.deleted_at
      ? "deleted"
      : normalizeAccountStatus(user.account_status, "active");
    if (accountStatus === "deleted") {
      return res.status(403).json({ success: false, message: "Account is deleted. Contact admin." });
    }
    if (accountStatus === "blocked") {
      return res.status(403).json({ success: false, message: "Account is blocked. Contact admin." });
    }
    if (accountStatus === "inactive") {
      return res.status(403).json({ success: false, message: "Account is inactive. Contact admin." });
    }

    const passwordOk = await bcrypt.compare(password, user.password_hash);
    if (!passwordOk) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    const token = signAuthToken(user);

    return res.status(200).json({
      success: true,
      message: "Login successful",
      user: toPublicUser(user),
      token,
      redirectUrl: "/dashboard"
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ success: false, message: "Server error while logging in" });
  }
}

router.get("/auth/otp-config", phoneOtpConfigHandler);
router.get("/otp-config", phoneOtpConfigHandler);

router.post("/auth/send-phone-otp", sendPhoneOtpHandler);
router.post("/send-phone-otp", sendPhoneOtpHandler);

router.post("/auth/verify-phone-otp", verifyPhoneOtpHandler);
router.post("/verify-phone-otp", verifyPhoneOtpHandler);

router.post("/auth/send-email-otp", sendEmailOtpHandler);
router.post("/send-email-otp", sendEmailOtpHandler);

router.post("/auth/register", registerHandler);
router.post("/register", registerHandler);

router.post("/auth/login", loginHandler);
router.post("/login", loginHandler);

async function logoutHandler(req, res) {
  try {
    const token = extractBearerToken(req.headers.authorization);
    if (!token) {
      return res.status(400).json({ success: false, message: "Missing bearer token" });
    }

    let decoded;
    try {
      decoded = verifyAuthToken(token);
    } catch (error) {
      return res.status(401).json({ success: false, message: "Invalid or expired token" });
    }

    const tokenHash = hashAuthToken(token);
    const expiresAt = resolveTokenExpiry(decoded);
    const userId = Number(req.auth?.userId || decoded?.userId || 0) || null;

    await pool.query(
      `
      INSERT INTO auth_token_revocations (token_hash, user_id, expires_at, reason)
      VALUES (?, ?, ?, 'logout')
      ON DUPLICATE KEY UPDATE
        reason = VALUES(reason),
        revoked_at = CURRENT_TIMESTAMP
      `,
      [tokenHash, userId, expiresAt]
    );

    return res.status(200).json({
      success: true,
      message: "Logged out successfully. Token revoked."
    });
  } catch (error) {
    console.error("Logout error:", error);
    return res.status(500).json({ success: false, message: "Server error while logging out" });
  }
}

router.post("/auth/logout", requireAuth, logoutHandler);
router.post("/logout", requireAuth, logoutHandler);

async function forgotPasswordHandler(req, res) {
  try {
    const email = normalizeEmail(req.body.email);
    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ success: false, message: "Please enter a valid email address" });
    }

    const [rows] = await pool.query(
      "SELECT id, account_status, deleted_at FROM users WHERE email = ? LIMIT 1",
      [email]
    );
    const user = rows[0];

    const genericResponse = {
      success: true,
      message: "If this email exists, a 6 digit password reset code has been sent."
    };

    if (!user) {
      return res.status(200).json(genericResponse);
    }

    const accountStatus = user.deleted_at
      ? "deleted"
      : normalizeAccountStatus(user.account_status, "active");
    if (accountStatus !== "active") {
      return res.status(200).json(genericResponse);
    }

    const code = createPasswordResetCode();
    const codeHash = hashPasswordResetCode(email, code);
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MINUTES * 60 * 1000);

    await pool.query(
      "DELETE FROM password_reset_tokens WHERE user_id = ? OR expires_at < NOW() OR used_at IS NOT NULL",
      [user.id]
    );
    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, requested_ip, attempts, expires_at)
       VALUES (?, ?, ?, 0, ?)`,
      [user.id, codeHash, resolveClientIp(req), expiresAt]
    );

    try {
      await sendPasswordResetEmail({
        email,
        code,
        expiresInMinutes: PASSWORD_RESET_TOKEN_TTL_MINUTES
      });
    } catch (emailError) {
      // Keep the public response generic to avoid email enumeration.
      console.error("Password reset email delivery error:", emailError);
    }

    if (shouldExposeResetCode()) {
      return res.status(200).json({
        ...genericResponse,
        devOnly: {
          resetCode: code,
          expiresAt: expiresAt.toISOString()
        }
      });
    }

    return res.status(200).json(genericResponse);
  } catch (error) {
    console.error("Forgot password error:", error);
    return res.status(500).json({ success: false, message: "Server error while processing forgot password" });
  }
}

async function resetPasswordHandler(req, res) {
  const email = normalizeEmail(req.body.email);
  const code = String(req.body.code || req.body.resetCode || "").trim();
  const password = String(req.body.password || "");

  if (!email || !isValidEmail(email)) {
    return res.status(400).json({ success: false, message: "Please enter your registered email address" });
  }
  if (!/^\d{6}$/.test(code)) {
    return res.status(400).json({ success: false, message: "Please enter the 6 digit reset code" });
  }
  if (!password || password.length < 6) {
    return res.status(400).json({ success: false, message: "Password must be at least 6 characters" });
  }

  const codeHash = hashPasswordResetCode(email, code);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [tokenRows] = await connection.query(
      `SELECT prt.id, prt.user_id, prt.token_hash, prt.expires_at, prt.used_at, prt.attempts,
              u.account_status, u.deleted_at, u.password_hash
       FROM password_reset_tokens prt
       INNER JOIN users u ON u.id = prt.user_id
       WHERE u.email = ?
       ORDER BY prt.id DESC
       LIMIT 1
       FOR UPDATE`,
      [email]
    );
    if (!tokenRows.length) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: "Invalid or expired reset code" });
    }

    const tokenRow = tokenRows[0];
    if (tokenRow.used_at || new Date(tokenRow.expires_at).getTime() <= Date.now()) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: "Invalid or expired reset code" });
    }
    if (Number(tokenRow.attempts || 0) >= PASSWORD_RESET_MAX_ATTEMPTS) {
      await connection.rollback();
      return res.status(429).json({ success: false, message: "Too many wrong attempts. Please request a new reset code." });
    }

    if (!safeHashEquals(codeHash, tokenRow.token_hash)) {
      await connection.query(
        "UPDATE password_reset_tokens SET attempts = attempts + 1 WHERE id = ?",
        [tokenRow.id]
      );
      await connection.commit();
      return res.status(400).json({ success: false, message: "Invalid or expired reset code" });
    }

    const accountStatus = tokenRow.deleted_at
      ? "deleted"
      : normalizeAccountStatus(tokenRow.account_status, "active");
    if (accountStatus !== "active") {
      await connection.rollback();
      return res.status(403).json({ success: false, message: "Password reset is not allowed for this account" });
    }

    const samePassword = await bcrypt.compare(password, tokenRow.password_hash || "");
    if (samePassword) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: "Please choose a new password different from the old password" });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await connection.query(
      "UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ? LIMIT 1",
      [passwordHash, tokenRow.user_id]
    );

    const [usedUpdate] = await connection.query(
      "UPDATE password_reset_tokens SET used_at = NOW() WHERE id = ? AND used_at IS NULL LIMIT 1",
      [tokenRow.id]
    );
    if (Number(usedUpdate.affectedRows || 0) === 0) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: "Invalid or expired reset code" });
    }

    await connection.query(
      "DELETE FROM password_reset_tokens WHERE user_id = ? AND id <> ?",
      [tokenRow.user_id, tokenRow.id]
    );

    await connection.commit();
    return res.status(200).json({
      success: true,
      message: "Password reset successful. You can now log in with your new password."
    });
  } catch (error) {
    await connection.rollback();
    console.error("Reset password error:", error);
    return res.status(500).json({ success: false, message: "Server error while resetting password" });
  } finally {
    connection.release();
  }
}

router.post("/auth/forgot-password", forgotPasswordHandler);
router.post("/forgot-password", forgotPasswordHandler);

router.post("/auth/reset-password", resetPasswordHandler);
router.post("/reset-password", resetPasswordHandler);

module.exports = router;
