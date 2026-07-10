import { paraglideVitePlugin } from "@inlang/paraglide-js";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";

const host = process.env.TAURI_DEV_HOST;
const isDemo = process.env.BUILD_TARGET === "demo";
const isServer = process.env.BUILD_TARGET === "server";

// https://vitejs.dev/config/
export default defineConfig(async ({ mode }) => {
  const isDemoMode = mode === "demo" || isDemo;
  const isServerMode = mode === "server" || isServer;

  return {
    plugins: [
      tailwindcss(),
      sveltekit(),
      paraglideVitePlugin({
        project: "./project.inlang",
        outdir: "./src/lib/paraglide",
        strategy: ["localStorage", "cookie", "globalVariable", "baseLocale"],
      }),
    ],

    // Define environment variables
    define: {
      "import.meta.env.VITE_IS_DEMO": JSON.stringify(isDemoMode),
      "import.meta.env.VITE_IS_SERVER": JSON.stringify(isServerMode),
    },

    // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
    // Skip Tauri-specific config in demo mode
    ...(isDemoMode || isServerMode
      ? {}
      : {
          // 1. prevent vite from obscuring rust errors
          clearScreen: false,

          // 2. tauri expects a fixed port, fail if that port is not available
          server: {
            port: 1420,
            strictPort: true,
            host: host || false,
            hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,

            watch: {
              // 3. tell vite to ignore watching `src-tauri` and database files
              // SQLite WAL/SHM files change on connection and trigger full page reloads
              ignored: [
                "**/src-tauri/**",
                "**/*.sqlite",
                "**/*.sqlite-shm",
                "**/*.sqlite-wal",
                "**/*.db",
              ],
            },
          },
        }),

    // Monaco Editor and DuckDB optimization
    optimizeDeps: {
      include: ["monaco-editor", "monaco-sql-languages"],
      // Include DuckDB-WASM in demo mode
      ...(isDemoMode
        ? { include: ["monaco-editor", "monaco-sql-languages", "@duckdb/duckdb-wasm"] }
        : {}),
    },

    // Build configuration for demo/server mode
    build: isDemoMode
      ? {
          outDir: "build-demo",
          rollupOptions: {
            external: (/** @type {string} */ _id) => {
              return false;
            },
          },
        }
      : isServerMode
        ? {
            outDir: "build-server",
            rollupOptions: {
              external: (/** @type {string} */ _id) => {
                return false;
              },
            },
          }
        : {},
  };
});
