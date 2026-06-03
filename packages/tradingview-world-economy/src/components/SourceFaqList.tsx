import type { CSSProperties } from "react"
import type { SourceFaqGroup, SourceFaqItem } from "../data/sourceFaqGroups"

export function SourceFaqList({ group }: { group: SourceFaqGroup }) {
  return (
    <div
      data-base-widget="true"
      data-container-name={group.dataAttributes.containerName}
      data-an-widget-id={group.dataAttributes.widgetId}
      className={group.classes.container}
    >
      <div className={group.classes.header}>
        <div className={group.classes.headerWrapper}>
          <span className={group.classes.titleAndHintWrapper}>
            <div className={group.classes.titleContainer}>
              <h2 className={group.classes.title} id={group.titleId}>
                {group.title}
              </h2>
            </div>
          </span>
        </div>
      </div>
      <div className={group.classes.content} data-qa-id={group.dataAttributes.contentQaId}>
        <div className={group.classes.wrapper}>
          {group.columns.map((column, columnIndex) => (
            <div className={group.classes.column} key={`faq-column-${columnIndex}`}>
              {column.map((item, itemIndex) => (
                <SourceFaqItemView
                  group={group}
                  item={item}
                  key={`${item.question}-${itemIndex}`}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function SourceFaqItemView({ group, item }: { group: SourceFaqGroup; item: SourceFaqItem }) {
  const detailsId = item.detailsId ?? `${item.summaryId ?? item.question}-details`
  const itemStyle: CSSProperties | undefined = item.order ? { order: item.order } : undefined
  return (
    <div className={item.itemClassName ?? group.classes.item} style={itemStyle}>
      <button
        className={group.classes.summary}
        id={item.summaryId}
        aria-expanded="false"
        aria-controls={detailsId}
      >
        <div className={group.classes.summaryLine}>
          <span className={group.classes.background} />
          <div className={group.classes.summaryText}>{item.question}</div>
          <div className={group.classes.iconPresentation} role="presentation">
            <div className={group.classes.iconWrapper}>
              <div className={group.classes.iconHorizontal} />
              <div className={group.classes.iconVertical} />
            </div>
          </div>
        </div>
      </button>
      <div className={group.classes.detailsWrapper} id={detailsId}>
        <div className={group.classes.details}>
          {item.answerText}
          {item.links.map((link) => (
            <a href={link.href} key={`${link.href}-${link.label}`}>{link.label}</a>
          ))}
        </div>
      </div>
    </div>
  )
}
