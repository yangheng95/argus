import type { CSSProperties } from "react"
import { AssetPath } from "../AssetPath"
import { ContentTable } from "../ContentTable"
import { sourceTables } from "../../data/sourceData"
import type { ExtractedMapPath } from "../../data/economicTrendsExtracted"
import {
  economicMetricCards,
  extractedCalendarItems,
  extractedFormulaFaqItems,
  extractedNewsItems,
  gdpGrowthRows,
  inflationLegendLabels,
  inflationMapPaths,
  worldEconomyCountryLinks,
} from "../../data/economicTrendsExtracted"

export function EconomicTrendsPage() {
  return (
    <div id="world-economy-page-section" data-base-widget="true" data-container-name="world-economy-page-section" data-an-widget-id="world-economy-page-section" className="container-Gvxnai7n">
      <div className="content-Gvxnai7n" data-qa-id="world-economy-page-section-content">
        <div className="widgets-jIcZQl74">
          <EconomicTrendsSummary />
          <CountriesOverview />
          <IdeasAndNews />
          <CalendarAndFaq />
        </div>
      </div>
    </div>
  )
}

function SectionHeader({ title, id }: { title: string; id: string }) {
  return (
    <div className="header-Gvxnai7n header-m-Gvxnai7n">
      <div className="wrapper-BQZK4DnU wrap-BQZK4DnU">
        <span className="titleAndHintWrapper-BQZK4DnU truncated-BQZK4DnU">
          <div className="container-BQZK4DnU">
            <h2 className="title-BQZK4DnU title-m-BQZK4DnU" id={id}>
              {title}
            </h2>
          </div>
        </span>
      </div>
    </div>
  )
}

function EconomicTrendsSummary() {
  return (
    <div data-base-widget="true" data-container-name="economy-market-summary" data-an-widget-id="economy-market-summary" className="container-Gvxnai7n">
      <SectionHeader title="Economic trends" id="economy-market-summary" />
      <div className="content-Gvxnai7n" data-qa-id="economy-market-summary-content">
        <div className="container-KqgCoGM1">
          <InflationMap />
          <GdpGrowthList />
          {economicMetricCards.map((card, index) => (
            <MetricCard card={card} gridArea={["unemploymentRate", "interestRate", "tradeBalance"][index]} key={card.ticker} />
          ))}
        </div>
      </div>
    </div>
  )
}

function InflationMap() {
  return (
    <div className="card-_bHcdE9E" style={{ gridArea: "maps" }}>
      <span className="title-KqgCoGM1">Inflation map</span>
      <div className="map-KqgCoGM1">
        <div className="container-xYQiJfBC">
          <div className="map-xYQiJfBC">
            <div className="container-PucT6CA9">
              <div className="mapContainer-PucT6CA9 loaded-PucT6CA9" data-color-preset="color-heatmap-tan-orange" data-qa-id="core-map-container-status" data-loading-status="loaded">
                <span data-qa-id="core-map-content" className="map-PucT6CA9">
                  <svg viewBox="0 0 745 372" fill="currentColor" preserveAspectRatio="xMidYMid meet">
                    {inflationMapPaths.map((path) => {
                      const extractedPath: ExtractedMapPath = path
                      return (
                      <AssetPath
                        assetPath={extractedPath.assetPath}
                        id={extractedPath.id}
                        className={extractedPath.className}
                        data-neutral={extractedPath.neutralLabel}
                        key={`${extractedPath.assetPath}-${extractedPath.id ?? extractedPath.neutralLabel ?? "neutral"}`}
                      />
                    )})}
                  </svg>
                  <svg viewBox="0 0 745 372" fill="currentColor" preserveAspectRatio="xMidYMid meet" className="blankMap" />
                </span>
                <div className="container-IyWyk2Ci intervalType-IyWyk2Ci shortMode-IyWyk2Ci legend-PucT6CA9">
                  <div role="toolbar" aria-orientation="horizontal" className="block-IyWyk2Ci" aria-labelledby="ariaLabelledBy">
                    <div className="semantic-extracted-map-legend" aria-hidden="true">
                      {inflationLegendLabels.map((label) => (
                        <span className="text-IyWyk2Ci" key={label}>{label}</span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function GdpGrowthList() {
  return (
    <div className="card-_bHcdE9E" style={{ gridArea: "staticCountries" }}>
      <div className="wrapper-LBIMiZWE">
        <div className="header-LBIMiZWE">GDP growth, YoY</div>
        <div className="header-WMQb_1Ui column-LBIMiZWE">
          <span>Country</span>
          <span>GDP Growth</span>
          <span>Nominal GDP</span>
        </div>
        <ul className="container-LBIMiZWE">
          {gdpGrowthRows.map((row) => (
            <li className="item-LBIMiZWE" key={row.name}>
              <div className="container-lLGceaUg containerWithHover-lLGceaUg">
                <div className="container-zBPPLXWm">
                  <img className="logo-m0C6Ivpo medium-m0C6Ivpo logo-KWH0mxBE letter-m0C6Ivpo" src={row.logo} alt="" />
                  <a href={row.href} className="container-Nt5iBa6X link-Nt5iBa6X container-IIKn4NmC">
                    <div className="titleContainer-IIKn4NmC">
                      <span className="title-IIKn4NmC apply-overflow-tooltip" data-overflow-tooltip-text={row.name}>{row.name}</span>
                    </div>
                  </a>
                  <span className="container-ItI7saAL" style={{ gridArea: "price" }}>
                    <span className="value-ItI7saAL">{row.growth}</span>
                    <span className="unit-ItI7saAL" />
                  </span>
                  <span className="container-ItI7saAL" style={{ gridArea: "valueAndUnit" }}>
                    <span className="value-ItI7saAL">{row.nominalGdp}</span>
                    <span className="unit-ItI7saAL">{row.currency}</span>
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function MetricCard({ card, gridArea }: { card: (typeof economicMetricCards)[number]; gridArea: string }) {
  const timeframe = "timeframe" in card ? card.timeframe : undefined

  return (
    <div className="card-_bHcdE9E" style={{ gridArea }}>
      <div className="header-Q4ifml3p">
        <a href={card.href} className="container-uk1zko9U link-uk1zko9U">
          <span className="title-uk1zko9U apply-overflow-tooltip" data-overflow-tooltip-text={card.title}>{card.title}</span>
          <span className="tickerBox-uk1zko9U">{card.ticker}</span>
        </a>
      </div>
      <div className="content-Q4ifml3p">
        <div className="semantic-extracted-chart">
          {card.chartImages.map((image) => <img src={image} alt="" key={image} />)}
        </div>
        {timeframe && <span className="timeframe-KqgCoGM1">{timeframe}</span>}
      </div>
      <div className="wrapper-vE74cYTn">
        <div className="container-vE74cYTn">
          {parseMetricSignal(card.signal).map((item) => (
            <div className="wrapper-yXjDRT2e" key={item.label}>
              <div className="label-yXjDRT2e">{item.label}</div>
              <div className="value-yXjDRT2e">{item.value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function CountriesOverview() {
  return (
    <div className="container-Gvxnai7n">
      <SectionHeader title="Countries" id="countries" />
      <div className="content-Gvxnai7n">
        <div className="container-A2DTx07J">
          {worldEconomyCountryLinks.map((country) => (
            <a href={country.href} className="button-A2DTx07J roundButton-wc15_bxY roundButtonColor-bvCKE8pJ gray-bvCKE8pJ primary-bvCKE8pJ small-wc15_bxY link-A2GavdUb" key={country.href}>
              <span className="content-wc15_bxY">{country.label}</span>
            </a>
          ))}
        </div>
        <ContentTable table={sourceTables[0]} />
      </div>
    </div>
  )
}

function IdeasAndNews() {
  return (
    <>
      <ExtractedSignalSection title="Ideas" id="ideas" items={extractedFormulaFaqItems} />
      <ExtractedSignalSection title="News" id="news" items={extractedNewsItems} />
    </>
  )
}

function CalendarAndFaq() {
  return (
    <>
      <ExtractedSignalSection title="Economic Calendar" id="economic-calendar" items={extractedCalendarItems} />
      <ExtractedSignalSection title="Frequently asked questions" id="faq" items={extractedFormulaFaqItems} />
    </>
  )
}

function ExtractedSignalSection({ title, id, items }: { title: string; id: string; items: readonly string[] }) {
  return (
    <div className="container-Gvxnai7n">
      <SectionHeader title={title} id={id} />
      <div className="content-Gvxnai7n">
        <div className="semantic-extracted-card-grid">
          {items.map((item) => (
            <article className="wrap-nj94V3ds" key={item}>
              <div className="titleBlock-nj94V3ds">
                <span className="title-nj94V3ds">{extractLeadingTitle(item)}</span>
              </div>
              <p className="subTitle-nj94V3ds">{item}</p>
            </article>
          ))}
        </div>
      </div>
    </div>
  )
}

function parseMetricSignal(signal: string): { label: string; value: string }[] {
  const actual = signal.match(/Actual\\s+(.+?)\\s+Forecast/)?.[1] ?? "—"
  const forecast = signal.match(/Forecast\\s+(.+?)\\s+Next release/)?.[1] ?? "—"
  const nextRelease = signal.match(/Next release\\s+(.+)$/)?.[1] ?? "—"
  return [
    { label: "Actual", value: actual },
    { label: "Forecast", value: forecast },
    { label: "Next release", value: nextRelease },
  ]
}

function extractLeadingTitle(text: string): string {
  return text.split(" Actual ")[0].split(" Forecast ")[0].split(" — ")[0].slice(0, 96)
}
