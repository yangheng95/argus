// JSON means JavaScript Object Notation. SHA-256 means Secure Hash Algorithm 256-bit.

import { createHash } from "node:crypto"
import { type EngineArtifactHost } from "@opencorvus-ai/plugin"
import personasSource from "../../assets/personas.json" with { type: "text" }
import {
  MIRROR_WATCH_PERSONA_AUTHORITY_ARTIFACT_TYPE,
  MIRROR_WATCH_PERSONA_AUTHORITY_SCHEMA_VERSION,
  parseMirrorWatchPersonaAuthority,
  parseMirrorWatchPersonaAuthorityPayload,
} from "./persona-authority"

export async function publishMirrorWatchPersonaAuthority(host: Pick<EngineArtifactHost, "publish">) {
  const personas = parseMirrorWatchPersonaAuthority(personasSource)
  const payload = parseMirrorWatchPersonaAuthorityPayload({
    authority_sha256: createHash("sha256").update(personasSource, "utf8").digest("hex"),
    persona_count: personas.length,
    personas,
  })
  const publication = await host.publish({
    artifact_type: MIRROR_WATCH_PERSONA_AUTHORITY_ARTIFACT_TYPE,
    schema_version: MIRROR_WATCH_PERSONA_AUTHORITY_SCHEMA_VERSION,
    label: "Mirror Watch persona authority",
    payload,
    resources: [],
    source_artifact_locators: [],
  })
  return {
    artifact_type: MIRROR_WATCH_PERSONA_AUTHORITY_ARTIFACT_TYPE,
    schema_version: MIRROR_WATCH_PERSONA_AUTHORITY_SCHEMA_VERSION,
    persona_count: payload.persona_count,
    authority_sha256: payload.authority_sha256,
    locator: publication.locator,
    artifact_sha256: publication.sha256,
  }
}
