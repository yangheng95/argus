import path from "path"
import { Context } from "@/util/context"
import { Filesystem } from "@/util/filesystem"

export const TestPathContext = Context.create<{ directory: string }>("test-path")

export function testScope(root: string) {
  try {
    const { directory } = TestPathContext.use()
    const workspacesRoot = Filesystem.resolve(path.join(root, "workspaces"))
    const resolvedDirectory = Filesystem.resolve(directory)
    if (!Filesystem.contains(workspacesRoot, resolvedDirectory)) {
      return path.join(root, "shared")
    }
    const relative = path.relative(workspacesRoot, resolvedDirectory)
    const [workspace] = relative.split(path.sep).filter(Boolean)
    if (!workspace) return path.join(root, "shared")
    return path.join(workspacesRoot, workspace, ".opencorvus-test")
  } catch {
    return path.join(root, "shared")
  }
}
