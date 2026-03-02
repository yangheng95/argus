// Simulate PermissionNext.disabled()
const EDIT_TOOLS = ["edit", "write", "patch", "multiedit"]

function match(str, pattern) {
  let escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")
  return new RegExp("^" + escaped + "$", "si").test(str)
}

// Merged ruleset: defaults + question_allow + user(botPermission)
const rules = [
  // defaults
  {permission: "*", action: "allow", pattern: "*"},
  {permission: "doom_loop", action: "ask", pattern: "*"},
  {permission: "screen", action: "allow", pattern: "*"},
  {permission: "input", action: "ask", pattern: "*"},
  {permission: "question", action: "deny", pattern: "*"},
  {permission: "read", action: "allow", pattern: "*"},
  {permission: "read", action: "ask", pattern: "*.env"},
  // question allow
  {permission: "question", action: "allow", pattern: "*"},
  // user = botPermission
  {permission: "*", action: "deny", pattern: "*"},
  {permission: "doom_loop", action: "allow", pattern: "*"},
  {permission: "invalid", action: "allow", pattern: "*"},
  {permission: "screen", action: "allow", pattern: "*"},
  {permission: "input", action: "allow", pattern: "*"},
  {permission: "bash", action: "allow", pattern: "*"},
  {permission: "edit", action: "allow", pattern: "*"},
  {permission: "write", action: "allow", pattern: "*"},
  {permission: "read", action: "allow", pattern: "*"},
  {permission: "glob", action: "allow", pattern: "*"},
  {permission: "grep", action: "allow", pattern: "*"},
  {permission: "skill", action: "allow", pattern: "*"},
  {permission: "websearch", action: "allow", pattern: "*"},
  {permission: "webfetch", action: "allow", pattern: "*"},
  {permission: "memory", action: "allow", pattern: "*"},
  {permission: "schedule", action: "allow", pattern: "*"},
  {permission: "planner", action: "allow", pattern: "*"},
  {permission: "goal", action: "allow", pattern: "*"},
  {permission: "vision_analyze", action: "allow", pattern: "*"},
  {permission: "external_directory", action: "allow", pattern: "*"},
]

const tools = ["invalid", "bash", "read", "glob", "grep", "edit", "write", "screen", "input", "memory", "schedule", "planner", "goal", "vision_analyze", "skill", "websearch", "webfetch"]

const disabled = new Set()
for (const tool of tools) {
  const permission = EDIT_TOOLS.includes(tool) ? "edit" : tool
  const rule = rules.findLast(r => match(permission, r.permission))
  if (!rule) { console.log(tool, "=> no rule"); continue }
  if (rule.pattern === "*" && rule.action === "deny") disabled.add(tool)
  console.log(tool, "=>", "match:", rule.permission, "action:", rule.action, disabled.has(tool) ? "DISABLED" : "enabled")
}
console.log("\nDisabled:", [...disabled])
console.log("Enabled:", tools.filter(t => !disabled.has(t)))
