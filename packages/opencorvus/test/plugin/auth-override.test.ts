import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { ProviderAuth } from "../../src/provider/auth"
import { Auth } from "../../src/auth"

describe("plugin.auth-override", () => {
  test("user plugin overrides built-in github-copilot auth", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const pluginDir = path.join(dir, ".opencorvus", "plugin")
        await fs.mkdir(pluginDir, { recursive: true })

        await Bun.write(
          path.join(pluginDir, "custom-copilot-auth.ts"),
          [
            "export default async () => ({",
            "  auth: {",
            '    provider: "github-copilot",',
            "    methods: [",
            '      { type: "api", label: "Test Override Auth" },',
            "    ],",
            "    loader: async () => ({ access: 'test-token' }),",
            "  },",
            "})",
            "",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const methods = await ProviderAuth.methods()
        const copilot = methods["github-copilot"]
        expect(copilot).toBeDefined()
        expect(copilot.length).toBe(1)
        expect(copilot[0].label).toBe("Test Override Auth")
      },
    })
  }, 30000) // Increased timeout for plugin installation

  test("provider auth exposes prompts and preserves provider override fields", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const pluginDir = path.join(dir, ".opencorvus", "plugin")
        await fs.mkdir(pluginDir, { recursive: true })

        await Bun.write(
          path.join(pluginDir, "custom-copilot-auth.ts"),
          [
            "export default async () => ({",
            "  auth: {",
            '    provider: "github-copilot",',
            "    methods: [",
            "      {",
            '        type: "oauth",',
            '        label: "Enterprise OAuth",',
            "        prompts: [",
            '          { type: "select", key: "deploymentType", message: "Deployment", options: [',
            '            { label: "GitHub.com", value: "github.com" },',
            '            { label: "Enterprise", value: "enterprise" },',
            "          ] },",
            '          { type: "text", key: "enterpriseUrl", message: "Enterprise URL", placeholder: "company.ghe.com", condition: (inputs) => inputs.deploymentType === "enterprise" },',
            "        ],",
            "        authorize: async (inputs = {}) => ({",
            '          url: `https://example.com/${inputs.deploymentType || "missing"}`,',
            '          instructions: inputs.enterpriseUrl || "no-domain",',
            '          method: "auto",',
            "          callback: async () => ({",
            '            type: "success",',
            '            provider: "github-copilot-enterprise",',
            '            refresh: "refresh-token",',
            '            access: "access-token",',
            '            expires: 123456,',
            '            enterpriseUrl: inputs.enterpriseUrl || "",',
            "          }),",
            "        }),",
            "      },",
            "    ],",
            "  },",
            "})",
            "",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const methods = await ProviderAuth.methods()
        const copilot = methods["github-copilot"]

        expect(copilot?.[0]?.prompts).toEqual([
          {
            type: "select",
            key: "deploymentType",
            message: "Deployment",
            options: [
              { label: "GitHub.com", value: "github.com" },
              { label: "Enterprise", value: "enterprise" },
            ],
          },
        ])

        expect(
          await ProviderAuth.resolvePrompts({
            providerID: "github-copilot",
            method: 0,
            inputs: {
              deploymentType: "enterprise",
            },
          }),
        ).toEqual([
          {
            type: "select",
            key: "deploymentType",
            message: "Deployment",
            options: [
              { label: "GitHub.com", value: "github.com" },
              { label: "Enterprise", value: "enterprise" },
            ],
          },
          {
            type: "text",
            key: "enterpriseUrl",
            message: "Enterprise URL",
            placeholder: "company.ghe.com",
          },
        ])

        const authorization = await ProviderAuth.authorize({
          providerID: "github-copilot",
          method: 0,
          inputs: {
            deploymentType: "enterprise",
            enterpriseUrl: "company.ghe.com",
          },
        })

        expect(authorization).toEqual({
          url: "https://example.com/enterprise",
          instructions: "company.ghe.com",
          method: "auto",
        })

        await ProviderAuth.callback({
          providerID: "github-copilot",
          method: 0,
        })

        expect(await Auth.get("github-copilot")).toBeUndefined()
        expect(await Auth.get("github-copilot-enterprise")).toEqual({
          type: "oauth",
          refresh: "refresh-token",
          access: "access-token",
          expires: 123456,
          enterpriseUrl: "company.ghe.com",
        })
      },
    })
  }, 30000)

  test("provider auth executes api methods with prompts", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const pluginDir = path.join(dir, ".opencorvus", "plugin")
        await fs.mkdir(pluginDir, { recursive: true })

        await Bun.write(
          path.join(pluginDir, "custom-gitlab-auth.ts"),
          [
            "export default async () => ({",
            "  auth: {",
            '    provider: "gitlab",',
            "    methods: [",
            "      {",
            '        type: "api",',
            '        label: "Personal Access Token",',
            "        prompts: [",
            '          { type: "text", key: "instanceUrl", message: "Instance URL", placeholder: "https://gitlab.example.com" },',
            '          { type: "text", key: "token", message: "Token", placeholder: "glpat-..." },',
            "        ],",
            "        authorize: async (inputs = {}) => ({",
            '          type: inputs.token ? "success" : "failed",',
            '          key: inputs.token || "",',
            '          provider: "gitlab-enterprise",',
            "        }),",
            "      },",
            "    ],",
            "  },",
            "})",
            "",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const methods = await ProviderAuth.methods()
        expect(methods["gitlab"]?.[0]?.prompts).toEqual([
          {
            type: "text",
            key: "instanceUrl",
            message: "Instance URL",
            placeholder: "https://gitlab.example.com",
          },
          {
            type: "text",
            key: "token",
            message: "Token",
            placeholder: "glpat-...",
          },
        ])

        await ProviderAuth.execute({
          providerID: "gitlab",
          method: 0,
          inputs: {
            instanceUrl: "https://gitlab.example.com",
            token: "glpat-test-token",
          },
        })

        expect(await Auth.get("gitlab-enterprise")).toEqual({
          type: "api",
          key: "glpat-test-token",
        })
      },
    })
  }, 30000)
})
