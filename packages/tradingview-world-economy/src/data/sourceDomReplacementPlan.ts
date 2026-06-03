export const sourceDomReplacementPlan = [
  {
      "regionComponentName": "EconomicTrendsRegion5",
      "regionFilePath": "src/components/source-dom/EconomicTrendsRegion5.tsx",
      "priority": "high",
      "recommendedComponentName": "EconomicTrendsTable",
      "replacementKind": "data_table_or_heatmap_component",
      "problem": "Generated source-dom region is 480293 bytes with 2454 DOM elements; keep it as visual evidence only until replaced by a semantic component with explicit data/assets.",
      "sourceMap": {
        "sourceNodeId": "node_000954",
        "bounds": {
          "x": 40,
          "y": 302,
          "w": 1360,
          "h": 5149
        },
        "domRegion": "src/components/source-dom/EconomicTrendsRegion5.tsx",
        "styleSources": [
          "src/styles/source-critical.css",
          "src/styles/source-full.css",
          "web-clone-source/source-skeleton/critical.css",
          "web-clone-source/source-ir/style-tokens.json"
        ],
        "dataSources": [
          "src/data/sourceData.ts",
          "sourceTables"
        ],
        "assetSources": [
          "src/data/sourceData.ts:sourceAssets"
        ],
        "visualSources": [
          "web-clone-source/reference.png",
          "reference.png",
          "web-clone-source/visual-surface-candidates.json",
          "source-node:node_000954"
        ]
      },
      "reusableSources": [
        "src/components/source-dom/EconomicTrendsRegion5.tsx",
        "src/data/sourceDomRegions.ts",
        "web-clone-source/reference.png",
        "web-clone-source/source-skeleton/critical.css"
      ],
      "dataSources": [
        "src/data/sourceData.ts",
        "sourceTables"
      ],
      "assetSources": [
        "src/data/sourceData.ts:sourceAssets"
      ],
      "generatedCleanupTargets": [
        "src/components/source-dom/EconomicTrendsRegion5.tsx",
        "src/components/SourceDomPage.tsx import/render reference for this region",
        "unused selectors in src/styles/source-critical.css and src/styles/source-full.css after visual parity is preserved"
      ],
      "verticalSliceSteps": [
        "Read src/components/source-dom/EconomicTrendsRegion5.tsx plus sourceMap evidence for source ids, text, classes, and asset references.",
        "Extract the visible data for EconomicTrendsTable into sourceData.ts or a small typed module instead of duplicating JSX literals.",
        "Render EconomicTrendsTable as a semantic component with loops/props/states appropriate for data_table_or_heatmap_component.",
        "Preserve only the scoped classes or CSS variables needed by the replacement; leave unrelated source CSS untouched.",
        "Swap EconomicTrendsRegion5 for EconomicTrendsTable at the existing SourceDomPage boundary.",
        "Compare the same visual viewport matrix against reference.png before deleting generated DOM/CSS coverage."
      ],
      "firstReplacementStep": "Model rows/columns/colors as arrays in sourceData or a new data module, render EconomicTrendsTable with loops, and keep table dimensions/colors matched to EconomicTrendsRegion5.",
      "parityGuard": "Before deleting EconomicTrendsRegion5, compare the root app against web-clone-source/reference.png and keep unchanged clone surfaces above the requested visual threshold. Check row/column count, cell colors, typography, and numeric text coverage."
    }
] as const

export const highPrioritySourceDomReplacementPlan = sourceDomReplacementPlan.filter((item) => item.priority === "high")
