import { describe, expect, test } from "bun:test"
import { permissionForProfile, pickPermissionProfile } from "../src/permission-profile"

describe("channel permission profile", () => {
  test("defaults to standard profile", () => {
    const result = pickPermissionProfile(undefined)
    expect(result).toEqual({ profile: "standard", invalid: false })
  })

  test("falls back to standard for unknown profile", () => {
    const result = pickPermissionProfile("unknown")
    expect(result).toEqual({ profile: "standard", invalid: true })
  })

  test("restricted blocks write-like tools", () => {
    const permission = permissionForProfile("restricted")
    expect(permission["*"]).toBe("deny")
    expect(permission.bash).toBe("deny")
    expect(permission.edit).toBe("deny")
    expect(permission.write).toBe("deny")
    expect(permission.input).toBe("deny")
  })

  test("standard keeps project tools but denies risky boundaries", () => {
    const permission = permissionForProfile("standard")
    expect(permission.bash).toBe("allow")
    expect(permission.edit).toBe("allow")
    expect(permission.external_directory).toBe("deny")
    expect(permission.doom_loop).toBe("deny")
    expect(permission.question).toBe("deny")
  })

  test("permissive remains fully enabled for compatibility", () => {
    const permission = permissionForProfile("permissive")
    expect(permission.bash).toBe("allow")
    expect(permission.edit).toBe("allow")
    expect(permission.external_directory).toBe("allow")
    expect(permission.doom_loop).toBe("allow")
  })

  test("passthrough does not override user permissions", () => {
    const permission = permissionForProfile("passthrough")
    expect(Object.keys(permission)).toHaveLength(0)
  })
})
