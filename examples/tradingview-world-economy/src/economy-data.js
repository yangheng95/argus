// GDP means Gross Domestic Product. YoY means year over year. USD means United States Dollar.
export const gdpRows = [
  { country: "India", flag: "in", growth: "7.80%", nominal: "3.91 T", currency: "USD" },
  { country: "Indonesia", flag: "id", growth: "5.61%", nominal: "1.40 T", currency: "USD" },
  { country: "Mainland China", flag: "cn", growth: "5.00%", nominal: "18.74 T", currency: "USD" },
  { country: "South Korea", flag: "kr", growth: "3.80%", nominal: "1.92 T", currency: "USD" },
  { country: "Saudi Arabia", flag: "sa", growth: "3.00%", nominal: "1.24 T", currency: "USD" },
  { country: "USA", flag: "us", growth: "2.70%", nominal: "29.18 T", currency: "USD" },
]

export const countryChips = [
  "Argentina",
  "Australia",
  "Brazil",
  "Canada",
  "European Union",
  "France",
  "Germany",
  "India",
  "Indonesia",
  "Italy",
  "Japan",
  "Mainland China",
  "Mexico",
  "Russia",
  "Saudi Arabia",
  "South Africa",
  "South Korea",
  "Turkey",
  "United Kingdom",
  "United States",
]

export const indicators = [
  {
    title: "US unemployment rate",
    code: "USUR",
    type: "bars",
    values: [4.24, 4.18, 4.28, 4.34, 4.47, 4.55, 4.52, 4.41, 4.48, 4.39, 4.43, 4.3],
    yTicks: ["0%", "2%", "4%"],
    xTicks: ["May", "Aug", "2026", "Apr"],
    actual: "4.3%",
    forecast: "-",
    nextRelease: "Jul 2, 2026",
  },
  {
    title: "US interest rate",
    code: "USINTR",
    type: "step",
    values: [0.75, 1.25, 2.45, 1.55, 0.3, 0.3, 0.3, 4.5, 5.5, 4.75, 4.25, 3.75],
    yTicks: ["0%", "2%", "4%", "6%"],
    xTicks: ["10 years"],
    actual: "3.75%",
    forecast: "-",
    nextRelease: "Jun 18, 2026",
  },
  {
    title: "US trade balance",
    code: "USBOT",
    type: "negative-bars",
    values: [-74, -50, -80, -55, -42, -25, -48, -74, -47, -52, -50, -49],
    yTicks: ["0", "-25 B", "-50 B", "-75 B"],
    xTicks: ["May", "Aug", "2026", "Apr"],
    actual: "-55.88 B",
    forecast: "-",
    nextRelease: "Jul 7, 2026",
  },
]

export const inflationBandByContinent = {
  Africa: 3,
  Asia: 2,
  Europe: 2,
  "North America": 2,
  Oceania: 2,
  "Seven seas (open ocean)": 1,
  "South America": 3,
}

export const inflationBandByISO = {
  ARG: 5,
  EGY: 4,
  IRN: 5,
  NGA: 4,
  PAK: 4,
  RUS: 2,
  TUR: 5,
  USA: 2,
  VEN: 5,
  ZAF: 3,
}

export const ideas = [
  {
    title: "$CNBOT - China Exports Hit Record High (May/2026)",
    symbol: "ECONOMICS:CNBOT",
    author: "Mr_J__fx",
    time: "22 hours ago",
    likes: "1",
    body: "China's exports surged year-on-year to a record USD 376.8 billion in May 2026, far exceeding forecasts and picking up from April.",
  },
  {
    title: "Yield Curve Inversion IHS Breakout - Recession Warning",
    symbol: "ECONOMICS:US10Y-US02Y",
    author: "jonnieking",
    time: "4 hours ago",
    likes: "1",
    body: "The yield curve inversion chart appears to have broken out of an inverse head and shoulders pattern while reclaiming the 50MA.",
  },
  {
    title: "How Food prices are affected by OIL Price",
    symbol: "ECONOMICS:FOOD",
    author: "Realisto_FX",
    time: "Jun 5",
    likes: "1",
    body: "The chart tracks the impact of oil prices on world food prices and compares current levels with historical data.",
  },
]

export const news = [
  ["US Stocks Rise Ahead of Fed Decision", "2 hours ago"],
  ["China Trade Surplus Widens as Exports Beat Forecasts", "5 hours ago"],
  ["Euro Area Bond Yields Hold Near Weekly Highs", "7 hours ago"],
]

export const calendarRows = [
  ["Jun 18", "US interest rate", "3.75%"],
  ["Jul 2", "US unemployment rate", "4.3%"],
  ["Jul 7", "US trade balance", "-55.88 B"],
]

// FAQ means Frequently Asked Questions.
export const faqRows = [
  ["What is GDP?", "GDP is the market value of final goods and services produced within an economy."],
  [
    "How is inflation shown?",
    "The map colors economies from low inflation to high inflation using the orange scale above.",
  ],
  ["Why compare nominal GDP?", "Nominal GDP keeps the ranking tied to current-price economic output in USD."],
]
