import { defineConfig, type Plugin } from "vite";
import solidPlugin from "vite-plugin-solid";
import path from "path";
import fs from "fs";

/**
 * Copies legacy assets into the build output.
 *
 * Legacy JS files are loaded via classic <script> tags and cannot be
 * processed as ES modules due to duplicate declarations and
 * global-scope patterns (IIFEs attaching to window).
 *
 * Other assets (i18n JSON, SVGs) are fetched at runtime by the legacy
 * scripts and must be present at their original relative paths.
 */
function copyLegacyAssets(entries: string[]): Plugin {
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
    name: "copy-legacy-assets",
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
    copyLegacyAssets([
      "workspace.js",
      "interactions.js",
      "app.js",
      "opencorvus-logo-light.svg",
      "i18n",
    ]),
  ],
  root: "src",
  build: {
    outDir: "../dist-vite",
    emptyDirBeforeBuild: true,
    target: "esnext",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
