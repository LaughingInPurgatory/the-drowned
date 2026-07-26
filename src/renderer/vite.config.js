// Only used by the standalone `vite` dev server (see .claude/launch.json,
// a browser-preview testing convenience) — the real app's build goes through
// electron-vite (electron.vite.config.mjs), which carries the same dedupe
// for the same reason (see the comment there).
export default {
  resolve: {
    dedupe: ['three']
  }
}
