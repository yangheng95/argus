import { test, expect, describe } from "bun:test"
import { selectBuildTargets, type BuildTarget } from "../../script/build-targets"

// 2026-05-11 codex review found that the Linux docker step in
// .github/workflows/build.yml invoked
// `bun run script/build.ts --single --baseline --musl-only --no-clean`
// but build.ts ignored `--musl-only` and `--no-clean`, so the alpine
// container rebuilt the host glibc target and wiped the dist/. This
// test pins the new flag semantics so the regression cannot return.

const ALL: BuildTarget[] = [
  { os: "linux", arch: "arm64" },
  { os: "linux", arch: "x64" },
  { os: "linux", arch: "x64", avx2: false },
  { os: "linux", arch: "arm64", abi: "musl" },
  { os: "linux", arch: "x64", abi: "musl" },
  { os: "linux", arch: "x64", abi: "musl", avx2: false },
  { os: "darwin", arch: "arm64" },
  { os: "darwin", arch: "x64" },
  { os: "darwin", arch: "x64", avx2: false },
  { os: "win32", arch: "x64" },
  { os: "win32", arch: "x64", avx2: false },
]

describe("selectBuildTargets — single mode", () => {
  test("default (no baseline, no muslOnly) keeps native glibc only", () => {
    const got = selectBuildTargets(ALL, {
      platform: "linux",
      arch: "x64",
      single: true,
      baseline: false,
      muslOnly: false,
    })
    expect(got).toEqual([{ os: "linux", arch: "x64" }])
  })

  test("--baseline adds the avx2-disabled glibc variant", () => {
    const got = selectBuildTargets(ALL, {
      platform: "linux",
      arch: "x64",
      single: true,
      baseline: true,
      muslOnly: false,
    })
    expect(got).toEqual([
      { os: "linux", arch: "x64" },
      { os: "linux", arch: "x64", avx2: false },
    ])
  })

  test("--musl-only selects every musl variant for the current arch (linux-x64 + baseline)", () => {
    const got = selectBuildTargets(ALL, {
      platform: "linux",
      arch: "x64",
      single: true,
      baseline: true,
      muslOnly: true,
    })
    expect(got).toEqual([
      { os: "linux", arch: "x64", abi: "musl" },
      { os: "linux", arch: "x64", abi: "musl", avx2: false },
    ])
  })

  test("--musl-only without --baseline drops the baseline musl variant", () => {
    const got = selectBuildTargets(ALL, {
      platform: "linux",
      arch: "x64",
      single: true,
      baseline: false,
      muslOnly: true,
    })
    expect(got).toEqual([{ os: "linux", arch: "x64", abi: "musl" }])
  })

  test("--musl-only on linux-arm64 picks the arm64 musl target", () => {
    const got = selectBuildTargets(ALL, {
      platform: "linux",
      arch: "arm64",
      single: true,
      baseline: true,
      muslOnly: true,
    })
    expect(got).toEqual([{ os: "linux", arch: "arm64", abi: "musl" }])
  })

  test("--musl-only on a non-Linux host produces zero targets (caller must error)", () => {
    const got = selectBuildTargets(ALL, {
      platform: "darwin",
      arch: "arm64",
      single: true,
      baseline: true,
      muslOnly: true,
    })
    expect(got).toEqual([])
  })

  test("default linux-arm64 keeps glibc and skips musl", () => {
    const got = selectBuildTargets(ALL, {
      platform: "linux",
      arch: "arm64",
      single: true,
      baseline: false,
      muslOnly: false,
    })
    expect(got).toEqual([{ os: "linux", arch: "arm64" }])
  })
})

describe("selectBuildTargets — full matrix mode", () => {
  test("single=false returns every entry unchanged", () => {
    const got = selectBuildTargets(ALL, {
      platform: "linux",
      arch: "x64",
      single: false,
      baseline: false,
      muslOnly: false,
    })
    expect(got).toEqual(ALL)
  })
})
