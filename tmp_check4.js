const fs = require("fs");
const os = require("os");
const path = require("path");

const raw = fs.readFileSync(path.join(os.tmpdir(), "prov3.json"), "utf8");
const data = JSON.parse(raw);
const list = data.all;

const alibabaCn = list.find(p => p.id === "alibaba-cn");
if (!alibabaCn) {
  console.log("alibaba-cn NOT found!");
  process.exit(1);
}

console.log("alibaba-cn found!");
console.log("  source:", alibabaCn.source);
console.log("  key:", alibabaCn.key ? alibabaCn.key.slice(0, 15) + "..." : "NONE");
console.log("  env:", alibabaCn.env);
console.log("  model count:", Object.keys(alibabaCn.models || {}).length);

const qwen35plus = alibabaCn.models && alibabaCn.models["qwen3.5-plus"];
if (qwen35plus) {
  console.log("\n  qwen3.5-plus model found!");
  console.log("    api.id:", qwen35plus.api?.id);
  console.log("    api.npm:", qwen35plus.api?.npm);
  console.log("    api.url:", qwen35plus.api?.url);
  console.log("    reasoning:", qwen35plus.capabilities?.reasoning);
} else {
  console.log("\n  qwen3.5-plus model NOT found!");
  console.log("  Available models:", Object.keys(alibabaCn.models || {}).slice(0, 10));
}

// Check default model
const defaultInfo = data.default;
console.log("\nDefault model:", defaultInfo);

// Check connected
console.log("Connected:", data.connected);
