import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const repo = resolve(import.meta.dir, "../../../..")

function readRepo(relativePath: string): string {
  return readFileSync(resolve(repo, relativePath), "utf8")
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
    expect(publishJob).toContain("find /tmp/release-assets -type f | sort")
    expect(publishJob).toContain('gh release upload "v${VERSION}" "${FILES[@]}" --clobber --repo "$GITHUB_REPOSITORY"')
    expect(publishJob).not.toContain("Upload overlay assets to GitHub Release")
  })

  test("release workflow archives every CLI variant with installer-compatible root layout", () => {
    const workflow = readRepo(".github/workflows/build.yml")
    const packageStep = /- name: Package CLI archive[\s\S]*?(?=\n      - name: Validate CLI assets)/.exec(workflow)?.[0] ?? ""
    const validateStep = /- name: Validate CLI assets[\s\S]*?(?=\n      - name: Upload CLI dist artifact)/.exec(workflow)?.[0] ?? ""

    expect(packageStep).toContain("dirs=(opencorvus-${{ matrix.platform }}*)")
    expect(packageStep).toContain('for dir in "${dirs[@]}"; do')
    expect(packageStep).toContain('tar -czf "${name}.tar.gz" -C "$dir" .')
    expect(packageStep).toContain('(cd "$dir" && zip -rq "../${name}.zip" .)')
    expect(packageStep).toContain('(cd "$dir" && 7z a -tzip "../${name}.zip" . > /dev/null)')
    expect(packageStep).not.toContain('tar -czf "${name}.tar.gz" "${name}"')

    expect(validateStep).toContain("platforms=()")
    expect(validateStep).toContain("platforms+=(\"${dir##*/opencorvus-}\")")
    expect(validateStep).toContain('platforms_csv="$(IFS=,; echo "${platforms[*]}")"')
    expect(validateStep).toContain('--platforms "$platforms_csv"')
  })
})
