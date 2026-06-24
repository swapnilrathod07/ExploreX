require("dotenv").config();

const {
  getOtpSmsProvider,
  sendOtpSms,
  shouldExposeOtpForProvider
} = require("../src/utils/smsOtp");

function readEnv(name) {
  return String(process.env[name] || "").trim();
}

function mask(value) {
  const text = String(value || "");
  if (!text) return "missing";
  if (text.length <= 8) return `${text.slice(0, 2)}***`;
  return `${text.slice(0, 4)}***${text.slice(-4)}`;
}

function normalizePhone(value) {
  const raw = String(value || "").trim();
  const compact = raw.replace(/[\s().-]/g, "");
  if (/^\+91[6-9]\d{9}$/.test(compact)) return compact;
  const digits = compact.replace(/\D/g, "");
  if (/^[6-9]\d{9}$/.test(digits)) return `+91${digits}`;
  if (/^91[6-9]\d{9}$/.test(digits)) return `+${digits}`;
  return "";
}

function providerStatus(provider) {
  if (provider === "msg91") {
    return {
      ready: Boolean(readEnv("MSG91_AUTH_KEY") && readEnv("MSG91_OTP_TEMPLATE_ID")),
      required: ["MSG91_AUTH_KEY", "MSG91_OTP_TEMPLATE_ID"],
      values: {
        MSG91_AUTH_KEY: mask(readEnv("MSG91_AUTH_KEY")),
        MSG91_OTP_TEMPLATE_ID: mask(readEnv("MSG91_OTP_TEMPLATE_ID"))
      }
    };
  }

  if (provider === "twilio") {
    return {
      ready: Boolean(readEnv("TWILIO_ACCOUNT_SID") && readEnv("TWILIO_AUTH_TOKEN") && readEnv("TWILIO_PHONE_NUMBER")),
      required: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER"],
      values: {
        TWILIO_ACCOUNT_SID: mask(readEnv("TWILIO_ACCOUNT_SID")),
        TWILIO_AUTH_TOKEN: mask(readEnv("TWILIO_AUTH_TOKEN")),
        TWILIO_PHONE_NUMBER: mask(readEnv("TWILIO_PHONE_NUMBER"))
      }
    };
  }

  if (provider === "custom") {
    return {
      ready: Boolean(readEnv("SMS_OTP_WEBHOOK_URL")),
      required: ["SMS_OTP_WEBHOOK_URL"],
      values: {
        SMS_OTP_WEBHOOK_URL: readEnv("SMS_OTP_WEBHOOK_URL") ? "set" : "missing",
        SMS_OTP_WEBHOOK_TOKEN: readEnv("SMS_OTP_WEBHOOK_TOKEN") ? "set" : "optional"
      }
    };
  }

  return {
    ready: provider === "dev" || provider === "local" || provider === "console",
    required: [],
    values: {}
  };
}

async function main() {
  const provider = getOtpSmsProvider();
  const status = providerStatus(provider);
  const phone = normalizePhone(process.argv[2] || "");
  const shouldSend = process.argv.includes("--send");

  console.log("ExploreX SMS OTP config check");
  console.log("--------------------------------");
  console.log(`Provider: ${provider}`);
  console.log(`OTP exposed in API response: ${shouldExposeOtpForProvider() ? "yes" : "no"}`);

  Object.entries(status.values).forEach(([key, value]) => {
    console.log(`${key}: ${value}`);
  });

  if (!status.ready) {
    console.log("");
    console.log("Status: not ready");
    console.log(`Add these values in .env: ${status.required.join(", ")}`);
    process.exitCode = 1;
    return;
  }

  console.log("");
  console.log("Status: config looks ready");

  if (!shouldSend) {
    console.log("Tip: run `npm run check:sms -- 9876543210 --send` to send a real test OTP.");
    return;
  }

  if (!phone) {
    console.log("Please pass a valid Indian mobile number, example: npm run check:sms -- 9876543210 --send");
    process.exitCode = 1;
    return;
  }

  const otp = String(Math.floor(100000 + Math.random() * 900000));
  const result = await sendOtpSms({
    phone,
    otp,
    purpose: "test",
    expiresInMinutes: Number(process.env.PHONE_OTP_TTL_MINUTES || 10)
  });

  console.log(`Test OTP delivery result: ${JSON.stringify({ provider: result.provider, sent: result.sent, messageId: result.messageId || "" })}`);
}

main().catch((error) => {
  console.error("SMS OTP check failed:", error.message);
  process.exitCode = 1;
});
