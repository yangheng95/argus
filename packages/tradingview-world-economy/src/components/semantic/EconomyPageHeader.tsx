import { AssetPath } from "../AssetPath"
import { economyBreadcrumbs } from "../../data/extractedNavigation"

export function EconomyPageHeader() {
  return (
    <div className="js-markets-page-header-root" data-props-id="62a90l" data-render-mode="legacy">
      <div className="marketHeader-JohAQ21X withBreadcrumbs-JohAQ21X">
        <div className="pageHead-tCfmQCnK">
          <div className="landingHeader-GSw4MLDp withBreadcrumbs-GSw4MLDp">
            <nav aria-label="Breadcrumbs" className="breadcrumbsContainer-tCAofWib breadcrumbsContainerScroll-tCAofWib">
              <ul className="breadcrumbsList-tCAofWib breadcrumbs-GSw4MLDp">
                {economyBreadcrumbs.map((breadcrumb, index) => (
                  <li className="breadcrumbsListItem-tCAofWib" key={breadcrumb.label}>
                    {index > 0 && (
                      <span className="divider-eNf2O0Gx small-eNf2O0Gx" aria-hidden="true">
                        /
                      </span>
                    )}
                    <a
                      href={breadcrumb.href}
                      aria-current={breadcrumb.current ? "page" : undefined}
                      className={[
                        "breadcrumb-eNf2O0Gx apply-overflow-tooltip apply-overflow-tooltip--allow-text apply-overflow-tooltip--check-children textButton-H0Qx6L7S link-H0Qx6L7S light-gray-H0Qx6L7S small-H0Qx6L7S",
                        breadcrumb.current ? "currentPage-eNf2O0Gx dimmed-H0Qx6L7S" : "",
                      ].join(" ")}
                    >
                      <span className="background-H0Qx6L7S states-without-bg-H0Qx6L7S" />
                      <span className="content-H0Qx6L7S">
                        <span className="breadcrumbContent-eNf2O0Gx">
                          {breadcrumb.label}
                        </span>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
            <h1 className="category-GSw4MLDp category-JohAQ21X">
              Economy
            </h1>
            <div className="container-weyhJErV">
              <div className="btnContainer-FCpS4r4J">
                <button className="headerBtn-FCpS4r4J">
                  <div className="container-weyhJErV">
                    <h2 className="header-FCpS4r4J">
                      <span className="noBreak-HkGXK524">
                        Overview
                        <div className="arrowWrap-FCpS4r4J">
                          <span role="img" className="iconSmall-FCpS4r4J sf-hidden" aria-hidden="true">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">
                              <AssetPath fill="currentColor" assetPath="../assets/svg/asset_000230.path.txt" />
                            </svg>
                          </span>
                          <span role="img" className="iconLarge-FCpS4r4J" aria-hidden="true">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28">
                              <AssetPath fill="currentColor" assetPath="../assets/svg/asset_000231.path.txt" />
                            </svg>
                          </span>
                        </div>
                      </span>
                    </h2>
                  </div>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
