function toUsernameSeed(name) {
  const first = String(name || "user").trim().split(/\s+/)[0] || "user";
  return first.toLowerCase().replace(/[^a-z0-9]/g, "") || "user";
}

module.exports = {
  toUsernameSeed
};