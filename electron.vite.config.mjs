import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        output: {
          format: 'cjs',
          entryFileNames: '[name].js'
        }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    // three/examples/jsm/postprocessing/* (render/scene.js: EffectComposer,
    // RenderPass, UnrealBloomPass, OutputPass) otherwise resolves 'three' via a
    // separate module graph than the rest of the app, triggering "Multiple
    // instances of Three.js" and silently breaking the post chain (the passes
    // rely on the renderer recognizing the same THREE classes) — deduping
    // forces both import paths onto the one instance.
    resolve: {
      dedupe: ['three']
    },
    css: {
      postcss: {}
    },
    build: {
      rollupOptions: {
        input: resolve('src/renderer/index.html')
      }
    }
  }
})
