/**
 * Errors that can be observed by users when starting / running the
 * managed sidecar. Distinct types make the failure mode explicit so the
 * extension UI can map each one to the right action ("install matching
 * VSIX", "stop existing instance", "see logs", etc.).
 */

// `name` is declared as a wide `string` (not a literal type) on each class
// so subclasses can override with their own string without TS complaining
// that the literal is not assignable. Each constructor still assigns the
// concrete class name at runtime.

export class UnsupportedPlatformError extends Error {
  override readonly name: string = "UnsupportedPlatformError"
  constructor(
    public readonly target: string,
    public readonly extensionRoot: string,
  ) {
    super(
      `OpenCorvus sidecar binary not found for target=${target}. ` +
        `Make sure the matching platform-specific VSIX is installed in this extension host. ` +
        `extensionPath=${extensionRoot}`,
    )
  }
}

export class SidecarStartupError extends Error {
  override readonly name: string = "SidecarStartupError"
  constructor(
    message: string,
    public readonly stderrTail?: string,
    public readonly exitCode?: number,
  ) {
    super(message)
  }
}

export class SidecarHandshakeTimeoutError extends SidecarStartupError {
  override readonly name: string = "SidecarHandshakeTimeoutError"
  constructor(timeoutMs: number, stderrTail?: string) {
    super(
      `OpenCorvus sidecar did not emit OPENCORVUS_LISTEN= within ${timeoutMs}ms of stdout/stderr inactivity`,
      stderrTail,
    )
  }
}

export class SidecarExistingInstanceError extends SidecarStartupError {
  override readonly name: string = "SidecarExistingInstanceError"
  constructor(message: string, exitCode: number, stderrTail?: string) {
    super(message, stderrTail, exitCode)
  }
}
