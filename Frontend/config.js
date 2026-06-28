(function () {
  const PRODUCTION_API_BASE = "https://explorex-production-b8a0.up.railway.app";
  const storageKeys = ["explore_api_base", "explorex_api_base"];
  const host = window.location.hostname || "localhost";
  const isLocalHost = host === "localhost" || host === "127.0.0.1" || host === "";

  function cleanBase(value) {
    const raw = String(value || "").trim().replace(/\/+$/, "");
    if (!raw) return "";
    try {
      const candidate = /^https?:\/\//i.test(raw) ? raw : "https://" + raw;
      const url = new URL(candidate);
      const urlHost = String(url.hostname || "").toLowerCase();
      const isLocalUrl = urlHost === "localhost" || urlHost === "127.0.0.1" || urlHost === "::1";
      if (!isLocalHost && isLocalUrl) return "";
      return url.origin.replace(/\/+$/, "");
    } catch (error) {
      return "";
    }
  }

  function readStoredBase() {
    for (const key of storageKeys) {
      try {
        const clean = cleanBase(localStorage.getItem(key));
        if (clean) return clean;
      } catch (error) {}
    }
    return "";
  }

  const metaBase = document.querySelector('meta[name="explorex-api-base"]')?.content || "";
  const explicitBase = cleanBase(
    window.EXPLOREX_API_BASE ||
    window.VITE_API_URL ||
    window.__EXPLOREX_API_BASE__ ||
    window.__EXPLOREX_CONFIG__?.apiBase ||
    metaBase
  );

  const defaultBase = isLocalHost ? "http://localhost:5000" : PRODUCTION_API_BASE;
  const apiBase = cleanBase(explicitBase || readStoredBase() || defaultBase) || defaultBase;
  const localCandidates = [apiBase, "http://localhost:5000", "http://127.0.0.1:5000", "http://localhost:5101", "http://127.0.0.1:5101"];

  window.EXPLOREX_API_BASE = apiBase;
  window.EXPLOREX_API_BASE_CANDIDATES = [...new Set((isLocalHost ? localCandidates : [apiBase]).map(cleanBase).filter(Boolean))];
  window.EXPLOREX_IS_LOCAL_FRONTEND = isLocalHost;

  try {
    storageKeys.forEach((key) => localStorage.setItem(key, apiBase));
  } catch (error) {
    // Storage can be blocked in private mode; pages can still use the global value.
  }
})();