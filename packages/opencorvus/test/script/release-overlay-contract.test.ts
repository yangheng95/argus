import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"

const repo = resolve(import.meta.dir, "../../../..")
const stageUploadAssetsScript = resolve(repo, "script/stage-release-upload-assets.ts")

function readRepo(relativePath: string): string {
  return readFileSync(resolve(repo, relativePath), "utf8")
}

async function runStageUploadAssets(
  source: string,
  out: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["bun", stageUploadAssetsScript, "--source", source, "--out", out, "--version", "9.9.9"], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  return { code, stdout, stderr }
}

describe("release overlay artifact contract", () => {
  test("release workflow builds overlay bundles with the bundling script", () => {
    const workflow = readRepo(".github/workflows/build.yml")
    const buildStep = /- name: Build bound overlay bundle[\s\S]*?run: ([^\r\n]+)/.exec(workflow)?.[1]

    expect(buildStep).toBe("bun run script/build.ts")
    expect(workflow).toContain("--require-bundle")
  })

  test("overlay release build script opts in to platform installer bundles", () => {
    const releaseBuild = readRepo("packages/overlay/script/build.ts")
    const devBuild = readRepo("packages/overlay/script/build-overlay.ts")

    expect(releaseBuild).toContain("tauri build --bundles")
    expect(releaseBuild).not.toContain("tauri build --no-bundle")
    expect(devBuild).toContain("tauri build --no-bundle")
  })

  test("release publish job uploads CLI archives and overlay bundles", () => {
    const workflow = readRepo(".github/workflows/build.yml")
    const publishJob = /publish-release-assets:[\s\S]*?(?=\n  publish-release-branch:)/.exec(workflow)?.[0] ?? ""

    expect(publishJob).toContain("Download CLI dist artifacts")
    expect(publishJob).toContain("pattern: opencorvus-dist-*")
    expect(publishJob).toContain("pattern: overlay-*")
    expect(publishJob).toContain(
      'bun ./script/stage-release-upload-assets.ts --source /tmp/release-assets --out "$UPLOAD_DIR" --version "$VERSION"',
    )
    expect(publishJob).not.toContain("find /tmp/release-assets -type f -print0 | sort -z")
    expect(publishJob).not.toContain("while IFS= read -r -d '' FILE; do")
    expect(publishJob).not.toContain("find /tmp/release-assets -type f | sort")
    expect(publishJob).toContain('gh release upload "v${VERSION}" "${FILES[@]}" --clobber --repo "$GITHUB_REPOSITORY"')
    expect(publishJob).not.toContain("Upload overlay assets to GitHub Release")
  })

  test("release upload staging ignores internal downloaded files and preserves bare asset names", async () => {
    const root = mkdtempSync(resolve(tmpdir(), "release-upload-tree-"))
    try {
      const source = resolve(root, "downloaded")
      const out = resolve(root, "upload")
      mkdirSync(resolve(source, "opencorvus-dist-linux-x64", "opencorvus-linux-x64", "bin"), { recursive: true })
      mkdirSync(resolve(source, "overlay-linux-x64"), { recursive: true })
      writeFileSync(resolve(source, "opencorvus-dist-linux-x64", "opencorvus-linux-x64.tar.gz"), "cli")
      writeFileSync(resolve(source, "opencorvus-dist-linux-x64", "opencorvus-linux-x64", "opencorvus"), "internal cli")
      writeFileSync(resolve(source, "opencorvus-dist-linux-x64", "opencorvus-linux-x64", "bin", "rg"), "internal rg")
      writeFileSync(resolve(source, "overlay-linux-x64", "opencorvus-overlay"), "internal overlay")
      writeFileSync(resolve(source, "overlay-linux-x64", "OpenCorvus_9.9.9_amd64.AppImage"), "appimage")
      writeFileSync(resolve(source, "overlay-linux-x64", "OpenCorvus_9.9.9_amd64.deb"), "deb")
      writeFileSync(resolve(source, "overlay-linux-x64", "OpenCorvus-9.9.9-1.x86_64.rpm"), "rpm")

      const result = await runStageUploadAssets(source, out)
      expect(result).toMatchObject({ code: 0, stderr: "" })
      expect(readdirSync(out).sort()).toEqual([
        "OpenCorvus-9.9.9-1.x86_64.rpm",
        "OpenCorvus_9.9.9_amd64.AppImage",
        "OpenCorvus_9.9.9_amd64.deb",
        "opencorvus-linux-x64.tar.gz",
      ])
      expect(result.stdout).toContain("opencorvus-linux-x64.tar.gz")
      expect(result.stdout).not.toContain("opencorvus-dist-linux-x64__")
      expect(result.stdout).not.toContain("opencorvus-overlay")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("release upload staging rejects duplicate bundle names across downloaded artifacts", async () => {
    const root = mkdtempSync(resolve(tmpdir(), "release-upload-dupe-"))
    try {
      const source = resolve(root, "downloaded")
      const out = resolve(root, "upload")
      mkdirSync(resolve(source, "overlay-linux-x64", "nested"), { recursive: true })
      writeFileSync(resolve(source, "overlay-linux-x64", "OpenCorvus_9.9.9_amd64.AppImage"), "one")
      writeFileSync(resolve(source, "overlay-linux-x64", "nested", "OpenCorvus_9.9.9_amd64.AppImage"), "two")

      const result = await runStageUploadAssets(source, out)
      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain("Duplicate release asset name after staging: OpenCorvus_9.9.9_amd64.AppImage")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("release upload staging rejects stale or wrong-platform overlay bundle names", async () => {
    const root = mkdtempSync(resolve(tmpdir(), "release-upload-contract-"))
    try {
      const source = resolve(root, "downloaded")
      const out = resolve(root, "upload")
      mkdirSync(resolve(source, "overlay-linux-x64"), { recursive: true })
      writeFileSync(resolve(source, "overlay-linux-x64", "OpenCorvus_9.9.8_amd64.AppImage"), "stale")

      const stale = await runStageUploadAssets(source, out)
      expect(stale.code).not.toBe(0)
      expect(stale.stderr).toContain("Overlay bundle does not match release 9.9.9 for linux-x64")

      rmSync(source, { recursive: true, force: true })
      rmSync(out, { recursive: true, force: true })
      mkdirSync(resolve(source, "overlay-linux-x64"), { recursive: true })
      writeFileSync(resolve(source, "overlay-linux-x64", "OpenCorvus_9.9.9_arm64.AppImage"), "wrong platform")

      const wrongPlatform = await runStageUploadAssets(source, out)
      expect(wrongPlatform.code).not.toBe(0)
      expect(wrongPlatform.stderr).toContain("Overlay bundle does not match release 9.9.9 for linux-x64")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("macOS app bundles are staged with release validator names", () => {
    const workflow = readRepo(".github/workflows/build.yml")
    const stageStep =
      /- name: Stage overlay artifacts[\s\S]*?(?=\n      - name: Validate overlay assets)/.exec(workflow)?.[0] ?? ""

    expect(stageStep).toContain('darwin-arm64) APP_ARCH="aarch64"')
    expect(stageStep).toContain('darwin-x64) APP_ARCH="x64"')
    expect(stageStep).toContain('APP_ARCHIVE="OpenCorvus_${{ needs.prepare.outputs.version }}_${APP_ARCH}.app.tar.gz"')
    expect(stageStep).toContain('tar -czf "$OUT/$APP_ARCHIVE"')
    expect(stageStep).not.toContain('$(basename "$app").tar.gz')
  })

  test("release workflow archives every CLI variant with installer-compatible root layout", () => {
    const workflow = readRepo(".github/workflows/build.yml")
    const packageStep =
      /- name: Package CLI archive[\s\S]*?(?=\n      - name: Validate CLI assets)/.exec(workflow)?.[0] ?? ""
    const validateStep =
      /- name: Validate CLI assets[\s\S]*?(?=\n      - name: Upload CLI dist artifact)/.exec(workflow)?.[0] ?? ""

    expect(packageStep).toContain("dirs=(opencorvus-${{ matrix.platform }}*)")
    expect(packageStep).toContain('for dir in "${dirs[@]}"; do')
    expect(packageStep).toContain('tar -czf "${name}.tar.gz" -C "$dir" .')
    expect(packageStep).toContain('(cd "$dir" && zip -rq "../${name}.zip" .)')
    expect(packageStep).toContain('(cd "$dir" && 7z a -tzip "../${name}.zip" . > /dev/null)')
    expect(packageStep).not.toContain('tar -czf "${name}.tar.gz" "${name}"')

    expect(validateStep).toContain("platforms=()")
    expect(validateStep).toContain('platforms+=("${dir##*/opencorvus-}")')
    expect(validateStep).toContain('platforms_csv="$(IFS=,; echo "${platforms[*]}")"')
    expect(validateStep).toContain('--platforms "$platforms_csv"')
  })
})
