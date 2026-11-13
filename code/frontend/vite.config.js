import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// /login and /register are both React pages (GET) and backend endpoints (POST).
// Page loads and refreshes must get the app's index.html instead of being
// forwarded to the backend, which has no GET route for them and returns 404.
function servePageLoads(req) {
  if (req.method === "GET" && req.headers.accept?.includes("text/html")) {
    return "/index.html";
  }
  return undefined;
}

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/socket.io": {
        target: "http://localhost:5000",
        changeOrigin: true,
        ws: true,
      },
      "/register": {
        target: "http://localhost:5000",
        changeOrigin: true,
        bypass: servePageLoads,
      },
      "/login": {
        target: "http://localhost:5000",
        changeOrigin: true,
        bypass: servePageLoads,
      },
      "/api": {
        target: "http://localhost:5000",
        changeOrigin: true,
      },
    },
  },
});
