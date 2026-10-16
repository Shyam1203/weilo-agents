import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@openuidev/devtools": decodeURIComponent(new URL("src/features/chat/openui/noDevtools.ts", import.meta.url).pathname).replace(/^\/(\w:)/, "$1") } },
  server: { proxy: { "/api": { target: "http://localhost:3210", ws: true } } },
});
