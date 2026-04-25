/**
 * `build` agent — pipeline / direct-workflow code-writing agent.
 *
 * Public surface:
 *   - BuildAgent.run({ target, task, ... }) → BuildAgent.RunOutput
 *   - BuildResultSchema, BuildResult, BuildTarget — terminal payload + input shape.
 */
export { BuildAgent } from "./agent"
export type { BuildResult, BuildTarget } from "./types"
export { BuildResultSchema } from "./types"
