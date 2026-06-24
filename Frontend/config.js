(function () {
  const storageKeys = ["explore_api_base", "explorex_api_base"];
  const explicitBase = String(
    window.EXPLOREX_API_BASE ||
      storageKeys.map((key) => localStorage.getItem(key)).find(Boolean) ||
      ""
  ).trim();

  const host = window.location.hostname || "localhost";
  const isLocalHost = host === "localhost" || host === "127.0.0.1" || host === "";
  const protocol = window.location.protocol === "https:" ? "https:" : "http:";
  const defaultBase = isLocalHost
    ? "http://localhost:5000"
    : `${protocol}//${host}:5000`;

  const apiBase = (explicitBase || defaultBase).replace(/\/+$/, "");
  window.EXPLOREX_API_BASE = apiBase;

  try {
    storageKeys.forEach((key) => localStorage.setItem(key, apiBase));
  } catch (error) {
    // Storage can be blocked in private mode; pages can still use the global value.
  }
})();
