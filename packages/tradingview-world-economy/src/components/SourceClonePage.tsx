import { SourceDomPage } from "./SourceDomPage"
import { sourceComponents, sourceTables } from "../data/sourceData"

export function SourceClonePage() {
  return (
    <SourceDomPage
      sourceComponentNames={sourceComponents.map((component) => component.name).join(",")}
      tableCount={sourceTables.length}
    />
  )
}
