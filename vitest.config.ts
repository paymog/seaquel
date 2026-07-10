import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";

const lib = fileURLToPath(new URL("./src/lib", import.meta.url));

export default defineConfig({
  plugins: [svelte()],
  test: { environment: "jsdom", globals: true },
  resolve: { alias: { $lib: lib } },
});
