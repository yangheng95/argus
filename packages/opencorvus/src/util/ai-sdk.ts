let warningsMuted = false

export function muteAiSdkWarnings() {
  if (warningsMuted) return
  // @ts-ignore AI SDK checks this global flag before logging to stdout.
  globalThis.AI_SDK_LOG_WARNINGS = false
  warningsMuted = true
}
