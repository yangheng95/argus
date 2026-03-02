const fs = require("fs");
const os = require("os");
const path = require("path");

// Read from cache file
const cachePath = path.join(os.homedir(), ".cache", "opencorvus", "models.json");
const data = JSON.parse(fs.readFileSync(cachePath, "utf8"));

const alibaba = data["alibaba-cn"];
if (!alibaba) {
  console.log("alibaba-cn NOT in models cache");
  process.exit(1);
}

console.log("alibaba-cn found in cache:");
console.log("  id:", alibaba.id);
console.log("  env:", alibaba.env);
console.log("  npm:", alibaba.npm);
console.log("  api:", alibaba.api);
console.log("  model count:", Object.keys(alibaba.models || {}).length);

// List all models and their statuses
const models = alibaba.models || {};
for (const [id, m] of Object.entries(models)) {
  console.log(`  model: ${id}, status: ${m.status || "undefined"}, reasoning: ${m.reasoning}`);
}
