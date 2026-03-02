const fs = require("fs");
const data = JSON.parse(fs.readFileSync("/tmp/prov.json", "utf8"));
const list = data.all;
console.log("Type:", typeof list, Array.isArray(list) ? "array" : "not-array");
if (typeof list === "object" && list !== null) {
  const keys = Object.keys(list);
  console.log("Provider count:", keys.length);
  const alibaba = keys.filter(k => k.includes("alibaba"));
  console.log("Alibaba providers:", alibaba);
  for (const k of alibaba) {
    const p = list[k];
    const modelKeys = Object.keys(p.models || {});
    const qwenModels = modelKeys.filter(m => m.includes("qwen3.5") || m.includes("plus"));
    console.log(`  ${k}: source=${p.source}, key=${p.key ? p.key.slice(0,15)+"..." : "NONE"}, totalModels=${modelKeys.length}, qwenPlusModels=${JSON.stringify(qwenModels)}`);
  }
}
