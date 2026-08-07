import type { Argv } from "yargs"
import { Global } from "@/global"
import { provisionComputerRuntimeBundle, verifyComputerRuntimeBundle } from "@/mcp/computer/runtime-bundle"
import path from "node:path"
import { cmd } from "./cmd"

const VerifyCommand = cmd({
  command: "verify <manifest>",
  describe: "verify one complete Computer VM runtime bundle",
  builder: (yargs: Argv) =>
    yargs.positional("manifest", {
      type: "string",
      demandOption: true,
      describe: "Absolute path to computer-runtime.json",
    }),
  handler: async (args: { manifest: string }) => {
    const verified = await verifyComputerRuntimeBundle({ manifestPath: args.manifest })
    console.log(
      JSON.stringify(
        {
          bundle_id: verified.manifest.bundle_id,
          bundle_version: verified.manifest.bundle_version,
          content_id: verified.contentID,
          manifest_path: verified.manifestPath,
        },
        null,
        2,
      ),
    )
  },
})

const ProvisionCommand = cmd({
  command: "provision <manifest>",
  describe: "verify and install one Computer VM runtime bundle into the local content-addressed store",
  builder: (yargs: Argv) =>
    yargs.positional("manifest", {
      type: "string",
      demandOption: true,
      describe: "Absolute path to computer-runtime.json",
    }),
  handler: async (args: { manifest: string }) => {
    const installed = await provisionComputerRuntimeBundle({
      manifestPath: args.manifest,
      destinationRoot: path.join(Global.Path.data, "computer-runtime-bundles"),
    })
    console.log(
      JSON.stringify(
        {
          bundle_id: installed.manifest.bundle_id,
          bundle_version: installed.manifest.bundle_version,
          content_id: installed.contentID,
          manifest_path: installed.manifestPath,
        },
        null,
        2,
      ),
    )
  },
})

export const ComputerRuntimeCommand = cmd({
  command: "computer-runtime",
  describe: "verify and provision self-contained Computer VM runtime bundles",
  builder: (yargs) => yargs.command(VerifyCommand).command(ProvisionCommand).demandCommand(),
  async handler() {},
})
