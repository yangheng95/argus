import { defineConfig, type Plugin } from "vite";
import solidPlugin from "vite-plugin-solid";
import path from "path";
import fs from "fs";

function copyStaticAssets(entries: string[]): Plugin {
  function copyRecursive(src: string, dest: string) {
    if (fs.statSync(src).isDirectory()) {
      fs.mkdirSync(dest, { recursive: true });
      for (const child of fs.readdirSync(src)) {
        copyRecursive(path.join(src, child), path.join(dest, child));
      }
    } else {
      fs.copyFileSync(src, dest);
    }
  }

  return {
    name: "copy-static-assets",
    writeBundle(options) {
      const outDir = options.dir ?? path.resolve(__dirname, "dist-vite");
      for (const entry of entries) {
        const src = path.resolve(__dirname, "src", entry);
        const dest = path.resolve(outDir, entry);
        if (fs.existsSync(src)) {
          copyRecursive(src, dest);
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [
    solidPlugin(),
    copyStaticAssets(["i18n"]),
  ],
  root: "src",
  server: {
    port: 5173,
    strictPort: true,
    fs: {
      allow: [path.resolve(__dirname, "..", "..")],
    },
  },
  build: {
    outDir: "../dist-vite",
    emptyOutDir: true,
    target: "esnext",
  },
  resolve: {
    alias: [
      { find: "@", replacement: path.resolve(__dirname, "src") },
      // Dev-only stubs for Tauri runtime APIs so `bun run dev:vite` works
      // outside the Tauri webview (used for screenshot/visual iteration).
      {
        find: /^@tauri-apps\/plugin-dialog$/,
        replacement: path.resolve(__dirname, "src/dev-stubs/tauri-dialog.ts"),
      },
    ],
  },
});
