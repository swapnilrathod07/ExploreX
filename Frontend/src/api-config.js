const API_BASE_URL =
  import.meta.env.VITE_API_URL ||
  'https://explorex-production-b8a0.up.railway.app';

window.API_BASE_URL = API_BASE_URL.replace(/\/+$/, '');
window.VITE_API_URL = window.API_BASE_URL;
window.EXPLOREX_API_BASE = window.API_BASE_URL;
window.EXPLOREX_API_BASE_CANDIDATES = [window.API_BASE_URL];

console.log('API_BASE_URL:', window.API_BASE_URL);

export { API_BASE_URL };
