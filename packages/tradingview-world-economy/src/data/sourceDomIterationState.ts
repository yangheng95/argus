export const sourceDomIterationState = {
  version: 3,
  purpose: "source-dom-maintainable-iteration-state",
  generatedRegionCount: 15,
  semanticReplacementCount: 5,
  remainingRegionCount: 0,
  completedReplacementCount: 15,
  semanticReplacements: [
    {
      componentName: "FooterNavigation",
      filePath: "src/components/semantic/FooterNavigation.tsx",
      replacementKind: "navigation_or_footer_component",
      sourceRegionComponentName: "FooterRegion",
    },
    {
      componentName: "HeaderNavigation",
      filePath: "src/components/semantic/HeaderNavigation.tsx",
      replacementKind: "navigation_or_footer_component",
      sourceRegionComponentName: "HeaderRegion",
    },
    {
      componentName: "EconomyPageHeader",
      filePath: "src/components/semantic/EconomyPageHeader.tsx",
      replacementKind: "navigation_or_header_component",
    },
    {
      componentName: "WorldEconomyTabNavigation",
      filePath: "src/components/semantic/WorldEconomyTabNavigation.tsx",
      replacementKind: "navigation_or_header_component",
    },
    {
      componentName: "EconomicTrendsPage",
      filePath: "src/components/semantic/EconomicTrendsPage.tsx",
      replacementKind: "data_driven_page_component",
      dataSources: [
        "src/data/economicTrendsExtracted.ts",
        "src/data/sourceData.ts",
        "src/data/svgPaths.ts",
      ],
    },
  ],
  remainingGeneratedRegions: [],
  nextReplacement: null,
  visualIteration: {
    referenceImage: "web-clone-source/reference.png",
    comparisonTool: "webpage_evaluate",
    viewportMatrix: [
      {
        name: "desktop-reference",
        width: 1440,
        height: 900,
        evidenceRole: "primary_reference",
        evidenceSource: "capture_viewport",
      },
      {
        name: "mobile-review",
        width: 390,
        height: 844,
        evidenceRole: "responsive_review",
        evidenceSource: "default",
      },
      {
        name: "wide-review",
        width: 1920,
        height: 1080,
        evidenceRole: "responsive_review",
        evidenceSource: "default",
      },
    ],
  },
  recommendedLoop: [
    "Keep future edits data-first: update economicTrendsExtracted.ts or sourceData.ts before changing component structure.",
    "Use extracted SVG paths, copied image assets, and existing extracted class names before adding new presentation styles.",
    "Run screenshot review against reference.png after each meaningful visual change.",
  ],
  stopCondition: {
    sourceDomRegionFileCount: 0,
    generatedBaselineDetected: false,
    maintainableAuditMode: "maintainable_replacement_required",
    requiresMaintainableAuditPassed: true,
    requiresMeasuredVisualParity: true,
    visualIterationViewports: ["desktop-reference", "mobile-review", "wide-review"],
  },
} as const

export const nextSourceDomReplacement = sourceDomIterationState.nextReplacement
