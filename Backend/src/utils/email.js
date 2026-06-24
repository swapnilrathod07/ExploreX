function readEnv(key, fallback = "") {
  const value = process.env[key];
  return value == null || value === "" ? fallback : String(value);
}

function getEmailProvider() {
  const explicit = readEnv("EMAIL_PROVIDER").trim().toLowerCase();
  if (explicit) return explicit;
  return readEnv("SMTP_HOST") ? "smtp" : "console";
}

function getFrontendBaseUrl() {
  const explicit = readEnv("FRONTEND_APP_URL").trim().replace(/\/+$/, "");
  if (explicit) return explicit;
  const firstOrigin = readEnv("FRONTEND_ORIGIN", "http://localhost:5500")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)[0];
  return (firstOrigin || "http://localhost:5500").replace(/\/+$/, "");
}


function buildPasswordResetEmail({ resetCode, expiresInMinutes }) {
  const appName = readEnv("APP_NAME", "ExploreX");
  const supportEmail = readEnv("SUPPORT_EMAIL", "support@explorex.com");
  const minutes = Number(expiresInMinutes) || 30;
  const code = String(resetCode || "").trim();
  const subject = `${appName} password reset code`;
  const text = [
    `Your ${appName} password reset code is ${code}.`,
    "",
    `This code expires in ${minutes} minutes. Do not share it with anyone.`,
    "",
    "If you did not request this, ignore this email.",
    "",
    `Need help? Contact ${supportEmail}.`
  ].join("\n");
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#0f172a;max-width:560px;margin:auto;padding:24px;">
      <div style="border:1px solid #dbe4ff;border-radius:18px;padding:22px;background:linear-gradient(135deg,#ffffff,#f5f7ff);">
        <h2 style="margin:0 0 10px;color:#1A3CD8;">Reset your ${appName} password</h2>
        <p style="margin:0 0 14px;">Use this one-time code to create your new password.</p>
        <div style="letter-spacing:8px;font-size:32px;font-weight:800;color:#0f172a;background:#eef2ff;border-radius:14px;padding:14px 18px;text-align:center;">
          ${code}
        </div>
        <p style="font-size:14px;color:#64748b;margin:16px 0 0;">This code expires in ${minutes} minutes. Do not share it with anyone.</p>
        <p style="font-size:13px;color:#64748b;margin:10px 0 0;">Need help? Contact ${supportEmail}.</p>
      </div>
    </div>
  `;
  return { subject, text, html };
}

function buildSignupOtpEmail({ otp, expiresInMinutes }) {
  const appName = readEnv("APP_NAME", "ExploreX");
  const supportEmail = readEnv("SUPPORT_EMAIL", "support@explorex.com");
  const minutes = Number(expiresInMinutes) || 10;
  const subject = `${appName} email verification OTP`;
  const text = [
    `Your ${appName} signup verification code is ${otp}.`,
    "",
    `This OTP expires in ${minutes} minutes. Do not share it with anyone.`,
    "",
    `If you did not request this, ignore this email.`,
    "",
    `Need help? Contact ${supportEmail}.`
  ].join("\n");
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#0f172a;max-width:560px;margin:auto;padding:24px;">
      <div style="border:1px solid #dbe4ff;border-radius:18px;padding:22px;background:linear-gradient(135deg,#ffffff,#f5f7ff);">
        <h2 style="margin:0 0 10px;color:#1A3CD8;">Verify your ${appName} account</h2>
        <p style="margin:0 0 14px;">Use this one-time password to complete your signup.</p>
        <div style="letter-spacing:8px;font-size:32px;font-weight:800;color:#0f172a;background:#eef2ff;border-radius:14px;padding:14px 18px;text-align:center;">
          ${otp}
        </div>
        <p style="font-size:14px;color:#64748b;margin:16px 0 0;">This OTP expires in ${minutes} minutes. Do not share it with anyone.</p>
        <p style="font-size:13px;color:#64748b;margin:10px 0 0;">Need help? Contact ${supportEmail}.</p>
      </div>
    </div>
  `;
  return { subject, text, html };
}

async function sendViaSmtp({ to, subject, text, html }) {
  let nodemailer;
  try {
    nodemailer = require("nodemailer");
  } catch (error) {
    throw new Error("SMTP email needs nodemailer. Run npm install in Backend after package.json update.");
  }

  const host = readEnv("SMTP_HOST");
  const port = Number(readEnv("SMTP_PORT", "587"));
  const user = readEnv("SMTP_USER");
  const pass = readEnv("SMTP_PASS").replace(/\s+/g, "");
  const missing = [];
  if (!host) missing.push("SMTP_HOST");
  if (!port) missing.push("SMTP_PORT");
  if (!user) missing.push("SMTP_USER");
  if (!pass) missing.push("SMTP_PASS");
  if (missing.length) {
    throw new Error(
      `Gmail SMTP is not configured. Missing ${missing.join(", ")} in Backend/.env. ` +
      "For Gmail, SMTP_PASS must be a Google App Password, not your normal Gmail password."
    );
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: readEnv("SMTP_SECURE", "false").toLowerCase() === "true",
    auth: { user, pass }
  });

  const from = readEnv("EMAIL_FROM", user);
  await transporter.sendMail({ from, to, subject, text, html });
  return { provider: "smtp", delivered: true };
}

async function sendPasswordResetEmail({ email, code, expiresInMinutes }) {
  const provider = getEmailProvider();
  const emailContent = buildPasswordResetEmail({ resetCode: code, expiresInMinutes });

  if (provider === "none" || provider === "disabled") {
    return { provider, delivered: false };
  }

  if (provider === "console" || provider === "dev") {
    console.log(`[ExploreX Email] Password reset code for ${email}: ${code}`);
    return { provider, delivered: false };
  }

  if (provider === "smtp") {
    return sendViaSmtp({ to: email, ...emailContent });
  }

  throw new Error(`Unsupported EMAIL_PROVIDER "${provider}". Use console, smtp, or none.`);
}

async function sendSignupOtpEmail({ email, otp, expiresInMinutes }) {
  const provider = getEmailProvider();
  const emailContent = buildSignupOtpEmail({ otp, expiresInMinutes });

  if (provider === "none" || provider === "disabled") {
    return { provider, delivered: false };
  }

  if (provider === "console" || provider === "dev") {
    console.log(`[ExploreX Email] Signup OTP for ${email}: ${otp}`);
    return { provider, delivered: false };
  }

  if (provider === "smtp") {
    return sendViaSmtp({ to: email, ...emailContent });
  }

  throw new Error(`Unsupported EMAIL_PROVIDER "${provider}". Use console, smtp, or none.`);
}

module.exports = {
  buildSignupOtpEmail,
  buildPasswordResetEmail,
  getEmailProvider,
  sendPasswordResetEmail,
  sendSignupOtpEmail
};
