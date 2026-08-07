// Only used by the standalone `vite` dev server (see .claude/launch.json,
// a browser-preview testing convenience) — the real app's build goes through
// electron-vite (electron.vite.config.mjs), which carries the same dedupe
// for the same reason (see the comment there).
export default {
  resolve: {
    dedupe: ['three']
  },
  server: {
    // No hot reload. This server exists to serve `scripts/shot.cjs`, which
    // opens a fresh window per capture and therefore always gets current files
    // anyway. With HMR on, an edit by any concurrent agent reloads the page
    // out from under an in-flight capture and the harness never reaches
    // `ready` — which reads as a timeout in someone else's workstream and cost
    // real time to chase down. Turning it off costs nothing here.
    hmr: false
  }
}
