import { SVGProps } from "react"
import { svgPaths } from "../data/svgPaths"

export function AssetPath({ assetPath, fill, ...props }: SVGProps<SVGPathElement> & { assetPath: string }) {
  const d = svgPaths[normalizeAssetPath(assetPath)] ?? ''
  return <path {...props} fill={fill ?? 'currentColor'} d={d} />
}

function normalizeAssetPath(assetPath: string): string {
  return assetPath.replaceAll('\\', '/').replace(/^\.\.\//, '').replace(/^\.\//, '')
}
