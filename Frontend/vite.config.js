import { defineConfig } from 'vite';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

function copyClassicScripts(){
  return {
    name: 'copy-classic-scripts',
    closeBundle(){
      mkdirSync(resolve(__dirname, 'dist'), { recursive: true });
      for (const file of ['config.js', 'lang.js']) {
        const source = resolve(__dirname, file);
        if (existsSync(source)) {
          copyFileSync(source, resolve(__dirname, 'dist', file));
        }
      }
    }
  };
}

export default defineConfig({
  plugins: [copyClassicScripts()],
  server: {
    host: '0.0.0.0',
    port: 5173
  },
  preview: {
    host: '0.0.0.0',
    port: 8080
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
      "index": resolve(__dirname, "index.html"),
      "login_1": resolve(__dirname, "login_1.html"),
      "about_1": resolve(__dirname, "about_1.html"),
      "city_services": resolve(__dirname, "city-services.html"),
      "kumbh_guide": resolve(__dirname, "kumbh-guide.html"),
      "route_planner": resolve(__dirname, "route-planner.html"),
      "profile_2": resolve(__dirname, "profile_2.html"),
      "support_chat": resolve(__dirname, "support-chat.html"),
      "privacy_policy": resolve(__dirname, "privacy-policy.html"),
      "terms": resolve(__dirname, "terms.html"),
      "hotel_owner": resolve(__dirname, "hotel-owner.html"),
      "explorex_admin": resolve(__dirname, "explorex-admin.html")
      }
    }
  }
});
