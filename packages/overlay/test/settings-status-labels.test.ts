import { beforeAll, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"

import {
  CHANNEL_CONFIGURATION_STATUSES,
  MCP_CONNECTION_STATUSES,
  UnsupportedSettingsStatusLabelError,
  channelConfigurationStatusLabel,
  channelConfigurationStatusLabelFromString,
  channelConfigurationStatusToneFromString,
  mcpConnectionStatusLabel,
  mcpConnectionStatusLabelFromString,
  mcpConnectionStatusOrDisabledLabel,
  mcpConnectionStatusOrDisabledTone,
  mcpConnectionStatusToneFromString,
} from "../src/utils/settings-status-labels"
import { setLocale, setLocaleData } from "../src/utils/i18n"

const overlayRoot = join(import.meta.dir, "..")
const enUS = JSON.parse(readFileSync(join(overlayRoot, "src/i18n/en-US.json"), "utf8"))

beforeAll(async () => {
  setLocaleData("en-US", enUS)
  await setLocale("en-US")
})

function source(path: string): string {
  return readFileSync(resolve(overlayRoot, "..", "..", path), "utf8")
}

describe("settings status label domains", () => {
  test("channel labels accept only channel configuration statuses", () => {
    expect(CHANNEL_CONFIGURATION_STATUSES).toEqual(["disabled", "configured", "partial", "missing"])
    expect(channelConfigurationStatusLabel("disabled")).toBe("Disabled")
    expect(channelConfigurationStatusLabel("configured")).toBe("Configured")
    expect(channelConfigurationStatusLabel("partial")).toBe("Needs Setup")
    expect(channelConfigurationStatusLabel("missing")).toBe("Available")
    expect(channelConfigurationStatusLabelFromString(" configured ")).toBe("Configured")
    expect(channelConfigurationStatusToneFromString("configured")).toBe("ok")
    expect(channelConfigurationStatusToneFromString("partial")).toBe("warn")
    expect(channelConfigurationStatusToneFromString("missing")).toBe("bad")
    expect(channelConfigurationStatusToneFromString("disabled")).toBe("muted")
    expect(() => channelConfigurationStatusLabelFromString("running")).toThrow(UnsupportedSettingsStatusLabelError)
    expect(() => channelConfigurationStatusToneFromString("")).toThrow(UnsupportedSettingsStatusLabelError)
  })

  test("MCP labels accept only the backend MCP status union", () => {
    expect(MCP_CONNECTION_STATUSES).toEqual([
      "connected",
      "disabled",
      "disconnected",
      "connecting",
      "failed",
      "needs_auth",
      "needs_client_registration",
    ])
    expect(mcpConnectionStatusLabel("connected")).toBe("Connected")
    expect(mcpConnectionStatusLabel("disabled")).toBe("Disabled")
    expect(mcpConnectionStatusLabel("disconnected")).toBe("Disconnected")
    expect(mcpConnectionStatusLabel("connecting")).toBe("Connecting")
    expect(mcpConnectionStatusLabel("failed")).toBe("Failed")
    expect(mcpConnectionStatusLabel("needs_auth")).toBe("Needs auth")
    expect(mcpConnectionStatusLabel("needs_client_registration")).toBe("Needs client registration")
    expect(mcpConnectionStatusLabelFromString(" needs_auth ")).toBe("Needs auth")
    expect(mcpConnectionStatusToneFromString("connected")).toBe("ok")
    expect(mcpConnectionStatusToneFromString("disabled")).toBe("muted")
    expect(mcpConnectionStatusToneFromString("disconnected")).toBe("neutral")
    expect(mcpConnectionStatusToneFromString("connecting")).toBe("warn")
    expect(mcpConnectionStatusToneFromString("failed")).toBe("bad")
    expect(() => mcpConnectionStatusLabelFromString("error")).toThrow(UnsupportedSettingsStatusLabelError)
    expect(() => mcpConnectionStatusToneFromString("")).toThrow(UnsupportedSettingsStatusLabelError)
  })

  test("missing MCP item status is explicitly rendered as disabled", () => {
    expect(mcpConnectionStatusOrDisabledLabel(undefined)).toBe("Disabled")
    expect(mcpConnectionStatusOrDisabledLabel(null)).toBe("Disabled")
    expect(mcpConnectionStatusOrDisabledLabel("")).toBe("Disabled")
    expect(mcpConnectionStatusOrDisabledTone(undefined)).toBe("muted")
    expect(mcpConnectionStatusOrDisabledLabel("connected")).toBe("Connected")
    expect(() => mcpConnectionStatusOrDisabledLabel("error")).toThrow(UnsupportedSettingsStatusLabelError)
  })
})

describe("settings status label adoption guards", () => {
  test("settings panels use shared strict status label helpers", () => {
    const channels = source("packages/overlay/src/components/settings/ChannelsPanel.tsx")
    const skills = source("packages/overlay/src/components/settings/SkillMarketPanel.tsx")

    expect(channels).toContain("channelConfigurationStatusLabelFromString")
    expect(channels).toContain("channelConfigurationStatusToneFromString")
    expect(channels).not.toContain("function channelStatusLabel")
    expect(channels).not.toContain("function channelStatusTone")

    expect(skills).toContain("mcpConnectionStatusOrDisabledLabel")
    expect(skills).toContain("mcpConnectionStatusOrDisabledTone")
    expect(skills).not.toContain("function mcpStatusLabel")
    expect(skills).not.toContain("function mcpStatusTone")

    for (const text of [channels, skills]) {
      expect(text).not.toContain("return map[status] || status")
      expect(text).not.toContain("translated === key ?")
    }
  })
})
