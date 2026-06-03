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
  },
  {
    "regionComponentName": "CountriesIdeasEconomicIndicatorsHeatRegion3",
    "regionFilePath": "src/components/source-dom/CountriesIdeasEconomicIndicatorsHeatRegion3.tsx",
    "priority": "low",
    "recommendedComponentName": "CountriesIdeasEconomicIndicatorsHeatNavigation",
    "replacementKind": "navigation_or_footer_component",
    "problem": "Generated source-dom region is 6597 bytes with 27 DOM elements; keep it as visual evidence only until replaced by a semantic component with explicit data/assets.",
    "sourceMap": {
      "sourceNodeId": "node_000917",
      "bounds": {
        "x": 0,
        "y": 230,
        "w": 1440,
        "h": 52
      },
      "domRegion": "src/components/source-dom/CountriesIdeasEconomicIndicatorsHeatRegion3.tsx",
      "styleSources": [
        "src/styles/source-critical.css",
        "src/styles/source-full.css",
        "web-clone-source/source-skeleton/critical.css",
        "web-clone-source/source-ir/style-tokens.json"
      ],
      "dataSources": [
        "src/data/sourceData.ts",
        "sourceComponents",
        "sourceTextSignals"
      ],
      "assetSources": [
        "src/data/sourceData.ts:sourceAssets"
      ],
      "visualSources": [
        "web-clone-source/reference.png",
        "reference.png",
        "web-clone-source/visual-surface-candidates.json",
        "source-node:node_000917"
      ]
    },
    "reusableSources": [
      "src/components/source-dom/CountriesIdeasEconomicIndicatorsHeatRegion3.tsx",
      "src/data/sourceDomRegions.ts",
      "web-clone-source/reference.png",
      "web-clone-source/source-skeleton/critical.css",
      "web-clone-source/source-ir/component-tree.json"
    ],
    "dataSources": [
      "src/data/sourceData.ts",
      "sourceComponents",
      "sourceTextSignals"
    ],
    "assetSources": [
      "src/data/sourceData.ts:sourceAssets"
    ],
    "generatedCleanupTargets": [
      "src/components/source-dom/CountriesIdeasEconomicIndicatorsHeatRegion3.tsx",
      "src/components/SourceDomPage.tsx import/render reference for this region",
      "unused selectors in src/styles/source-critical.css and src/styles/source-full.css after visual parity is preserved"
    ],
    "verticalSliceSteps": [
      "Read src/components/source-dom/CountriesIdeasEconomicIndicatorsHeatRegion3.tsx plus sourceMap evidence for source ids, text, classes, and asset references.",
      "Extract the visible data for CountriesIdeasEconomicIndicatorsHeatNavigation into sourceData.ts or a small typed module instead of duplicating JSX literals.",
      "Render CountriesIdeasEconomicIndicatorsHeatNavigation as a semantic component with loops/props/states appropriate for navigation_or_footer_component.",
      "Preserve only the scoped classes or CSS variables needed by the replacement; leave unrelated source CSS untouched.",
      "Swap CountriesIdeasEconomicIndicatorsHeatRegion3 for CountriesIdeasEconomicIndicatorsHeatNavigation at the existing SourceDomPage boundary.",
      "Compare the same visual viewport matrix against reference.png before deleting generated DOM/CSS coverage."
    ],
    "firstReplacementStep": "Extract link groups/social/language state into arrays, render CountriesIdeasEconomicIndicatorsHeatNavigation with existing navigation/footer primitives when available, and keep legal/source text intact.",
    "parityGuard": "Before deleting CountriesIdeasEconomicIndicatorsHeatRegion3, compare the root app against web-clone-source/reference.png and keep unchanged clone surfaces above the requested visual threshold."
  },
  {
    "regionComponentName": "MarketsEconomyRegion",
    "regionFilePath": "src/components/source-dom/MarketsEconomyRegion.tsx",
    "priority": "low",
    "recommendedComponentName": "MarketsEconomyNavigation",
    "replacementKind": "navigation_or_footer_component",
    "problem": "Generated source-dom region is 2260 bytes with 12 DOM elements; keep it as visual evidence only until replaced by a semantic component with explicit data/assets.",
    "sourceMap": {
      "sourceNodeId": "node_000880",
      "bounds": {
        "x": 24,
        "y": 56,
        "w": 1392,
        "h": 90
      },
      "domRegion": "src/components/source-dom/MarketsEconomyRegion.tsx",
      "styleSources": [
        "src/styles/source-critical.css",
        "src/styles/source-full.css",
        "web-clone-source/source-skeleton/critical.css",
        "web-clone-source/source-ir/style-tokens.json"
      ],
      "dataSources": [
        "src/data/sourceData.ts",
        "sourceComponents",
        "sourceTextSignals"
      ],
      "assetSources": [
        "src/data/sourceData.ts:sourceAssets"
      ],
      "visualSources": [
        "web-clone-source/reference.png",
        "reference.png",
        "web-clone-source/visual-surface-candidates.json",
        "source-node:node_000880"
      ]
    },
    "reusableSources": [
      "src/components/source-dom/MarketsEconomyRegion.tsx",
      "src/data/sourceDomRegions.ts",
      "web-clone-source/reference.png",
      "web-clone-source/source-skeleton/critical.css",
      "web-clone-source/source-ir/component-tree.json"
    ],
    "dataSources": [
      "src/data/sourceData.ts",
      "sourceComponents",
      "sourceTextSignals"
    ],
    "assetSources": [
      "src/data/sourceData.ts:sourceAssets"
    ],
    "generatedCleanupTargets": [
      "src/components/source-dom/MarketsEconomyRegion.tsx",
      "src/components/SourceDomPage.tsx import/render reference for this region",
      "unused selectors in src/styles/source-critical.css and src/styles/source-full.css after visual parity is preserved"
    ],
    "verticalSliceSteps": [
      "Read src/components/source-dom/MarketsEconomyRegion.tsx plus sourceMap evidence for source ids, text, classes, and asset references.",
      "Extract the visible data for MarketsEconomyNavigation into sourceData.ts or a small typed module instead of duplicating JSX literals.",
      "Render MarketsEconomyNavigation as a semantic component with loops/props/states appropriate for navigation_or_footer_component.",
      "Preserve only the scoped classes or CSS variables needed by the replacement; leave unrelated source CSS untouched.",
      "Swap MarketsEconomyRegion for MarketsEconomyNavigation at the existing SourceDomPage boundary.",
      "Compare the same visual viewport matrix against reference.png before deleting generated DOM/CSS coverage."
    ],
    "firstReplacementStep": "Extract link groups/social/language state into arrays, render MarketsEconomyNavigation with existing navigation/footer primitives when available, and keep legal/source text intact.",
    "parityGuard": "Before deleting MarketsEconomyRegion, compare the root app against web-clone-source/reference.png and keep unchanged clone surfaces above the requested visual threshold."
  },
  {
    "regionComponentName": "OverviewRegion",
    "regionFilePath": "src/components/source-dom/OverviewRegion.tsx",
    "priority": "low",
    "recommendedComponentName": "OverviewSurface",
    "replacementKind": "map_or_chart_asset_component",
    "problem": "Generated source-dom region is 1842 bytes with 7 DOM elements; keep it as visual evidence only until replaced by a semantic component with explicit data/assets.",
    "sourceMap": {
      "sourceNodeId": "node_000898",
      "bounds": {
        "x": 240,
        "y": 178,
        "w": 960,
        "h": 64
      },
      "domRegion": "src/components/source-dom/OverviewRegion.tsx",
      "styleSources": [
        "src/styles/source-critical.css",
        "src/styles/source-full.css",
        "web-clone-source/source-skeleton/critical.css",
        "web-clone-source/source-ir/style-tokens.json",
        "src/data/sourceSvgAssetGroups.ts",
        "src/data/svgPaths.ts"
      ],
      "dataSources": [
        "src/data/sourceData.ts"
      ],
      "assetSources": [
        "src/data/svgPaths.ts",
        "src/data/sourceSvgAssetGroups.ts",
        "public/assets/svg/",
        "public/assets/images/",
        "src/data/sourceData.ts:sourceAssets"
      ],
      "visualSources": [
        "web-clone-source/reference.png",
        "reference.png",
        "web-clone-source/visual-surface-candidates.json",
        "source-node:node_000898"
      ]
    },
    "reusableSources": [
      "src/components/source-dom/OverviewRegion.tsx",
      "src/data/sourceDomRegions.ts",
      "web-clone-source/reference.png",
      "web-clone-source/source-skeleton/critical.css",
      "src/data/svgPaths.ts",
      "src/data/sourceSvgAssetGroups.ts",
      "web-clone-source/assets/svg/"
    ],
    "dataSources": [
      "src/data/sourceData.ts"
    ],
    "assetSources": [
      "src/data/svgPaths.ts",
      "src/data/sourceSvgAssetGroups.ts",
      "public/assets/svg/",
      "public/assets/images/",
      "src/data/sourceData.ts:sourceAssets"
    ],
    "generatedCleanupTargets": [
      "src/components/source-dom/OverviewRegion.tsx",
      "src/components/SourceDomPage.tsx import/render reference for this region",
      "unused selectors in src/styles/source-critical.css and src/styles/source-full.css after visual parity is preserved"
    ],
    "verticalSliceSteps": [
      "Read src/components/source-dom/OverviewRegion.tsx plus sourceMap evidence for source ids, text, classes, and asset references.",
      "Extract the visible data for OverviewSurface into sourceData.ts or a small typed module instead of duplicating JSX literals.",
      "Render OverviewSurface as a semantic component with loops/props/states appropriate for map_or_chart_asset_component.",
      "Preserve only the scoped classes or CSS variables needed by the replacement; leave unrelated source CSS untouched.",
      "Swap OverviewRegion for OverviewSurface at the existing SourceDomPage boundary.",
      "Compare the same visual viewport matrix against reference.png before deleting generated DOM/CSS coverage."
    ],
    "firstReplacementStep": "Create OverviewSurface beside the app components using sidecar SVG/image assets and explicit legend/scale data, then swap it for OverviewRegion only after screenshot parity is preserved.",
    "parityGuard": "Before deleting OverviewRegion, compare the root app against web-clone-source/reference.png and keep unchanged clone surfaces above the requested visual threshold. Check map/chart fills, legend ticks, geographic/chart geometry, and extracted asset references."
  },
  {
    "regionComponentName": "EconomicTrendsRegion2",
    "regionFilePath": "src/components/source-dom/EconomicTrendsRegion2.tsx",
    "priority": "high",
    "recommendedComponentName": "EconomicTrendsTable",
    "replacementKind": "data_table_or_heatmap_component",
    "problem": "Generated source-dom region is 530 bytes with 2486 DOM elements; keep it as visual evidence only until replaced by a semantic component with explicit data/assets.",
    "sourceMap": {
      "sourceNodeId": "node_000914",
      "bounds": {
        "x": 0,
        "y": 302,
        "w": 1440,
        "h": 5149
      },
      "domRegion": "src/components/source-dom/EconomicTrendsRegion2.tsx",
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
        "source-node:node_000914"
      ]
    },
    "reusableSources": [
      "src/components/source-dom/EconomicTrendsRegion2.tsx",
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
      "src/components/source-dom/EconomicTrendsRegion2.tsx",
      "src/components/SourceDomPage.tsx import/render reference for this region",
      "unused selectors in src/styles/source-critical.css and src/styles/source-full.css after visual parity is preserved"
    ],
    "verticalSliceSteps": [
      "Read src/components/source-dom/EconomicTrendsRegion2.tsx plus sourceMap evidence for source ids, text, classes, and asset references.",
      "Extract the visible data for EconomicTrendsTable into sourceData.ts or a small typed module instead of duplicating JSX literals.",
      "Render EconomicTrendsTable as a semantic component with loops/props/states appropriate for data_table_or_heatmap_component.",
      "Preserve only the scoped classes or CSS variables needed by the replacement; leave unrelated source CSS untouched.",
      "Swap EconomicTrendsRegion2 for EconomicTrendsTable at the existing SourceDomPage boundary.",
      "Compare the same visual viewport matrix against reference.png before deleting generated DOM/CSS coverage."
    ],
    "firstReplacementStep": "Model rows/columns/colors as arrays in sourceData or a new data module, render EconomicTrendsTable with loops, and keep table dimensions/colors matched to EconomicTrendsRegion2.",
    "parityGuard": "Before deleting EconomicTrendsRegion2, compare the root app against web-clone-source/reference.png and keep unchanged clone surfaces above the requested visual threshold. Check row/column count, cell colors, typography, and numeric text coverage."
  },
  {
    "regionComponentName": "EconomyRegion5",
    "regionFilePath": "src/components/source-dom/EconomyRegion5.tsx",
    "priority": "low",
    "recommendedComponentName": "EconomySurface",
    "replacementKind": "map_or_chart_asset_component",
    "problem": "Generated source-dom region is 527 bytes with 21 DOM elements; keep it as visual evidence only until replaced by a semantic component with explicit data/assets.",
    "sourceMap": {
      "sourceNodeId": "node_000879",
      "bounds": {
        "x": 40,
        "y": 56,
        "w": 1360,
        "h": 186
      },
      "domRegion": "src/components/source-dom/EconomyRegion5.tsx",
      "styleSources": [
        "src/styles/source-critical.css",
        "src/styles/source-full.css",
        "web-clone-source/source-skeleton/critical.css",
        "web-clone-source/source-ir/style-tokens.json",
        "src/data/sourceSvgAssetGroups.ts",
        "src/data/svgPaths.ts"
      ],
      "dataSources": [
        "src/data/sourceData.ts"
      ],
      "assetSources": [
        "src/data/svgPaths.ts",
        "src/data/sourceSvgAssetGroups.ts",
        "public/assets/svg/",
        "public/assets/images/",
        "src/data/sourceData.ts:sourceAssets"
      ],
      "visualSources": [
        "web-clone-source/reference.png",
        "reference.png",
        "web-clone-source/visual-surface-candidates.json",
        "source-node:node_000879"
      ]
    },
    "reusableSources": [
      "src/components/source-dom/EconomyRegion5.tsx",
      "src/data/sourceDomRegions.ts",
      "web-clone-source/reference.png",
      "web-clone-source/source-skeleton/critical.css",
      "src/data/svgPaths.ts",
      "src/data/sourceSvgAssetGroups.ts",
      "web-clone-source/assets/svg/"
    ],
    "dataSources": [
      "src/data/sourceData.ts"
    ],
    "assetSources": [
      "src/data/svgPaths.ts",
      "src/data/sourceSvgAssetGroups.ts",
      "public/assets/svg/",
      "public/assets/images/",
      "src/data/sourceData.ts:sourceAssets"
    ],
    "generatedCleanupTargets": [
      "src/components/source-dom/EconomyRegion5.tsx",
      "src/components/SourceDomPage.tsx import/render reference for this region",
      "unused selectors in src/styles/source-critical.css and src/styles/source-full.css after visual parity is preserved"
    ],
    "verticalSliceSteps": [
      "Read src/components/source-dom/EconomyRegion5.tsx plus sourceMap evidence for source ids, text, classes, and asset references.",
      "Extract the visible data for EconomySurface into sourceData.ts or a small typed module instead of duplicating JSX literals.",
      "Render EconomySurface as a semantic component with loops/props/states appropriate for map_or_chart_asset_component.",
      "Preserve only the scoped classes or CSS variables needed by the replacement; leave unrelated source CSS untouched.",
      "Swap EconomyRegion5 for EconomySurface at the existing SourceDomPage boundary.",
      "Compare the same visual viewport matrix against reference.png before deleting generated DOM/CSS coverage."
    ],
    "firstReplacementStep": "Create EconomySurface beside the app components using sidecar SVG/image assets and explicit legend/scale data, then swap it for EconomyRegion5 only after screenshot parity is preserved.",
    "parityGuard": "Before deleting EconomyRegion5, compare the root app against web-clone-source/reference.png and keep unchanged clone surfaces above the requested visual threshold. Check map/chart fills, legend ticks, geographic/chart geometry, and extracted asset references."
  },
  {
    "regionComponentName": "EconomicTrendsRegion4",
    "regionFilePath": "src/components/source-dom/EconomicTrendsRegion4.tsx",
    "priority": "high",
    "recommendedComponentName": "EconomicTrendsTable",
    "replacementKind": "data_table_or_heatmap_component",
    "problem": "Generated source-dom region is 432 bytes with 2455 DOM elements; keep it as visual evidence only until replaced by a semantic component with explicit data/assets.",
    "sourceMap": {
      "sourceNodeId": "node_000953",
      "bounds": {
        "x": 40,
        "y": 302,
        "w": 1360,
        "h": 5149
      },
      "domRegion": "src/components/source-dom/EconomicTrendsRegion4.tsx",
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
        "source-node:node_000953"
      ]
    },
    "reusableSources": [
      "src/components/source-dom/EconomicTrendsRegion4.tsx",
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
      "src/components/source-dom/EconomicTrendsRegion4.tsx",
      "src/components/SourceDomPage.tsx import/render reference for this region",
      "unused selectors in src/styles/source-critical.css and src/styles/source-full.css after visual parity is preserved"
    ],
    "verticalSliceSteps": [
      "Read src/components/source-dom/EconomicTrendsRegion4.tsx plus sourceMap evidence for source ids, text, classes, and asset references.",
      "Extract the visible data for EconomicTrendsTable into sourceData.ts or a small typed module instead of duplicating JSX literals.",
      "Render EconomicTrendsTable as a semantic component with loops/props/states appropriate for data_table_or_heatmap_component.",
      "Preserve only the scoped classes or CSS variables needed by the replacement; leave unrelated source CSS untouched.",
      "Swap EconomicTrendsRegion4 for EconomicTrendsTable at the existing SourceDomPage boundary.",
      "Compare the same visual viewport matrix against reference.png before deleting generated DOM/CSS coverage."
    ],
    "firstReplacementStep": "Model rows/columns/colors as arrays in sourceData or a new data module, render EconomicTrendsTable with loops, and keep table dimensions/colors matched to EconomicTrendsRegion4.",
    "parityGuard": "Before deleting EconomicTrendsRegion4, compare the root app against web-clone-source/reference.png and keep unchanged clone surfaces above the requested visual threshold. Check row/column count, cell colors, typography, and numeric text coverage."
  },
  {
    "regionComponentName": "EconomyRegion",
    "regionFilePath": "src/components/source-dom/EconomyRegion.tsx",
    "priority": "high",
    "recommendedComponentName": "EconomyTable",
    "replacementKind": "data_table_or_heatmap_component",
    "problem": "Generated source-dom region is 432 bytes with 2512 DOM elements; keep it as visual evidence only until replaced by a semantic component with explicit data/assets.",
    "sourceMap": {
      "sourceNodeId": "node_000868",
      "bounds": {
        "x": 0,
        "y": 56,
        "w": 1440,
        "h": 5395
      },
      "domRegion": "src/components/source-dom/EconomyRegion.tsx",
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
        "source-node:node_000868"
      ]
    },
    "reusableSources": [
      "src/components/source-dom/EconomyRegion.tsx",
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
      "src/components/source-dom/EconomyRegion.tsx",
      "src/components/SourceDomPage.tsx import/render reference for this region",
      "unused selectors in src/styles/source-critical.css and src/styles/source-full.css after visual parity is preserved"
    ],
    "verticalSliceSteps": [
      "Read src/components/source-dom/EconomyRegion.tsx plus sourceMap evidence for source ids, text, classes, and asset references.",
      "Extract the visible data for EconomyTable into sourceData.ts or a small typed module instead of duplicating JSX literals.",
      "Render EconomyTable as a semantic component with loops/props/states appropriate for data_table_or_heatmap_component.",
      "Preserve only the scoped classes or CSS variables needed by the replacement; leave unrelated source CSS untouched.",
      "Swap EconomyRegion for EconomyTable at the existing SourceDomPage boundary.",
      "Compare the same visual viewport matrix against reference.png before deleting generated DOM/CSS coverage."
    ],
    "firstReplacementStep": "Model rows/columns/colors as arrays in sourceData or a new data module, render EconomyTable with loops, and keep table dimensions/colors matched to EconomyRegion.",
    "parityGuard": "Before deleting EconomyRegion, compare the root app against web-clone-source/reference.png and keep unchanged clone surfaces above the requested visual threshold. Check row/column count, cell colors, typography, and numeric text coverage."
  },
  {
    "regionComponentName": "EconomicTrendsRegion",
    "regionFilePath": "src/components/source-dom/EconomicTrendsRegion.tsx",
    "priority": "high",
    "recommendedComponentName": "EconomicTrendsTable",
    "replacementKind": "data_table_or_heatmap_component",
    "problem": "Generated source-dom region is 422 bytes with 2487 DOM elements; keep it as visual evidence only until replaced by a semantic component with explicit data/assets.",
    "sourceMap": {
      "sourceNodeId": "node_000913",
      "bounds": {
        "x": 0,
        "y": 302,
        "w": 1440,
        "h": 5149
      },
      "domRegion": "src/components/source-dom/EconomicTrendsRegion.tsx",
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
        "source-node:node_000913"
      ]
    },
    "reusableSources": [
      "src/components/source-dom/EconomicTrendsRegion.tsx",
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
      "src/components/source-dom/EconomicTrendsRegion.tsx",
      "src/components/SourceDomPage.tsx import/render reference for this region",
      "unused selectors in src/styles/source-critical.css and src/styles/source-full.css after visual parity is preserved"
    ],
    "verticalSliceSteps": [
      "Read src/components/source-dom/EconomicTrendsRegion.tsx plus sourceMap evidence for source ids, text, classes, and asset references.",
      "Extract the visible data for EconomicTrendsTable into sourceData.ts or a small typed module instead of duplicating JSX literals.",
      "Render EconomicTrendsTable as a semantic component with loops/props/states appropriate for data_table_or_heatmap_component.",
      "Preserve only the scoped classes or CSS variables needed by the replacement; leave unrelated source CSS untouched.",
      "Swap EconomicTrendsRegion for EconomicTrendsTable at the existing SourceDomPage boundary.",
      "Compare the same visual viewport matrix against reference.png before deleting generated DOM/CSS coverage."
    ],
    "firstReplacementStep": "Model rows/columns/colors as arrays in sourceData or a new data module, render EconomicTrendsTable with loops, and keep table dimensions/colors matched to EconomicTrendsRegion.",
    "parityGuard": "Before deleting EconomicTrendsRegion, compare the root app against web-clone-source/reference.png and keep unchanged clone surfaces above the requested visual threshold. Check row/column count, cell colors, typography, and numeric text coverage."
  },
  {
    "regionComponentName": "CountriesIdeasEconomicIndicatorsHeatRegion",
    "regionFilePath": "src/components/source-dom/CountriesIdeasEconomicIndicatorsHeatRegion.tsx",
    "priority": "low",
    "recommendedComponentName": "CountriesIdeasEconomicIndicatorsHeatNavigation",
    "replacementKind": "navigation_or_footer_component",
    "problem": "Generated source-dom region is 407 bytes with 29 DOM elements; keep it as visual evidence only until replaced by a semantic component with explicit data/assets.",
    "sourceMap": {
      "sourceNodeId": "node_000915",
      "bounds": {
        "x": 0,
        "y": 302,
        "w": 1440,
        "h": 0
      },
      "domRegion": "src/components/source-dom/CountriesIdeasEconomicIndicatorsHeatRegion.tsx",
      "styleSources": [
        "src/styles/source-critical.css",
        "src/styles/source-full.css",
        "web-clone-source/source-skeleton/critical.css",
        "web-clone-source/source-ir/style-tokens.json"
      ],
      "dataSources": [
        "src/data/sourceData.ts",
        "sourceComponents",
        "sourceTextSignals"
      ],
      "assetSources": [
        "src/data/sourceData.ts:sourceAssets"
      ],
      "visualSources": [
        "web-clone-source/reference.png",
        "reference.png",
        "web-clone-source/visual-surface-candidates.json",
        "source-node:node_000915"
      ]
    },
    "reusableSources": [
      "src/components/source-dom/CountriesIdeasEconomicIndicatorsHeatRegion.tsx",
      "src/data/sourceDomRegions.ts",
      "web-clone-source/reference.png",
      "web-clone-source/source-skeleton/critical.css",
      "web-clone-source/source-ir/component-tree.json"
    ],
    "dataSources": [
      "src/data/sourceData.ts",
      "sourceComponents",
      "sourceTextSignals"
    ],
    "assetSources": [
      "src/data/sourceData.ts:sourceAssets"
    ],
    "generatedCleanupTargets": [
      "src/components/source-dom/CountriesIdeasEconomicIndicatorsHeatRegion.tsx",
      "src/components/SourceDomPage.tsx import/render reference for this region",
      "unused selectors in src/styles/source-critical.css and src/styles/source-full.css after visual parity is preserved"
    ],
    "verticalSliceSteps": [
      "Read src/components/source-dom/CountriesIdeasEconomicIndicatorsHeatRegion.tsx plus sourceMap evidence for source ids, text, classes, and asset references.",
      "Extract the visible data for CountriesIdeasEconomicIndicatorsHeatNavigation into sourceData.ts or a small typed module instead of duplicating JSX literals.",
      "Render CountriesIdeasEconomicIndicatorsHeatNavigation as a semantic component with loops/props/states appropriate for navigation_or_footer_component.",
      "Preserve only the scoped classes or CSS variables needed by the replacement; leave unrelated source CSS untouched.",
      "Swap CountriesIdeasEconomicIndicatorsHeatRegion for CountriesIdeasEconomicIndicatorsHeatNavigation at the existing SourceDomPage boundary.",
      "Compare the same visual viewport matrix against reference.png before deleting generated DOM/CSS coverage."
    ],
    "firstReplacementStep": "Extract link groups/social/language state into arrays, render CountriesIdeasEconomicIndicatorsHeatNavigation with existing navigation/footer primitives when available, and keep legal/source text intact.",
    "parityGuard": "Before deleting CountriesIdeasEconomicIndicatorsHeatRegion, compare the root app against web-clone-source/reference.png and keep unchanged clone surfaces above the requested visual threshold."
  },
  {
    "regionComponentName": "CountriesIdeasEconomicIndicatorsHeatRegion2",
    "regionFilePath": "src/components/source-dom/CountriesIdeasEconomicIndicatorsHeatRegion2.tsx",
    "priority": "low",
    "recommendedComponentName": "CountriesIdeasEconomicIndicatorsHeatNavigation",
    "replacementKind": "navigation_or_footer_component",
    "problem": "Generated source-dom region is 390 bytes with 28 DOM elements; keep it as visual evidence only until replaced by a semantic component with explicit data/assets.",
    "sourceMap": {
      "sourceNodeId": "node_000916",
      "bounds": {
        "x": 0,
        "y": 302,
        "w": 1440,
        "h": 5149
      },
      "domRegion": "src/components/source-dom/CountriesIdeasEconomicIndicatorsHeatRegion2.tsx",
      "styleSources": [
        "src/styles/source-critical.css",
        "src/styles/source-full.css",
        "web-clone-source/source-skeleton/critical.css",
        "web-clone-source/source-ir/style-tokens.json"
      ],
      "dataSources": [
        "src/data/sourceData.ts",
        "sourceComponents",
        "sourceTextSignals"
      ],
      "assetSources": [
        "src/data/sourceData.ts:sourceAssets"
      ],
      "visualSources": [
        "web-clone-source/reference.png",
        "reference.png",
        "web-clone-source/visual-surface-candidates.json",
        "source-node:node_000916"
      ]
    },
    "reusableSources": [
      "src/components/source-dom/CountriesIdeasEconomicIndicatorsHeatRegion2.tsx",
      "src/data/sourceDomRegions.ts",
      "web-clone-source/reference.png",
      "web-clone-source/source-skeleton/critical.css",
      "web-clone-source/source-ir/component-tree.json"
    ],
    "dataSources": [
      "src/data/sourceData.ts",
      "sourceComponents",
      "sourceTextSignals"
    ],
    "assetSources": [
      "src/data/sourceData.ts:sourceAssets"
    ],
    "generatedCleanupTargets": [
      "src/components/source-dom/CountriesIdeasEconomicIndicatorsHeatRegion2.tsx",
      "src/components/SourceDomPage.tsx import/render reference for this region",
      "unused selectors in src/styles/source-critical.css and src/styles/source-full.css after visual parity is preserved"
    ],
    "verticalSliceSteps": [
      "Read src/components/source-dom/CountriesIdeasEconomicIndicatorsHeatRegion2.tsx plus sourceMap evidence for source ids, text, classes, and asset references.",
      "Extract the visible data for CountriesIdeasEconomicIndicatorsHeatNavigation into sourceData.ts or a small typed module instead of duplicating JSX literals.",
      "Render CountriesIdeasEconomicIndicatorsHeatNavigation as a semantic component with loops/props/states appropriate for navigation_or_footer_component.",
      "Preserve only the scoped classes or CSS variables needed by the replacement; leave unrelated source CSS untouched.",
      "Swap CountriesIdeasEconomicIndicatorsHeatRegion2 for CountriesIdeasEconomicIndicatorsHeatNavigation at the existing SourceDomPage boundary.",
      "Compare the same visual viewport matrix against reference.png before deleting generated DOM/CSS coverage."
    ],
    "firstReplacementStep": "Extract link groups/social/language state into arrays, render CountriesIdeasEconomicIndicatorsHeatNavigation with existing navigation/footer primitives when available, and keep legal/source text intact.",
    "parityGuard": "Before deleting CountriesIdeasEconomicIndicatorsHeatRegion2, compare the root app against web-clone-source/reference.png and keep unchanged clone surfaces above the requested visual threshold."
  },
  {
    "regionComponentName": "EconomicTrendsRegion3",
    "regionFilePath": "src/components/source-dom/EconomicTrendsRegion3.tsx",
    "priority": "high",
    "recommendedComponentName": "EconomicTrendsTable",
    "replacementKind": "data_table_or_heatmap_component",
    "problem": "Generated source-dom region is 371 bytes with 2456 DOM elements; keep it as visual evidence only until replaced by a semantic component with explicit data/assets.",
    "sourceMap": {
      "sourceNodeId": "node_000952",
      "bounds": {
        "x": 0,
        "y": 302,
        "w": 1440,
        "h": 5149
      },
      "domRegion": "src/components/source-dom/EconomicTrendsRegion3.tsx",
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
        "source-node:node_000952"
      ]
    },
    "reusableSources": [
      "src/components/source-dom/EconomicTrendsRegion3.tsx",
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
      "src/components/source-dom/EconomicTrendsRegion3.tsx",
      "src/components/SourceDomPage.tsx import/render reference for this region",
      "unused selectors in src/styles/source-critical.css and src/styles/source-full.css after visual parity is preserved"
    ],
    "verticalSliceSteps": [
      "Read src/components/source-dom/EconomicTrendsRegion3.tsx plus sourceMap evidence for source ids, text, classes, and asset references.",
      "Extract the visible data for EconomicTrendsTable into sourceData.ts or a small typed module instead of duplicating JSX literals.",
      "Render EconomicTrendsTable as a semantic component with loops/props/states appropriate for data_table_or_heatmap_component.",
      "Preserve only the scoped classes or CSS variables needed by the replacement; leave unrelated source CSS untouched.",
      "Swap EconomicTrendsRegion3 for EconomicTrendsTable at the existing SourceDomPage boundary.",
      "Compare the same visual viewport matrix against reference.png before deleting generated DOM/CSS coverage."
    ],
    "firstReplacementStep": "Model rows/columns/colors as arrays in sourceData or a new data module, render EconomicTrendsTable with loops, and keep table dimensions/colors matched to EconomicTrendsRegion3.",
    "parityGuard": "Before deleting EconomicTrendsRegion3, compare the root app against web-clone-source/reference.png and keep unchanged clone surfaces above the requested visual threshold. Check row/column count, cell colors, typography, and numeric text coverage."
  },
  {
    "regionComponentName": "EconomyRegion2",
    "regionFilePath": "src/components/source-dom/EconomyRegion2.tsx",
    "priority": "low",
    "recommendedComponentName": "EconomySurface",
    "replacementKind": "map_or_chart_asset_component",
    "problem": "Generated source-dom region is 364 bytes with 24 DOM elements; keep it as visual evidence only until replaced by a semantic component with explicit data/assets.",
    "sourceMap": {
      "sourceNodeId": "node_000876",
      "bounds": {
        "x": 0,
        "y": 56,
        "w": 1440,
        "h": 186
      },
      "domRegion": "src/components/source-dom/EconomyRegion2.tsx",
      "styleSources": [
        "src/styles/source-critical.css",
        "src/styles/source-full.css",
        "web-clone-source/source-skeleton/critical.css",
        "web-clone-source/source-ir/style-tokens.json",
        "src/data/sourceSvgAssetGroups.ts",
        "src/data/svgPaths.ts"
      ],
      "dataSources": [
        "src/data/sourceData.ts"
      ],
      "assetSources": [
        "src/data/svgPaths.ts",
        "src/data/sourceSvgAssetGroups.ts",
        "public/assets/svg/",
        "public/assets/images/",
        "src/data/sourceData.ts:sourceAssets"
      ],
      "visualSources": [
        "web-clone-source/reference.png",
        "reference.png",
        "web-clone-source/visual-surface-candidates.json",
        "source-node:node_000876"
      ]
    },
    "reusableSources": [
      "src/components/source-dom/EconomyRegion2.tsx",
      "src/data/sourceDomRegions.ts",
      "web-clone-source/reference.png",
      "web-clone-source/source-skeleton/critical.css",
      "src/data/svgPaths.ts",
      "src/data/sourceSvgAssetGroups.ts",
      "web-clone-source/assets/svg/"
    ],
    "dataSources": [
      "src/data/sourceData.ts"
    ],
    "assetSources": [
      "src/data/svgPaths.ts",
      "src/data/sourceSvgAssetGroups.ts",
      "public/assets/svg/",
      "public/assets/images/",
      "src/data/sourceData.ts:sourceAssets"
    ],
    "generatedCleanupTargets": [
      "src/components/source-dom/EconomyRegion2.tsx",
      "src/components/SourceDomPage.tsx import/render reference for this region",
      "unused selectors in src/styles/source-critical.css and src/styles/source-full.css after visual parity is preserved"
    ],
    "verticalSliceSteps": [
      "Read src/components/source-dom/EconomyRegion2.tsx plus sourceMap evidence for source ids, text, classes, and asset references.",
      "Extract the visible data for EconomySurface into sourceData.ts or a small typed module instead of duplicating JSX literals.",
      "Render EconomySurface as a semantic component with loops/props/states appropriate for map_or_chart_asset_component.",
      "Preserve only the scoped classes or CSS variables needed by the replacement; leave unrelated source CSS untouched.",
      "Swap EconomyRegion2 for EconomySurface at the existing SourceDomPage boundary.",
      "Compare the same visual viewport matrix against reference.png before deleting generated DOM/CSS coverage."
    ],
    "firstReplacementStep": "Create EconomySurface beside the app components using sidecar SVG/image assets and explicit legend/scale data, then swap it for EconomyRegion2 only after screenshot parity is preserved.",
    "parityGuard": "Before deleting EconomyRegion2, compare the root app against web-clone-source/reference.png and keep unchanged clone surfaces above the requested visual threshold. Check map/chart fills, legend ticks, geographic/chart geometry, and extracted asset references."
  },
  {
    "regionComponentName": "EconomyRegion3",
    "regionFilePath": "src/components/source-dom/EconomyRegion3.tsx",
    "priority": "low",
    "recommendedComponentName": "EconomySurface",
    "replacementKind": "map_or_chart_asset_component",
    "problem": "Generated source-dom region is 302 bytes with 23 DOM elements; keep it as visual evidence only until replaced by a semantic component with explicit data/assets.",
    "sourceMap": {
      "sourceNodeId": "node_000877",
      "bounds": {
        "x": 0,
        "y": 56,
        "w": 1440,
        "h": 186
      },
      "domRegion": "src/components/source-dom/EconomyRegion3.tsx",
      "styleSources": [
        "src/styles/source-critical.css",
        "src/styles/source-full.css",
        "web-clone-source/source-skeleton/critical.css",
        "web-clone-source/source-ir/style-tokens.json",
        "src/data/sourceSvgAssetGroups.ts",
        "src/data/svgPaths.ts"
      ],
      "dataSources": [
        "src/data/sourceData.ts"
      ],
      "assetSources": [
        "src/data/svgPaths.ts",
        "src/data/sourceSvgAssetGroups.ts",
        "public/assets/svg/",
        "public/assets/images/",
        "src/data/sourceData.ts:sourceAssets"
      ],
      "visualSources": [
        "web-clone-source/reference.png",
        "reference.png",
        "web-clone-source/visual-surface-candidates.json",
        "source-node:node_000877"
      ]
    },
    "reusableSources": [
      "src/components/source-dom/EconomyRegion3.tsx",
      "src/data/sourceDomRegions.ts",
      "web-clone-source/reference.png",
      "web-clone-source/source-skeleton/critical.css",
      "src/data/svgPaths.ts",
      "src/data/sourceSvgAssetGroups.ts",
      "web-clone-source/assets/svg/"
    ],
    "dataSources": [
      "src/data/sourceData.ts"
    ],
    "assetSources": [
      "src/data/svgPaths.ts",
      "src/data/sourceSvgAssetGroups.ts",
      "public/assets/svg/",
      "public/assets/images/",
      "src/data/sourceData.ts:sourceAssets"
    ],
    "generatedCleanupTargets": [
      "src/components/source-dom/EconomyRegion3.tsx",
      "src/components/SourceDomPage.tsx import/render reference for this region",
      "unused selectors in src/styles/source-critical.css and src/styles/source-full.css after visual parity is preserved"
    ],
    "verticalSliceSteps": [
      "Read src/components/source-dom/EconomyRegion3.tsx plus sourceMap evidence for source ids, text, classes, and asset references.",
      "Extract the visible data for EconomySurface into sourceData.ts or a small typed module instead of duplicating JSX literals.",
      "Render EconomySurface as a semantic component with loops/props/states appropriate for map_or_chart_asset_component.",
      "Preserve only the scoped classes or CSS variables needed by the replacement; leave unrelated source CSS untouched.",
      "Swap EconomyRegion3 for EconomySurface at the existing SourceDomPage boundary.",
      "Compare the same visual viewport matrix against reference.png before deleting generated DOM/CSS coverage."
    ],
    "firstReplacementStep": "Create EconomySurface beside the app components using sidecar SVG/image assets and explicit legend/scale data, then swap it for EconomyRegion3 only after screenshot parity is preserved.",
    "parityGuard": "Before deleting EconomyRegion3, compare the root app against web-clone-source/reference.png and keep unchanged clone surfaces above the requested visual threshold. Check map/chart fills, legend ticks, geographic/chart geometry, and extracted asset references."
  },
  {
    "regionComponentName": "EconomyRegion4",
    "regionFilePath": "src/components/source-dom/EconomyRegion4.tsx",
    "priority": "low",
    "recommendedComponentName": "EconomySurface",
    "replacementKind": "map_or_chart_asset_component",
    "problem": "Generated source-dom region is 273 bytes with 22 DOM elements; keep it as visual evidence only until replaced by a semantic component with explicit data/assets.",
    "sourceMap": {
      "sourceNodeId": "node_000878",
      "bounds": {
        "x": 0,
        "y": 56,
        "w": 1440,
        "h": 186
      },
      "domRegion": "src/components/source-dom/EconomyRegion4.tsx",
      "styleSources": [
        "src/styles/source-critical.css",
        "src/styles/source-full.css",
        "web-clone-source/source-skeleton/critical.css",
        "web-clone-source/source-ir/style-tokens.json",
        "src/data/sourceSvgAssetGroups.ts",
        "src/data/svgPaths.ts"
      ],
      "dataSources": [
        "src/data/sourceData.ts"
      ],
      "assetSources": [
        "src/data/svgPaths.ts",
        "src/data/sourceSvgAssetGroups.ts",
        "public/assets/svg/",
        "public/assets/images/",
        "src/data/sourceData.ts:sourceAssets"
      ],
      "visualSources": [
        "web-clone-source/reference.png",
        "reference.png",
        "web-clone-source/visual-surface-candidates.json",
        "source-node:node_000878"
      ]
    },
    "reusableSources": [
      "src/components/source-dom/EconomyRegion4.tsx",
      "src/data/sourceDomRegions.ts",
      "web-clone-source/reference.png",
      "web-clone-source/source-skeleton/critical.css",
      "src/data/svgPaths.ts",
      "src/data/sourceSvgAssetGroups.ts",
      "web-clone-source/assets/svg/"
    ],
    "dataSources": [
      "src/data/sourceData.ts"
    ],
    "assetSources": [
      "src/data/svgPaths.ts",
      "src/data/sourceSvgAssetGroups.ts",
      "public/assets/svg/",
      "public/assets/images/",
      "src/data/sourceData.ts:sourceAssets"
    ],
    "generatedCleanupTargets": [
      "src/components/source-dom/EconomyRegion4.tsx",
      "src/components/SourceDomPage.tsx import/render reference for this region",
      "unused selectors in src/styles/source-critical.css and src/styles/source-full.css after visual parity is preserved"
    ],
    "verticalSliceSteps": [
      "Read src/components/source-dom/EconomyRegion4.tsx plus sourceMap evidence for source ids, text, classes, and asset references.",
      "Extract the visible data for EconomySurface into sourceData.ts or a small typed module instead of duplicating JSX literals.",
      "Render EconomySurface as a semantic component with loops/props/states appropriate for map_or_chart_asset_component.",
      "Preserve only the scoped classes or CSS variables needed by the replacement; leave unrelated source CSS untouched.",
      "Swap EconomyRegion4 for EconomySurface at the existing SourceDomPage boundary.",
      "Compare the same visual viewport matrix against reference.png before deleting generated DOM/CSS coverage."
    ],
    "firstReplacementStep": "Create EconomySurface beside the app components using sidecar SVG/image assets and explicit legend/scale data, then swap it for EconomyRegion4 only after screenshot parity is preserved.",
    "parityGuard": "Before deleting EconomyRegion4, compare the root app against web-clone-source/reference.png and keep unchanged clone surfaces above the requested visual threshold. Check map/chart fills, legend ticks, geographic/chart geometry, and extracted asset references."
  }
] as const

export const highPrioritySourceDomReplacementPlan = sourceDomReplacementPlan.filter((item) => item.priority === "high")
