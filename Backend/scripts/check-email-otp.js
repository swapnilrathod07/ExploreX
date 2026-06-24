require("dotenv").config();

const { getEmailProvider, sendSignupOtpEmail } = require("../src/utils/email");

function readEnv(name) {
  return String(process.env[name] || "").trim();
}

function maskEmail(value) {
  const email = String(value || "").trim();
  if (!email) return "missing";
  const [name, domain] = email.split("@");
  if (!domain) return "set";
  return `${name.slice(0, 2)}***@${domain}`;
}

function maskSet(value) {
  return String(value || "").trim() ? "set" : "missing";
}

async function main() {
  const provider = getEmailProvider();
  const shouldSend = process.argv.includes("--send");
  const toEmail = String(process.argv.find((arg) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(arg)) || readEnv("SMTP_USER")).trim();

  console.log("ExploreX Email OTP config check");
  console.log("--------------------------------");
  console.log(`Provider: ${provider}`);
  console.log(`SMTP_HOST: ${readEnv("SMTP_HOST") || "missing"}`);
  console.log(`SMTP_PORT: ${readEnv("SMTP_PORT") || "missing"}`);
  console.log(`SMTP_SECURE: ${readEnv("SMTP_SECURE") || "false"}`);
  console.log(`SMTP_USER: ${maskEmail(readEnv("SMTP_USER"))}`);
  console.log(`SMTP_PASS: ${maskSet(readEnv("SMTP_PASS"))}`);
  console.log(`EMAIL_FROM: ${readEnv("EMAIL_FROM") || "missing"}`);

  if (provider !== "smtp") {
    console.log("");
    console.log("Status: real email is not enabled. Set EMAIL_PROVIDER=smtp for Gmail SMTP.");
    process.exitCode = 1;
    return;
  }

  const missing = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS"].filter((key) => !readEnv(key));
  if (missing.length) {
    console.log("");
    console.log(`Status: not ready. Missing ${missing.join(", ")} in .env.`);
    console.log("For Gmail, SMTP_PASS must be a Google App Password, not your normal Gmail password.");
    process.exitCode = 1;
    return;
  }

  console.log("");
  console.log("Status: config looks ready.");
  if (!shouldSend) {
    console.log("Tip: run `npm run check:email -- your@gmail.com --send` to send a real test OTP.");
    return;
  }

  const otp = String(Math.floor(100000 + Math.random() * 900000));
  const result = await sendSignupOtpEmail({
    email: toEmail,
    otp,
    expiresInMinutes: Number(process.env.EMAIL_OTP_TTL_MINUTES || 10)
  });

  console.log(`Test email delivery result: ${JSON.stringify({ provider: result.provider, delivered: result.delivered })}`);
}

main().catch((error) => {
  console.error("Email OTP check failed:", error.message);
  process.exitCode = 1;
});
