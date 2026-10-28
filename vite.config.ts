import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "autoUpdate",
      injectRegister: false,
      manifest: {
        name: "יחד בסל",
        short_name: "יחד בסל",
        id: "/",
        description: "רשימת קניות משותפת לכל הבית, עם התראות כשמוסיפים פריטים וכשמישהו בסופר",
        lang: "he",
        dir: "rtl",
        start_url: "/",
        display: "standalone",
        background_color: "#F5F7F2",
        theme_color: "#2E6B45",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      devOptions: { enabled: true, type: "module" },
    }),
  ],
  test: { include: ["src/**/*.test.ts", "supabase/functions/_shared/*.test.ts"] },
});
