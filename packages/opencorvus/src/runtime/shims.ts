import { muteAiSdkWarnings } from "@/util/ai-sdk"

let installed = false

export function installRuntimeShims() {
  if (installed) return
  muteAiSdkWarnings()
  installed = true
}
