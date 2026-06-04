import { prepareCompiledBinaryRuntime } from "./runtime/binary-launcher"

prepareCompiledBinaryRuntime()
await import("./overlay-server.ts")
