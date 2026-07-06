import { tool } from "@opencorvus-ai/plugin"
import contractSource from "../protocol-engine/opentest-contract.json" with { type: "text" }
import { inspectOpenTestArtifacts, parseProtocolContract } from "../protocol-engine/opentest-protocol-engine"

const contractText = contractSource as unknown as string

export default tool({
  description:
    "Inspect software-testing artifacts using the external OpenTest protocol contract parsed by the software-testing protocol engine.",
  args: {
    root: tool.schema.string().min(1).describe("Path relative to the active project directory."),
    max_files: tool.schema.number().int().min(1).max(2000).describe("Maximum number of files to inspect."),
  },
  async execute(args, context) {
    const contract = parseProtocolContract(contractText)
    const inventory = await inspectOpenTestArtifacts({
      contract,
      projectDirectory: context.directory,
      root: args.root,
      maxFiles: args.max_files,
    })
    return JSON.stringify(inventory, null, 2)
  },
})
