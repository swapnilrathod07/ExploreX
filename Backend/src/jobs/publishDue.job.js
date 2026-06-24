const { pool } = require("../config/db");

let publishDueInProgress = false;

function toBoolean(value, fallback = true) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  const raw = String(value || "").trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function clampInt(value, fallback, min, max) {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

async function runPublishDueOnce(options = {}) {
  const source = String(options.source || "cron").trim().toLowerCase() || "cron";
  const writeAudit = options.writeAudit !== false;

  if (publishDueInProgress) {
    return {
      success: true,
      affectedRows: 0,
      skipped: true,
      reason: "already_running",
      source
    };
  }

  publishDueInProgress = true;
  try {
    const [result] = await pool.query(
      `
      UPDATE places
      SET status = 'published', scheduled_at = NULL
      WHERE is_deleted = 0
        AND status = 'scheduled'
        AND scheduled_at IS NOT NULL
        AND scheduled_at <= NOW()
      `
    );

    const affected = Number(result?.affectedRows || 0);
    if (affected > 0 && writeAudit) {
      const details = `${affected} scheduled place(s) published by ${source} run`;
      const metaJson = JSON.stringify({ source, affectedRows: affected });
      await pool.query(
        `INSERT INTO audit_logs (action, entity, entity_id, details, meta_json)
         VALUES (?, ?, ?, ?, ?)`,
        ["publish_due", "place", null, details, metaJson]
      );
    }

    return {
      success: true,
      affectedRows: affected,
      skipped: false,
      source
    };
  } finally {
    publishDueInProgress = false;
  }
}

function startPublishDueJob() {
  const enabled = toBoolean(process.env.PUBLISH_DUE_JOB_ENABLED, true);
  if (!enabled) {
    console.log("[jobs] publish-due scheduler disabled by env");
    return () => {};
  }

  const intervalSeconds = clampInt(
    process.env.PUBLISH_DUE_JOB_INTERVAL_SECONDS,
    60,
    15,
    3600
  );
  const intervalMs = intervalSeconds * 1000;
  const runOnStart = toBoolean(process.env.PUBLISH_DUE_JOB_RUN_ON_START, true);

  if (runOnStart) {
    runPublishDueOnce({ source: "startup", writeAudit: true })
      .then((result) => {
        if (result.affectedRows > 0) {
          console.log(`[jobs] publish-due startup run: published ${result.affectedRows} place(s)`);
        }
      })
      .catch((error) => {
        console.error("[jobs] publish-due startup run failed:", error.message);
      });
  }

  const timer = setInterval(() => {
    runPublishDueOnce({ source: "cron", writeAudit: true })
      .then((result) => {
        if (result.affectedRows > 0) {
          console.log(`[jobs] publish-due cron: published ${result.affectedRows} place(s)`);
        }
      })
      .catch((error) => {
        console.error("[jobs] publish-due cron failed:", error.message);
      });
  }, intervalMs);

  timer.unref?.();
  console.log(`[jobs] publish-due scheduler started (every ${intervalSeconds}s)`);

  return () => clearInterval(timer);
}

module.exports = {
  runPublishDueOnce,
  startPublishDueJob
};
