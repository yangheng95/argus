export interface SourceFaqGroup {
  title: string
  titleId?: string
  classes: Record<string, string>
  dataAttributes: Record<string, string | undefined>
  columns: readonly (readonly SourceFaqItem[])[]
}

export interface SourceFaqItem {
  question: string
  answerText: string
  links: readonly { href: string; label: string }[]
  order?: string
  itemClassName?: string
  summaryId?: string
  detailsId?: string
}

export const sourceFaqGroups = {} as const satisfies Record<string, SourceFaqGroup>
