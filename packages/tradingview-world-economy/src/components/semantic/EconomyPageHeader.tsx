import { AssetPath } from "../AssetPath"
import { economyBreadcrumbs } from "../../data/extractedNavigation"

export function EconomyPageHeader() {
  return (
    <div data-source-node-id="node_000876" data-source-role="header" className="js-markets-page-header-root" data-props-id="62a90l" data-render-mode="legacy">
      <div data-source-node-id="node_000877" className="marketHeader-JohAQ21X withBreadcrumbs-JohAQ21X">
        <div data-source-node-id="node_000878" className="pageHead-tCfmQCnK">
          <div data-source-node-id="node_000879" className="landingHeader-GSw4MLDp withBreadcrumbs-GSw4MLDp">
            <nav data-source-node-id="node_000880" data-source-role="nav" aria-label="Breadcrumbs" className="breadcrumbsContainer-tCAofWib breadcrumbsContainerScroll-tCAofWib">
              <ul data-source-node-id="node_000881" data-source-role="list" className="breadcrumbsList-tCAofWib breadcrumbs-GSw4MLDp">
                {economyBreadcrumbs.map((breadcrumb, index) => (
                  <li data-source-node-id={index === 0 ? "node_000882" : "node_000888"} className="breadcrumbsListItem-tCAofWib" key={breadcrumb.label}>
                    {index > 0 && (
                      <span data-source-node-id="node_000889" className="divider-eNf2O0Gx small-eNf2O0Gx" aria-hidden="true">
                        /
                      </span>
                    )}
                    <a
                      data-source-node-id={index === 0 ? "node_000883" : "node_000891"}
                      href={breadcrumb.href}
                      aria-current={breadcrumb.current ? "page" : undefined}
                      className={[
                        "breadcrumb-eNf2O0Gx apply-overflow-tooltip apply-overflow-tooltip--allow-text apply-overflow-tooltip--check-children textButton-H0Qx6L7S link-H0Qx6L7S light-gray-H0Qx6L7S small-H0Qx6L7S",
                        breadcrumb.current ? "currentPage-eNf2O0Gx dimmed-H0Qx6L7S" : "",
                      ].join(" ")}
                    >
                      <span data-source-node-id={index === 0 ? "node_000884" : "node_000892"} className="background-H0Qx6L7S states-without-bg-H0Qx6L7S" />
                      <span data-source-node-id={index === 0 ? "node_000885" : "node_000893"} className="content-H0Qx6L7S">
                        <span data-source-node-id={index === 0 ? "node_000886" : "node_000894"} className="breadcrumbContent-eNf2O0Gx">
                          {breadcrumb.label}
                        </span>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
            <h1 data-source-node-id="node_000896" className="category-GSw4MLDp category-JohAQ21X">
              Economy
            </h1>
            <div data-source-node-id="node_000898" className="container-weyhJErV">
              <div data-source-node-id="node_000899" className="btnContainer-FCpS4r4J">
                <button data-source-node-id="node_000900" className="headerBtn-FCpS4r4J">
                  <div data-source-node-id="node_000901" className="container-weyhJErV">
                    <h2 data-source-node-id="node_000902" data-source-role="header" className="header-FCpS4r4J">
                      <span data-source-node-id="node_000903" className="noBreak-HkGXK524">
                        Overview
                        <div data-source-node-id="node_000905" className="arrowWrap-FCpS4r4J">
                          <span data-source-node-id="node_000906" role="img" className="iconSmall-FCpS4r4J sf-hidden" aria-hidden="true">
                            <svg data-source-node-id="node_000907" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">
                              <AssetPath data-source-node-id="node_000908" fill="currentColor" assetPath="../assets/svg/asset_000230.path.txt" />
                            </svg>
                          </span>
                          <span data-source-node-id="node_000909" role="img" className="iconLarge-FCpS4r4J" aria-hidden="true">
                            <svg data-source-node-id="node_000910" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28">
                              <AssetPath data-source-node-id="node_000911" fill="currentColor" assetPath="../assets/svg/asset_000231.path.txt" />
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
