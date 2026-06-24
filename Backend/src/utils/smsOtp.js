const DEFAULT_OTP_MESSAGE =
  "Your ExploreX verification code is {{OTP}}. It expires in {{MINUTES}} minutes. Do not share it.";

function readEnv(name, fallback = "") {
  return String(process.env[name] || fallback).trim();
}

function parseBoolSetting(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return null;
}

function getOtpSmsProvider() {
  const explicit = readEnv("SMS_OTP_PROVIDER") || readEnv("PHONE_OTP_PROVIDER");
  if (explicit) return explicit.toLowerCase();
  if (readEnv("MSG91_AUTH_KEY") && readEnv("MSG91_OTP_TEMPLATE_ID")) return "msg91";
  if (readEnv("TWILIO_ACCOUNT_SID") && readEnv("TWILIO_AUTH_TOKEN") && readEnv("TWILIO_PHONE_NUMBER")) return "twilio";
  return "dev";
}

function buildOtpMessage({ otp, expiresInMinutes }) {
  return readEnv("SMS_OTP_MESSAGE", DEFAULT_OTP_MESSAGE)
    .replace(/\{\{OTP\}\}/g, String(otp || ""))
    .replace(/\{\{MINUTES\}\}/g, String(expiresInMinutes || 10));
}

function requireFetch() {
  if (typeof fetch !== "function") {
    throw new Error("SMS OTP needs Node.js 18+ fetch support or a fetch polyfill.");
  }
}

async function parseProviderResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (error) {
    return { raw: text };
  }
}

async function sendViaTwilio({ phone, otp, expiresInMinutes }) {
  requireFetch();
  const accountSid = readEnv("TWILIO_ACCOUNT_SID");
  const authToken = readEnv("TWILIO_AUTH_TOKEN");
  const from = readEnv("TWILIO_PHONE_NUMBER");
  if (!accountSid || !authToken || !from) {
    throw new Error("Twilio SMS is not configured. Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_PHONE_NUMBER.");
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`;
  const body = new URLSearchParams({
    To: phone,
    From: from,
    Body: buildOtpMessage({ otp, expiresInMinutes })
  });
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });
  const payload = await parseProviderResponse(response);
  if (!response.ok) {
    throw new Error(payload?.message || payload?.error_message || `Twilio SMS failed (${response.status})`);
  }
  return { provider: "twilio", messageId: payload?.sid || "" };
}

async function sendViaMsg91({ phone, otp, expiresInMinutes }) {
  requireFetch();
  const authKey = readEnv("MSG91_AUTH_KEY");
  const templateId = readEnv("MSG91_OTP_TEMPLATE_ID");
  if (!authKey || !templateId) {
    throw new Error("MSG91 OTP is not configured. Add MSG91_AUTH_KEY and MSG91_OTP_TEMPLATE_ID.");
  }

  const mobile = phone.replace(/^\+/, "");
  const params = new URLSearchParams({
    template_id: templateId,
    mobile,
    otp: String(otp),
    otp_expiry: String(Math.max(2, Math.min(30, Number(expiresInMinutes) || 10)))
  });
  const response = await fetch(`https://control.msg91.com/api/v5/otp?${params.toString()}`, {
    method: "GET",
    headers: {
      authkey: authKey,
      Accept: "application/json"
    }
  });
  const payload = await parseProviderResponse(response);
  const type = String(payload?.type || "").toLowerCase();
  if (!response.ok || type === "error") {
    throw new Error(payload?.message || `MSG91 OTP failed (${response.status})`);
  }
  return { provider: "msg91", messageId: payload?.request_id || payload?.requestId || "" };
}

async function sendViaCustomWebhook({ phone, otp, purpose, expiresInMinutes }) {
  requireFetch();
  const url = readEnv("SMS_OTP_WEBHOOK_URL");
  if (!url) {
    throw new Error("Custom SMS webhook is not configured. Add SMS_OTP_WEBHOOK_URL.");
  }
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json"
  };
  const token = readEnv("SMS_OTP_WEBHOOK_TOKEN");
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      phone,
      otp,
      purpose,
      message: buildOtpMessage({ otp, expiresInMinutes }),
      expiresInMinutes
    })
  });
  const payload = await parseProviderResponse(response);
  if (!response.ok || payload?.success === false) {
    throw new Error(payload?.message || `Custom SMS webhook failed (${response.status})`);
  }
  return { provider: "custom", messageId: payload?.messageId || payload?.id || "" };
}

async function sendOtpSms({ phone, otp, purpose = "signup", expiresInMinutes = 10 }) {
  const provider = getOtpSmsProvider();
  if (provider === "dev" || provider === "local") {
    console.log(`[ExploreX OTP] ${purpose} OTP for ${phone}: ${otp}`);
    return { provider: "dev", sent: false, devOnly: true };
  }
  if (provider === "console") {
    console.log(`[ExploreX OTP] ${purpose} OTP for ${phone}: ${otp}`);
    return { provider: "console", sent: false, devOnly: true };
  }
  if (provider === "twilio") {
    const result = await sendViaTwilio({ phone, otp, expiresInMinutes });
    return { ...result, sent: true };
  }
  if (provider === "msg91") {
    const result = await sendViaMsg91({ phone, otp, expiresInMinutes });
    return { ...result, sent: true };
  }
  if (provider === "custom") {
    const result = await sendViaCustomWebhook({ phone, otp, purpose, expiresInMinutes });
    return { ...result, sent: true };
  }
  throw new Error(`Unsupported SMS_OTP_PROVIDER "${provider}". Use dev, console, twilio, msg91, or custom.`);
}

function shouldExposeOtpForProvider() {
  const explicit = parseBoolSetting(process.env.EXPOSE_OTP_IN_RESPONSE);
  if (explicit !== null) return explicit;
  return false;
}

module.exports = {
  getOtpSmsProvider,
  sendOtpSms,
  shouldExposeOtpForProvider
};
