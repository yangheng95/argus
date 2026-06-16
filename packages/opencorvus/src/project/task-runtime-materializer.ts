import fs from "node:fs/promises"

import { ProjectRuntimePaths } from "@/project/runtime-paths"

export namespace TaskRuntimeMaterializer {
  export async function webpageEvidenceDir(projectDir: string, taskID: string): Promise<string> {
    const paths = ProjectRuntimePaths.frontendDesignPaths(projectDir, taskID)
    await fs.mkdir(paths.webpageEvidenceAbsolute, { recursive: true })
    return paths.webpageEvidenceAbsolute
  }

  export async function materializeFrontendDesign(input: {
    projectDir: string
    taskID: string
    worktreeDir: string
  }): Promise<void> {
    const paths = ProjectRuntimePaths.frontendDesignPaths(input.projectDir, input.taskID)
    await fs.mkdir(paths.webpageEvidenceAbsolute, { recursive: true })
  }
}
