// Self-contained binary launcher
// Changes CWD to the binary's directory so native .node modules (sharp, etc.)
// are resolved from the co-located node_modules/ directory.
// The original CWD is preserved in OPENCORVUS_ORIGINAL_CWD for the application to use.
import path from "path"

const binDir = path.dirname(process.execPath)
const originalCwd = process.cwd()

// Save original CWD so the application can restore it
process.env.OPENCORVUS_ORIGINAL_CWD = originalCwd

// Change to binary's directory — this is critical for native .node module resolution
// in Bun compiled binaries, which resolve require() from CWD.
process.chdir(binDir)

// Now dynamically import the real entry point
await import("./index.ts")
