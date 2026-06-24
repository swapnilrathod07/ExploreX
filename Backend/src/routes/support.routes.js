const express = require("express");
const { pool } = require("../config/db");
const { requireAuth, requireAdminAuth } = require("../middleware/auth.middleware");
const { requireAdminPermission } = require("../middleware/adminPermissions.middleware");

const router = express.Router();

const TICKET_STATUS_SET = new Set(["pending", "resolved"]);

function clampText(value, max = 255) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function parsePositiveInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

function toIso(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
}

function safeStatus(value, fallback = "pending") {
  const key = clampText(value, 24).toLowerCase();
  return TICKET_STATUS_SET.has(key) ? key : fallback;
}

function safeJsonStringify(value, fallback = "{}") {
  try {
    return JSON.stringify(value == null ? JSON.parse(fallback) : value);
  } catch (error) {
    return fallback;
  }
}

async function createAuditLog(action, entity, details, entityId = null, meta = null) {
  try {
    await pool.query(
      `INSERT INTO audit_logs (action, entity, entity_id, details, meta_json)
       VALUES (?, ?, ?, ?, ?)`,
      [
        clampText(action, 80) || "update",
        clampText(entity, 80) || "system",
        entityId == null ? null : Number(entityId),
        clampText(details, 1000) || "No details",
        meta == null ? null : safeJsonStringify(meta, "{}")
      ]
    );
  } catch (error) {
    console.error("Support audit log write failed:", error.message);
  }
}

async function getTicketById(ticketId) {
  const [rows] = await pool.query(
    `
    SELECT
      t.id,
      t.user_id,
      t.subject,
      t.status,
      t.created_at,
      t.updated_at,
      t.resolved_at,
      u.full_name AS user_name,
      u.email AS user_email
    FROM support_tickets t
    LEFT JOIN users u ON u.id = t.user_id
    WHERE t.id = ?
    LIMIT 1
    `,
    [ticketId]
  );
  return rows[0] || null;
}

function mapTicketSummary(row) {
  const unreadCount = Math.max(0, Number(row.unread_count) || 0);
  const messageCount = Math.max(0, Number(row.message_count) || 0);
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    userName: row.user_name || "Traveller",
    userEmail: row.user_email || "",
    subject: row.subject || "",
    status: safeStatus(row.status, "pending"),
    unreadCount,
    messageCount,
    lastMessage: row.last_message || "",
    lastMessageAt: toIso(row.last_message_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    resolvedAt: toIso(row.resolved_at)
  };
}

function mapMessageRow(row) {
  return {
    id: Number(row.id),
    ticketId: Number(row.ticket_id),
    senderType: row.sender_type || "user",
    senderId: row.sender_id == null ? null : Number(row.sender_id),
    message: row.message || "",
    isRead: Boolean(row.is_read),
    createdAt: toIso(row.created_at)
  };
}

function isAdminRequest(req) {
  return String(req.auth?.role || "").trim().toLowerCase() === "admin";
}

function requireSupportPermissionForAdmin(req, res, next) {
  if (!isAdminRequest(req)) return next();
  return requireAdminPermission("support")(req, res, next);
}

// Security: support responses must never be cached across sessions/users.
router.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store, private, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.append("Vary", "Authorization");
  return next();
});

router.post("/support/ticket", requireAuth, async (req, res) => {
  const subject = clampText(req.body?.subject, 160);
  const message = clampText(req.body?.message, 2000);

  if (!subject || subject.length < 3) {
    return res.status(400).json({
      success: false,
      message: "Please enter a subject (minimum 3 characters)"
    });
  }
  if (!message) {
    return res.status(400).json({
      success: false,
      message: "Please enter your support message"
    });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [ticketResult] = await connection.query(
      `INSERT INTO support_tickets (user_id, subject, status)
       VALUES (?, ?, 'pending')`,
      [Number(req.auth.userId), subject]
    );

    const ticketId = Number(ticketResult.insertId);
    await connection.query(
      `INSERT INTO support_messages (ticket_id, sender_type, sender_id, message, is_read)
       VALUES (?, 'user', ?, ?, 0)`,
      [ticketId, Number(req.auth.userId), message]
    );

    await connection.commit();

    const ticket = await getTicketById(ticketId);
    await createAuditLog(
      "support_create_ticket",
      "support_ticket",
      `Created support ticket #${ticketId}`,
      ticketId,
      { byUserId: Number(req.auth.userId), subject }
    );

    return res.status(201).json({
      success: true,
      message: "Support ticket created successfully",
      data: ticket
        ? {
            id: Number(ticket.id),
            userId: Number(ticket.user_id),
            subject: ticket.subject || "",
            status: safeStatus(ticket.status, "pending"),
            createdAt: toIso(ticket.created_at),
            updatedAt: toIso(ticket.updated_at)
          }
        : null
    });
  } catch (error) {
    await connection.rollback();
    console.error("Support ticket POST error:", error);
    return res.status(500).json({ success: false, message: "Server error while creating support ticket" });
  } finally {
    connection.release();
  }
});

router.get("/support/my-tickets", requireAuth, async (req, res) => {
  try {
    const status = safeStatus(req.query.status, "all");
    const limit = Math.min(100, Math.max(1, Math.trunc(Number(req.query.limit) || 40)));
    const offset = Math.max(0, Math.trunc(Number(req.query.offset) || 0));

    const where = ["t.user_id = ?"];
    const params = [Number(req.auth.userId)];
    if (status !== "all") {
      where.push("LOWER(t.status) = ?");
      params.push(status);
    }

    const whereSql = `WHERE ${where.join(" AND ")}`;

    const [rows] = await pool.query(
      `
      SELECT
        t.id,
        t.user_id,
        t.subject,
        t.status,
        t.created_at,
        t.updated_at,
        t.resolved_at,
        u.full_name AS user_name,
        u.email AS user_email,
        (
          SELECT sm.message
          FROM support_messages sm
          WHERE sm.ticket_id = t.id
          ORDER BY sm.id DESC
          LIMIT 1
        ) AS last_message,
        (
          SELECT sm.created_at
          FROM support_messages sm
          WHERE sm.ticket_id = t.id
          ORDER BY sm.id DESC
          LIMIT 1
        ) AS last_message_at,
        (
          SELECT COUNT(*)
          FROM support_messages sm
          WHERE sm.ticket_id = t.id
            AND sm.sender_type = 'admin'
            AND sm.is_read = 0
        ) AS unread_count,
        (
          SELECT COUNT(*)
          FROM support_messages sm
          WHERE sm.ticket_id = t.id
        ) AS message_count
      FROM support_tickets t
      LEFT JOIN users u ON u.id = t.user_id
      ${whereSql}
      ORDER BY COALESCE(last_message_at, t.updated_at) DESC, t.id DESC
      LIMIT ? OFFSET ?
      `,
      [...params, limit, offset]
    );

    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS c FROM support_tickets t ${whereSql}`,
      params
    );

    return res.status(200).json({
      success: true,
      data: rows.map(mapTicketSummary),
      pagination: {
        total: Number(countRows[0]?.c || 0),
        limit,
        offset
      }
    });
  } catch (error) {
    console.error("Support my-tickets GET error:", error);
    return res.status(500).json({ success: false, message: "Server error while fetching support tickets" });
  }
});

router.get("/support/ticket/:id/messages", requireAuth, async (req, res) => {
  try {
    const ticketId = parsePositiveInt(req.params.id);
    if (!ticketId) {
      return res.status(400).json({ success: false, message: "Invalid support ticket id" });
    }

    const ticket = await getTicketById(ticketId);
    if (!ticket) {
      return res.status(404).json({ success: false, message: "Support ticket not found" });
    }

    const isAdmin = isAdminRequest(req);
    if (!isAdmin && Number(ticket.user_id) !== Number(req.auth.userId)) {
      return res.status(403).json({ success: false, message: "Forbidden: ticket access denied" });
    }

    // Mark opposite-side messages as read when ticket is opened.
    if (isAdmin) {
      await pool.query(
        `UPDATE support_messages
         SET is_read = 1
         WHERE ticket_id = ? AND sender_type = 'user' AND is_read = 0`,
        [ticketId]
      );
    } else {
      await pool.query(
        `UPDATE support_messages
         SET is_read = 1
         WHERE ticket_id = ? AND sender_type = 'admin' AND is_read = 0`,
        [ticketId]
      );
    }

    // Extra guard: a traveller should only ever read admin messages + their own user messages.
    const messageSql = isAdmin
      ? `
        SELECT id, ticket_id, sender_type, sender_id, message, is_read, created_at
        FROM support_messages
        WHERE ticket_id = ?
        ORDER BY created_at ASC, id ASC
      `
      : `
        SELECT id, ticket_id, sender_type, sender_id, message, is_read, created_at
        FROM support_messages
        WHERE ticket_id = ?
          AND (
            sender_type = 'admin'
            OR (sender_type = 'user' AND sender_id = ?)
          )
        ORDER BY created_at ASC, id ASC
      `;
    const messageParams = isAdmin
      ? [ticketId]
      : [ticketId, Number(req.auth.userId)];

    const [messageRows] = await pool.query(messageSql, messageParams);

    const [ticketRows] = await pool.query(
      `
      SELECT
        t.id,
        t.user_id,
        t.subject,
        t.status,
        t.created_at,
        t.updated_at,
        t.resolved_at,
        u.full_name AS user_name,
        u.email AS user_email,
        (
          SELECT COUNT(*)
          FROM support_messages sm
          WHERE sm.ticket_id = t.id
            AND sm.sender_type = 'admin'
            AND sm.is_read = 0
        ) AS unread_count,
        (
          SELECT COUNT(*)
          FROM support_messages sm
          WHERE sm.ticket_id = t.id
        ) AS message_count
      FROM support_tickets t
      LEFT JOIN users u ON u.id = t.user_id
      WHERE t.id = ?
      LIMIT 1
      `,
      [ticketId]
    );

    const ticketRow = ticketRows[0] || ticket;

    return res.status(200).json({
      success: true,
      ticket: mapTicketSummary(ticketRow),
      messages: messageRows.map(mapMessageRow)
    });
  } catch (error) {
    console.error("Support ticket messages GET error:", error);
    return res.status(500).json({ success: false, message: "Server error while fetching support messages" });
  }
});

router.post("/support/ticket/:id/message", requireAuth, requireSupportPermissionForAdmin, async (req, res) => {
  const ticketId = parsePositiveInt(req.params.id);
  const message = clampText(req.body?.message, 2000);

  if (!ticketId) {
    return res.status(400).json({ success: false, message: "Invalid support ticket id" });
  }
  if (!message) {
    return res.status(400).json({ success: false, message: "Please enter a message" });
  }

  const isAdmin = isAdminRequest(req);
  const ticket = await getTicketById(ticketId);
  if (!ticket) {
    return res.status(404).json({ success: false, message: "Support ticket not found" });
  }
  if (!isAdmin && Number(ticket.user_id) !== Number(req.auth.userId)) {
    return res.status(403).json({ success: false, message: "Forbidden: ticket access denied" });
  }

  const senderType = isAdmin ? "admin" : "user";
  const senderId = Number(req.auth.userId);

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [result] = await connection.query(
      `INSERT INTO support_messages (ticket_id, sender_type, sender_id, message, is_read)
       VALUES (?, ?, ?, ?, 0)`,
      [ticketId, senderType, senderId, message]
    );

    // User message re-opens resolved tickets automatically.
    if (senderType === "user") {
      await connection.query(
        `UPDATE support_tickets
         SET status = 'pending', resolved_at = NULL, updated_at = NOW()
         WHERE id = ?`,
        [ticketId]
      );
    } else {
      await connection.query(
        `UPDATE support_tickets
         SET updated_at = NOW()
         WHERE id = ?`,
        [ticketId]
      );
    }

    await connection.commit();

    const [rows] = await pool.query(
      `
      SELECT id, ticket_id, sender_type, sender_id, message, is_read, created_at
      FROM support_messages
      WHERE id = ?
      LIMIT 1
      `,
      [Number(result.insertId)]
    );

    await createAuditLog(
      senderType === "admin" ? "support_admin_reply" : "support_user_reply",
      "support_ticket",
      `${senderType} sent a support reply on ticket #${ticketId}`,
      ticketId,
      { byUserId: senderId, senderType }
    );

    return res.status(201).json({
      success: true,
      message: "Support message sent",
      data: rows[0] ? mapMessageRow(rows[0]) : null
    });
  } catch (error) {
    await connection.rollback();
    console.error("Support message POST error:", error);
    return res.status(500).json({ success: false, message: "Server error while sending support message" });
  } finally {
    connection.release();
  }
});

router.delete("/support/ticket/:id", requireAuth, requireSupportPermissionForAdmin, async (req, res) => {
  try {
    const ticketId = parsePositiveInt(req.params.id);
    if (!ticketId) {
      return res.status(400).json({ success: false, message: "Invalid support ticket id" });
    }

    const ticket = await getTicketById(ticketId);
    if (!ticket) {
      return res.status(404).json({ success: false, message: "Support ticket not found" });
    }

    const isAdmin = isAdminRequest(req);
    if (!isAdmin && Number(ticket.user_id) !== Number(req.auth.userId)) {
      return res.status(403).json({ success: false, message: "Forbidden: ticket access denied" });
    }

    await pool.query("DELETE FROM support_tickets WHERE id = ? LIMIT 1", [ticketId]);

    await createAuditLog(
      "support_delete_ticket",
      "support_ticket",
      `Deleted support ticket #${ticketId}`,
      ticketId,
      { byUserId: Number(req.auth.userId), byRole: isAdmin ? "admin" : "user" }
    );

    return res.status(200).json({
      success: true,
      message: "Support ticket deleted"
    });
  } catch (error) {
    console.error("Support ticket DELETE error:", error);
    return res.status(500).json({ success: false, message: "Server error while deleting support ticket" });
  }
});

router.get("/admin/support/tickets", requireAdminAuth, async (req, res) => {
  try {
    const status = safeStatus(req.query.status, "all");
    const filter = clampText(req.query.filter, 24).toLowerCase(); // all | unread | pending | resolved
    const search = clampText(req.query.search, 160).toLowerCase();
    const limit = Math.min(200, Math.max(1, Math.trunc(Number(req.query.limit) || 80)));
    const offset = Math.max(0, Math.trunc(Number(req.query.offset) || 0));

    const where = [];
    const params = [];

    if (status !== "all") {
      where.push("LOWER(t.status) = ?");
      params.push(status);
    }
    if (filter === "pending") {
      where.push("LOWER(t.status) = 'pending'");
    } else if (filter === "resolved") {
      where.push("LOWER(t.status) = 'resolved'");
    } else if (filter === "unread") {
      where.push(`(
        SELECT COUNT(*)
        FROM support_messages sx
        WHERE sx.ticket_id = t.id
          AND sx.sender_type = 'user'
          AND sx.is_read = 0
      ) > 0`);
    }

    if (search) {
      where.push("(LOWER(t.subject) LIKE ? OR LOWER(COALESCE(u.full_name,'')) LIKE ? OR LOWER(COALESCE(u.email,'')) LIKE ?)");
      const q = `%${search}%`;
      params.push(q, q, q);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const [rows] = await pool.query(
      `
      SELECT
        t.id,
        t.user_id,
        t.subject,
        t.status,
        t.created_at,
        t.updated_at,
        t.resolved_at,
        u.full_name AS user_name,
        u.email AS user_email,
        (
          SELECT sm.message
          FROM support_messages sm
          WHERE sm.ticket_id = t.id
          ORDER BY sm.id DESC
          LIMIT 1
        ) AS last_message,
        (
          SELECT sm.created_at
          FROM support_messages sm
          WHERE sm.ticket_id = t.id
          ORDER BY sm.id DESC
          LIMIT 1
        ) AS last_message_at,
        (
          SELECT COUNT(*)
          FROM support_messages sm
          WHERE sm.ticket_id = t.id
            AND sm.sender_type = 'user'
            AND sm.is_read = 0
        ) AS unread_count,
        (
          SELECT COUNT(*)
          FROM support_messages sm
          WHERE sm.ticket_id = t.id
        ) AS message_count
      FROM support_tickets t
      LEFT JOIN users u ON u.id = t.user_id
      ${whereSql}
      ORDER BY unread_count DESC, COALESCE(last_message_at, t.updated_at) DESC, t.id DESC
      LIMIT ? OFFSET ?
      `,
      [...params, limit, offset]
    );

    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS c FROM support_tickets t LEFT JOIN users u ON u.id = t.user_id ${whereSql}`,
      params
    );

    return res.status(200).json({
      success: true,
      data: rows.map(mapTicketSummary),
      pagination: {
        total: Number(countRows[0]?.c || 0),
        limit,
        offset
      }
    });
  } catch (error) {
    console.error("Admin support tickets GET error:", error);
    return res.status(500).json({ success: false, message: "Server error while fetching admin support tickets" });
  }
});

router.patch("/admin/support/ticket/:id/status", requireAdminAuth, requireAdminPermission("support"), async (req, res) => {
  try {
    const ticketId = parsePositiveInt(req.params.id);
    const status = safeStatus(req.body?.status, "");

    if (!ticketId) {
      return res.status(400).json({ success: false, message: "Invalid support ticket id" });
    }
    if (!status || status === "all") {
      return res.status(400).json({ success: false, message: "Invalid status. Use pending or resolved" });
    }

    const ticket = await getTicketById(ticketId);
    if (!ticket) {
      return res.status(404).json({ success: false, message: "Support ticket not found" });
    }

    await pool.query(
      `
      UPDATE support_tickets
      SET
        status = ?,
        resolved_at = CASE WHEN ? = 'resolved' THEN NOW() ELSE NULL END,
        updated_at = NOW()
      WHERE id = ?
      `,
      [status, status, ticketId]
    );

    const nextTicket = await getTicketById(ticketId);

    await createAuditLog(
      "support_status_update",
      "support_ticket",
      `Admin changed support ticket #${ticketId} status to ${status}`,
      ticketId,
      {
        byAdminId: Number(req.auth.userId),
        from: safeStatus(ticket.status, "pending"),
        to: status
      }
    );

    return res.status(200).json({
      success: true,
      message: "Support ticket status updated",
      data: nextTicket
        ? {
            id: Number(nextTicket.id),
            userId: Number(nextTicket.user_id),
            subject: nextTicket.subject || "",
            status: safeStatus(nextTicket.status, "pending"),
            createdAt: toIso(nextTicket.created_at),
            updatedAt: toIso(nextTicket.updated_at),
            resolvedAt: toIso(nextTicket.resolved_at)
          }
        : null
    });
  } catch (error) {
    console.error("Admin support status PATCH error:", error);
    return res.status(500).json({ success: false, message: "Server error while updating support status" });
  }
});

router.delete("/admin/support/ticket/:id", requireAdminAuth, requireAdminPermission("support"), async (req, res) => {
  try {
    const ticketId = parsePositiveInt(req.params.id);
    if (!ticketId) {
      return res.status(400).json({ success: false, message: "Invalid support ticket id" });
    }

    const ticket = await getTicketById(ticketId);
    if (!ticket) {
      return res.status(404).json({ success: false, message: "Support ticket not found" });
    }

    await pool.query("DELETE FROM support_tickets WHERE id = ? LIMIT 1", [ticketId]);

    await createAuditLog(
      "support_admin_delete_ticket",
      "support_ticket",
      `Admin deleted support ticket #${ticketId}`,
      ticketId,
      { byAdminId: Number(req.auth.userId) }
    );

    return res.status(200).json({
      success: true,
      message: "Support ticket deleted by admin"
    });
  } catch (error) {
    console.error("Admin support ticket DELETE error:", error);
    return res.status(500).json({ success: false, message: "Server error while deleting support ticket" });
  }
});

module.exports = router;
