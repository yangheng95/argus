export const economyBreadcrumbs = [
  {
    label: "Markets",
    href: "https://www.tradingview.com/markets/",
    current: false,
  },
  {
    label: "Economy",
    href: "https://www.tradingview.com/markets/world-economy/",
    current: true,
  },
] as const

export const worldEconomyTabs = [
  { id: "countries", label: "Countries", selected: true },
  { id: "ideas", label: "Ideas", selected: false },
  { id: "economic-indicators-heatmap", label: "Economic indicators heatmap", selected: false },
  { id: "main-indicators", label: "Main indicators", selected: false },
  { id: "global-inflation-map", label: "Global industrial map", selected: false },
  { id: "news", label: "News", selected: false },
  { id: "economic-calendar", label: "Economic Calendar", selected: false },
  { id: "faq", label: "FAQ", selected: false },
] as const
