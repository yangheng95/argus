const fs = require("fs");
const os = require("os");
const path = require("path");

const args = process.argv.slice(2);
const filename = args[0] || "prov3.json";
const raw = fs.readFileSync(path.join(os.tmpdir(), filename), "utf8");
const data = JSON.parse(raw);

console.log("Top-level keys:", Object.keys(data));

const list = data.all;
if (Array.isArray(list)) {
  console.log("all is array, length:", list.length);
  // Search more broadly
  const found = list.filter(p => {
    const id = p.id || "";
    const name = (p.name || "").toLowerCase();
    return id.includes("alibaba") || id.includes("dash") || name.includes("alibaba") || name.includes("dash") || name.includes("qwen");
  });
  console.log("Matching providers (alibaba/dash/qwen):", found.map(p => ({id: p.id, name: p.name, source: p.source})));

  // Show first 5 provider IDs
  console.log("First 10 provider IDs:", list.slice(0, 10).map(p => p.id));
  console.log("Last 5 provider IDs:", list.slice(-5).map(p => p.id));
} else if (typeof list === "object") {
  const keys = Object.keys(list);
  console.log("all is object, keys count:", keys.length);
  const alibaba = keys.filter(k => k.includes("alibaba") || k.includes("dash"));
  console.log("Alibaba/dash keys:", alibaba);
}

// Also check raw text
if (raw.includes("alibaba")) {
  console.log("'alibaba' found in raw response!");
  const idx = raw.indexOf("alibaba");
  console.log("Context:", raw.substring(Math.max(0, idx - 50), idx + 100));
} else {
  console.log("'alibaba' NOT found in raw response!");
}
