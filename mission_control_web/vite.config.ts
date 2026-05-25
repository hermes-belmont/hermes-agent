import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import fs from "node:fs";

const HERMES_BASE_URL = process.env.HERMES_BASE_URL ?? "http://localhost:9119";

function sessionTokenPlugin(): Plugin {
  return {
    name: "hermes-session-token",
    configureServer(server) {
      server.middlewares.use("/__hermes/session-token", async (_req, res) => {
        try {
          const upstream = await fetch(HERMES_BASE_URL);
          const html = await upstream.text();
          const match = html.match(/window\.__HERMES_SESSION_TOKEN__="([^"]+)"/);

          if (!match?.[1]) {
            res.statusCode = 502;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: `Session token not found at ${HERMES_BASE_URL}` }));
            return;
          }

          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ token: match[1] }));
        } catch (error) {
          res.statusCode = 502;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({
            error: error instanceof Error ? error.message : "Failed to fetch Hermes session token",
          }));
        }
      });
    },
  };
}

function cleanBuildOutputPlugin(): Plugin {
  return {
    name: "clean-build-output-preserve-preview",
    buildStart() {
      const outDir = path.resolve(__dirname, "../hermes_cli/mission_control_dist");
      const indexHtml = path.join(outDir, "index.html");
      const assetsDir = path.join(outDir, "assets");
      try { fs.rmSync(indexHtml, { force: true }); } catch { /* ignore missing */ }
      try { fs.rmSync(assetsDir, { recursive: true, force: true }); } catch { /* ignore missing */ }
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), sessionTokenPlugin(), cleanBuildOutputPlugin()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "../hermes_cli/mission_control_dist",
    emptyOutDir: false,
  },
  server: {
    host: "127.0.0.1",
    port: 9120,
    strictPort: true,
    proxy: {
      "/api": {
        target: HERMES_BASE_URL,
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
