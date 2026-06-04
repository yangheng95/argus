import { describe, expect, test } from "bun:test"
import {
  allExpandedFileTreeDirectories,
  buildFileTree,
  fileTreeFileSelection,
  flattenFileTree,
  moveFileTreeSelection,
  moveFileTreeSelectionToFirstChild,
  moveFileTreeSelectionToParent,
  movePatchFileIndex,
  orderedPatchFileIndexes,
  showDiffViewerFileTree,
  singlePatchFileIndex,
  toggleFileTreeDirectory,
} from "../../src/cli/cmd/tui/feature-plugins/system/diff-viewer-file-tree-utils"

describe("OpenCode diff viewer file tree utils", () => {
  const files = [
    { file: "src/zeta.ts", status: "modified" as const },
    { file: "README.md", status: "added" as const },
    { file: "src/components/button.tsx", status: "deleted" as const },
  ]

  test("builds sorted flattened rows and preserves patch file order", () => {
    const tree = buildFileTree(files)
    const expanded = allExpandedFileTreeDirectories(tree)
    const rows = flattenFileTree(tree, expanded)

    expect(rows.map((row) => row.name)).toEqual(["src", "components", "button.tsx", "zeta.ts", "README.md"])
    expect(orderedPatchFileIndexes(rows)).toEqual([2, 0, 1])
    expect(showDiffViewerFileTree(true, files.length)).toBe(true)
    expect(showDiffViewerFileTree(false, files.length)).toBe(false)
  })

  test("moves between file tree nodes and patch indexes", () => {
    const tree = buildFileTree(files)
    const expanded = allExpandedFileTreeDirectories(tree)
    const rows = flattenFileTree(tree, expanded)
    const src = rows.find((row) => row.name === "src")!
    const button = rows.find((row) => row.name === "button.tsx")!

    expect(moveFileTreeSelection(rows, undefined, 1)).toBe(rows[0]!.id)
    expect(moveFileTreeSelectionToFirstChild(rows, src.id)).toBe(rows[1]!.id)
    expect(moveFileTreeSelectionToParent(rows, button.id)).toBe(rows[1]!.id)
    expect(movePatchFileIndex([2, 0, 1], 2, 1)).toBe(0)
    expect(movePatchFileIndex([2, 0, 1], 1, 1)).toBe(1)
    expect(singlePatchFileIndex(undefined, 2, 0, 1)).toBe(2)
  })

  test("reveals files by expanding parent directories", () => {
    const tree = buildFileTree(files)
    const selection = fileTreeFileSelection(tree, 2)
    expect(selection?.highlightedNode).toBeDefined()
    expect(selection?.expandedNodes.size).toBeGreaterThan(0)

    const collapsed = toggleFileTreeDirectory(tree, allExpandedFileTreeDirectories(tree), selection?.highlightedNode)
    expect(collapsed).toBeInstanceOf(Set)
  })
})
