import { existsSync } from "fs"
import { createRequire } from "module"
import path from "path"

const sourceRequire = createRequire(import.meta.url)

export function runtimePackageRequire(): NodeJS.Require {
  const packagedPackageJson = path.join(path.dirname(process.execPath), "package.json")
  if (existsSync(packagedPackageJson)) {
    return createRequire(packagedPackageJson)
  }
  return sourceRequire
}

export function requireRuntimePackage<T>(specifier: string): T {
  return runtimePackageRequire()(specifier) as T
}
