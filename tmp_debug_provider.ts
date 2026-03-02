// Debug script: test provider loading for alibaba-cn
// Run from packages/opencorvus with: bun run --conditions=browser ../../tmp_debug_provider.ts

import { Provider } from "./src/provider/provider"
import { Auth } from "./src/auth"
import { Global } from "./src/global"
import { ModelsDev } from "./src/provider/models"

console.log("=== Debug Provider Loading ===")
console.log("Global.Path.data:", Global.Path.data)
console.log("Global.Path.config:", Global.Path.config)

// Check auth
const auth = await Auth.all()
console.log("\n=== Auth.all() ===")
console.log("Auth providers:", Object.keys(auth))
for (const [k, v] of Object.entries(auth)) {
  console.log(`  ${k}: type=${v.type}, key=${v.type === "api" ? v.key.slice(0, 15) + "..." : "N/A"}`)
}

// Check models
const models = await ModelsDev.get()
const alibaba = models["alibaba-cn"]
if (alibaba) {
  console.log("\n=== ModelsDev alibaba-cn ===")
  console.log("  Found with", Object.keys(alibaba.models || {}).length, "models")
} else {
  console.log("\n=== ModelsDev alibaba-cn: NOT FOUND ===")
}

// Check provider list
const providers = await Provider.list()
console.log("\n=== Provider.list() ===")
console.log("Total providers:", Object.keys(providers).length)
const alibabaProvider = providers["alibaba-cn"]
if (alibabaProvider) {
  console.log("alibaba-cn FOUND:", { source: alibabaProvider.source, key: alibabaProvider.key?.slice(0, 15), modelCount: Object.keys(alibabaProvider.models).length })
} else {
  console.log("alibaba-cn NOT FOUND in providers")
  // Check nearby names
  const similar = Object.keys(providers).filter(k => k.includes("alibaba") || k.includes("dash"))
  console.log("Similar provider names:", similar)
}

// Try to get model directly
try {
  const model = await Provider.getModel("alibaba-cn", "qwen3.5-plus")
  console.log("\n=== Provider.getModel('alibaba-cn', 'qwen3.5-plus') ===")
  console.log("SUCCESS:", { id: model.id, api: model.api })
} catch (e: any) {
  console.log("\n=== Provider.getModel('alibaba-cn', 'qwen3.5-plus') FAILED ===")
  console.log("Error:", e.name, e.message)
}

process.exit(0)
