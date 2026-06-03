import { EconomicTrendsPage } from "./EconomicTrendsPage"
import { EconomyPageHeader } from "./EconomyPageHeader"
import { WorldEconomyTabNavigation } from "./WorldEconomyTabNavigation"

export function WorldEconomyOverviewContent() {
  return (
    <div id="js-category-content" className="tv-category-content " data-sf-nesting-track-id="1.6.6.9">
      <EconomyPageHeader />
      <div className="js-markets-world-economy-page-tab-overview-root" data-props-id="UE9jWZ" data-render-mode="legacy" data-sf-nesting-track-id="1.6.6.9.8">
        <div className="container-hlm3yPqK pageWithOneSection-hlm3yPqK" data-sf-nesting-track-id="1.6.6.9.8.1">
          <WorldEconomyTabNavigation />
          <div data-query-type="media" className="container-ZazqFM2n" data-sf-nesting-track-id="1.6.6.9.8.1.2">
            <section className="section-jIcZQl74" data-an-section-id="world-economy-page-section" data-sf-nesting-track-id="1.6.6.9.8.1.2.1">
              <EconomicTrendsPage />
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}
