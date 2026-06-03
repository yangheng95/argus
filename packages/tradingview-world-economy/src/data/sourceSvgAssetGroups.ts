export interface SourceSvgAssetGroupItem {
  assetPath: string
  [attribute: string]: unknown
}

export const sourceSvgAssetGroups = {} as const satisfies Record<string, readonly SourceSvgAssetGroupItem[]>
