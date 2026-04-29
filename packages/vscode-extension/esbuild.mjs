import esbuild from "esbuild"

/**
 * VS Code extension build:
 *  - bundles src/extension.ts → dist/extension.cjs
 *  - CommonJS because the VS Code extension host loads via require()
 *  - external `vscode` module is provided by the host at runtime
 *  - no source maps in production (plan §19.1.4: VSIX must stay <200MB)
 *  - dead-code-eliminate dev-only branches via `define`
 */

const isProduction = process.argv.includes("--production")

await esbuild.build({
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.cjs",
  platform: "node",
  format: "cjs",
  target: "node18",
  external: ["vscode"],
  sourcemap: isProduction ? false : "inline",
  minify: isProduction,
  define: {
    "process.env.NODE_ENV": isProduction ? '"production"' : '"development"',
    // Production strips all dev-mode env reads (plan §17): the bundle
    // simply never sees these names, so a release VSIX cannot be
    // tricked into loading vite dev server / external sidecar.
    ...(isProduction
      ? {
          "process.env.OPENCORVUS_DEV_UI": "undefined",
          "process.env.OPENCORVUS_DEV_SIDECAR": "undefined",
          "process.env.OPENCORVUS_DEV_BINARY": "undefined",
        }
      : {}),
  },
  logLevel: "info",
})
