// JSON means JavaScript Object Notation.

import { tool } from "@opencorvus-ai/plugin"
import { publishMirrorWatchPersonaAuthority } from "../lib/mirror-watch/persona-authority-publisher"

export default tool({
  description:
    "Validate and publish the exact immutable Mirror Watch persona cohort into the current Task Catalog, then return only its compact publication receipt.",
  args: {},
  async execute(_args, context) {
    return JSON.stringify(await publishMirrorWatchPersonaAuthority(context.host.engineArtifacts))
  },
})
