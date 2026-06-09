export default {
  entry: ["github/index.ts", "nix/scripts/**/*.ts", "script/**/*.ts"],
  project: ["github/**/*.ts", "nix/scripts/**/*.ts", "script/**/*.ts"],
  ignore: [
    "backups/**",
    "packages/overlay/src-tauri/**",
    "packages/opencorvus/.opencorvus/**",
    "packages/opencorvus/.turbo/**",
    "packages/opencorvus/dist/**",
    "packages/opencorvus/eval-prd-workspace/**",
    "packages/opencorvus/eval-workspace-*/**",
  ],
  ignoreBinaries: [
    "osascript",
    "powershell.exe",
    "wl-paste",
    "xclip",
    "choco",
    "gh",
    "opencorvus",
    "powershell",
    "mix",
    "tar",
    "xcrun",
    "java",
    "brew",
    "scoop",
  ],
  workspaces: {
    "packages/channel-config": {
      entry: ["src/index.ts"],
      project: ["src/**/*.ts"],
    },
    "packages/channel-runtime": {
      entry: ["src/index.ts", "src/main.ts"],
      project: ["src/**/*.ts"],
      ignoreDependencies: [
        "@opencorvus-ai/channel-config",
        "@opencorvus-ai/sdk",
        "@slack/bolt",
        "discord.js",
        "grammy",
      ],
    },
    "packages/opencorvus": {
      entry: ["src/index.ts", "bin/opencorvus"],
      project: ["src/**/*.ts", "src/**/*.tsx"],
      ignore: ["script/**", "test/**"],
      ignoreDependencies: ["@solid-primitives/event-bus", "strip-ansi"],
    },
    "packages/overlay": {
      entry: [
        "script/build.ts",
        "script/build-overlay.ts",
        "script/build-docker.ts",
        "script/check-panel-i18n.ts",
        // src/main.tsx is the Solid entry point — vite.config.ts roots
        // at `src/` and uses src/index.html as the HTML host that loads
        // /main.tsx via the standard <script type="module"> tag.
        "src/index.html",
        "src/main.tsx",
      ],
      project: ["script/**/*.ts", "src/**/*.{ts,tsx,js,html}", "vite.config.ts"],
      ignore: ["src-tauri/**", "test/**", "node_modules/**", "dist/**", "dist-vite/**"],
    },
    "packages/plugin": {
      entry: ["src/index.ts", "src/tool.ts"],
      project: ["src/**/*.ts"],
    },
    "packages/script": {
      entry: ["src/index.ts"],
      project: ["src/**/*.ts"],
    },
    "packages/sdk/js": {
      entry: [
        "src/index.ts",
        "src/client.ts",
        "src/server.ts",
        "src/v2/index.ts",
        "src/v2/client.ts",
        "src/v2/server.ts",
        "src/v2/gen/client/index.ts",
      ],
      project: ["src/**/*.ts"],
    },
    "packages/util": {
      entry: ["src/**/*.ts"],
      project: ["src/**/*.ts"],
    },
  },
}
