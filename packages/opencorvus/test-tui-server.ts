// Quick test: spawn TUI in foreground, check if server starts
import { resolveNetworkOptions } from "./src/cli/network"

// Simulate what thread.ts does
const args = {
  port: 15678,
  hostname: "127.0.0.1",
  mdns: false,
  "mdns-domain": "opencorvus.local",
  cors: [] as string[],
}

const networkOpts = await resolveNetworkOptions(args)
console.log("networkOpts:", JSON.stringify(networkOpts))
console.log("shouldStartServer check:")
console.log("  process.argv.includes('--port'):", process.argv.includes("--port"))
console.log("  networkOpts.port !== 0:", networkOpts.port !== 0)

const shouldStartServer =
  process.argv.includes("--port") ||
  process.argv.includes("--hostname") ||
  process.argv.includes("--mdns") ||
  networkOpts.mdns ||
  networkOpts.port !== 0 ||
  networkOpts.hostname !== "127.0.0.1"

console.log("shouldStartServer:", shouldStartServer)
