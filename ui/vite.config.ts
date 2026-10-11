import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In dev, the daemon (container, port 3210) answers /api. The Host header is kept, so it matches
// the Origin the daemon checks.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { proxy: { "/api": { target: "http://localhost:3210", ws: true } } },
});
