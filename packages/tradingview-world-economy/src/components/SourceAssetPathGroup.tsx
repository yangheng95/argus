import { SVGProps } from "react"
import { AssetPath } from "./AssetPath"
import type { SourceSvgAssetGroupItem } from "../data/sourceSvgAssetGroups"

export function SourceAssetPathGroup({ items }: { items: readonly SourceSvgAssetGroupItem[] }) {
  return (
    <>
      {items.map((item, index) => (
        <AssetPath
          key={`${item.assetPath}-${typeof item.id === "string" ? item.id : index}`}
          {...(item as SVGProps<SVGPathElement> & { assetPath: string })}
        />
      ))}
    </>
  )
}
