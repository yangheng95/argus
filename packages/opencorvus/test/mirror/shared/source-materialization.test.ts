import { describe, expect, test } from "bun:test"

import type { ProjectScaffold } from "../../../src/mirror/ir/scaffold"
import {
  generateReactSourceFiles,
  materializeScaffoldForReactSource,
} from "../../../src/mirror/shared/scaffold-helpers"

function scaffold(): ProjectScaffold {
  return {
    tokensFile: {
      filePath: "packages/app/src/constants/design-tokens.ts",
      exportName: "COLORS",
      isDefaultExport: false,
      propsInterface: "",
      imports: {},
      patterns: [],
    },
    sharedComponents: [],
    sections: [
      {
        name: "hero",
        role: "hero",
        bounds: { x: 0, y: 0, w: 1440, h: 480 },
        elementCount: 2,
        file: {
          filePath: "packages/app/src/components/hero.tsx",
          exportName: "Hero",
          isDefaultExport: false,
          propsInterface: "",
          imports: {},
          patterns: [],
          sectionIR: [
            '<Container name="hero" size="1440x480" layout="VERTICAL gap:24px" bg="#ffffff">',
            '  <Text name="heading" style="Inter 32px 700 #111827">Welcome</Text>',
            '  <Image name="logo" size="120x40" src="mirror/images/img-0.png" alt="Logo" />',
            "</Container>",
          ].join("\n"),
        },
        subComponents: [],
      },
    ],
    appFile: {
      filePath: "packages/app/src/App.tsx",
      exportName: "App",
      isDefaultExport: false,
      propsInterface: "",
      imports: {},
      patterns: [],
    },
    tokens: {
      colors: [{ value: "#ffffff", frequency: 3, semantic: "background" }],
      spacing: [{ px: 24, frequency: 1, tailwind: "6" }],
      fonts: [{ family: "Inter", weights: [400, 700], sizes: [16, 32] }],
      radii: [],
      shadows: [],
      customProperties: {},
    },
    catalog: { patterns: [], totalElements: 2, coveredElements: 0 },
  }
}

describe("React source materialization", () => {
  test("projects legacy scaffold paths onto the source layout", () => {
    const materialized = materializeScaffoldForReactSource(scaffold())
    expect(materialized.tokensFile.filePath).toBe("src/design-tokens.ts")
    expect(materialized.appFile.filePath).toBe("src/App.tsx")
    expect(materialized.sections[0].file.filePath).toBe("src/components/hero.tsx")
    expect(materialized.sections[0].file.imports["../design-tokens"]).toEqual(["COLORS", "FONTS", "SPACING", "RADII"])
  })

  test("emits App, tokens, and existing section files in one source set", () => {
    const materialized = materializeScaffoldForReactSource(scaffold())
    const files = generateReactSourceFiles(materialized)
    const byPath = new Map(files.map((file) => [file.file_path, file.code]))

    expect(byPath.has("src/design-tokens.ts")).toBe(true)
    expect(byPath.has("src/App.tsx")).toBe(true)
    expect(byPath.has("src/components/hero.tsx")).toBe(true)
    expect(byPath.get("src/App.tsx")).toContain('import { Hero } from "./components/hero"')
    expect(byPath.get("src/components/hero.tsx")).toContain("Welcome")
    expect(byPath.get("src/components/hero.tsx")).toContain('src="mirror/images/img-0.png"')
  })
})
