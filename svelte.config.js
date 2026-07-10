// Tauri doesn't have a Node.js server to do proper SSR
// so we will use adapter-static to prerender the app (SSG)
// See: https://v2.tauri.app/start/frontend/sveltekit/ for more info
import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

const isDemo = process.env.BUILD_TARGET === "demo";
const isServer = process.env.BUILD_TARGET === "server";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      fallback: "index.html",
      pages: isDemo ? "build-demo" : isServer ? "build-server" : "build",
      assets: isDemo ? "build-demo" : isServer ? "build-server" : "build",
    }),
    paths: {
      base: isDemo ? "/demo" : "",
    },
    alias: {
      $lib: "src/lib",
      "$lib/*": "src/lib/*",
    },
  },
};

export default config;
