
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/socket.io": {
        target: "http://localhost:5000",
        changeOrigin: true,
        ws: true,
      },
      "/login": {
        target: "http://localhost:5000",
        changeOrigin: true,
        bypass(req) {
          if (req.method === "GET") return "/index.html";
        },
      },
      "/register": {
        target: "http://localhost:5000",
        changeOrigin: true,
        bypass(req) {
          if (req.method === "GET") return "/index.html";
        },
      },
      "/api": {
        target: "http://localhost:5000",
        changeOrigin: true,
      },
    },
  },
});
