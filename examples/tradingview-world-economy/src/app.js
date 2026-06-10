import {
  calendarRows,
  countryChips,
  faqRows,
  gdpRows,
  ideas,
  indicators,
  inflationBandByContinent,
  inflationBandByISO,
  news,
} from "./economy-data.js"

const byID = (id) => document.getElementById(id)
const colorScale = ["#fff3df", "#ffdca6", "#ffb340", "#ff9500", "#ef6a00", "#e44800"]

function projectCoordinate([longitude, latitude]) {
  const width = 1160
  const height = 560
  const minLatitude = -58
  const maxLatitude = 84
  const x = ((longitude + 180) / 360) * width
  const y = ((maxLatitude - latitude) / (maxLatitude - minLatitude)) * height
  return [x, y]
}

function ringPath(ring) {
  return ring
    .map((coordinate, index) => {
      const [x, y] = projectCoordinate(coordinate)
      const command = index === 0 ? "M" : "L"
      return `${command}${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(" ")
}

function geometryPath(geometry) {
  const polygonPaths = {
    Polygon: () => geometry.coordinates.map((ring) => `${ringPath(ring)} Z`).join(" "),
    MultiPolygon: () => geometry.coordinates.flatMap((polygon) => polygon.map((ring) => `${ringPath(ring)} Z`)).join(" "),
  }
  return polygonPaths[geometry.type]()
}

function inflationBandFor(feature) {
  const iso = feature.properties.ISO_A3
  const continent = feature.properties.CONTINENT
  return inflationBandByISO[iso] ?? inflationBandByContinent[continent] ?? 1
}

async function renderInflationMap() {
  const map = byID("inflation-map")
  const geo = await fetch("./src/world-countries-110m.geojson").then((response) => response.json())
  const paths = geo.features
    .filter((feature) => feature.properties.NAME !== "Antarctica")
    .map((feature) => {
      const name = feature.properties.NAME_LONG || feature.properties.NAME
      return `<path d="${geometryPath(feature.geometry)}" fill="${colorScale[inflationBandFor(feature)]}" data-name="${name}" tabindex="0"></path>`
    })
    .join("")

  map.innerHTML = `
    <svg viewBox="0 0 1160 620" role="img" aria-label="World inflation map">
      <g class="map-regions">${paths}</g>
      <g class="map-dots" aria-hidden="true">
        <circle cx="612" cy="214" r="10"></circle><circle cx="690" cy="242" r="12"></circle>
        <circle cx="770" cy="294" r="9"></circle><circle cx="354" cy="418" r="9"></circle>
        <circle cx="528" cy="306" r="8"></circle><circle cx="646" cy="358" r="8"></circle>
      </g>
    </svg>
  `
}

function flagMarkup(code) {
  return `<span class="flag flag-${code}" aria-hidden="true"></span>`
}

function renderGdpTable() {
  byID("gdp-table").innerHTML = `
    <div class="gdp-head">
      <span>Country</span>
      <span>GDP growth</span>
      <span>Nominal GDP</span>
    </div>
    ${gdpRows
      .map(
        (row) => `
          <div class="gdp-row">
            <div class="country-cell">${flagMarkup(row.flag)}<span>${row.country}</span></div>
            <div class="number-cell">${row.growth}</div>
            <div class="number-cell nominal"><span>${row.nominal}</span><small>${row.currency}</small></div>
          </div>
        `,
      )
      .join("")}
  `
}

function pointsFor(values, width, height, max, min = 0) {
  const step = width / Math.max(values.length - 1, 1)
  return values.map((value, index) => {
    const y = height - ((value - min) / (max - min)) * height
    return [index * step, y]
  })
}

function renderBars(indicator) {
  const max = Math.max(...indicator.values) * 1.12
  return `
    <div class="chart bars-chart">
      ${indicator.values
        .map((value) => `<span style="height:${Math.max(8, (value / max) * 86)}%" title="${value}"></span>`)
        .join("")}
    </div>
  `
}

function renderNegativeBars(indicator) {
  const max = Math.max(...indicator.values.map((value) => Math.abs(value))) * 1.08
  return `
    <div class="chart negative-chart">
      <div class="zero-line"></div>
      ${indicator.values
        .map((value) => `<span style="height:${Math.max(10, (Math.abs(value) / max) * 86)}%" title="${value}"></span>`)
        .join("")}
    </div>
  `
}

function renderStepLine(indicator) {
  const points = pointsFor(indicator.values, 320, 104, 6)
  const path = points
    .map((point, index) => {
      const previous = points[index - 1]
      return index === 0 ? `M ${point[0]} ${point[1]}` : `H ${point[0]} V ${point[1]}`
    })
    .join(" ")
  return `
    <div class="chart line-chart">
      <svg viewBox="0 0 340 118" role="img" aria-label="${indicator.title} chart">
        <g class="grid-lines"><line x1="4" x2="336" y1="8" y2="8"></line><line x1="4" x2="336" y1="43" y2="43"></line><line x1="4" x2="336" y1="78" y2="78"></line><line x1="4" x2="336" y1="112" y2="112"></line></g>
        <path class="step-path" d="${path}" transform="translate(10 2)"></path>
      </svg>
    </div>
  `
}

function chartFor(indicator) {
  const chartRenderers = {
    bars: renderBars,
    step: renderStepLine,
    "negative-bars": renderNegativeBars,
  }
  return chartRenderers[indicator.type](indicator)
}

function renderIndicators() {
  byID("indicator-grid").innerHTML = indicators
    .map(
      (indicator) => `
        <article class="card indicator-card">
          <h3>${indicator.title} <span>${indicator.code}</span></h3>
          <div class="chart-wrap">
            ${chartFor(indicator)}
            <div class="axis-labels">${indicator.yTicks.map((tick) => `<span>${tick}</span>`).join("")}</div>
          </div>
          <div class="x-labels">${indicator.xTicks.map((tick) => `<span>${tick}</span>`).join("")}</div>
          <div class="metric-row">
            <div><span>Actual</span><strong>${indicator.actual}</strong></div>
            <div><span>Forecast</span><strong>${indicator.forecast}</strong></div>
            <div><span>Next release</span><strong>${indicator.nextRelease}</strong></div>
          </div>
        </article>
      `,
    )
    .join("")
}

function renderCountries() {
  byID("country-chips").innerHTML = countryChips.map((country) => `<a href="#">${country}</a>`).join("")
}

function renderIdeas() {
  byID("ideas-list").innerHTML = ideas
    .map(
      (idea) => `
        <article class="idea-row">
          <div class="idea-thumb"><span></span></div>
          <div>
            <p class="symbol">${idea.symbol}</p>
            <h3>${idea.title}</h3>
            <p>${idea.body}</p>
            <div class="idea-meta">by ${idea.author}<span>${idea.time}</span><span>${idea.likes}</span></div>
          </div>
        </article>
      `,
    )
    .join("")
}

function renderNews() {
  byID("news-list").innerHTML = news
    .map(([title, time]) => `<a class="news-row" href="#"><span>${title}</span><small>${time}</small></a>`)
    .join("")
}

function renderCalendar() {
  byID("calendar-list").innerHTML = calendarRows
    .map(([date, event, value]) => `<div class="calendar-row"><strong>${date}</strong><span>${event}</span><em>${value}</em></div>`)
    .join("")
}

function renderFAQ() {
  byID("faq-list").innerHTML = faqRows
    .map(([question, answer]) => `<details><summary>${question}</summary><p>${answer}</p></details>`)
    .join("")
}

await renderInflationMap()
renderGdpTable()
renderIndicators()
renderCountries()
renderIdeas()
renderNews()
renderCalendar()
renderFAQ()
