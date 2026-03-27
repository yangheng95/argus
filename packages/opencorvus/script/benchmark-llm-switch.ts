#!/usr/bin/env bun
/**
 * E2E Benchmark: LLM Model Switch + Actual API Call
 *
 * Usage:
 *   bun run script/benchmark-llm-switch.ts [providerID/modelID]
 *   bun run script/benchmark-llm-switch.ts github-copilot/gemini-3-flash-preview
 *   bun run script/benchmark-llm-switch.ts anthropic/claude-sonnet-4-20250514
 *
 * This script:
 * 1. Starts an opencorvus instance (no server, direct API)
 * 2. Switches config model to the specified target
 * 3. Verifies config.json persistence
 * 4. Resolves model through Provider chain
 * 5. Makes an actual LLM API call
 * 6. Reports success/failure with diagnostics
 */
import path from "path"
import { Instance } from "../src/project/instance"
import { Config } from "../src/config/config"
import { Provider } from "../src/provider/provider"
import { Log } from "../src/util/log"

Log.init({ print: true, dev: true, level: "INFO" })

const target = process.argv[2] || "github-copilot/gemini-3-flash-preview"
const [providerID, ...modelParts] = target.split("/")
const modelID = modelParts.join("/")

console.log(`\n=== LLM Switch Benchmark ===`)
console.log(`Target: ${providerID}/${modelID}\n`)

const directory = path.resolve(process.cwd(), "../..")

async function run() {
  await Instance.provide({
    directory,
    fn: async () => {
      // Step 1: Read current config
      console.log("[1/6] Reading current config...")
      const before = await Config.get()
      console.log(`  Current model: ${before.model || "(not set)"}`)

      // Step 2: Switch model (simulate overlay PATCH /config)
      console.log(`\n[2/6] Switching to ${providerID}/${modelID}...`)
      const patch: Record<string, any> = {
        ...before,
        model: `${providerID}/${modelID}`,
      }
      await Config.update(patch)
      Provider.reset()
      console.log("  Config.update() + Provider.reset() done")

      // Step 3: Verify persistence
      console.log("\n[3/6] Verifying config persistence...")
      const after = await Config.get()
      if (after.model === `${providerID}/${modelID}`) {
        console.log(`  ✓ Config.get().model = "${after.model}"`)
      } else {
        console.error(`  ✗ Config.get().model = "${after.model}" (expected "${providerID}/${modelID}")`)
        process.exit(1)
      }

      // Step 4: Provider resolution
      console.log("\n[4/6] Provider.defaultModel() resolution...")
      const resolved = await Provider.defaultModel()
      if (resolved.providerID === providerID && resolved.modelID === modelID) {
        console.log(`  ✓ providerID="${resolved.providerID}", modelID="${resolved.modelID}"`)
      } else {
        console.error(`  ✗ providerID="${resolved.providerID}", modelID="${resolved.modelID}"`)
        process.exit(1)
      }

      // Step 5: Get full model info
      console.log("\n[5/6] Provider.getModel()...")
      try {
        const model = await Provider.getModel(providerID, modelID)
        console.log(`  ✓ Model found: ${model.name}`)
        console.log(`    reasoning: ${model.capabilities.reasoning}`)
        console.log(`    toolcall:  ${model.capabilities.toolcall}`)
        console.log(`    API ID:    ${model.api.id}`)
        console.log(`    SDK:       ${model.api.npm || "(default)"}`)
      } catch (e: any) {
        if (e.name === "ProviderModelNotFoundError") {
          console.error(`  ✗ Model not found: ${e.data?.providerID}/${e.data?.modelID}`)
          console.error(`    Suggestions: ${e.data?.suggestions?.join(", ") || "none"}`)
          const providers = await Provider.list()
          console.error(`    Available providers: ${Object.keys(providers).join(", ")}`)
          if (providers[providerID]) {
            console.error(`    Models in ${providerID}: ${Object.keys(providers[providerID].models).slice(0, 10).join(", ")}...`)
          }
        } else {
          console.error(`  ✗ Error: ${e.message}`)
        }
        process.exit(1)
      }

      // Step 6: Actual LLM call
      console.log("\n[6/6] Making LLM API call...")
      try {
        const model = await Provider.getModel(providerID, modelID)
        const language = await Provider.getLanguage(model)
        console.log(`  ✓ LanguageModel created: ${language.modelId}`)

        const { generateText } = await import("ai")
        const result = await generateText({
          model: language,
          prompt: "Reply with exactly: BENCHMARK_OK",
          maxTokens: 20,
          temperature: 0,
          abortSignal: AbortSignal.timeout(30000),
        })

        if (result.text.includes("BENCHMARK_OK")) {
          console.log(`  ✓ LLM responded: "${result.text.trim()}"`)
        } else {
          console.log(`  ~ LLM responded (unexpected): "${result.text.trim().slice(0, 100)}"`)
        }

        console.log(`\n=== BENCHMARK PASSED ===`)
        console.log(`Model ${providerID}/${modelID} is working correctly.`)
        console.log(`Tokens: input=${result.usage?.promptTokens}, output=${result.usage?.completionTokens}`)
      } catch (e: any) {
        console.error(`  ✗ LLM call failed: ${e.message}`)
        if (e.statusCode) console.error(`    Status: ${e.statusCode}`)
        if (e.responseBody) console.error(`    Body: ${JSON.stringify(e.responseBody).slice(0, 200)}`)
        console.error(`\n=== BENCHMARK FAILED ===`)
        console.error(`Config chain is correct but LLM API call failed.`)
        console.error(`Check: provider authentication, API key, network connectivity.`)
        process.exit(1)
      }

      // Restore original model
      if (before.model && before.model !== `${providerID}/${modelID}`) {
        console.log(`\nRestoring original model: ${before.model}`)
        await Config.update({ ...after, model: before.model })
        Provider.reset()
      }
    },
  })
}

run().catch((e) => {
  console.error(`\nFatal error: ${e.message}`)
  console.error(e.stack)
  process.exit(1)
})
