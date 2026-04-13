/**
 * Channel key derivation for Gateway session singletons.
 *
 * A Gateway session is unique per (platform, channel, user). The composite
 * key collapses those three coordinates into one string that lives in
 * `session.channel_key` and feeds the partial unique index defined in
 * `session.sql.ts` / `ddl.ts` (`session_gateway_singleton_idx`).
 *
 * Local HTTP clients have no platform/channel — they use `local:${userID}`.
 */

const SEP = ":"

export type ChannelKeyInput =
  | { platform: string; channel: string; userID: string }
  | { local: true; userID: string }

export function channelKey(input: ChannelKeyInput): string {
  if ("local" in input) {
    if (!input.userID) throw new Error("channelKey: local key requires userID")
    return `local${SEP}${input.userID}`
  }
  if (!input.platform || !input.channel || !input.userID) {
    throw new Error("channelKey: platform, channel, userID are all required")
  }
  return `${input.platform}${SEP}${input.channel}${SEP}${input.userID}`
}

/** Inverse of `channelKey` — returns null when the key isn't well-formed. */
export function parseChannelKey(key: string): ChannelKeyInput | null {
  const parts = key.split(SEP)
  if (parts.length === 2 && parts[0] === "local") {
    return { local: true, userID: parts[1] }
  }
  if (parts.length === 3 && parts[0] && parts[1] && parts[2]) {
    return { platform: parts[0], channel: parts[1], userID: parts[2] }
  }
  return null
}
