import { prepareCompiledBinaryRuntime } from "./runtime/binary-launcher"

prepareCompiledBinaryRuntime()
await import("./index.ts")
