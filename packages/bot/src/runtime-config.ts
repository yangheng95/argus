import { permissionForProfile, pickPermissionProfile } from "./permission-profile"

type Config = Record<string, unknown>

function parseConfig(raw: string | undefined): Config {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
    return parsed as Config
  } catch {
    return {}
  }
}

function permissionMap(permission: unknown): Config {
  if (!permission || typeof permission !== "object" || Array.isArray(permission)) return {}
  return permission as Config
}

export function resolveRuntimeConfig(raw: string | undefined, profileInput: string | undefined) {
  const config = parseConfig(raw)
  const profileState = pickPermissionProfile(profileInput)
  const botPermission = permissionForProfile(profileState.profile)
  return {
    config: {
      ...config,
      permission: {
        ...permissionMap(config.permission),
        ...botPermission,
      },
    },
    profileState,
  }
}
