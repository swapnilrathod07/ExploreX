const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const path = require("path");

dotenv.config();

const authRoutes = require("./routes/auth.routes");
const profileRoutes = require("./routes/profile.routes");
const adminRoutes = require("./routes/admin.routes");
const routePlannerRoutes = require("./routes/routePlanner.routes");
const supportRoutes = require("./routes/support.routes");
const uploadRoutes = require("./routes/upload.routes");
const hotelRoutes = require("./routes/hotel.routes");
const { ensureDatabase, testConnection, initSchema, describeDatabaseError } = require("./config/db");
const { startPublishDueJob } = require("./jobs/publishDue.job");

const app = express();
const PORT = process.env.PORT || 5000;
const isProduction = String(process.env.NODE_ENV || "").trim().toLowerCase() === "production";

if (isProduction) {
  app.set("trust proxy", 1);
}

const originEnv = String(process.env.FRONTEND_ORIGIN || "").trim();
const parsedOriginValues = originEnv
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const hasWildcardOrigin = parsedOriginValues.includes("*");
const explicitAllowedOrigins = parsedOriginValues.filter((value) => value !== "*");
const allowAllOrigins = !isProduction && hasWildcardOrigin;
const allowedOrigins = explicitAllowedOrigins;
const allowedOriginSet = new Set(
  allowedOrigins
    .map((origin) => String(origin || "").trim().replace(/\/+$/, "").toLowerCase())
    .filter(Boolean)
);

if (isProduction && hasWildcardOrigin) {
  console.warn("[security] FRONTEND_ORIGIN contains wildcard in production; wildcard is ignored.");
}
if (isProduction && allowedOrigins.length === 0) {
  console.warn("[security] No explicit FRONTEND_ORIGIN configured for production.");
}

function isAllowedDevLocalOrigin(originValue) {
  if (isProduction) return false;
  try {
    const parsed = new URL(String(originValue || "").trim());
    const protocol = String(parsed.protocol || "").toLowerCase();
    if (protocol !== "http:" && protocol !== "https:") return false;
    const host = String(parsed.hostname || "").toLowerCase();
    if (!host) return false;
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
    if (/^192\.168\./.test(host) || /^10\./.test(host)) return true;
    const match172 = host.match(/^172\.(\d{1,3})\./);
    if (match172) {
      const secondBlock = Number(match172[1]);
      if (Number.isFinite(secondBlock) && secondBlock >= 16 && secondBlock <= 31) {
        return true;
      }
    }
    return false;
  } catch (error) {
    return false;
  }
}

function resolveClientIp(req) {
  const forwardedFor = String(req.headers["x-forwarded-for"] || "").trim();
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }
  return String(req.socket?.remoteAddress || req.ip || "unknown");
}

function createRateLimiter({ windowMs, maxRequests, message, keyPrefix = "" }) {
  const bucket = new Map();
  const sweepIntervalMs = Math.min(windowMs, 60_000);
  setInterval(() => {
    const now = Date.now();
    for (const [key, state] of bucket.entries()) {
      if (now >= state.resetAt) bucket.delete(key);
    }
  }, sweepIntervalMs).unref();

  return (req, res, next) => {
    const now = Date.now();
    const key = `${keyPrefix}${resolveClientIp(req)}`;
    const existing = bucket.get(key);
    const state = !existing || now >= existing.resetAt
      ? { count: 0, resetAt: now + windowMs }
      : existing;

    state.count += 1;
    bucket.set(key, state);

    const remaining = Math.max(0, maxRequests - state.count);
    res.setHeader("X-RateLimit-Limit", String(maxRequests));
    res.setHeader("X-RateLimit-Remaining", String(remaining));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(state.resetAt / 1000)));

    if (state.count > maxRequests) {
      const retryAfterSeconds = Math.max(1, Math.ceil((state.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({
        success: false,
        message
      });
    }

    return next();
  };
}

const apiLimiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: isProduction ? 240 : 600,
  message: "Too many requests. Please try again shortly."
});
const authLimiter = createRateLimiter({
  windowMs: 15 * 60_000,
  maxRequests: isProduction ? 20 : 80,
  message: "Too many authentication attempts. Please wait a while and try again.",
  keyPrefix: "auth:"
});
const adminLimiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: isProduction ? 120 : 300,
  message: "Too many admin requests. Please slow down.",
  keyPrefix: "admin:"
});

app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(self)");
  return next();
});

app.use(
  cors({
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Admin-Pin-Token"],
    optionsSuccessStatus: 204,
    origin(origin, callback) {
      if (!origin) {
        return callback(null, true);
      }
      const normalizedOrigin = String(origin || "").trim().replace(/\/+$/, "").toLowerCase();
      if (allowAllOrigins || allowedOriginSet.has(normalizedOrigin) || isAllowedDevLocalOrigin(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Origin not allowed by CORS"));
    }
  })
);

app.use("/api", apiLimiter);
app.use("/api/login", authLimiter);
app.use("/api/register", authLimiter);
app.use("/api/send-email-otp", authLimiter);
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/register", authLimiter);
app.use("/api/auth/send-email-otp", authLimiter);
app.use("/api/auth/send-phone-otp", authLimiter);
app.use("/api/auth/verify-phone-otp", authLimiter);
app.use("/api/auth/forgot-password", authLimiter);
app.use("/api/forgot-password", authLimiter);
app.use("/api/auth/reset-password", authLimiter);
app.use("/api/reset-password", authLimiter);
app.use("/api/admin", adminLimiter);

app.use(express.json({ limit: "50mb" }));
app.use(
  "/uploads",
  express.static(path.join(__dirname, "..", "uploads"), {
    maxAge: isProduction ? "7d" : 0,
    immutable: isProduction,
    setHeaders(res) {
      // Uploaded images may be served from a different frontend origin.
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      res.setHeader("Access-Control-Allow-Origin", "*");
    }
  })
);

app.get("/", (req, res) => {
  res.status(200).json({ status: "ExploreX Backend Running" });
});

app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "ExploreX backend is running"
  });
});

app.get("/api/health/db", async (req, res) => {
  try {
    await testConnection();
    return res.status(200).json({
      success: true,
      message: "Database connected"
    });
  } catch (error) {
    console.error("Database health check failed:", describeDatabaseError(error));
    return res.status(503).json({
      success: false,
      message: "Database connection unavailable"
    });
  }
});

app.use("/api", authRoutes);
app.use("/api", profileRoutes);
app.use("/api", adminRoutes);
app.use("/api", routePlannerRoutes);
app.use("/api", supportRoutes);
app.use("/api", uploadRoutes);
app.use("/api", hotelRoutes);

app.use((err, req, res, next) => {
  if (err && err.message === "Origin not allowed by CORS") {
    return res.status(403).json({ success: false, message: err.message });
  }
  if (err && (err.type === "entity.too.large" || err.status === 413)) {
    return res.status(413).json({
      success: false,
      message: "Request payload too large. Please upload a smaller image."
    });
  }
  if (err && err.type === "entity.parse.failed") {
    return res.status(400).json({
      success: false,
      message: "Invalid JSON payload."
    });
  }
  console.error("Unhandled API error:", err);
  return res.status(err?.statusCode || err?.status || 500).json({
    success: false,
    message: isProduction ? "Server error. Please try again later." : (err?.message || "Server error")
  });
});

app.use((req, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

(async () => {
  try {
    await ensureDatabase();
    await testConnection();
    await initSchema();
    startPublishDueJob();

    const server = app.listen(PORT, () => {
      console.log(`ExploreX backend running on port ${PORT}`);
    });
    server.on("error", (error) => {
      if (error?.code === "EADDRINUSE") {
        console.error(`Port ${PORT} is already in use. Stop the old backend terminal or set PORT to another value.`);
      } else {
        console.error("Server listen error:", error?.message || error);
      }
      process.exit(1);
    });
  } catch (error) {
    console.error("Failed to start server:", describeDatabaseError(error));
    process.exit(1);
  }
})();
