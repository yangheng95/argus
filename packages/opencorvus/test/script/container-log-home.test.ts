import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const root = path.resolve(import.meta.dir, "../../../..")

test("container runtime home is the single source for server log paths", () => {
  const dockerfile = readFileSync(path.join(root, "packages/opencorvus/Dockerfile"), "utf8")
  const entrypoint = readFileSync(path.join(root, "script/opencorvus-container-entrypoint.sh"), "utf8")

  expect(dockerfile).toContain("ENV OPENCORVUS_HOME=/var/lib/opencorvus")
  expect(entrypoint).toContain('OPENCORVUS_HOME="${OPENCORVUS_HOME:-/var/lib/opencorvus}"')
  expect(entrypoint).toContain('log "log_dir=$OPENCORVUS_HOME/data/log"')
  expect(entrypoint).not.toContain("/root/.opencorvus")
})
