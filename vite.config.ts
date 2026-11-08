import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    outDir: "docs",
    emptyOutDir: true,
  },
  server: {
    host: "127.0.0.1",
    port: 4177,
    proxy: {
      "/armory-proxy": {
        target: "https://worldofwarcraft.blizzard.com",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/armory-proxy/, ""),
      },
    },
  },
});
