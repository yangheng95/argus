export default {
  entry: [
    "github/index.ts",
    "nix/scripts/**/*.ts",
    "script/**/*.ts",
  ],
  project: [
    "github/**/*.ts",
    "nix/scripts/**/*.ts",
    "script/**/*.ts",
  ],
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
      ignoreDependencies: [
        "@solid-primitives/event-bus",
        "strip-ansi",
      ],
    },
    "packages/overlay": {
      entry: [
        "script/build.ts",
        "script/check-panel-i18n.ts",
        "src/app.js",
        "src/index.html",
        "src/interactions.js",
        "src/workspace.js",
      ],
      project: ["script/**/*.ts", "src/**/*.js", "src/**/*.html"],
      ignore: ["src-tauri/**", "test/**"],
    },
    "packages/plugin": {
      entry: ["src/index.ts", "src/tool.ts"],
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
    "packages/supervisor": {
      entry: ["src/index.ts", "src/main.ts"],
      project: ["src/**/*.ts"],
      ignoreDependencies: [
        "@opencorvus-ai/sdk",
        "ulid",
        "zod",
      ],
    },
    "packages/util": {
      entry: ["src/**/*.ts"],
      project: ["src/**/*.ts"],
    },
  },
}
