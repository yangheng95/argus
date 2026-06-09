const profiles = {
  restricted: {
    "*": "deny",
    invalid: "allow",
    screen: "allow",
    read: "allow",
    glob: "allow",
    grep: "allow",
    list: "allow",
    websearch: "allow",
    webfetch: "allow",
    codesearch: "allow",
    planner: "allow",
    goal: "allow",
    memory: "allow",
    schedule: "allow",
    vision_analyze: "allow",
    question: "deny",
    doom_loop: "deny",
    input: "deny",
    bash: "deny",
    edit: "deny",
    write: "deny",
    task: "deny",
    skill: "deny",
    external_directory: "deny",
  },
  standard: {
    "*": "deny",
    invalid: "allow",
    screen: "allow",
    input: "allow",
    bash: "allow",
    edit: "allow",
    write: "allow",
    read: "allow",
    glob: "allow",
    grep: "allow",
    list: "allow",
    websearch: "allow",
    webfetch: "allow",
    codesearch: "allow",
    memory: "allow",
    schedule: "allow",
    planner: "allow",
    goal: "allow",
    vision_analyze: "allow",
    skill: "allow",
    task: "allow",
    automation: "allow",
    question: "deny",
    doom_loop: "deny",
    external_directory: "deny",
  },
  permissive: {
    doom_loop: "allow",
    invalid: "allow",
    screen: "allow",
    input: "allow",
    bash: "allow",
    edit: "allow",
    write: "allow",
    read: "allow",
    glob: "allow",
    grep: "allow",
    list: "allow",
    websearch: "allow",
    webfetch: "allow",
    codesearch: "allow",
    memory: "allow",
    schedule: "allow",
    planner: "allow",
    goal: "allow",
    vision_analyze: "allow",
    external_directory: "allow",
    task: "allow",
    skill: "allow",
  },
  passthrough: {},
} as const

export type PermissionProfile = keyof typeof profiles

export function pickPermissionProfile(input: string | undefined): {
  profile: PermissionProfile
  invalid: boolean
} {
  const raw = input?.trim().toLowerCase()
  if (!raw) return { profile: "standard", invalid: false }
  if (raw in profiles) return { profile: raw as PermissionProfile, invalid: false }
  return { profile: "standard", invalid: true }
}

export function permissionForProfile(profile: PermissionProfile): Record<string, string> {
  return { ...profiles[profile] }
}
