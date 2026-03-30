#!/usr/bin/env bun

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { pathToFileURL } from "url";

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Guard: never let a stale hand-edited main.js survive.
// Always overwrite — the source of truth is main.tsx, not main.js.
const mainJsPath = path.join(dir, "src", "main.js");
const mainJsBak = mainJsPath + ".bak";
await fs.rm(mainJsBak, { force: true }).catch(() => undefined);
const repo = path.resolve(dir, "../..");
const outDir = path.join(dir, ".mainjs-build");
const srcDir = path.join(dir, "src");
const bunModules = path.join(repo, "node_modules", ".bun");
const tempEntry = path.join(srcDir, ".mainjs-entry.html");

async function findPackageDir(prefix: string) {
  const entries = await fs.readdir(bunModules, { withFileTypes: true });
  const match = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a))[0];
  if (!match) {
    throw new Error(`Unable to locate ${prefix} under ${bunModules}`);
  }
  return path.join(bunModules, match);
}

const viteDir = await findPackageDir("vite@6.");
const solidPluginDir = await findPackageDir("vite-plugin-solid@2.");
const solidDir = await findPackageDir("solid-js@1.");
const { build } = await import(pathToFileURL(path.join(viteDir, "node_modules", "vite", "dist", "node", "index.js")).href);
const solidPluginModule = await import(
  pathToFileURL(path.join(solidPluginDir, "node_modules", "vite-plugin-solid", "dist", "esm", "index.mjs")).href,
);
const solidPlugin = solidPluginModule.default;
const solidPackageDir = path.join(solidDir, "node_modules", "solid-js");

await fs.rm(outDir, { recursive: true, force: true }).catch(() => undefined);
await fs.writeFile(
  tempEntry,
  [
    "<!DOCTYPE html>",
    '<html lang="zh-CN">',
    "<head>",
    '  <meta charset="UTF-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
    "  <title>overlay-mainjs</title>",
    "</head>",
    "<body>",
    '  <script type="module" src="./main.tsx"></script>',
    "</body>",
    "</html>",
    "",
  ].join("\n"),
);

try {
  await build({
    configFile: false,
    root: srcDir,
    plugins: [solidPlugin()],
    resolve: {
      alias: [
        {
          find: "solid-js/web/dist/web",
          replacement: path.join(solidPackageDir, "web", "dist", "web.js"),
        },
        {
          find: "solid-js/web",
          replacement: path.join(solidPackageDir, "web", "dist", "web.js"),
        },
        {
          find: "solid-js/store",
          replacement: path.join(solidPackageDir, "store", "dist", "store.js"),
        },
        {
          find: "solid-js",
          replacement: path.join(solidPackageDir, "dist", "solid.js"),
        },
        {
          find: "@",
          replacement: srcDir,
        },
      ],
      conditions: ["browser"],
    },
    build: {
      outDir,
      emptyOutDir: true,
      target: "esnext",
      minify: false,
      cssCodeSplit: false,
      rollupOptions: {
        input: tempEntry,
        output: { inlineDynamicImports: true },
        external: [/^@tauri-apps\//],
      },
    },
  });

  const assetsDir = path.join(outDir, "assets");
  const files = await fs.readdir(assetsDir);
  const bundle = files.find((name) => name.endsWith(".js"));
  if (!bundle) {
    throw new Error(`No JS bundle found in ${assetsDir}`);
  }
  await fs.copyFile(path.join(assetsDir, bundle), path.join(srcDir, "main.js"));
  console.log(`✓ main.tsx → main.js (${(await fs.stat(path.join(srcDir, "main.js"))).size} bytes)`);
} finally {
  await fs.rm(tempEntry, { force: true }).catch(() => undefined);
  await fs.rm(outDir, { recursive: true, force: true }).catch(() => undefined);
}
