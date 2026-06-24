import fs from "node:fs/promises"
import path from "node:path"
import { createHash } from "node:crypto"
import { parseDocument } from "htmlparser2"
import { GENERATED_FRONTEND_PACKAGE_PROFILE } from "./frontend-package-profile"

export interface GenerateWebCloneSourceProjectInput {
  webpageEvidenceDir: string
  outputDir: string
  framework?: "react"
  packageName?: string
  overwrite?: boolean
}

export interface GenerateWebCloneSourceProjectOutput {
  framework: "react"
  webpageEvidenceDir: string
  outputDir: string
  visualIterationMatrix: string
  files: string[]
  stats: {
    textSignalCount: number
    componentCount: number
    tableCount: number
    listCount: number
    cardCount: number
    repeatedGroupCount: number
    assetRefCount: number
    copiedCssFiles: number
  }
}

export interface SourceProjectVisualIterationViewport {
  name: string
  width: number
  height: number
  evidenceRole: "primary_reference" | "responsive_review"
  evidenceSource: "capture_viewport" | "reference_manifest" | "matching_reference" | "default"
  referenceImage?: string
  comparison: string
}

export interface SourceProjectVisualIteration {
  referenceImage: string
  evidenceMethod: "task_scoped_preview_screenshots"
  viewportMatrix: SourceProjectVisualIterationViewport[]
  rule: string
}

const DEFAULT_SOURCE_PROJECT_PRIMARY_VIEWPORT = {
  width: 1440,
  height: 900,
  evidenceSource: "default" as const,
}

export const SOURCE_PROJECT_VISUAL_ITERATION_VIEWPORTS: SourceProjectVisualIterationViewport[] =
  buildSourceProjectVisualIterationViewports(DEFAULT_SOURCE_PROJECT_PRIMARY_VIEWPORT)

function buildSourceProjectVisualIterationViewports(primary: {
  width: number
  height: number
  evidenceSource: SourceProjectVisualIterationViewport["evidenceSource"]
}): SourceProjectVisualIterationViewport[] {
  return [
    {
      name: "desktop-reference",
      width: primary.width,
      height: primary.height,
      evidenceRole: "primary_reference",
      evidenceSource: primary.evidenceSource,
      comparison:
        "Capture and inspect a task-scoped preview screenshot against web-clone-source/reference.png after each region replacement.",
    },
    {
      name: "wide-review",
      width: 1920,
      height: 1080,
      evidenceRole: "responsive_review",
      evidenceSource: "default",
      comparison:
        "Capture and inspect the root app at this viewport; use matching reference evidence when it exists, otherwise record the evidence gap.",
    },
  ]
}

export function renderSourceProjectVisualIterationMatrix(
  viewports: readonly SourceProjectVisualIterationViewport[] = SOURCE_PROJECT_VISUAL_ITERATION_VIEWPORTS,
): string {
  return viewports
    .map(
      (viewport) =>
        `${viewport.name} ${viewport.width}x${viewport.height} (${viewport.evidenceRole}, ${viewport.evidenceSource}${viewport.referenceImage ? `, ${viewport.referenceImage}` : ""}): ${viewport.comparison}`,
    )
    .join(" ")
}

interface SourceTable {
  title?: string
  headers: string[]
  rows: string[][]
}

interface SourceList {
  title?: string
  items: string[]
}

interface SourceCard {
  title?: string
  fields: Array<{ label?: string; value: string }>
  text: string[]
}

interface SourceRepeatedGroup {
  title?: string
  sampleTexts: string[]
}

interface SourceComponentPattern {
  nodeId: string
  kind?: string
  recommendedReplacementKind?: SourceDomReplacementPlanItem["replacementKind"]
  signals?: Record<string, unknown>
}

interface SourceComponent {
  name: string
  kind?: string
  tag?: string
  classNames: string[]
  textPreview: string[]
}

interface SourceAssetRef {
  id: string
  kind: string
  path: string
  mime?: string
  semanticRole?: string
  preview?: string
  bytes?: number
}

interface SourceProjectData {
  textSignals: string[]
  components: SourceComponent[]
  tables: SourceTable[]
  lists: SourceList[]
  cards: SourceCard[]
  repeatedGroups: SourceRepeatedGroup[]
  sourceComponentPatterns: SourceComponentPattern[]
  assets: SourceAssetRef[]
}

interface DomNode {
  type?: string
  name?: string
  data?: string
  attribs?: Record<string, string>
  children?: DomNode[]
}

interface ExtractedPublicAsset {
  relativePath: string
  bytes: Uint8Array
}

interface DocumentContext {
  htmlAttrs: Record<string, string>
  bodyAttrs: Record<string, string>
}

interface SourceDomRenderProject {
  sourceDomPage: string
  regionFiles: Map<string, string>
  regionMetrics: SourceDomRegionMetric[]
  semanticReplacementMetrics: SemanticSourceReplacementMetric[]
  svgAssetGroups: Map<string, SourceSvgAssetGroupItem[]>
  faqGroups: Map<string, SourceFaqGroup>
}

interface SourceDomRegionMetric {
  componentName: string
  filePath: string
  sourceNodeId?: string
  sourceSegmentId?: string
  sourceBounds?: SourceBounds
  sourceComponentPattern?: SourceComponentPattern
  tag: string
  heading?: string
  textPreview: string
  elementCount: number
  bytes: number
  replacementPriority: "low" | "medium" | "high"
}

interface SourceDomReplacementPlanItem {
  regionComponentName: string
  regionFilePath: string
  priority: SourceDomRegionMetric["replacementPriority"]
  recommendedComponentName: string
  replacementKind:
    | "map_or_chart_asset_component"
    | "data_table_or_heatmap_component"
    | "card_collection_component"
    | "faq_disclosure_component"
    | "navigation_or_footer_component"
    | "event_or_news_list_component"
    | "baseline_defer"
  problem: string
  sourceMap: {
    sourceNodeId?: string
    sourceSegmentId?: string
    bounds?: SourceBounds
    domRegion: string
    styleSources: string[]
    dataSources: string[]
    assetSources: string[]
    visualSources: string[]
  }
  reusableSources: string[]
  dataSources: string[]
  assetSources: string[]
  generatedCleanupTargets: string[]
  verticalSliceSteps: string[]
  firstReplacementStep: string
  parityGuard: string
}

interface SourceBounds {
  x: number
  y: number
  w: number
  h: number
}

interface SemanticSourceReplacementMetric {
  componentName: string
  filePath: string
  sourceRegionComponentName: string
  sourceNodeId?: string
  rootQaId?: string
  replacementKind:
    | "event_or_news_list_component"
    | "data_table_or_heatmap_component"
    | "navigation_or_footer_component"
    | "map_or_chart_asset_component"
    | "faq_disclosure_component"
    | "card_collection_component"
    | "metric_chart_card_component"
  itemCount: number
  bytes: number
  rootClassName: string
  gridClassName?: string
  tableClassName?: string
  cardContainerClassName?: string
  mapPathCount?: number
  textPreview: string
}

interface SemanticMetricChartCard {
  componentName: string
  rootClassName: string
  rootSourceNodeId?: string
  rootStyle?: Record<string, string>
  headerClassName: string
  linkHref: string
  linkClassName: string
  titleClassName: string
  titleTooltip?: string
  title: string
  tickerClassName: string
  ticker: string
  contentClassName: string
  chartShellClassName: string
  chartFrame?: SemanticChartNode
  statsWrapperClassName: string
  statsContainerClassName: string
  stats: SemanticMetricChartStat[]
}

interface SemanticChartNode {
  tagName: "table" | "tbody" | "tr" | "td" | "div" | "canvas"
  className: string
  style?: Record<string, string>
  width?: string
  height?: string
  children: SemanticChartNode[]
}

interface SemanticMetricChartStat {
  wrapperClassName: string
  labelClassName: string
  label: string
  valueClassName: string
  value: string
  valueInnerClassName: string
}

interface SourceSvgAssetGroupItem {
  assetPath: string
  [attribute: string]: unknown
}

interface SourceFaqGroup {
  title: string
  titleId?: string
  classes: {
    container: string
    header: string
    headerWrapper: string
    titleAndHintWrapper: string
    titleContainer: string
    title: string
    content: string
    wrapper: string
    column: string
    item: string
    summary: string
    summaryLine: string
    background: string
    summaryText: string
    iconPresentation: string
    iconWrapper: string
    iconHorizontal: string
    iconVertical: string
    detailsWrapper: string
    details: string
  }
  dataAttributes: {
    containerName?: string
    widgetId?: string
    contentQaId?: string
  }
  columns: SourceFaqItem[][]
}

interface SourceFaqItem {
  question: string
  answerText: string
  links: Array<{ href: string; label: string }>
  order?: string
  itemClassName?: string
  summaryId?: string
  detailsId?: string
}

interface SourceDomRenderContext {
  previewImagePaths: string[]
  previewImageIndex: number
  nodeStyleFallbacks: Map<string, string>
  nodeBoundsById: Map<string, SourceBounds>
  irChildrenByNodeId: Map<string, DomNode[]>
  sourceComponentPatternsByNodeId: Map<string, SourceComponentPattern>
  regionFiles: Map<string, string>
  regionMetrics: SourceDomRegionMetric[]
  semanticReplacementMetrics: SemanticSourceReplacementMetric[]
  regionNameCounts: Map<string, number>
  svgAssetGroups: Map<string, SourceSvgAssetGroupItem[]>
  svgAssetGroupCount: number
  faqGroups: Map<string, SourceFaqGroup>
  faqGroupCount: number
  currentImports: Map<string, string>
  currentSvgAssetGroupNames: Set<string>
  currentImportPrefix: string
  extractRegions: boolean
  regionDepth: number
  maxRegionDepth: number
  maxRegionCount: number
  omitSourceProvenanceAttributes: boolean
}

interface SourceRegionRenderRef {
  componentName: string
  importPath: string
}

interface SemanticNewsList {
  componentName: string
  rootClassName: string
  rootQaId?: string
  rootSourceNodeId?: string
  wrapperClassName: string
  gridClassName: string
  items: SemanticNewsItem[]
}

interface SemanticNewsItem {
  href: string
  cardClassName: string
  articleClassName: string
  containerClassName: string
  headerClassName: string
  titleClassName: string
  titleQaId?: string
  title: string
  sourceLabel: string
  dateClassName: string
  timestampTitle?: string
  logoImages: Array<{ src: string; alt: string; className: string }>
}

interface SemanticRepeatedListCollection {
  componentName: string
  rootTagName: "ul" | "ol" | "div"
  rootClassName: string
  rootSourceNodeId?: string
  items: SemanticRepeatedListItem[]
}

interface SemanticRepeatedListItem {
  id: string
  itemClassName: string
  cardClassName: string
  titleClassName: string
  metaClassName: string
  imageClassName: string
  href: string
  title: string
  meta: string
  imageSrc: string
  imageAlt: string
}

interface SemanticRepeatedListItemCandidate extends SemanticRepeatedListItem {
  sourceNode: DomNode
}

interface SemanticRepeatedListTitleCandidate {
  sourceNode: DomNode
  text: string
}

interface SemanticDataTable {
  componentName: string
  rootClassName: string
  rootDataAttrs: Record<string, string>
  rootSourceNodeId?: string
  headerClassName: string
  headerWrapperClassName: string
  titleWrapperClassName: string
  titleContainerClassName: string
  titleClassName: string
  titleId?: string
  titleHref?: string
  titleLinkClassName: string
  titleText: string
  contentClassName: string
  tableContainerClassName: string
  tableContainerStyle?: Record<string, string>
  innerContainerClassName: string
  tableClassName: string
  bodyClassName: string
  headers: SemanticDataTableHeader[]
  rows: SemanticDataTableRow[]
}

interface SemanticDataTableHeader {
  label: string
  href?: string
  thClassName: string
  anchorClassName: string
  spanClassName: string
}

interface SemanticDataTableRow {
  label: string
  href?: string
  imageSrc?: string
  imageAlt: string
  imageClassName: string
  thClassName: string
  labelLinkClassName: string
  labelClassName: string
  cells: SemanticDataTableCell[]
}

interface SemanticDataTableCell {
  value: string
  unit: string
  className: string
  contentClassName: string
  rowClassName: string
  valueClassName: string
  unitClassName: string
}

interface SemanticMetricRankingCard {
  componentName: string
  rootClassName: string
  rootSourceNodeId?: string
  rootStyle?: Record<string, string>
  wrapperClassName: string
  titleClassName: string
  titleText: string
  headerRowClassName: string
  headerLabels: string[]
  headerLabelClassName: string
  listClassName: string
  itemClassName: string
  rowOuterClassName: string
  rowInnerClassName: string
  imageClassName: string
  linkClassName: string
  titleContainerClassName: string
  labelClassName: string
  valueCellClassName: string
  valueClassName: string
  unitClassName: string
  rows: SemanticMetricRankingRow[]
}

interface SemanticMetricRankingRow {
  label: string
  href: string
  imageSrc?: string
  imageAlt: string
  values: Array<{ value: string; unit: string }>
}

interface SemanticEventCardList {
  componentName: string
  rootClassName: string
  rootDataAttrs: Record<string, string>
  rootSourceNodeId?: string
  headerClassName: string
  headerWrapperClassName: string
  titleWrapperClassName: string
  titleContainerClassName: string
  titleClassName: string
  titleId?: string
  titleHref?: string
  titleLinkClassName: string
  titleText: string
  contentClassName: string
  wrapperClassName: string
  containerClassName: string
  itemsClassName: string
  chromeClassNames: string[]
  items: SemanticEventCardItem[]
}

interface SemanticEventCardItem {
  href: string
  cardClassName: string
  topClassName: string
  dateClassName: string
  dayClassName: string
  dayText: string
  dotClassName: string
  dotText: string
  timestampWrapperClassName: string
  badgeClassName: string
  badgeContentClassName: string
  timestampTitle?: string
  titleBlockClassName: string
  flagSrc?: string
  flagClassName: string
  flagTooltip?: string
  columnClassName: string
  titleClassName: string
  title: string
  statsClassName: string
  stats: SemanticEventCardStat[]
}

interface SemanticEventCardStat {
  wrapperClassName: string
  titleClassName: string
  label: string
  valueWrapClassName: string
  valueClassName: string
  value: string
  unitClassName: string
  unit: string
}

interface SemanticFooter {
  componentName: string
  rootClassName: string
  rootSourceNodeId?: string
  dataNosnippet?: string
  promoClassName: string
  visualRootClassName: string
  containerClassName: string
  contentClassName: string
  leadingClassName: string
  logoSocialsClassName: string
  logoLink?: SemanticFooterLogoLink
  socialsClassName: string
  socialLinks: SemanticFooterLink[]
  copyrightContainerClassName: string
  languageButtonClassName: string
  copyrightClassName: string
  legalParts: SemanticFooterLegalPart[]
  footerLinksClassName: string
  linkGroups: SemanticFooterLinkGroup[]
  backgroundImageClassName: string
  lookFirstContainerClassName: string
  images: Array<{ src: string; alt: string; className: string }>
  pepeContainerClassName: string
  pepeLauncherClassName: string
  languageLabel?: string
}

interface SemanticFooterLink {
  href: string
  label: string
  ariaLabel?: string
  className: string
  target?: string
  rel?: string
  iconClassName?: string
}

interface SemanticFooterLogoLink extends SemanticFooterLink {
  markClassName: string
}

interface SemanticFooterLegalPart {
  kind: "text" | "link"
  text: string
  link?: SemanticFooterLink
}

interface SemanticFooterLinkGroup {
  className: string
  columns: SemanticFooterLinkColumn[]
}

interface SemanticFooterLinkColumn {
  className: string
  titleClassName: string
  title: string
  listClassName: string
  links: SemanticFooterLink[]
}

interface SemanticHeaderNavigation {
  componentName: string
  rootClassName: string
  rootSourceNodeId?: string
  rootDataAttrs: Record<string, string>
  backdropClassName: string
  innerClassName: string
  logoAreaClassName: string
  hamburger?: SemanticHeaderButton
  logoWrapperClassName: string
  logoLink: SemanticHeaderLink
  logoIconWrapperClassName: string
  logoIcon?: SemanticSvgIcon
  logoTextWrapperClassName: string
  logoTextIcon?: SemanticSvgIcon
  logoTextFallback?: string
  logoProClassName: string
  middleWrapperClassName: string
  middleContentClassName: string
  searchAreaClassName: string
  searchContainerClassName: string
  searchButton?: SemanticHeaderButton
  simpleSearchButton?: SemanticHeaderButton
  navClassName: string
  menuClassName: string
  menuItems: SemanticHeaderMenuItem[]
  userAreaClassName: string
  languageButton?: SemanticHeaderButton
  anonymousUserButton?: SemanticHeaderButton
  loggedUserButtonClassName: string
  offerShellClassName: string
  offerPropsId?: string
  offerRenderMode?: string
  offerContainerClassName: string
  offerLink?: SemanticHeaderLink
  offerContentClassName: string
  offerChildrenClassName: string
  offerTitleClassName: string
}

interface SemanticHeaderMenuItem {
  className: string
  dropdownRootIndex?: string
  href: string
  trackId?: string
  label: string
  chevronClassName: string
  chevronAriaLabel?: string
  chevronAriaHasPopup?: string
  chevronAriaExpanded?: string
  chevronRole?: string
  chevronIcon?: SemanticSvgIcon
}

interface SemanticHeaderButton {
  className: string
  label: string
  ariaLabel?: string
  ariaHasPopup?: string
  ariaExpanded?: string
  type?: string
  icon?: SemanticSvgIcon
  textClassName?: string
}

interface SemanticHeaderLink {
  className: string
  href: string
  label: string
  ariaLabel?: string
  target?: string
  rel?: string
}

interface SemanticSvgIcon {
  width?: string
  height?: string
  viewBox?: string
  className?: string
  fill?: string
  xmlns?: string
  preserveAspectRatio?: string
  paths: SemanticMapPath[]
  circles: Array<Record<string, unknown>>
}

interface SemanticMapSurface {
  componentName: string
  rootClassName: string
  rootDataAttrs: Record<string, string>
  rootSourceNodeId?: string
  rootStyle?: Record<string, string>
  bodyWrapperFrame?: SemanticElementFrame
  headerClassName: string
  headerWrapperClassName: string
  titleWrapperClassName: string
  titleContainerClassName: string
  titleClassName: string
  titleId?: string
  titleHref?: string
  titleLinkClassName: string
  titleText: string
  contentClassName: string
  mapContainerClassName: string
  mapWrapperClassName: string
  mapClassName: string
  mapFrameNodes: SemanticElementFrame[]
  svgViewBox: string
  svgClassName: string
  legend?: SemanticMapLegend
  legendLabels: string[]
  paths: SemanticMapPath[]
  footerLink?: SemanticFooterLink
}

interface SemanticMapLegend {
  containerFrame: SemanticElementFrame
  toolbarFrame?: SemanticElementFrame
  svg: SemanticSvgRoot
  items: SemanticMapLegendItem[]
}

interface SemanticSvgRoot {
  width?: string
  height?: string
  viewBox?: string
  fill?: string
  className?: string
  style?: Record<string, string>
}

interface SemanticMapLegendItem {
  className: string
  dataAttrs: Record<string, string>
  tooltipClassName: string
  tooltipTitle?: string
  rect?: Record<string, unknown>
  figureGroupClassName: string
  paths: SemanticMapPath[]
  text?: SemanticMapLegendText
}

interface SemanticMapLegendText {
  className: string
  x?: string
  y?: string
  label: string
  tspans: Array<Record<string, unknown>>
}

interface SemanticElementFrame {
  tagName: string
  className: string
  dataAttrs: Record<string, string>
  style?: Record<string, string>
  id?: string
  semanticRole?: string
}

interface SemanticMapPath {
  assetPath: string
  [attribute: string]: unknown
}

interface SemanticLinkGrid {
  componentName: string
  replacementKind: SemanticSourceReplacementMetric["replacementKind"]
  rootClassName: string
  rootDataAttrs: Record<string, string>
  rootSourceNodeId?: string
  headerClassName: string
  headerWrapperClassName: string
  titleWrapperClassName: string
  titleContainerClassName: string
  titleClassName: string
  titleId?: string
  titleHref?: string
  titleLinkClassName: string
  titleText: string
  contentClassName: string
  linksContainerClassName: string
  links: SemanticFooterLink[]
}

interface SemanticIdeaCardCollection {
  componentName: string
  rootClassName: string
  rootDataAttrs: Record<string, string>
  rootSourceNodeId?: string
  rootStyle?: Record<string, string>
  headerClassName: string
  headerWrapperClassName: string
  titleWrapperClassName: string
  titleContainerClassName: string
  titleClassName: string
  titleId?: string
  titleHref?: string
  titleLinkClassName: string
  titleText: string
  contentClassName: string
  contentQaId?: string
  tabsContainerClassName: string
  tabsScrollWrapClassName: string
  tabsScrollWrapDataName?: string
  tabsScrollWrapStyle?: Record<string, string>
  tabsListId?: string
  tabsListClassName: string
  tabsListOrientation?: string
  tabs: SemanticSectionTab[]
  cardsWrapperClassName: string
  filmstripContainerClassName: string
  itemsClassName: string
  chromeItems: SemanticIdeaChromeItem[]
  cards: SemanticIdeaCard[]
  moreLink?: SemanticIdeaMoreLink
}

interface SemanticIdeaChromeItem {
  className: string
  style?: Record<string, string>
}

interface SemanticIdeaCard {
  rootClassName: string
  rootStyle?: Record<string, string>
  textBlockClassName: string
  textBlockStyle?: Record<string, string>
  href: string
  titleClassName: string
  titleQaId?: string
  title: string
  paragraphClassName: string
  paragraphQaId?: string
  paragraphContainerClassName: string
  paragraphContentClassName: string
  paragraph: string
  previewClassName: string
  previewFallbackImageSrc?: string
  previewGridClassName: string
  previewChromeClassNames: string[]
  previewBadgeRowClassName: string
  logoLink?: SemanticIdeaLogoLink
  strategyBadge?: SemanticIdeaStrategyBadge
  imageLinkClassName: string
  imagePictureClassName: string
  imageSrc?: string
  imageClassName: string
  imageStyle?: Record<string, string>
  metaRowClassName: string
  publicationInfoClassName: string
  authorWrapClassName: string
  authorHref?: string
  authorLinkClassName: string
  authorClassName: string
  author: string
  dateWrapClassName: string
  dateClassName: string
  dateTitle?: string
  date: string
  buttonsClassName: string
  commentHref?: string
  commentClassName: string
  commentAriaLabel?: string
  likeClassName: string
  likeAriaLabel?: string
  likeCountWrapClassName: string
  likeDigitGridClassName: string
  likeDigitClassName: string
  likeCount: string
}

interface SemanticIdeaLogoLink {
  className: string
  href: string
  title?: string
  qaId?: string
  imageClassName: string
  imageSrc: string
  imageAlt: string
}

interface SemanticIdeaStrategyBadge {
  className: string
  title?: string
  iconClassName: string
  labelClassName: string
  label: string
  icon?: SemanticSvgIcon
}

interface SemanticIdeaMoreLink {
  className: string
  href: string
  style?: Record<string, string>
  contentClassName: string
  wrapClassName: string
  textClassName: string
  label: string
  arrowClassName: string
  icon?: SemanticSvgIcon
}

interface SemanticSectionShell {
  componentName: string
  replacementKind: SemanticSourceReplacementMetric["replacementKind"]
  rootClassName: string
  rootDataAttrs: Record<string, string>
  rootSourceNodeId?: string
  rootStyle?: Record<string, string>
  headerClassName: string
  headerWrapperClassName: string
  titleWrapperClassName: string
  titleContainerClassName: string
  titleClassName: string
  titleId?: string
  titleHref?: string
  titleLinkClassName: string
  titleText: string
  contentClassName: string
  tabsContainerClassName: string
  tabs: SemanticSectionTab[]
  footerLink?: SemanticFooterLink
  children: SemanticSectionChild[]
}

interface SemanticSectionTab {
  tagName: "a" | "button"
  className: string
  id?: string
  href?: string
  label: string
  role?: string
  ariaSelected?: string
  ariaDisabled?: string
  ariaLabel?: string
  dataId?: string
  dataQaId?: string
}

interface SemanticSectionChild {
  componentName: string
}

const MAX_TEXT_SIGNALS = 160
const MAX_TABLES = 24
const MAX_TABLE_ROWS = 80
const MAX_LISTS = 24
const MAX_LIST_ITEMS = 80
const MAX_CARDS = 48
const MAX_REPEATED_GROUPS = 48
const MAX_ASSET_REFS = 240
const MIN_SVG_ASSET_GROUP_SIZE = 16

export async function generateWebCloneSourceProject(
  input: GenerateWebCloneSourceProjectInput,
): Promise<GenerateWebCloneSourceProjectOutput> {
  const framework = input.framework ?? "react"
  if (framework !== "react") throw new Error(`Unsupported web clone source framework: ${framework}`)

  const webpageEvidenceDir = path.resolve(input.webpageEvidenceDir)
  const outputDir = path.resolve(input.outputDir)
  await assertWebpageEvidenceInputs(webpageEvidenceDir)
  await prepareOutputDir(outputDir, input.overwrite === true)

  const [sourceSkeleton, rawCriticalCss, rawFullSourceCss, contentModel, componentTree, assetManifest, pageIr] =
    await Promise.all([
      readText(path.join(webpageEvidenceDir, "source-skeleton", "index.html")),
      readOptionalText(path.join(webpageEvidenceDir, "source-skeleton", "critical.css")),
      readOptionalText(path.join(webpageEvidenceDir, "source-skeleton", "full-source.css")),
      readJsonOptional(path.join(webpageEvidenceDir, "source-ir", "content-model.json")),
      readJsonOptional(path.join(webpageEvidenceDir, "source-ir", "component-tree.json")),
      readJsonOptional(path.join(webpageEvidenceDir, "assets", "manifest.json")),
      readJsonOptional(path.join(webpageEvidenceDir, "page.ir.json")),
    ])
  const extractedAssets = new Map<string, ExtractedPublicAsset>()
  const criticalCss = sanitizeCssSidecar(rawCriticalCss, extractedAssets)
  const fullSourceCss = sanitizeCssSidecar(rawFullSourceCss, extractedAssets)
  const projectData = buildSourceProjectData({ sourceSkeleton, contentModel, componentTree, assetManifest })
  const previewImagePaths = await readPreviewImagePaths(webpageEvidenceDir)
  const nodeStyleFallbacks = extractNodeStyleFallbacks(pageIr)
  const nodeBoundsById = extractNodeBounds(pageIr)
  const irChildrenByNodeId = extractIrChildrenByNodeId(pageIr)
  const documentContext = extractDocumentContext(pageIr)
  const svgPaths = await readSvgPathData(webpageEvidenceDir)
  const sourceDomProject = renderSourceDomProject(
    sourceSkeleton,
    previewImagePaths,
    nodeStyleFallbacks,
    nodeBoundsById,
    irChildrenByNodeId,
    projectData.sourceComponentPatterns,
  )
  const replacementPlan = buildSourceDomReplacementPlan(sourceDomProject.regionMetrics, projectData)
  const visualIteration = await buildSourceProjectVisualIteration(webpageEvidenceDir)

  const packageName = normalizePackageName(input.packageName ?? `web-clone-${path.basename(outputDir)}`)
  const files = new Map<string, string>()
  files.set("package.json", renderPackageJson(packageName))
  files.set("tsconfig.json", renderTsconfigJson())
  files.set("index.html", renderIndexHtml(documentContext))
  files.set("README.md", renderReadme(webpageEvidenceDir, visualIteration))
  files.set("vite.config.ts", renderViteConfigTs())
  files.set("src/vite-env.d.ts", renderViteEnvDts())
  files.set("src/main.tsx", renderMainTsx())
  files.set("src/App.tsx", renderAppTsx())
  files.set("src/components/SourceClonePage.tsx", renderSourceClonePageTsx())
  files.set("src/components/SourceDomPage.tsx", sourceDomProject.sourceDomPage)
  for (const [relativePath, content] of sourceDomProject.regionFiles) files.set(relativePath, content)
  files.set("src/components/AssetPath.tsx", renderAssetPathTsx())
  files.set("src/components/SourceAssetPathGroup.tsx", renderSourceAssetPathGroupTsx())
  files.set("src/components/SourceFaqList.tsx", renderSourceFaqListTsx())
  files.set("src/components/ContentTable.tsx", renderContentTableTsx())
  files.set("src/data/sourceDomRegions.ts", renderSourceDomRegionsTs(sourceDomProject.regionMetrics))
  files.set("src/data/sourceDomReplacementPlan.ts", renderSourceDomReplacementPlanTs(replacementPlan))
  files.set(
    "src/data/sourceDomIterationState.ts",
    renderSourceDomIterationStateTs(
      sourceDomProject.regionMetrics,
      replacementPlan,
      sourceDomProject.semanticReplacementMetrics,
      visualIteration,
    ),
  )
  files.set("src/data/sourceSvgAssetGroups.ts", renderSourceSvgAssetGroupsTs(sourceDomProject.svgAssetGroups))
  files.set("src/data/sourceFaqGroups.ts", renderSourceFaqGroupsTs(sourceDomProject.faqGroups))
  files.set("src/data/svgPaths.ts", renderSvgPathsTs(svgPaths))
  files.set("src/data/sourceData.ts", renderSourceDataTs(projectData))
  files.set(
    "src/styles.css",
    renderStylesCss({ hasCriticalCss: criticalCss.length > 0, hasFullCss: fullSourceCss.length > 0 }),
  )
  if (criticalCss.length > 0) files.set("src/styles/source-critical.css", criticalCss)
  if (fullSourceCss.length > 0) files.set("src/styles/source-full.css", fullSourceCss)

  for (const [relativePath, content] of files) {
    await writeFile(path.join(outputDir, relativePath), content)
  }
  await copyPublicAssets(webpageEvidenceDir, outputDir, extractedAssets)
  const copiedReferenceFiles = await copyReferenceImage(webpageEvidenceDir, outputDir)
  await writeJson(path.join(outputDir, "src/data/sourceProjectManifest.json"), {
    version: 1,
    purpose: "web-clone-source-project",
    webpageEvidenceDir,
    generatedFrom: [
      "source-skeleton/index.html",
      "source-skeleton/critical.css",
      "source-skeleton/full-source.css",
      "source-ir/content-model.json",
      "source-ir/component-tree.json",
      "source-ir/style-profile.json",
      "assets/manifest.json",
    ],
    sourceDomRegions: {
      count: sourceDomProject.regionMetrics.length,
      largestBytes: Math.max(0, ...sourceDomProject.regionMetrics.map((region) => region.bytes)),
      highPriorityCount: sourceDomProject.regionMetrics.filter((region) => region.replacementPriority === "high")
        .length,
      metricsModule: "src/data/sourceDomRegions.ts",
      replacementPlanModule: "src/data/sourceDomReplacementPlan.ts",
      replacementPlanCount: replacementPlan.length,
      iterationStateModule: "src/data/sourceDomIterationState.ts",
      semanticReplacementCount: sourceDomProject.semanticReplacementMetrics.length,
      svgAssetGroupModule: "src/data/sourceSvgAssetGroups.ts",
      svgAssetGroupCount: sourceDomProject.svgAssetGroups.size,
      faqGroupModule: "src/data/sourceFaqGroups.ts",
      faqGroupCount: sourceDomProject.faqGroups.size,
    },
    semanticReplacements: {
      count: sourceDomProject.semanticReplacementMetrics.length,
      iterationStateModule: "src/data/sourceDomIterationState.ts",
      components: sourceDomProject.semanticReplacementMetrics.map((item) => item.componentName),
    },
    visualIteration,
    rules: [
      "Use sourceData.ts and framework components as the editable implementation surface.",
      "Do not render reference.png, screenshot files, base64 payloads, or hidden semantic coverage layers as the clone.",
      "Use reference.png only as task-scoped desktop visual validation evidence.",
    ],
  })

  const writtenFiles = [...files.keys(), "src/data/sourceProjectManifest.json", ...copiedReferenceFiles].sort()

  return {
    framework,
    webpageEvidenceDir,
    outputDir,
    visualIterationMatrix: renderSourceProjectVisualIterationMatrix(visualIteration.viewportMatrix),
    files: writtenFiles.map((file) => path.join(outputDir, file)),
    stats: {
      textSignalCount: projectData.textSignals.length,
      componentCount: projectData.components.length,
      tableCount: projectData.tables.length,
      listCount: projectData.lists.length,
      cardCount: projectData.cards.length,
      repeatedGroupCount: projectData.repeatedGroups.length,
      assetRefCount: projectData.assets.length,
      copiedCssFiles: [criticalCss, fullSourceCss].filter(Boolean).length,
    },
  }
}

function buildSourceProjectData(input: {
  sourceSkeleton: string
  contentModel: unknown
  componentTree: unknown
  assetManifest: unknown
}): SourceProjectData {
  const tables = readTables(input.contentModel)
  const lists = readLists(input.contentModel)
  const cards = readCards(input.contentModel)
  const repeatedGroups = readRepeatedGroups(input.contentModel)
  const sourceComponentPatterns = readSourceComponentPatterns(input.contentModel)
  const components = readComponents(input.componentTree)
  const assets = readAssetRefs(input.assetManifest)
  const textSignals = rankTextSignals([
    ...collectVisibleStrings(input.contentModel),
    ...components.flatMap((component) => [component.name, ...component.textPreview]),
    ...tables.flatMap((table) => [...table.headers, ...table.rows.flat()]),
    ...lists.flatMap((list) => list.items),
    ...cards.flatMap((card) => [...card.text, ...card.fields.map((field) => field.value)]),
    ...repeatedGroups.flatMap((group) => group.sampleTexts),
    ...collectSkeletonText(input.sourceSkeleton),
  ]).slice(0, MAX_TEXT_SIGNALS)

  return {
    textSignals,
    components,
    tables,
    lists,
    cards,
    repeatedGroups,
    sourceComponentPatterns,
    assets,
  }
}

function extractNodeStyleFallbacks(pageIr: unknown): Map<string, string> {
  const styles = new Map<string, string>()

  function visit(value: unknown): void {
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    if (!value || typeof value !== "object") return
    const row = value as Record<string, unknown>
    if (typeof row.id === "string" && Array.isArray(row.attrs)) {
      const styleAttr = row.attrs.find((attr) => {
        const attrRow = attr && typeof attr === "object" ? (attr as Record<string, unknown>) : {}
        return attrRow.name === "style" && typeof attrRow.value === "string"
      }) as Record<string, unknown> | undefined
      if (typeof styleAttr?.value === "string") {
        styles.set(row.id, normalizeStyleAssetUrls(styleAttr.value))
      }
    }
    if (row.root) visit(row.root)
    if (Array.isArray(row.children)) {
      for (const child of row.children) visit(child)
    }
  }

  visit(pageIr)
  return styles
}

function extractNodeBounds(pageIr: unknown): Map<string, SourceBounds> {
  const boundsById = new Map<string, SourceBounds>()

  function visit(value: unknown): void {
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    if (!value || typeof value !== "object") return
    const row = value as Record<string, unknown>
    const bounds = asSourceBounds((row.layout as Record<string, unknown> | undefined)?.bounds)
    if (typeof row.id === "string" && bounds) boundsById.set(row.id, bounds)
    if (row.root) visit(row.root)
    if (Array.isArray(row.children)) {
      for (const child of row.children) visit(child)
    }
  }

  visit(pageIr)
  return boundsById
}

function asSourceBounds(value: unknown): SourceBounds | undefined {
  if (!value || typeof value !== "object") return undefined
  const row = value as Record<string, unknown>
  const x = typeof row.x === "number" ? row.x : undefined
  const y = typeof row.y === "number" ? row.y : undefined
  const w = typeof row.w === "number" ? row.w : undefined
  const h = typeof row.h === "number" ? row.h : undefined
  if (x === undefined || y === undefined || w === undefined || h === undefined) return undefined
  return { x, y, w, h }
}

function extractDocumentContext(pageIr: unknown): DocumentContext {
  return {
    htmlAttrs: {
      lang: "en",
      dir: "ltr",
      class: "is-not-authenticated is-not-pro theme-light feature-no-touch feature-no-mobiletouch",
      "data-theme": "light",
      ...extractElementAttrs(pageIr, "html"),
    },
    bodyAttrs: {
      class: "search-page index-page",
      ...extractElementAttrs(pageIr, "body"),
    },
  }
}

function extractElementAttrs(pageIr: unknown, tagName: string): Record<string, string> {
  const node = findIrElement(pageIr, tagName)
  return node ? irAttrsToDomAttribs(node.attrs) : {}
}

function findIrElement(value: unknown, tagName: string): Record<string, unknown> | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findIrElement(item, tagName)
      if (found) return found
    }
    return undefined
  }
  if (!value || typeof value !== "object") return undefined
  const row = value as Record<string, unknown>
  if (row.type === "element" && row.tag === tagName) return row
  if (row.root) {
    const found = findIrElement(row.root, tagName)
    if (found) return found
  }
  if (Array.isArray(row.children)) {
    for (const child of row.children) {
      const found = findIrElement(child, tagName)
      if (found) return found
    }
  }
  return undefined
}

function extractIrChildrenByNodeId(pageIr: unknown): Map<string, DomNode[]> {
  const childrenById = new Map<string, DomNode[]>()

  function visit(value: unknown): void {
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    if (!value || typeof value !== "object") return
    const row = value as Record<string, unknown>
    if (typeof row.id === "string" && Array.isArray(row.children)) {
      const children = row.children
        .map((child) => domNodeFromIrNode(child))
        .filter((child): child is DomNode => Boolean(child))
      if (children.length > 0) childrenById.set(row.id, children)
    }
    if (row.root) visit(row.root)
    if (Array.isArray(row.children)) {
      for (const child of row.children) visit(child)
    }
  }

  visit(pageIr)
  return childrenById
}

function domNodeFromIrNode(value: unknown): DomNode | undefined {
  if (!value || typeof value !== "object") return undefined
  const row = value as Record<string, unknown>
  if (row.type === "text") {
    return { type: "text", data: typeof row.text === "string" ? row.text : "" }
  }
  if (row.type !== "element" || typeof row.tag !== "string") return undefined
  return {
    type: "tag",
    name: row.tag,
    attribs: { "data-source-node-id": typeof row.id === "string" ? row.id : "", ...irAttrsToDomAttribs(row.attrs) },
    children: Array.isArray(row.children)
      ? row.children.map((child) => domNodeFromIrNode(child)).filter((child): child is DomNode => Boolean(child))
      : [],
  }
}

function irAttrsToDomAttribs(attrs: unknown): Record<string, string> {
  const result: Record<string, string> = {}
  if (!Array.isArray(attrs)) return result
  for (const attr of attrs) {
    const row = attr && typeof attr === "object" ? (attr as Record<string, unknown>) : undefined
    if (!row || typeof row.name !== "string") continue
    if (row.name === "d" && typeof row.assetId === "string") {
      result["data-asset-d"] = `../assets/svg/${row.assetId}.path.txt`
      continue
    }
    if (typeof row.value !== "string" || row.value.startsWith("__WEB_CLONE_ASSET_REF_")) continue
    result[row.name] = row.name === "style" ? normalizeStyleAssetUrls(row.value) : row.value
  }
  return result
}

function normalizeStyleAssetUrls(style: string): string {
  return style.replace(/url\(assets\/(asset_\d+\.(?:png|webp|jpe?g))\)/gi, 'url("/assets/images/$1")')
}

function readTables(contentModel: unknown): SourceTable[] {
  return readArray(contentModel, "tables")
    .map((item, index) => {
      const row = asRecord(item)
      const headers = readStringArray(row.headers).filter((value) => value.length > 0)
      const rows = readTableRows(row.rows).slice(0, MAX_TABLE_ROWS)
      return {
        title: readString(row.title) ?? `Table ${index + 1}`,
        headers,
        rows,
      }
    })
    .filter((table) => table.headers.length > 0 || table.rows.length > 0)
    .slice(0, MAX_TABLES)
}

function readLists(contentModel: unknown): SourceList[] {
  return readArray(contentModel, "lists")
    .map((item, index) => {
      const row = asRecord(item)
      return {
        title: readString(row.title) ?? `List ${index + 1}`,
        items: readStringArray(row.items).slice(0, MAX_LIST_ITEMS),
      }
    })
    .filter((list) => list.items.length > 0)
    .slice(0, MAX_LISTS)
}

function readCards(contentModel: unknown): SourceCard[] {
  return readArray(contentModel, "cards")
    .map((item, index) => {
      const row = asRecord(item)
      const fields: Array<{ label?: string; value: string }> = []
      for (const field of readArray(row, "fields")) {
        const fieldRow = asRecord(field)
        const value = readString(fieldRow.value) ?? readString(fieldRow.text)
        if (!value) continue
        const label = readString(fieldRow.label)
        fields.push(label ? { label, value } : { value })
      }
      return {
        title: readString(row.title) ?? `Card ${index + 1}`,
        fields,
        text: readStringArray(row.text),
      }
    })
    .filter((card) => card.fields.length > 0 || card.text.length > 0)
    .slice(0, MAX_CARDS)
}

function readRepeatedGroups(contentModel: unknown): SourceRepeatedGroup[] {
  return readArray(contentModel, "repeatedGroups")
    .map((item, index) => {
      const row = asRecord(item)
      return {
        title: readString(row.title) ?? `Repeated group ${index + 1}`,
        sampleTexts: readStringArray(row.sampleTexts).slice(0, MAX_LIST_ITEMS),
      }
    })
    .filter((group) => group.sampleTexts.length > 0)
    .slice(0, MAX_REPEATED_GROUPS)
}

function readSourceComponentPatterns(contentModel: unknown): SourceComponentPattern[] {
  return readArray(contentModel, "sourceComponentPatterns")
    .map((item): SourceComponentPattern | undefined => {
      const row = asRecord(item)
      const nodeId = readString(row.nodeId)
      const replacementKind = readSourceReplacementKind(row.recommendedReplacementKind)
      if (!nodeId) return undefined
      return {
        nodeId,
        kind: readString(row.kind),
        recommendedReplacementKind: replacementKind,
        signals: asRecord(row.signals),
      }
    })
    .filter((item): item is SourceComponentPattern => Boolean(item))
    .slice(0, 240)
}

function readSourceReplacementKind(value: unknown): SourceDomReplacementPlanItem["replacementKind"] | undefined {
  if (typeof value !== "string") return undefined
  if (
    value === "map_or_chart_asset_component" ||
    value === "data_table_or_heatmap_component" ||
    value === "card_collection_component" ||
    value === "faq_disclosure_component" ||
    value === "navigation_or_footer_component" ||
    value === "event_or_news_list_component" ||
    value === "baseline_defer"
  )
    return value
  return undefined
}

function readComponents(componentTree: unknown): SourceComponent[] {
  return readArray(componentTree, "components")
    .map((item, index) => {
      const row = asRecord(item)
      const name = readString(row.name) ?? `SourceComponent${index + 1}`
      return {
        name: toComponentName(name, index),
        kind: readString(row.kind),
        tag: readString(row.tag),
        classNames: readStringArray(row.classNames),
        textPreview: readStringArray(row.textPreview).slice(0, 24),
      }
    })
    .slice(0, 80)
}

function readAssetRefs(assetManifest: unknown): SourceAssetRef[] {
  const root = asRecord(assetManifest)
  const assets = Array.isArray(root.assets) ? root.assets : Array.isArray(assetManifest) ? assetManifest : []
  const refs: SourceAssetRef[] = []
  for (const item of assets) {
    const row = asRecord(item)
    const id = readString(row.id)
    const kind = readString(row.kind)
    const assetPath = readString(row.path)
    if (!id || !kind || !assetPath) continue
    const ref: SourceAssetRef = { id, kind, path: assetPath }
    const mime = readString(row.mime)
    const semanticRole = readString(row.semanticRole)
    const preview = sanitizeAssetPreview(readString(row.preview))
    if (mime) ref.mime = mime
    if (semanticRole) ref.semanticRole = semanticRole
    if (preview) ref.preview = preview
    if (typeof row.bytes === "number") ref.bytes = row.bytes
    refs.push(ref)
  }
  return refs.slice(0, MAX_ASSET_REFS)
}

function sanitizeCssSidecar(css: string, extractedAssets: Map<string, ExtractedPublicAsset>): string {
  if (!css) return ""
  const assetSafeCss = css
    .replace(/url\(\s*(["']?)(data:[^)]+?)\1\s*\)/gi, (_match, _quote: string, dataUrl: string) => {
      const asset = extractDataUrlAsset(dataUrl, extractedAssets)
      return asset ? `url("/${asset.relativePath}")` : 'url("")'
    })
    .replace(/data:[^"')\s]+/gi, "")
  return stripSourceProvenanceCssRules(normalizePseudoElementDirectionOrder(expandNestedAmpersandCss(assetSafeCss)))
}

function stripSourceProvenanceCssRules(css: string): string {
  let output = ""
  let index = 0
  while (index < css.length) {
    const open = css.indexOf("{", index)
    if (open === -1) {
      output += css.slice(index)
      break
    }
    const close = findMatchingBrace(css, open)
    if (close === undefined) {
      output += css.slice(index)
      break
    }
    const preludeStart = findCssPreludeStart(css, open)
    const prelude = css.slice(preludeStart, open).trim()
    output += css.slice(index, preludeStart)
    const body = css.slice(open + 1, close)
    if (prelude.startsWith("@")) {
      if (/^@(media|supports|container|layer|scope|document)\b/i.test(prelude)) {
        const cleanedBody = stripSourceProvenanceCssRules(body)
        if (cleanedBody.trim()) output += `${prelude}{${cleanedBody}}`
      } else {
        output += css.slice(preludeStart, close + 1)
      }
    } else {
      const selectors = splitCssSelectorList(prelude).filter((selector) => !isSourceProvenanceCssSelector(selector))
      if (selectors.length > 0) output += `${selectors.join(", ")}{${body}}`
    }
    index = close + 1
  }
  return output
}

function splitCssSelectorList(selectorText: string): string[] {
  const selectors: string[] = []
  let current = ""
  let bracketDepth = 0
  let parenDepth = 0
  for (const char of selectorText) {
    if (char === "[") bracketDepth += 1
    if (char === "]" && bracketDepth > 0) bracketDepth -= 1
    if (char === "(") parenDepth += 1
    if (char === ")" && parenDepth > 0) parenDepth -= 1
    if (char === "," && bracketDepth === 0 && parenDepth === 0) {
      const selector = current.trim()
      if (selector) selectors.push(selector)
      current = ""
      continue
    }
    current += char
  }
  const selector = current.trim()
  if (selector) selectors.push(selector)
  return selectors
}

function isSourceProvenanceCssSelector(selector: string): boolean {
  return /\[data-source-(?:node-id|segment-id)\b/i.test(selector)
}

function normalizePseudoElementDirectionOrder(css: string): string {
  return css.replace(
    /(::?)(before|after):dir\(([^)]+)\)/g,
    (_match, pseudoPrefix: string, pseudoName: string, dir: string) => `:dir(${dir})${pseudoPrefix}${pseudoName}`,
  )
}

function expandNestedAmpersandCss(css: string): string {
  const expandedNestedBlocks = expandNestedAmpersandBlocks(css)
  return expandedNestedBlocks.replace(
    /([^{}@&][^{}]*?)\{([^{}&]*?)\}\s*&([^{}]+?)\{([^{}]*?)\};?\}/g,
    (_match, selector: string, declarations: string, nestedSelector: string, nestedDeclarations: string) => {
      const baseSelector = selector.trim()
      return `${baseSelector}{${declarations}}\n${baseSelector}${nestedSelector.trim()}{${nestedDeclarations}}`
    },
  )
}

function expandNestedAmpersandBlocks(css: string): string {
  let output = ""
  let index = 0
  while (index < css.length) {
    const open = css.indexOf("{", index)
    if (open === -1) {
      output += css.slice(index)
      break
    }
    const close = findMatchingBrace(css, open)
    if (close === undefined) {
      output += css.slice(index)
      break
    }
    const preludeStart = findCssPreludeStart(css, open)
    const prelude = css.slice(preludeStart, open).trim()
    output += css.slice(index, preludeStart)
    const body = css.slice(open + 1, close)
    if (prelude.startsWith("@")) {
      output += `${prelude}{${expandNestedAmpersandBlocks(body)}}`
    } else if (body.includes("&")) {
      const expanded = expandNestedAmpersandBody(prelude, body)
      output += `${prelude}{${expanded.parentBody}}${expanded.nestedRules.join("")}`
    } else {
      output += css.slice(preludeStart, close + 1)
    }
    index = close + 1
  }
  return output
}

function expandNestedAmpersandBody(
  parentSelector: string,
  body: string,
): { parentBody: string; nestedRules: string[] } {
  let parentBody = ""
  const nestedRules: string[] = []
  let index = 0
  while (index < body.length) {
    if (body[index] !== "&") {
      parentBody += body[index]
      index += 1
      continue
    }
    const nestedOpen = body.indexOf("{", index)
    const nextDeclaration = body.indexOf(";", index)
    if (nestedOpen === -1 || (nextDeclaration !== -1 && nextDeclaration < nestedOpen)) {
      parentBody += body[index]
      index += 1
      continue
    }
    const nestedClose = findMatchingBrace(body, nestedOpen)
    if (nestedClose === undefined) {
      parentBody += body[index]
      index += 1
      continue
    }
    const nestedSelector = body.slice(index + 1, nestedOpen).trim()
    const nestedBody = body.slice(nestedOpen + 1, nestedClose)
    nestedRules.push(`${parentSelector}${nestedSelector}{${nestedBody}}`)
    index = nestedClose + 1
    if (body[index] === ";") index += 1
  }
  return { parentBody, nestedRules }
}

function findCssPreludeStart(css: string, openBraceIndex: number): number {
  let index = openBraceIndex - 1
  while (index >= 0) {
    const char = css[index]
    if (char === "}" || char === "{" || char === ";") return index + 1
    index -= 1
  }
  return 0
}

function findMatchingBrace(value: string, openBraceIndex: number): number | undefined {
  let depth = 0
  for (let index = openBraceIndex; index < value.length; index += 1) {
    const char = value[index]
    if (char === "{") depth += 1
    if (char === "}") {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return undefined
}

function extractDataUrlAsset(
  dataUrl: string,
  extractedAssets: Map<string, ExtractedPublicAsset>,
): ExtractedPublicAsset | undefined {
  const parsed = parseDataUrl(dataUrl)
  if (!parsed) return undefined
  const hash = createHash("sha256").update(parsed.bytes).digest("hex").slice(0, 16)
  const ext = extensionForMime(parsed.mime)
  const relativePath = `assets/extracted/${hash}.${ext}`
  const existing = extractedAssets.get(relativePath)
  if (existing) return existing
  const asset = { relativePath, bytes: parsed.bytes }
  extractedAssets.set(relativePath, asset)
  return asset
}

function parseDataUrl(dataUrl: string): { mime: string; bytes: Uint8Array } | undefined {
  const match = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/i.exec(dataUrl.trim())
  if (!match) return undefined
  const mime = match[1] || "application/octet-stream"
  const isBase64 = Boolean(match[2])
  try {
    const bytes = isBase64
      ? Buffer.from(match[3] ?? "", "base64")
      : Buffer.from(decodeURIComponent(match[3] ?? ""), "utf8")
    return { mime, bytes }
  } catch {
    return undefined
  }
}

function extensionForMime(mime: string): string {
  const normalized = mime.toLowerCase().split(";")[0]?.trim()
  if (normalized === "image/svg+xml") return "svg"
  if (normalized === "image/png") return "png"
  if (normalized === "image/jpeg" || normalized === "image/jpg") return "jpg"
  if (normalized === "image/webp") return "webp"
  if (normalized === "image/gif") return "gif"
  if (normalized === "image/avif") return "avif"
  if (normalized === "font/woff2") return "woff2"
  if (normalized === "font/woff") return "woff"
  return "bin"
}

function sanitizeAssetPreview(preview: string | undefined): string | undefined {
  if (!preview) return undefined
  if (/data:/i.test(preview)) return undefined
  return preview
}

function renderPackageJson(packageName: string): string {
  return `${JSON.stringify(
    {
      name: packageName,
      private: true,
      version: "0.0.0",
      type: "module",
      scripts: {
        dev: GENERATED_FRONTEND_PACKAGE_PROFILE.scripts.viteDev,
        typecheck: GENERATED_FRONTEND_PACKAGE_PROFILE.scripts.typecheck,
        build: GENERATED_FRONTEND_PACKAGE_PROFILE.scripts.viteBuild,
        preview: GENERATED_FRONTEND_PACKAGE_PROFILE.scripts.vitePreview,
      },
      packageManager: GENERATED_FRONTEND_PACKAGE_PROFILE.packageManager,
      dependencies: {
        "@vitejs/plugin-react": "^5.0.0",
        typescript: "^5.8.0",
        vite: "^7.0.0",
        react: "^19.0.0",
        "react-dom": "^19.0.0",
      },
      devDependencies: {
        "@types/react": "^19.0.0",
        "@types/react-dom": "^19.0.0",
      },
    },
    null,
    2,
  )}\n`
}

function renderTsconfigJson(): string {
  return `${JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        useDefineForClassFields: true,
        lib: ["DOM", "DOM.Iterable", "ES2022"],
        allowJs: false,
        skipLibCheck: true,
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        strict: true,
        forceConsistentCasingInFileNames: true,
        module: "ESNext",
        moduleResolution: "Bundler",
        resolveJsonModule: true,
        isolatedModules: true,
        noEmit: true,
        jsx: "react-jsx",
      },
      include: ["src"],
    },
    null,
    2,
  )}\n`
}

function renderViteConfigTs(): string {
  return [
    'import react from "@vitejs/plugin-react"',
    'import { defineConfig } from "vite"',
    "",
    "export default defineConfig({",
    "  plugins: [react()],",
    "  build: {",
    "    cssMinify: false,",
    "  },",
    "})",
    "",
  ].join("\n")
}

function renderIndexHtml(documentContext: DocumentContext): string {
  return [
    "<!doctype html>",
    `<html${renderHtmlAttributes(documentContext.htmlAttrs)}>`,
    "  <head>",
    '    <meta charset="UTF-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    "    <title>Web Clone Source Project</title>",
    "  </head>",
    `  <body${renderHtmlAttributes(documentContext.bodyAttrs)}>`,
    '    <div id="root"></div>',
    '    <script type="module" src="/src/main.tsx"></script>',
    "  </body>",
    "</html>",
    "",
  ].join("\n")
}

function renderViteEnvDts(): string {
  return ['/// <reference types="vite/client" />', ""].join("\n")
}

function renderHtmlAttributes(attrs: Record<string, string>): string {
  const parts = Object.entries(attrs)
    .filter(([name, value]) => Boolean(toJsxAttributeName(name)) && value.trim().length > 0)
    .map(([name, value]) => ` ${name}="${escapeHtmlAttribute(value)}"`)
  return parts.join("")
}

function escapeHtmlAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
}

function renderMainTsx(): string {
  return [
    'import { StrictMode } from "react"',
    'import { createRoot } from "react-dom/client"',
    'import "./styles.css"',
    'import App from "./App"',
    "",
    'createRoot(document.getElementById("root")!).render(',
    "  <StrictMode>",
    "    <App />",
    "  </StrictMode>,",
    ")",
    "",
  ].join("\n")
}

function renderAppTsx(): string {
  return [
    'import { SourceClonePage } from "./components/SourceClonePage"',
    "",
    "export default function App() {",
    "  return <SourceClonePage />",
    "}",
    "",
  ].join("\n")
}

function renderSourceClonePageTsx(): string {
  return [
    'import { SourceDomPage } from "./SourceDomPage"',
    'import { sourceComponents, sourceTables } from "../data/sourceData"',
    "",
    "export function SourceClonePage() {",
    "  return (",
    "    <SourceDomPage",
    '      sourceComponentNames={sourceComponents.map((component) => component.name).join(",")}',
    "      tableCount={sourceTables.length}",
    "    />",
    "  )",
    "}",
    "",
  ].join("\n")
}

function renderSourceDomProject(
  sourceSkeleton: string,
  previewImagePaths: string[],
  nodeStyleFallbacks: Map<string, string>,
  nodeBoundsById: Map<string, SourceBounds>,
  irChildrenByNodeId: Map<string, DomNode[]>,
  sourceComponentPatterns: SourceComponentPattern[],
): SourceDomRenderProject {
  const currentImports = new Map<string, string>()
  const currentSvgAssetGroupNames = new Set<string>()
  const context: SourceDomRenderContext = {
    previewImagePaths,
    previewImageIndex: 0,
    nodeStyleFallbacks,
    nodeBoundsById,
    irChildrenByNodeId,
    sourceComponentPatternsByNodeId: new Map(sourceComponentPatterns.map((pattern) => [pattern.nodeId, pattern])),
    regionFiles: new Map(),
    regionMetrics: [],
    semanticReplacementMetrics: [],
    regionNameCounts: new Map(),
    svgAssetGroups: new Map(),
    svgAssetGroupCount: 0,
    faqGroups: new Map(),
    faqGroupCount: 0,
    currentImports,
    currentSvgAssetGroupNames,
    currentImportPrefix: "./source-dom/",
    extractRegions: true,
    regionDepth: 0,
    maxRegionDepth: 6,
    maxRegionCount: 80,
    omitSourceProvenanceAttributes: true,
  }
  const bodyLines = renderSkeletonBodyJsx(sourceSkeleton, 3, context)
  const imports = Array.from(currentImports.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([componentName, importPath]) => `import { ${componentName} } from ${JSON.stringify(importPath)}`)
  const svgAssetGroupImports =
    currentSvgAssetGroupNames.size > 0
      ? [
          'import { SourceAssetPathGroup } from "./SourceAssetPathGroup"',
          'import { sourceSvgAssetGroups } from "../data/sourceSvgAssetGroups"',
        ]
      : []
  const sourceDomPage = [
    "// @ts-nocheck",
    'import { AssetPath } from "./AssetPath"',
    ...svgAssetGroupImports,
    ...imports,
    "",
    "export interface SourceDomPageProps {",
    "  sourceComponentNames: string",
    "  tableCount: number",
    "}",
    "",
    "export function SourceDomPage({ sourceComponentNames, tableCount }: SourceDomPageProps) {",
    "  return (",
    '    <div className="source-dom-page theme-light feature-no-touch" data-theme="light" data-source-component-names={sourceComponentNames} data-source-table-count={tableCount}>',
    ...bodyLines,
    "    </div>",
    "  )",
    "}",
    "",
  ].join("\n")
  context.regionMetrics.sort((a, b) => b.bytes - a.bytes || a.componentName.localeCompare(b.componentName))
  context.semanticReplacementMetrics.sort((a, b) => b.bytes - a.bytes || a.componentName.localeCompare(b.componentName))
  return {
    sourceDomPage,
    regionFiles: context.regionFiles,
    regionMetrics: context.regionMetrics,
    semanticReplacementMetrics: context.semanticReplacementMetrics,
    svgAssetGroups: context.svgAssetGroups,
    faqGroups: context.faqGroups,
  }
}

function renderAssetPathTsx(): string {
  return [
    'import { SVGProps } from "react"',
    'import { svgPaths } from "../data/svgPaths"',
    "",
    "export function AssetPath({ assetPath, fill, ...props }: SVGProps<SVGPathElement> & { assetPath: string }) {",
    "  const d = svgPaths[normalizeAssetPath(assetPath)] ?? ''",
    "  return <path {...props} fill={fill ?? 'currentColor'} d={d} />",
    "}",
    "",
    "function normalizeAssetPath(assetPath: string): string {",
    "  return assetPath.replaceAll('\\\\', '/').replace(/^\\.\\.\\//, '').replace(/^\\.\\//, '')",
    "}",
    "",
  ].join("\n")
}

function renderSourceAssetPathGroupTsx(): string {
  return [
    'import { SVGProps } from "react"',
    'import { AssetPath } from "./AssetPath"',
    'import type { SourceSvgAssetGroupItem } from "../data/sourceSvgAssetGroups"',
    "",
    "export function SourceAssetPathGroup({ items }: { items: readonly SourceSvgAssetGroupItem[] }) {",
    "  return (",
    "    <>",
    "      {items.map((item, index) => (",
    "        <AssetPath",
    '          key={`${item.assetPath}-${typeof item.id === "string" ? item.id : index}`}',
    "          {...(item as SVGProps<SVGPathElement> & { assetPath: string })}",
    "        />",
    "      ))}",
    "    </>",
    "  )",
    "}",
    "",
  ].join("\n")
}

function renderSourceFaqListTsx(): string {
  return [
    'import type { CSSProperties } from "react"',
    'import type { SourceFaqGroup, SourceFaqItem } from "../data/sourceFaqGroups"',
    "",
    "export function SourceFaqList({ group }: { group: SourceFaqGroup }) {",
    "  return (",
    "    <div",
    '      data-base-widget="true"',
    "      data-container-name={group.dataAttributes.containerName}",
    "      data-an-widget-id={group.dataAttributes.widgetId}",
    "      className={group.classes.container}",
    "    >",
    "      <div className={group.classes.header}>",
    "        <div className={group.classes.headerWrapper}>",
    "          <span className={group.classes.titleAndHintWrapper}>",
    "            <div className={group.classes.titleContainer}>",
    "              <h2 className={group.classes.title} id={group.titleId}>",
    "                {group.title}",
    "              </h2>",
    "            </div>",
    "          </span>",
    "        </div>",
    "      </div>",
    "      <div className={group.classes.content} data-qa-id={group.dataAttributes.contentQaId}>",
    "        <div className={group.classes.wrapper}>",
    "          {group.columns.map((column, columnIndex) => (",
    "            <div className={group.classes.column} key={`faq-column-${columnIndex}`}>",
    "              {column.map((item, itemIndex) => (",
    "                <SourceFaqItemView",
    "                  group={group}",
    "                  item={item}",
    "                  key={`${item.question}-${itemIndex}`}",
    "                />",
    "              ))}",
    "            </div>",
    "          ))}",
    "        </div>",
    "      </div>",
    "    </div>",
    "  )",
    "}",
    "",
    "function SourceFaqItemView({ group, item }: { group: SourceFaqGroup; item: SourceFaqItem }) {",
    "  const detailsId = item.detailsId ?? `${item.summaryId ?? item.question}-details`",
    "  const itemStyle: CSSProperties | undefined = item.order ? { order: item.order } : undefined",
    "  return (",
    "    <div className={item.itemClassName ?? group.classes.item} style={itemStyle}>",
    "      <button",
    "        className={group.classes.summary}",
    "        id={item.summaryId}",
    '        aria-expanded="false"',
    "        aria-controls={detailsId}",
    "      >",
    "        <div className={group.classes.summaryLine}>",
    "          <span className={group.classes.background} />",
    "          <div className={group.classes.summaryText}>{item.question}</div>",
    '          <div className={group.classes.iconPresentation} role="presentation">',
    "            <div className={group.classes.iconWrapper}>",
    "              <div className={group.classes.iconHorizontal} />",
    "              <div className={group.classes.iconVertical} />",
    "            </div>",
    "          </div>",
    "        </div>",
    "      </button>",
    "      <div className={group.classes.detailsWrapper} id={detailsId}>",
    "        <div className={group.classes.details}>",
    "          {item.answerText}",
    "          {item.links.map((link) => (",
    "            <a href={link.href} key={`${link.href}-${link.label}`}>{link.label}</a>",
    "          ))}",
    "        </div>",
    "      </div>",
    "    </div>",
    "  )",
    "}",
    "",
  ].join("\n")
}

function renderSkeletonBodyJsx(sourceSkeleton: string, indentLevel: number, context: SourceDomRenderContext): string[] {
  const document = parseDocument(sourceSkeleton, {
    lowerCaseAttributeNames: false,
    lowerCaseTags: false,
    recognizeSelfClosing: true,
  }) as DomNode
  const body = findFirstElement(document, "body")
  const children = body?.children ?? document.children ?? []
  const rendered = children.flatMap((child) => renderDomChildJsx(child, indentLevel, context, children))
  return rendered.length > 0 ? rendered : [`${indent(indentLevel)}<main />`]
}

function findFirstElement(node: DomNode, tagName: string): DomNode | undefined {
  if (node.type === "tag" && node.name?.toLowerCase() === tagName.toLowerCase()) return node
  for (const child of node.children ?? []) {
    const found = findFirstElement(child, tagName)
    if (found) return found
  }
  return undefined
}

function renderDomNodeJsx(node: DomNode, indentLevel: number, context: SourceDomRenderContext): string[] {
  if (node.type === "text") {
    const text = normalizeTextNode(node.data ?? "")
    return text ? [`${indent(indentLevel)}{${JSON.stringify(text)}}`] : []
  }
  if (node.type !== "tag" && node.type !== "script" && node.type !== "style") return []
  const tag = node.name ?? "div"
  if (tag.toLowerCase() === "script" || tag.toLowerCase() === "style") return []
  const mergedChildren = mergeDomChildrenBySourceId(
    node.children ?? [],
    node.attribs?.["data-source-node-id"]
      ? (context.irChildrenByNodeId.get(node.attribs["data-source-node-id"]) ?? [])
      : [],
  )
  let children = renderDomChildrenJsx(mergedChildren, indentLevel + 1, context)
  const previewImage = renderMissingPreviewImage({ ...node, children: mergedChildren }, indentLevel + 1, context)
  if (previewImage) children.unshift(previewImage)
  const attrText = renderJsxAttributes(
    tag,
    rewriteImagePlaceholderAttributes(tag, node.attribs ?? {}, context),
    context.nodeStyleFallbacks,
    context.omitSourceProvenanceAttributes,
  )
  const componentTag = toJsxTagName(tag, tag.toLowerCase() === "path" && Boolean(node.attribs?.["data-asset-d"]))
  const open = `${indent(indentLevel)}<${componentTag}${attrText ? ` ${attrText}` : ""}`
  if (VOID_TAGS.has(tag.toLowerCase()) || children.length === 0) return [`${open} />`]
  return [`${open}>`, ...children, `${indent(indentLevel)}</${componentTag}>`]
}

function renderDomChildrenJsx(children: DomNode[], indentLevel: number, context: SourceDomRenderContext): string[] {
  const rendered: string[] = []
  let assetPathRun: DomNode[] = []

  const flushAssetPathRun = () => {
    if (assetPathRun.length >= MIN_SVG_ASSET_GROUP_SIZE) {
      rendered.push(renderSourceSvgAssetGroupUse(assetPathRun, indentLevel, context))
    } else {
      for (const assetPathNode of assetPathRun) {
        rendered.push(...renderDomChildJsx(assetPathNode, indentLevel, context, children))
      }
    }
    assetPathRun = []
  }

  for (const child of children) {
    if (isSourceSvgAssetPathNode(child)) {
      assetPathRun.push(child)
      continue
    }
    flushAssetPathRun()
    rendered.push(...renderDomChildJsx(child, indentLevel, context, children))
  }
  flushAssetPathRun()
  return rendered
}

function renderSourceSvgAssetGroupUse(nodes: DomNode[], indentLevel: number, context: SourceDomRenderContext): string {
  const groupName = allocateSourceSvgAssetGroupName(context)
  context.svgAssetGroups.set(
    groupName,
    nodes.map((node) => sourceSvgAssetGroupItem(node, context.nodeStyleFallbacks)),
  )
  context.currentSvgAssetGroupNames.add(groupName)
  return `${indent(indentLevel)}<SourceAssetPathGroup items={sourceSvgAssetGroups[${JSON.stringify(groupName)}]} />`
}

function renderDomChildJsx(
  node: DomNode,
  indentLevel: number,
  context: SourceDomRenderContext,
  siblings: DomNode[],
): string[] {
  if (shouldExtractSourceRegion(node, siblings, context)) {
    const regionRef = renderExtractedSourceRegion(node, context)
    context.currentImports.set(regionRef.componentName, regionRef.importPath)
    return [`${indent(indentLevel)}<${regionRef.componentName} />`]
  }
  return renderDomNodeJsx(node, indentLevel, context)
}

function renderExtractedSourceRegion(node: DomNode, context: SourceDomRenderContext): SourceRegionRenderRef {
  const componentName = allocateSourceRegionComponentName(node, context)
  const semanticRegion = renderSemanticNewsListRegion(node, componentName, context)
  if (semanticRegion) return semanticRegion
  const semanticEventCardsRegion = renderSemanticEventCardListRegion(node, componentName, context)
  if (semanticEventCardsRegion) return semanticEventCardsRegion
  const semanticRepeatedListRegion = renderSemanticRepeatedListRegion(node, componentName, context)
  if (semanticRepeatedListRegion) return semanticRepeatedListRegion
  const semanticTableRegion = renderSemanticDataTableRegion(node, componentName, context)
  if (semanticTableRegion) return semanticTableRegion
  const semanticMetricRankingRegion = renderSemanticMetricRankingCardRegion(node, componentName, context)
  if (semanticMetricRankingRegion) return semanticMetricRankingRegion
  const semanticMetricChartCardRegion = renderSemanticMetricChartCardRegion(node, componentName, context)
  if (semanticMetricChartCardRegion) return semanticMetricChartCardRegion
  const semanticHeaderRegion = renderSemanticHeaderNavigationRegion(node, componentName, context)
  if (semanticHeaderRegion) return semanticHeaderRegion
  const semanticFooterRegion = renderSemanticFooterRegion(node, componentName, context)
  if (semanticFooterRegion) return semanticFooterRegion
  const semanticIdeaCardsRegion = renderSemanticIdeaCardCollectionRegion(node, componentName, context)
  if (semanticIdeaCardsRegion) return semanticIdeaCardsRegion
  const semanticSectionShellRegion = renderSemanticSectionShellRegion(node, componentName, context)
  if (semanticSectionShellRegion) return semanticSectionShellRegion
  const semanticMapRegion = renderSemanticMapSurfaceRegion(node, componentName, context)
  if (semanticMapRegion) return semanticMapRegion
  const semanticLinkGridRegion = renderSemanticLinkGridRegion(node, componentName, context)
  if (semanticLinkGridRegion) return semanticLinkGridRegion
  const semanticFaqRegion = renderSemanticFaqRegion(node, componentName, context)
  if (semanticFaqRegion) return semanticFaqRegion

  const faqGroup = extractSourceFaqGroup(node, context)
  if (faqGroup) {
    const groupName = allocateSourceFaqGroupName(context)
    context.faqGroups.set(groupName, faqGroup)
    const content = [
      "// @ts-nocheck",
      'import { SourceFaqList } from "../SourceFaqList"',
      'import { sourceFaqGroups } from "../../data/sourceFaqGroups"',
      "",
      `export function ${componentName}() {`,
      "  return <SourceFaqList group={sourceFaqGroups[" + JSON.stringify(groupName) + "]} />",
      "}",
      "",
    ].join("\n")
    const filePath = `src/components/source-dom/${componentName}.tsx`
    const bytes = Buffer.byteLength(content, "utf8")
    const elementCount = countRenderableElements(node)
    context.regionFiles.set(filePath, content)
    context.regionMetrics.push({
      componentName,
      filePath,
      sourceNodeId: node.attribs?.["data-source-node-id"],
      sourceSegmentId: node.attribs?.["data-source-segment-id"],
      sourceBounds: sourceNodeBounds(node, context),
      sourceComponentPattern: sourceComponentPatternForNode(node, context),
      tag: node.name ?? "div",
      heading: findFirstHeadingText(node),
      textPreview: visibleText(node).slice(0, 180),
      elementCount,
      bytes,
      replacementPriority: sourceDomReplacementPriority(bytes, elementCount),
    })
    return { componentName, importPath: sourceDomImportPath(context, componentName) }
  }
  const parentImports = context.currentImports
  const parentSvgAssetGroupNames = context.currentSvgAssetGroupNames
  const parentPrefix = context.currentImportPrefix
  const parentDepth = context.regionDepth
  const parentOmitSourceProvenanceAttributes = context.omitSourceProvenanceAttributes
  const imports = new Map<string, string>()
  const svgAssetGroupNames = new Set<string>()
  context.currentImports = imports
  context.currentSvgAssetGroupNames = svgAssetGroupNames
  context.currentImportPrefix = "./"
  context.regionDepth = parentDepth + 1
  context.omitSourceProvenanceAttributes = false
  const body = renderDomNodeJsx(node, 2, context)
  context.omitSourceProvenanceAttributes = parentOmitSourceProvenanceAttributes
  context.regionDepth = parentDepth
  context.currentImportPrefix = parentPrefix
  context.currentSvgAssetGroupNames = parentSvgAssetGroupNames
  context.currentImports = parentImports

  const nestedImports = Array.from(imports.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, importPath]) => `import { ${name} } from ${JSON.stringify(importPath)}`)
  const svgAssetGroupImports =
    svgAssetGroupNames.size > 0
      ? [
          'import { SourceAssetPathGroup } from "../SourceAssetPathGroup"',
          'import { sourceSvgAssetGroups } from "../../data/sourceSvgAssetGroups"',
        ]
      : []
  const content = [
    "// @ts-nocheck",
    'import { AssetPath } from "../AssetPath"',
    ...svgAssetGroupImports,
    ...nestedImports,
    "",
    `export function ${componentName}() {`,
    "  return (",
    ...body,
    "  )",
    "}",
    "",
  ].join("\n")
  const filePath = `src/components/source-dom/${componentName}.tsx`
  const bytes = Buffer.byteLength(content, "utf8")
  context.regionFiles.set(filePath, content)
  context.regionMetrics.push({
    componentName,
    filePath,
    sourceNodeId: node.attribs?.["data-source-node-id"],
    sourceSegmentId: node.attribs?.["data-source-segment-id"],
    sourceBounds: sourceNodeBounds(node, context),
    sourceComponentPattern: sourceComponentPatternForNode(node, context),
    tag: node.name ?? "div",
    heading: findFirstHeadingText(node),
    textPreview: visibleText(node).slice(0, 180),
    elementCount: countRenderableElements(node),
    bytes,
    replacementPriority: sourceDomReplacementPriority(bytes, countRenderableElements(node)),
  })
  return { componentName, importPath: sourceDomImportPath(context, componentName) }
}

function sourceDomImportPath(context: SourceDomRenderContext, componentName: string): string {
  return `${context.currentImportPrefix}${componentName}`
}

function sourceNodeBounds(node: DomNode, context: SourceDomRenderContext): SourceBounds | undefined {
  const sourceNodeId = node.attribs?.["data-source-node-id"]
  return sourceNodeId ? context.nodeBoundsById.get(sourceNodeId) : undefined
}

function sourceComponentPatternForNode(
  node: DomNode,
  context: SourceDomRenderContext,
): SourceComponentPattern | undefined {
  const sourceNodeId = node.attribs?.["data-source-node-id"]
  return sourceNodeId ? context.sourceComponentPatternsByNodeId.get(sourceNodeId) : undefined
}

function semanticImportPath(context: SourceDomRenderContext, componentName: string): string {
  return context.currentImportPrefix === "./source-dom/"
    ? `./semantic/${componentName}`
    : `../semantic/${componentName}`
}

function renderSemanticNewsListRegion(
  node: DomNode,
  sourceRegionComponentName: string,
  context: SourceDomRenderContext,
): SourceRegionRenderRef | undefined {
  if (!isSemanticNewsListCandidate(node, countRenderableElements(node))) return undefined
  const semanticList = extractSemanticNewsList(node, sourceRegionComponentName)
  if (!semanticList) return undefined

  const content = renderSemanticNewsListComponent(semanticList)
  const filePath = `src/components/semantic/${semanticList.componentName}.tsx`
  context.regionFiles.set(filePath, content)
  context.semanticReplacementMetrics.push({
    componentName: semanticList.componentName,
    filePath,
    sourceRegionComponentName,
    sourceNodeId: semanticList.rootSourceNodeId,
    rootQaId: semanticList.rootQaId,
    replacementKind: "event_or_news_list_component",
    itemCount: semanticList.items.length,
    bytes: Buffer.byteLength(content, "utf8"),
    rootClassName: semanticList.rootClassName,
    gridClassName: semanticList.gridClassName,
    textPreview: semanticList.items
      .map((item) => item.title)
      .join(" | ")
      .slice(0, 180),
  })
  return {
    componentName: semanticList.componentName,
    importPath: semanticImportPath(context, semanticList.componentName),
  }
}

function renderSemanticRepeatedListRegion(
  node: DomNode,
  sourceRegionComponentName: string,
  context: SourceDomRenderContext,
): SourceRegionRenderRef | undefined {
  const collection = extractSemanticRepeatedListCollection(node, sourceRegionComponentName)
  if (!collection) return undefined
  const content = renderSemanticRepeatedListComponent(collection)
  const filePath = `src/components/semantic/${collection.componentName}.tsx`
  context.regionFiles.set(filePath, content)
  context.semanticReplacementMetrics.push({
    componentName: collection.componentName,
    filePath,
    sourceRegionComponentName,
    sourceNodeId: collection.rootSourceNodeId,
    replacementKind: "card_collection_component",
    itemCount: collection.items.length,
    bytes: Buffer.byteLength(content, "utf8"),
    rootClassName: collection.rootClassName,
    textPreview: collection.items
      .map((item) => item.title)
      .join(" | ")
      .slice(0, 180),
  })
  return {
    componentName: collection.componentName,
    importPath: semanticImportPath(context, collection.componentName),
  }
}

function renderSemanticDataTableRegion(
  node: DomNode,
  sourceRegionComponentName: string,
  context: SourceDomRenderContext,
): SourceRegionRenderRef | undefined {
  if (!isSemanticDataTableCandidate(node)) return undefined
  const semanticTable = extractSemanticDataTable(node, sourceRegionComponentName)
  if (!semanticTable) return undefined

  const content = renderSemanticDataTableComponent(semanticTable)
  const filePath = `src/components/semantic/${semanticTable.componentName}.tsx`
  context.regionFiles.set(filePath, content)
  context.semanticReplacementMetrics.push({
    componentName: semanticTable.componentName,
    filePath,
    sourceRegionComponentName,
    sourceNodeId: semanticTable.rootSourceNodeId,
    rootQaId: semanticTable.rootDataAttrs["data-qa-id"],
    replacementKind: "data_table_or_heatmap_component",
    itemCount: semanticTable.rows.length,
    bytes: Buffer.byteLength(content, "utf8"),
    rootClassName: semanticTable.rootClassName,
    tableClassName: semanticTable.tableClassName,
    textPreview: [
      semanticTable.titleText,
      ...semanticTable.headers.map((header) => header.label),
      ...semanticTable.rows.slice(0, 4).map((row) => row.label),
    ]
      .join(" | ")
      .slice(0, 180),
  })
  return {
    componentName: semanticTable.componentName,
    importPath: semanticImportPath(context, semanticTable.componentName),
  }
}

function renderSemanticMetricRankingCardRegion(
  node: DomNode,
  sourceRegionComponentName: string,
  context: SourceDomRenderContext,
): SourceRegionRenderRef | undefined {
  if (!isSemanticMetricRankingCardCandidate(node)) return undefined
  const ranking = extractSemanticMetricRankingCard(node, sourceRegionComponentName, context)
  if (!ranking) return undefined

  const content = renderSemanticMetricRankingCardComponent(ranking)
  const filePath = `src/components/semantic/${ranking.componentName}.tsx`
  context.regionFiles.set(filePath, content)
  context.semanticReplacementMetrics.push({
    componentName: ranking.componentName,
    filePath,
    sourceRegionComponentName,
    sourceNodeId: ranking.rootSourceNodeId,
    replacementKind: "data_table_or_heatmap_component",
    itemCount: ranking.rows.length,
    bytes: Buffer.byteLength(content, "utf8"),
    rootClassName: ranking.rootClassName,
    cardContainerClassName: ranking.listClassName,
    textPreview: [ranking.titleText, ...ranking.headerLabels, ...ranking.rows.slice(0, 6).map((row) => row.label)]
      .join(" | ")
      .slice(0, 180),
  })
  return {
    componentName: ranking.componentName,
    importPath: semanticImportPath(context, ranking.componentName),
  }
}

function renderSemanticMetricChartCardRegion(
  node: DomNode,
  sourceRegionComponentName: string,
  context: SourceDomRenderContext,
): SourceRegionRenderRef | undefined {
  if (!isSemanticMetricChartCardCandidate(node)) return undefined
  const card = extractSemanticMetricChartCard(node, sourceRegionComponentName)
  if (!card) return undefined

  const content = renderSemanticMetricChartCardComponent(card)
  const filePath = `src/components/semantic/${card.componentName}.tsx`
  context.regionFiles.set(filePath, content)
  context.semanticReplacementMetrics.push({
    componentName: card.componentName,
    filePath,
    sourceRegionComponentName,
    sourceNodeId: card.rootSourceNodeId,
    replacementKind: "metric_chart_card_component",
    itemCount: card.stats.length,
    bytes: Buffer.byteLength(content, "utf8"),
    rootClassName: card.rootClassName,
    textPreview: [card.title, card.ticker, ...card.stats.map((stat) => `${stat.label} ${stat.value}`)]
      .join(" | ")
      .slice(0, 180),
  })
  return {
    componentName: card.componentName,
    importPath: semanticImportPath(context, card.componentName),
  }
}

function renderSemanticEventCardListRegion(
  node: DomNode,
  sourceRegionComponentName: string,
  context: SourceDomRenderContext,
): SourceRegionRenderRef | undefined {
  if (!isSemanticEventCardListCandidate(node)) return undefined
  const semanticList = extractSemanticEventCardList(node, sourceRegionComponentName)
  if (!semanticList) return undefined

  const content = renderSemanticEventCardListComponent(semanticList)
  const filePath = `src/components/semantic/${semanticList.componentName}.tsx`
  context.regionFiles.set(filePath, content)
  context.semanticReplacementMetrics.push({
    componentName: semanticList.componentName,
    filePath,
    sourceRegionComponentName,
    sourceNodeId: semanticList.rootSourceNodeId,
    rootQaId: semanticList.rootDataAttrs["data-qa-id"],
    replacementKind: "event_or_news_list_component",
    itemCount: semanticList.items.length,
    bytes: Buffer.byteLength(content, "utf8"),
    rootClassName: semanticList.rootClassName,
    cardContainerClassName: semanticList.itemsClassName,
    textPreview: [semanticList.titleText, ...semanticList.items.slice(0, 6).map((item) => item.title)]
      .join(" | ")
      .slice(0, 180),
  })
  return {
    componentName: semanticList.componentName,
    importPath: semanticImportPath(context, semanticList.componentName),
  }
}

function renderSemanticFooterRegion(
  node: DomNode,
  sourceRegionComponentName: string,
  context: SourceDomRenderContext,
): SourceRegionRenderRef | undefined {
  if (!isSemanticFooterCandidate(node)) return undefined
  const footer = extractSemanticFooter(node, sourceRegionComponentName)
  if (!footer) return undefined

  const content = renderSemanticFooterComponent(footer)
  const filePath = `src/components/semantic/${footer.componentName}.tsx`
  const footerLinks = footer.linkGroups.flatMap((group) => group.columns).flatMap((column) => column.links)
  const legalText = footer.legalParts.map((part) => part.text).filter(Boolean)
  context.regionFiles.set(filePath, content)
  context.semanticReplacementMetrics.push({
    componentName: footer.componentName,
    filePath,
    sourceRegionComponentName,
    sourceNodeId: footer.rootSourceNodeId,
    replacementKind: "navigation_or_footer_component",
    itemCount: footerLinks.length + footer.socialLinks.length,
    bytes: Buffer.byteLength(content, "utf8"),
    rootClassName: footer.rootClassName,
    textPreview: [
      footer.languageLabel,
      ...footer.socialLinks.slice(0, 4).map((item) => item.label),
      ...footerLinks.slice(0, 8).map((item) => item.label),
      ...legalText.slice(0, 2),
    ]
      .filter(Boolean)
      .join(" | ")
      .slice(0, 180),
  })
  return {
    componentName: footer.componentName,
    importPath: semanticImportPath(context, footer.componentName),
  }
}

function renderSemanticHeaderNavigationRegion(
  node: DomNode,
  sourceRegionComponentName: string,
  context: SourceDomRenderContext,
): SourceRegionRenderRef | undefined {
  if (!isSemanticHeaderNavigationCandidate(node)) return undefined
  const header = extractSemanticHeaderNavigation(node, sourceRegionComponentName, context)
  if (!header) return undefined

  const content = renderSemanticHeaderNavigationComponent(header)
  const filePath = `src/components/semantic/${header.componentName}.tsx`
  context.regionFiles.set(filePath, content)
  context.semanticReplacementMetrics.push({
    componentName: header.componentName,
    filePath,
    sourceRegionComponentName,
    sourceNodeId: header.rootSourceNodeId,
    replacementKind: "navigation_or_footer_component",
    itemCount:
      header.menuItems.length +
      (header.searchButton ? 1 : 0) +
      (header.languageButton ? 1 : 0) +
      (header.offerLink ? 1 : 0),
    bytes: Buffer.byteLength(content, "utf8"),
    rootClassName: header.rootClassName,
    textPreview: [
      header.searchButton?.label,
      ...header.menuItems.map((item) => item.label),
      header.languageButton?.label,
      header.offerLink?.label,
    ]
      .filter(Boolean)
      .join(" | ")
      .slice(0, 180),
  })
  return {
    componentName: header.componentName,
    importPath: semanticImportPath(context, header.componentName),
  }
}

function renderSemanticMapSurfaceRegion(
  node: DomNode,
  sourceRegionComponentName: string,
  context: SourceDomRenderContext,
): SourceRegionRenderRef | undefined {
  if (!isSemanticMapSurfaceCandidate(node)) return undefined
  const mapSurface = extractSemanticMapSurface(node, sourceRegionComponentName, context.nodeStyleFallbacks)
  if (!mapSurface) return undefined

  const content = renderSemanticMapSurfaceComponent(mapSurface)
  const filePath = `src/components/semantic/${mapSurface.componentName}.tsx`
  context.regionFiles.set(filePath, content)
  context.semanticReplacementMetrics.push({
    componentName: mapSurface.componentName,
    filePath,
    sourceRegionComponentName,
    sourceNodeId: mapSurface.rootSourceNodeId,
    rootQaId: mapSurface.rootDataAttrs["data-qa-id"],
    replacementKind: "map_or_chart_asset_component",
    itemCount: mapSurface.paths.length,
    mapPathCount: mapSurface.paths.length,
    bytes: Buffer.byteLength(content, "utf8"),
    rootClassName: mapSurface.rootClassName,
    textPreview: [mapSurface.titleText, ...mapSurface.legendLabels, mapSurface.footerLink?.label]
      .filter(Boolean)
      .join(" | ")
      .slice(0, 180),
  })
  return {
    componentName: mapSurface.componentName,
    importPath: semanticImportPath(context, mapSurface.componentName),
  }
}

function renderSemanticLinkGridRegion(
  node: DomNode,
  sourceRegionComponentName: string,
  context: SourceDomRenderContext,
): SourceRegionRenderRef | undefined {
  if (!isSemanticLinkGridCandidate(node)) return undefined
  const linkGrid = extractSemanticLinkGrid(node, sourceRegionComponentName)
  if (!linkGrid) return undefined

  const content = renderSemanticLinkGridComponent(linkGrid)
  const filePath = `src/components/semantic/${linkGrid.componentName}.tsx`
  context.regionFiles.set(filePath, content)
  context.semanticReplacementMetrics.push({
    componentName: linkGrid.componentName,
    filePath,
    sourceRegionComponentName,
    sourceNodeId: linkGrid.rootSourceNodeId,
    rootQaId: linkGrid.rootDataAttrs["data-qa-id"],
    replacementKind: linkGrid.replacementKind,
    itemCount: linkGrid.links.length,
    bytes: Buffer.byteLength(content, "utf8"),
    rootClassName: linkGrid.rootClassName,
    textPreview: [linkGrid.titleText, ...linkGrid.links.slice(0, 12).map((item) => item.label)]
      .filter(Boolean)
      .join(" | ")
      .slice(0, 180),
  })
  return {
    componentName: linkGrid.componentName,
    importPath: semanticImportPath(context, linkGrid.componentName),
  }
}

function renderSemanticIdeaCardCollectionRegion(
  node: DomNode,
  sourceRegionComponentName: string,
  context: SourceDomRenderContext,
): SourceRegionRenderRef | undefined {
  if (!isSemanticIdeaCardCollectionCandidate(node)) return undefined
  const collection = extractSemanticIdeaCardCollection(node, sourceRegionComponentName, context)
  if (!collection) return undefined

  const content = renderSemanticIdeaCardCollectionComponent(collection)
  const filePath = `src/components/semantic/${collection.componentName}.tsx`
  context.regionFiles.set(filePath, content)
  context.semanticReplacementMetrics.push({
    componentName: collection.componentName,
    filePath,
    sourceRegionComponentName,
    sourceNodeId: collection.rootSourceNodeId,
    rootQaId: collection.rootDataAttrs["data-qa-id"] ?? collection.contentQaId,
    replacementKind: "card_collection_component",
    itemCount: collection.cards.length + collection.tabs.length + (collection.moreLink ? 1 : 0),
    bytes: Buffer.byteLength(content, "utf8"),
    rootClassName: collection.rootClassName,
    cardContainerClassName: collection.itemsClassName,
    textPreview: [
      collection.titleText,
      ...collection.tabs.map((tab) => tab.label),
      ...collection.cards.slice(0, 6).map((card) => card.title),
      collection.moreLink?.label,
    ]
      .filter(Boolean)
      .join(" | ")
      .slice(0, 180),
  })
  return {
    componentName: collection.componentName,
    importPath: semanticImportPath(context, collection.componentName),
  }
}

function renderSemanticFaqRegion(
  node: DomNode,
  sourceRegionComponentName: string,
  context: SourceDomRenderContext,
): SourceRegionRenderRef | undefined {
  const faqGroup = extractSourceFaqGroup(node, context)
  if (!faqGroup) return undefined
  const groupName = allocateSourceFaqGroupName(context)
  context.faqGroups.set(groupName, faqGroup)
  const componentName = sourceRegionComponentName.replace(/Region\d*$/, "FAQ")
  const semanticComponentName =
    componentName === sourceRegionComponentName ? `${sourceRegionComponentName}FAQ` : componentName
  const faqItems = faqGroup.columns.flat()
  const content = [
    "// @ts-nocheck",
    "// semantic-source-replacement: generated from source FAQ disclosure data and rendered through SourceFaqList.",
    'import { SourceFaqList } from "../SourceFaqList"',
    'import { sourceFaqGroups } from "../../data/sourceFaqGroups"',
    "",
    `export function ${semanticComponentName}() {`,
    "  return <SourceFaqList group={sourceFaqGroups[" + JSON.stringify(groupName) + "]} />",
    "}",
    "",
  ].join("\n")
  const filePath = `src/components/semantic/${semanticComponentName}.tsx`
  context.regionFiles.set(filePath, content)
  context.semanticReplacementMetrics.push({
    componentName: semanticComponentName,
    filePath,
    sourceRegionComponentName,
    sourceNodeId: node.attribs?.["data-source-node-id"],
    rootQaId: faqGroup.dataAttributes.contentQaId,
    replacementKind: "faq_disclosure_component",
    itemCount: faqItems.length,
    bytes: Buffer.byteLength(content, "utf8"),
    rootClassName: node.attribs?.class ?? faqGroup.classes.container,
    textPreview: [faqGroup.title, ...faqItems.slice(0, 6).map((item) => item.question)].join(" | ").slice(0, 180),
  })
  return {
    componentName: semanticComponentName,
    importPath: semanticImportPath(context, semanticComponentName),
  }
}

function renderSemanticSectionShellRegion(
  node: DomNode,
  sourceRegionComponentName: string,
  context: SourceDomRenderContext,
): SourceRegionRenderRef | undefined {
  if (!isSemanticSectionShellCandidate(node)) return undefined
  const section = extractSemanticSectionShell(node, sourceRegionComponentName, context)
  if (!section) return undefined

  const content = renderSemanticSectionShellComponent(section)
  const filePath = `src/components/semantic/${section.componentName}.tsx`
  context.regionFiles.set(filePath, content)
  context.semanticReplacementMetrics.push({
    componentName: section.componentName,
    filePath,
    sourceRegionComponentName,
    sourceNodeId: section.rootSourceNodeId,
    rootQaId: section.rootDataAttrs["data-qa-id"],
    replacementKind: section.replacementKind,
    itemCount: section.tabs.length + section.children.length + (section.footerLink ? 1 : 0),
    bytes: Buffer.byteLength(content, "utf8"),
    rootClassName: section.rootClassName,
    textPreview: [
      section.titleText,
      ...section.tabs.map((tab) => tab.label),
      section.footerLink?.label,
      ...section.children.map((child) => child.componentName),
    ]
      .filter(Boolean)
      .join(" | ")
      .slice(0, 180),
  })
  return {
    componentName: section.componentName,
    importPath: semanticImportPath(context, section.componentName),
  }
}

function extractSemanticNewsList(node: DomNode, sourceRegionComponentName: string): SemanticNewsList | undefined {
  const grid = findSemanticNewsListGrid(node)
  const anchors = grid ? directNewsCardAnchors(grid) : []
  if (anchors.length < 3) return undefined
  const items = anchors
    .map(semanticNewsItem)
    .filter((item): item is SemanticNewsItem => Boolean(item))
    .slice(0, 60)
  if (items.length < 3) return undefined

  const wrapper = grid ? firstElementChildBetween(node, grid) : firstElementChild(node)
  const componentName = sourceRegionComponentName.replace(/Region\d*$/, "List")
  return {
    componentName: componentName === sourceRegionComponentName ? `${sourceRegionComponentName}List` : componentName,
    rootClassName: node.attribs?.class ?? "",
    rootQaId: node.attribs?.["data-qa-id"],
    rootSourceNodeId: node.attribs?.["data-source-node-id"],
    wrapperClassName: wrapper?.attribs?.class ?? "",
    gridClassName: grid?.attribs?.class ?? "",
    items,
  }
}

function extractSemanticRepeatedListCollection(
  node: DomNode,
  sourceRegionComponentName: string,
): SemanticRepeatedListCollection | undefined {
  if (!isSemanticRepeatedListCandidate(node)) return undefined
  const itemNodes = directElementChildren(node).filter((child) => child.type === "tag")
  const items = itemNodes
    .map((item, index) => semanticRepeatedListItem(item, index))
    .filter((item): item is SemanticRepeatedListItemCandidate => Boolean(item))
    .slice(0, 80)
  if (items.length < 3) return undefined
  const tag = node.name?.toLowerCase()
  const componentName = sourceRegionComponentName.replace(/Region\d*$/, "List")
  return {
    componentName: componentName === sourceRegionComponentName ? `${sourceRegionComponentName}List` : componentName,
    rootTagName: tag === "ol" ? "ol" : tag === "ul" ? "ul" : "div",
    rootClassName: node.attribs?.class ?? "",
    rootSourceNodeId: node.attribs?.["data-source-node-id"],
    items: items.map(({ sourceNode: _sourceNode, ...item }) => item),
  }
}

function isSemanticRepeatedListCandidate(node: DomNode): boolean {
  if (node.type !== "tag") return false
  const tag = node.name?.toLowerCase() ?? ""
  if (tag !== "ul" && tag !== "ol" && node.attribs?.["data-source-role"] !== "list") return false
  const itemNodes = directElementChildren(node).filter((child) => child.type === "tag")
  if (itemNodes.length < 3) return false
  const extractableItems = itemNodes.map((item, index) => semanticRepeatedListItem(item, index)).filter(Boolean)
  return extractableItems.length >= 3
}

function semanticRepeatedListItem(node: DomNode, index: number): SemanticRepeatedListItemCandidate | undefined {
  const anchor = findDescendantElement(
    node,
    (child) => child.name?.toLowerCase() === "a" && normalizeVisibleText(visibleText(child)).length > 0,
  )
  const titleCandidate = semanticRepeatedListTitle(node, anchor)
  if (!anchor || !titleCandidate) return undefined
  const image = findDescendantElement(node, (child) => child.name?.toLowerCase() === "img")
  const card = firstElementChild(node) ?? node
  const meta = semanticRepeatedListMetaText(node, titleCandidate.sourceNode)
  return {
    sourceNode: node,
    id: node.attribs?.["data-source-node-id"] ?? `item-${index + 1}`,
    itemClassName: node.attribs?.class ?? "",
    cardClassName: card.attribs?.class ?? "",
    titleClassName: titleCandidate.sourceNode.attribs?.class ?? "",
    metaClassName: semanticRepeatedListMetaNode(node, titleCandidate.sourceNode)?.attribs?.class ?? "",
    imageClassName: image?.attribs?.class ?? "",
    href: normalizeReferencedAssetUrl(anchor.attribs?.href ?? ""),
    title: titleCandidate.text,
    meta,
    imageSrc: normalizeReferencedAssetUrl(image?.attribs?.src ?? ""),
    imageAlt: image?.attribs?.alt ?? "",
  }
}

function semanticRepeatedListTitle(node: DomNode, anchor?: DomNode): SemanticRepeatedListTitleCandidate | undefined {
  const titleNode =
    findDescendantElement(anchor ?? node, (child) => {
      if (child.type !== "tag") return false
      const tag = child.name?.toLowerCase() ?? ""
      if (/^h[1-6]$/.test(tag)) return true
      if (tag === "p" || tag === "span") return /(?:headline|title|promo)/i.test(child.attribs?.class ?? "")
      return false
    }) ?? anchor
  const text = normalizeVisibleText(titleNode ? visibleText(titleNode) : "")
  return titleNode && text ? { sourceNode: titleNode, text } : undefined
}

function semanticRepeatedListMetaNode(node: DomNode, titleNode: DomNode): DomNode | undefined {
  return findDescendantElement(node, (child) => {
    if (child === titleNode || child.type !== "tag") return false
    const text = normalizeVisibleText(visibleText(child))
    if (!text || text.length > 80) return false
    const className = child.attribs?.class ?? ""
    return /(?:meta|source|attribution|tag|label|category|strip)/i.test(className)
  })
}

function semanticRepeatedListMetaText(node: DomNode, titleNode: DomNode): string {
  const metaNode = semanticRepeatedListMetaNode(node, titleNode)
  return metaNode ? normalizeVisibleText(visibleText(metaNode)) : ""
}

function isSemanticDataTableCandidate(node: DomNode): boolean {
  const table = findDescendantElement(node, (child) => child.name?.toLowerCase() === "table")
  if (!table) return false
  const tableDistance = descendantElementDistance(node, table)
  if (tableDistance === undefined || tableDistance > 4) return false
  const rows = directTableRows(table)
  if (rows.length < 3) return false
  const firstRow = rows[0]
  if (!firstRow) return false
  const headerCells = tableRowCells(firstRow)
  if (headerCells.length < 3) return false
  const dataRows = rows.slice(1).filter((row) => tableRowCells(row).length >= 3)
  if (dataRows.length < 2) return false
  return true
}

function extractSemanticDataTable(node: DomNode, sourceRegionComponentName: string): SemanticDataTable | undefined {
  const table = findDescendantElement(node, (child) => child.name?.toLowerCase() === "table")
  if (!table) return undefined
  const rows = directTableRows(table)
  if (rows.length < 3) return undefined
  const headerCells = tableRowCells(rows[0] ?? [])
  const headers = headerCells
    .slice(1)
    .map(semanticDataTableHeader)
    .filter((item): item is SemanticDataTableHeader => Boolean(item))
  const dataRows = rows
    .slice(1)
    .map((row) => semanticDataTableRow(row, headers.length))
    .filter((item): item is SemanticDataTableRow => Boolean(item))
  if (headers.length < 2 || dataRows.length < 2) return undefined

  const header = findDirectChildBySourceRole(node, "header")
  const headerWrapper = header ? firstElementChild(header) : undefined
  const titleWrapper = headerWrapper ? firstElementChild(headerWrapper) : undefined
  const titleContainer = titleWrapper ? firstElementChild(titleWrapper) : undefined
  const titleLink = titleContainer
    ? findDescendantElement(titleContainer, (child) => child.name?.toLowerCase() === "a")
    : undefined
  const titleNode = findDescendantElement(titleContainer ?? node, (child) => /^h[1-4]$/i.test(child.name ?? ""))
  const content = findDescendantElement(
    node,
    (child) => child.attribs?.["data-qa-id"]?.endsWith("-content") || hasClassMatching(child, /^content-/),
  )
  const tableContainer =
    findAncestorElement(node, table, (child) => hasClassMatching(child, /^tableContainer-/)) ??
    findAncestorElement(node, table, (child) => hasClassMatching(child, /^container-/) && child !== node)
  const innerContainer = tableContainer ? firstElementChild(tableContainer) : undefined
  const body = findDescendantElement(table, (child) => child.name?.toLowerCase() === "tbody")
  const componentName = semanticTableComponentName(sourceRegionComponentName, titleNode ? visibleText(titleNode) : "")
  const rootDataAttrs = pickDataAttributes(node.attribs ?? {}, [
    "data-base-widget",
    "data-container-name",
    "data-an-widget-id",
  ])

  return {
    componentName,
    rootClassName: node.attribs?.class ?? "",
    rootDataAttrs,
    rootSourceNodeId: node.attribs?.["data-source-node-id"],
    headerClassName: header?.attribs?.class ?? "",
    headerWrapperClassName: headerWrapper?.attribs?.class ?? "",
    titleWrapperClassName: titleWrapper?.attribs?.class ?? "",
    titleContainerClassName: titleContainer?.attribs?.class ?? "",
    titleClassName: titleNode?.attribs?.class ?? "",
    titleId: titleNode?.attribs?.id,
    titleHref: normalizeReferencedAssetUrl(titleLink?.attribs?.href ?? ""),
    titleLinkClassName: titleLink?.attribs?.class ?? "",
    titleText: normalizeVisibleText(
      titleNode ? visibleText(titleNode) : sourceRegionComponentName.replace(/Region\d*$/, ""),
    ),
    contentClassName: content?.attribs?.class ?? "",
    tableContainerClassName: tableContainer?.attribs?.class ?? "",
    tableContainerStyle: parseStyleRecord(tableContainer?.attribs?.style ?? ""),
    innerContainerClassName: innerContainer?.attribs?.class ?? "",
    tableClassName: table.attribs?.class ?? "",
    bodyClassName: body?.attribs?.class ?? "",
    headers,
    rows: dataRows,
  }
}

function semanticTableComponentName(sourceRegionComponentName: string, title: string): string {
  const fromTitle = title ? `${toPascalIdentifier(title)}Table` : ""
  const fromRegion = sourceRegionComponentName.replace(/Region\d*$/, "Table")
  return fromTitle || (fromRegion === sourceRegionComponentName ? `${sourceRegionComponentName}Table` : fromRegion)
}

function directTableRows(table: DomNode): DomNode[] {
  const bodies = directElementChildren(table).filter((child) => /^(?:thead|tbody|tfoot)$/i.test(child.name ?? ""))
  const rowParents = bodies.length > 0 ? bodies : [table]
  return rowParents.flatMap((parent) =>
    directElementChildren(parent).filter((child) => child.name?.toLowerCase() === "tr"),
  )
}

function tableRowCells(row: DomNode): DomNode[] {
  return directElementChildren(row).filter((child) => /^(?:td|th)$/i.test(child.name ?? ""))
}

function semanticDataTableHeader(cell: DomNode): SemanticDataTableHeader | undefined {
  const label = normalizeVisibleText(visibleText(cell))
  if (!label) return undefined
  const anchor = findDescendantElement(cell, (child) => child.name?.toLowerCase() === "a")
  const span = findDescendantElement(cell, (child) => child.name?.toLowerCase() === "span")
  return {
    label,
    href: normalizeReferencedAssetUrl(anchor?.attribs?.href ?? ""),
    thClassName: cell.attribs?.class ?? "",
    anchorClassName: anchor?.attribs?.class ?? "",
    spanClassName: span?.attribs?.class ?? "",
  }
}

function semanticDataTableRow(row: DomNode, expectedCellCount: number): SemanticDataTableRow | undefined {
  const cells = tableRowCells(row)
  if (cells.length < expectedCellCount + 1) return undefined
  const labelCell = cells[0]
  if (!labelCell) return undefined
  const labelAnchor = findDescendantElement(labelCell, (child) => child.name?.toLowerCase() === "a")
  const labelImage = findDescendantElement(labelCell, (child) => child.name?.toLowerCase() === "img")
  const labelSpan = findDescendantElement(labelCell, (child) => child.name?.toLowerCase() === "span")
  const label = normalizeVisibleText(labelSpan ? visibleText(labelSpan) : visibleText(labelCell))
  if (!label) return undefined
  const dataCells = cells.slice(1, expectedCellCount + 1).map(semanticDataTableCell)
  if (dataCells.some((cell) => !cell)) return undefined
  return {
    label,
    href: normalizeReferencedAssetUrl(labelAnchor?.attribs?.href ?? ""),
    imageSrc: normalizeReferencedAssetUrl(labelImage?.attribs?.src ?? ""),
    imageAlt: labelImage?.attribs?.alt ?? "",
    imageClassName: labelImage?.attribs?.class ?? "",
    thClassName: labelCell.attribs?.class ?? "",
    labelLinkClassName: labelAnchor?.attribs?.class ?? "",
    labelClassName: labelSpan?.attribs?.class ?? "",
    cells: dataCells.filter((cell): cell is SemanticDataTableCell => Boolean(cell)),
  }
}

function semanticDataTableCell(cell: DomNode): SemanticDataTableCell {
  const valueNode = findDescendantElement(
    cell,
    (child) => hasClassMatching(child, /^(?:js-symbol-last|value)-/) || child.attribs?.class === "js-symbol-last",
  )
  const unitNode = findDescendantElement(cell, (child) => hasClassMatching(child, /^(?:currency|unit)-/))
  const rowNode = findAncestorElement(cell, valueNode ?? unitNode ?? cell, (child) => hasClassMatching(child, /^row-/))
  const contentNode = firstElementChild(cell)
  const value = normalizeVisibleText(valueNode ? visibleText(valueNode) : visibleText(cell))
  const unit = unitNode ? normalizeVisibleText(visibleText(unitNode)) : ""
  return {
    value,
    unit,
    className: cell.attribs?.class ?? "",
    contentClassName: contentNode?.attribs?.class ?? "",
    rowClassName: rowNode?.attribs?.class ?? "",
    valueClassName: valueNode?.attribs?.class ?? "",
    unitClassName: unitNode?.attribs?.class ?? "",
  }
}

function isSemanticMetricRankingCardCandidate(node: DomNode): boolean {
  if (node.type !== "tag") return false
  if (node.attribs?.["data-source-role"] !== "card" && !hasClassMatching(node, /^card-/)) return false
  const list = findSemanticMetricRankingList(node)
  if (!list) return false
  const rows = directElementChildren(list).filter((child) => child.name?.toLowerCase() === "li")
  if (rows.length < 3) return false
  const headerRow = findSemanticMetricRankingHeaderRow(node)
  if (!headerRow) return false
  const headerLabels = semanticMetricRankingHeaderLabels(headerRow)
  if (headerLabels.length < 2) return false
  const semanticRows = rows.map(semanticMetricRankingRow).filter((row): row is SemanticMetricRankingRow => Boolean(row))
  if (semanticRows.length < 3) return false
  const text = visibleText(node).toLowerCase()
  return /\b(country|gdp|growth|nominal|rate|inflation|unemployment|market cap|population)\b/.test(text)
}

function isSemanticMetricChartCardCandidate(node: DomNode): boolean {
  if (!isSemanticCardLikeElement(node)) return false
  const headerLink = findSemanticMetricChartHeaderLink(node)
  if (!headerLink) return false
  const title = semanticMetricChartTitleNode(headerLink)
  if (!title || normalizeVisibleText(visibleText(title)).length < 2) return false
  const hasChartAsset = Boolean(findSemanticMetricChartFrame(node))
  if (!hasChartAsset) return false
  const stats = semanticMetricChartStats(node)
  if (stats.length < 1) return false
  const text = visibleText(node).toLowerCase()
  return /\b(actual|forecast|next release|rate|balance|unemployment|interest|trade|inflation|gdp)\b/.test(text)
}

function extractSemanticMetricChartCard(
  node: DomNode,
  sourceRegionComponentName: string,
): SemanticMetricChartCard | undefined {
  const header = findDescendantElement(node, (child) => hasClassMatching(child, /^header-/))
  const headerLink = findSemanticMetricChartHeaderLink(node)
  const titleNode = headerLink ? semanticMetricChartTitleNode(headerLink) : undefined
  const tickerNode = headerLink
    ? findDescendantElement(headerLink, (child) => hasClassMatching(child, /^tickerBox-/))
    : undefined
  const title = normalizeVisibleText(titleNode ? visibleText(titleNode) : "")
  if (!headerLink || !title) return undefined
  const content = findDescendantElement(node, (child) => hasClassMatching(child, /^content-/))
  const chartShell = content ? firstElementChild(content) : findSemanticMetricChartFrame(node)
  const chartFrame = findSemanticMetricChartFrame(node)
  const statsWrapper = findDescendantElement(
    node,
    (child) => hasClassMatching(child, /^wrapper-vE74cYTn/) || hasClassMatching(child, /^stats/),
  )
  const statsContainer = statsWrapper ? firstElementChild(statsWrapper) : undefined
  const stats = semanticMetricChartStats(node)
  if (!chartFrame || stats.length < 1) return undefined
  const componentBaseName = toPascalIdentifier(title || sourceRegionComponentName.replace(/Region\d*$/, ""))

  return {
    componentName: `${componentBaseName}MetricCard`,
    rootClassName: node.attribs?.class ?? "",
    rootSourceNodeId: node.attribs?.["data-source-node-id"],
    rootStyle: parseStyleRecord(node.attribs?.style ?? ""),
    headerClassName: header?.attribs?.class ?? "",
    linkHref: normalizeReferencedAssetUrl(headerLink.attribs?.href ?? ""),
    linkClassName: headerLink.attribs?.class ?? "",
    titleClassName: titleNode?.attribs?.class ?? "",
    titleTooltip: titleNode?.attribs?.["data-overflow-tooltip-text"],
    title,
    tickerClassName: tickerNode?.attribs?.class ?? "",
    ticker: normalizeVisibleText(tickerNode ? visibleText(tickerNode) : ""),
    contentClassName: content?.attribs?.class ?? "",
    chartShellClassName: chartShell?.attribs?.class ?? "",
    chartFrame: semanticChartNode(chartFrame, 0),
    statsWrapperClassName: statsWrapper?.attribs?.class ?? "",
    statsContainerClassName: statsContainer?.attribs?.class ?? "",
    stats,
  }
}

function findSemanticMetricChartHeaderLink(node: DomNode): DomNode | undefined {
  return findDescendantElement(
    node,
    (child) =>
      child.name?.toLowerCase() === "a" &&
      Boolean(semanticMetricChartTitleNode(child)) &&
      Boolean(findDescendantElement(child, (candidate) => hasClassMatching(candidate, /^tickerBox-/))),
  )
}

function semanticMetricChartTitleNode(node: DomNode): DomNode | undefined {
  return findDescendantElement(node, (child) => hasClassMatching(child, /^title-/))
}

function findSemanticMetricChartFrame(node: DomNode): DomNode | undefined {
  const lightweightChart = findDescendantElement(node, (child) => hasClassMatching(child, /^tv-lightweight-charts$/))
  return (
    lightweightChart ??
    findDescendantElement(
      node,
      (child) =>
        child.name?.toLowerCase() === "canvas" &&
        /backgroundImage|background-image|url\(/.test(child.attribs?.style ?? ""),
    )
  )
}

function semanticMetricChartStats(node: DomNode): SemanticMetricChartStat[] {
  return findDescendantElements(node, isSemanticMetricChartStatNode)
    .map((statNode) => {
      const labelNode = findDescendantElement(statNode, (child) => hasClassMatching(child, /^label-/))
      const valueNode = findDescendantElement(statNode, (child) => hasClassMatching(child, /^value-/))
      const valueInner = valueNode ? firstElementChild(valueNode) : undefined
      return {
        wrapperClassName: statNode.attribs?.class ?? "",
        labelClassName: labelNode?.attribs?.class ?? "",
        label: normalizeVisibleText(labelNode ? visibleText(labelNode) : ""),
        valueClassName: valueNode?.attribs?.class ?? "",
        value: normalizeVisibleText(valueNode ? visibleText(valueNode) : ""),
        valueInnerClassName: valueInner?.attribs?.class ?? "",
      }
    })
    .filter((stat) => stat.label || stat.value)
    .slice(0, 8)
}

function isSemanticMetricChartStatNode(node: DomNode): boolean {
  if (node.type !== "tag") return false
  if (hasClassMatching(node, /^wrapper-yXjDRT2e/)) return true
  const children = directElementChildren(node)
  if (children.length < 2 || children.length > 3) return false
  return (
    children.some((child) => hasClassMatching(child, /^label-/)) &&
    children.some((child) => hasClassMatching(child, /^value-/))
  )
}

function semanticChartNode(node: DomNode, depth: number): SemanticChartNode | undefined {
  if (depth > 8 || node.type !== "tag") return undefined
  const tagName = node.name?.toLowerCase()
  if (
    tagName !== "table" &&
    tagName !== "tbody" &&
    tagName !== "tr" &&
    tagName !== "td" &&
    tagName !== "div" &&
    tagName !== "canvas"
  )
    return undefined
  const children = directElementChildren(node)
    .map((child) => semanticChartNode(child, depth + 1))
    .filter((child): child is SemanticChartNode => Boolean(child))
  return {
    tagName,
    className: node.attribs?.class ?? "",
    style: parseStyleRecord(node.attribs?.style ?? ""),
    width: node.attribs?.width,
    height: node.attribs?.height,
    children,
  }
}

function extractSemanticMetricRankingCard(
  node: DomNode,
  sourceRegionComponentName: string,
  context: SourceDomRenderContext,
): SemanticMetricRankingCard | undefined {
  const list = findSemanticMetricRankingList(node)
  const headerRow = findSemanticMetricRankingHeaderRow(node)
  if (!list || !headerRow) return undefined
  const rows = directElementChildren(list)
    .filter((child) => child.name?.toLowerCase() === "li")
    .map(semanticMetricRankingRow)
    .filter((row): row is SemanticMetricRankingRow => Boolean(row))
  if (rows.length < 3) return undefined

  const wrapper = firstElementChild(node)
  const titleNode = findDescendantElement(
    wrapper ?? node,
    (child) =>
      child !== headerRow &&
      (child.attribs?.["data-source-role"] === "header" ||
        hasClassMatching(child, /^header-/) ||
        hasClassMatching(child, /^title-/)) &&
      normalizeVisibleText(visibleText(child)).length > 0,
  )
  const firstItem = directElementChildren(list).find((child) => child.name?.toLowerCase() === "li")
  const firstOuter = firstItem ? firstElementChild(firstItem) : undefined
  const firstInner = firstOuter ? firstElementChild(firstOuter) : undefined
  const firstImage = firstItem
    ? findDescendantElement(firstItem, (child) => child.name?.toLowerCase() === "img")
    : undefined
  const firstLink = firstItem
    ? findDescendantElement(firstItem, (child) => child.name?.toLowerCase() === "a")
    : undefined
  const firstTitleContainer = firstLink ? firstElementChild(firstLink) : undefined
  const firstLabel = firstLink
    ? findDescendantElement(firstLink, (child) => hasClassMatching(child, /^title-/))
    : undefined
  const firstValueCell = firstItem ? findDescendantElement(firstItem, isSemanticMetricValueCell) : undefined
  const firstValue = firstValueCell
    ? findDescendantElement(firstValueCell, (child) => hasClassMatching(child, /^value-/))
    : undefined
  const firstUnit = firstValueCell
    ? findDescendantElement(firstValueCell, (child) => hasClassMatching(child, /^unit-/))
    : undefined
  const titleText = normalizeVisibleText(
    titleNode ? visibleText(titleNode) : sourceRegionComponentName.replace(/Region\d*$/, ""),
  )
  const componentName = `${toPascalIdentifier(titleText || sourceRegionComponentName.replace(/Region\d*$/, ""))}Ranking`

  return {
    componentName,
    rootClassName: node.attribs?.class ?? "",
    rootSourceNodeId: node.attribs?.["data-source-node-id"],
    rootStyle: semanticNodeStyleRecord(node, context),
    wrapperClassName: wrapper?.attribs?.class ?? "",
    titleClassName: titleNode?.attribs?.class ?? "",
    titleText,
    headerRowClassName: headerRow.attribs?.class ?? "",
    headerLabels: semanticMetricRankingHeaderLabels(headerRow),
    headerLabelClassName: directElementChildren(headerRow)[0]?.attribs?.class ?? "",
    listClassName: list.attribs?.class ?? "",
    itemClassName: firstItem?.attribs?.class ?? "",
    rowOuterClassName: firstOuter?.attribs?.class ?? "",
    rowInnerClassName: firstInner?.attribs?.class ?? "",
    imageClassName: firstImage?.attribs?.class ?? "",
    linkClassName: firstLink?.attribs?.class ?? "",
    titleContainerClassName: firstTitleContainer?.attribs?.class ?? "",
    labelClassName: firstLabel?.attribs?.class ?? "",
    valueCellClassName: firstValueCell?.attribs?.class ?? "",
    valueClassName: firstValue?.attribs?.class ?? "",
    unitClassName: firstUnit?.attribs?.class ?? "",
    rows,
  }
}

function findSemanticMetricRankingList(node: DomNode): DomNode | undefined {
  return findDescendantElement(node, (child) => {
    if (child.name?.toLowerCase() !== "ul") return false
    const distance = descendantElementDistance(node, child)
    if (distance === undefined || distance > 4) return false
    return directElementChildren(child).filter((item) => item.name?.toLowerCase() === "li").length >= 3
  })
}

function findSemanticMetricRankingHeaderRow(node: DomNode): DomNode | undefined {
  return findDescendantElement(node, (child) => {
    if (semanticMetricRankingHeaderLabels(child).length < 2) return false
    if (child.attribs?.["data-source-role"] === "header") return true
    return (
      hasClassMatching(child, /^header-/) &&
      (hasClassMatching(child, /^column/) ||
        /\b(country|gdp|growth|nominal|rate|inflation|unemployment|market cap|population)\b/i.test(visibleText(child)))
    )
  })
}

function semanticMetricRankingHeaderLabels(node: DomNode): string[] {
  return directElementChildren(node)
    .map((child) => normalizeVisibleText(visibleText(child)))
    .filter(Boolean)
}

function semanticMetricRankingRow(item: DomNode): SemanticMetricRankingRow | undefined {
  const anchor = findDescendantElement(item, (child) => child.name?.toLowerCase() === "a")
  const labelNode = anchor ? findDescendantElement(anchor, (child) => hasClassMatching(child, /^title-/)) : undefined
  const label = normalizeVisibleText(labelNode ? visibleText(labelNode) : anchor ? visibleText(anchor) : "")
  if (!label) return undefined
  const image = findDescendantElement(item, (child) => child.name?.toLowerCase() === "img")
  const values = findDescendantElements(item, isSemanticMetricValueCell)
    .map((cell) => {
      const valueNode = findDescendantElement(cell, (child) => hasClassMatching(child, /^value-/))
      const unitNode = findDescendantElement(cell, (child) => hasClassMatching(child, /^unit-/))
      return {
        value: normalizeVisibleText(valueNode ? visibleText(valueNode) : visibleText(cell)),
        unit: normalizeVisibleText(unitNode ? visibleText(unitNode) : ""),
      }
    })
    .filter((cell) => cell.value || cell.unit)
  if (values.length < 1) return undefined
  return {
    label,
    href: normalizeReferencedAssetUrl(anchor?.attribs?.href ?? ""),
    imageSrc: normalizeReferencedAssetUrl(image?.attribs?.src ?? ""),
    imageAlt: image?.attribs?.alt ?? "",
    values,
  }
}

function isSemanticMetricValueCell(node: DomNode): boolean {
  return hasClassMatching(node, /^container-ItI7saAL/) || hasClassMatching(node, /^valueCell-/)
}

function findDirectChildBySourceRole(node: DomNode, role: string): DomNode | undefined {
  return directElementChildren(node).find((child) => child.attribs?.["data-source-role"] === role)
}

function pickDataAttributes(attrs: Record<string, string>, names: string[]): Record<string, string> {
  const picked: Record<string, string> = {}
  for (const name of names) {
    const value = attrs[name]
    if (value) picked[name] = value
  }
  return picked
}

function parseStyleRecord(style: string): Record<string, string> | undefined {
  const entries: Record<string, string> = {}
  for (const rawPart of style.split(";")) {
    const part = rawPart.trim()
    if (!part) continue
    const colon = part.indexOf(":")
    if (colon < 1) continue
    const key = part.slice(0, colon).trim()
    const value = part.slice(colon + 1).trim()
    if (key && value) entries[toStyleKey(key)] = value
  }
  return Object.keys(entries).length > 0 ? entries : undefined
}

function isSemanticEventCardListCandidate(node: DomNode): boolean {
  const itemsContainer = findSemanticEventCardContainer(node)
  if (!itemsContainer) return false
  const containerDistance = descendantElementDistance(node, itemsContainer)
  if (containerDistance === undefined || containerDistance > 4) return false
  const cards = semanticEventCardAnchors(itemsContainer)
  if (cards.length < 3) return false
  return true
}

function extractSemanticEventCardList(
  node: DomNode,
  sourceRegionComponentName: string,
): SemanticEventCardList | undefined {
  const itemsContainer = findSemanticEventCardContainer(node)
  const cardAnchors = itemsContainer ? semanticEventCardAnchors(itemsContainer) : []
  if (!itemsContainer || cardAnchors.length < 3) return undefined
  const items = cardAnchors
    .map(semanticEventCardItem)
    .filter((item): item is SemanticEventCardItem => Boolean(item))
    .slice(0, 80)
  if (items.length < 3) return undefined

  const header = findDirectChildBySourceRole(node, "header")
  const headerWrapper = header ? firstElementChild(header) : undefined
  const titleWrapper = headerWrapper ? firstElementChild(headerWrapper) : undefined
  const titleContainer = titleWrapper ? firstElementChild(titleWrapper) : undefined
  const titleLink = titleContainer
    ? findDescendantElement(titleContainer, (child) => child.name?.toLowerCase() === "a")
    : undefined
  const titleNode = findDescendantElement(titleContainer ?? node, (child) => /^h[1-4]$/i.test(child.name ?? ""))
  const content = findDescendantElement(
    node,
    (child) => child.attribs?.["data-qa-id"]?.endsWith("-content") || hasClassMatching(child, /^content-/),
  )
  const wrapper = content ? firstElementChild(content) : undefined
  const container = wrapper ? firstElementChild(wrapper) : undefined
  const componentName = sourceRegionComponentName.replace(/Region\d*$/, "List")
  const rootDataAttrs = pickDataAttributes(node.attribs ?? {}, [
    "data-base-widget",
    "data-container-name",
    "data-an-widget-id",
  ])
  const chromeClassNames = directElementChildren(itemsContainer)
    .filter((child) => !isSemanticEventCardAnchor(child))
    .map((child) => child.attribs?.class ?? "")
    .filter(Boolean)
    .slice(0, 6)

  return {
    componentName: componentName === sourceRegionComponentName ? `${sourceRegionComponentName}List` : componentName,
    rootClassName: node.attribs?.class ?? "",
    rootDataAttrs,
    rootSourceNodeId: node.attribs?.["data-source-node-id"],
    headerClassName: header?.attribs?.class ?? "",
    headerWrapperClassName: headerWrapper?.attribs?.class ?? "",
    titleWrapperClassName: titleWrapper?.attribs?.class ?? "",
    titleContainerClassName: titleContainer?.attribs?.class ?? "",
    titleClassName: titleNode?.attribs?.class ?? "",
    titleId: titleNode?.attribs?.id,
    titleHref: normalizeReferencedAssetUrl(titleLink?.attribs?.href ?? ""),
    titleLinkClassName: titleLink?.attribs?.class ?? "",
    titleText: normalizeVisibleText(
      titleNode ? visibleText(titleNode) : sourceRegionComponentName.replace(/Region\d*$/, ""),
    ),
    contentClassName: content?.attribs?.class ?? "",
    wrapperClassName: wrapper?.attribs?.class ?? "",
    containerClassName: container?.attribs?.class ?? "",
    itemsClassName: itemsContainer.attribs?.class ?? "",
    chromeClassNames,
    items,
  }
}

function findSemanticEventCardContainer(node: DomNode): DomNode | undefined {
  const candidates = findDescendantElements(node, (child) => {
    if (child.type !== "tag") return false
    if (!hasClassMatching(child, /^items-/) && child.attribs?.["data-source-role"] !== "grid") return false
    return semanticEventCardAnchors(child).length >= 3
  })
  return candidates.length === 1 ? candidates[0] : undefined
}

function semanticEventCardAnchors(node: DomNode): DomNode[] {
  return directElementChildren(node).filter(isSemanticEventCardAnchor)
}

function isSemanticEventCardAnchor(node: DomNode): boolean {
  if (node.type !== "tag" || node.name?.toLowerCase() !== "a") return false
  if (!hasClassMatching(node, /^wrap-/)) return false
  const title = findDescendantElement(node, (child) => hasClassMatching(child, /^title-/))
  const stats = findDescendantElement(node, (child) => hasClassMatching(child, /^stats-/))
  return Boolean(title && stats)
}

function semanticEventCardItem(anchor: DomNode): SemanticEventCardItem | undefined {
  const titleNode = findDescendantElement(anchor, (child) => hasClassMatching(child, /^title-/))
  const title = normalizeVisibleText(titleNode ? visibleText(titleNode) : "")
  if (!title) return undefined
  const top = findDescendantElement(anchor, (child) => hasClassMatching(child, /^top-/))
  const date = findDescendantElement(anchor, (child) => hasClassMatching(child, /^date-/))
  const day = findDescendantElement(anchor, (child) => hasClassMatching(child, /^day-/))
  const dot = findDescendantElement(anchor, (child) => hasClassMatching(child, /^dot-/))
  const timestampWrapper = findDescendantElement(
    anchor,
    (child) => hasClassMatching(child, /^wrap-/) && /GMT|UTC|20\d{2}/.test(child.attribs?.title ?? ""),
  )
  const badge = timestampWrapper
    ? findDescendantElement(timestampWrapper, (child) => hasClassMatching(child, /^badge-/))
    : undefined
  const badgeContent = badge ? firstElementChild(badge) : undefined
  const titleBlock = findDescendantElement(anchor, (child) => hasClassMatching(child, /^titleBlock-/))
  const flag = titleBlock
    ? findDescendantElement(titleBlock, (child) => child.name?.toLowerCase() === "img")
    : undefined
  const column = titleBlock
    ? findDescendantElement(titleBlock, (child) => hasClassMatching(child, /^column-/))
    : undefined
  const statsNode = findDescendantElement(anchor, (child) => hasClassMatching(child, /^stats-/))
  const stats = statsNode
    ? directElementChildren(statsNode)
        .map(semanticEventCardStat)
        .filter((item): item is SemanticEventCardStat => Boolean(item))
        .slice(0, 8)
    : []
  if (stats.length === 0) return undefined
  return {
    href: normalizeReferencedAssetUrl(anchor.attribs?.href ?? ""),
    cardClassName: anchor.attribs?.class ?? "",
    topClassName: top?.attribs?.class ?? "",
    dateClassName: date?.attribs?.class ?? "",
    dayClassName: day?.attribs?.class ?? "",
    dayText: normalizeVisibleText(day ? visibleText(day) : ""),
    dotClassName: dot?.attribs?.class ?? "",
    dotText: normalizeVisibleText(dot ? visibleText(dot) : ""),
    timestampWrapperClassName: timestampWrapper?.attribs?.class ?? "",
    badgeClassName: badge?.attribs?.class ?? "",
    badgeContentClassName: badgeContent?.attribs?.class ?? "",
    timestampTitle: timestampWrapper?.attribs?.title,
    titleBlockClassName: titleBlock?.attribs?.class ?? "",
    flagSrc: normalizeReferencedAssetUrl(flag?.attribs?.src ?? ""),
    flagClassName: flag?.attribs?.class ?? "",
    flagTooltip: flag?.attribs?.["data-tooltip"],
    columnClassName: column?.attribs?.class ?? "",
    titleClassName: titleNode?.attribs?.class ?? "",
    title,
    statsClassName: statsNode?.attribs?.class ?? "",
    stats,
  }
}

function semanticEventCardStat(node: DomNode): SemanticEventCardStat | undefined {
  const titleNode = findDescendantElement(node, (child) => hasClassMatching(child, /^title-/))
  const valueWrap = findDescendantElement(node, (child) => hasClassMatching(child, /^valueWrap-/))
  const valueNode = findDescendantElement(
    node,
    (child) => hasClassMatching(child, /^value-/) || hasClassMatching(child, /^highlighted-/),
  )
  const unitNode = findDescendantElement(node, (child) => hasClassMatching(child, /^unit-/))
  const label = normalizeVisibleText(titleNode ? visibleText(titleNode) : "")
  const value = normalizeVisibleText(valueNode ? visibleText(valueNode) : "")
  if (!label && !value) return undefined
  return {
    wrapperClassName: node.attribs?.class ?? "",
    titleClassName: titleNode?.attribs?.class ?? "",
    label,
    valueWrapClassName: valueWrap?.attribs?.class ?? "",
    valueClassName: valueNode?.attribs?.class ?? "",
    value,
    unitClassName: unitNode?.attribs?.class ?? "",
    unit: normalizeVisibleText(unitNode ? visibleText(unitNode) : ""),
  }
}

function isSemanticFooterCandidate(node: DomNode): boolean {
  const tag = node.name?.toLowerCase() ?? ""
  const className = node.attribs?.class ?? ""
  if (tag !== "footer" && !/\btv-footer\b/.test(className)) return false
  const links = findDescendantElements(node, (child) => child.name?.toLowerCase() === "a")
  return links.length >= 4 && visibleText(node).length > 80
}

function extractSemanticFooter(node: DomNode, sourceRegionComponentName: string): SemanticFooter | undefined {
  const promo = findDescendantElement(node, (child) =>
    /(?:promo-footer|footer-shell)/i.test(child.attribs?.class ?? ""),
  )
  const visualRoot = findDescendantElement(node, (child) => hasClassMatching(child, /^root-/))
  const container = findDescendantElement(visualRoot ?? promo ?? node, (child) =>
    hasClassMatching(child, /^container-/),
  )
  const content = container
    ? directElementChildren(container).find((child) => hasClassMatching(child, /^content-/))
    : undefined
  const leading = content
    ? directElementChildren(content).find(
        (child) => child.name?.toLowerCase() === "div" && !hasClassMatching(child, /^footerLinks-/),
      )
    : undefined
  const logoSocials = findDescendantElement(leading ?? node, (child) => hasClassMatching(child, /^logoSocials-/))
  const logoAnchor = logoSocials
    ? findDescendantElement(
        logoSocials,
        (child) => child.name?.toLowerCase() === "a" && hasClassMatching(child, /^logoWrapper-/),
      )
    : undefined
  const logoMark = logoAnchor
    ? findDescendantElement(logoAnchor, (child) => hasClassMatching(child, /^logo-/))
    : undefined
  const socials = logoSocials
    ? findDescendantElement(logoSocials, (child) => hasClassMatching(child, /^socials-/))
    : undefined
  const socialLinks = (socials ? directElementChildren(socials) : [])
    .filter((child) => child.name?.toLowerCase() === "a")
    .map(semanticFooterLink)
    .filter((item): item is SemanticFooterLink => Boolean(item))
  const copyrightContainer = findDescendantElement(leading ?? node, (child) =>
    hasClassMatching(child, /^copyrightContainer-/),
  )
  const languageButton = findDescendantElement(
    copyrightContainer ?? node,
    (child) => child.name?.toLowerCase() === "button" && /language/i.test(child.attribs?.class ?? ""),
  )
  const copyright = findDescendantElement(
    copyrightContainer ?? node,
    (child) => child.name?.toLowerCase() === "p" && hasClassMatching(child, /^copyright-/),
  )
  const footerLinks = findDescendantElement(content ?? node, (child) => hasClassMatching(child, /^footerLinks-/))
  const linkGroups = extractSemanticFooterLinkGroups(footerLinks)
  const footerLinkCount = linkGroups.flatMap((group) => group.columns).flatMap((column) => column.links).length
  if (socialLinks.length + footerLinkCount < 4) return undefined
  const backgroundImage = container
    ? directElementChildren(container).find((child) => hasClassMatching(child, /^backgroundImage-/))
    : undefined
  const lookFirstContainer = container
    ? directElementChildren(container).find((child) => hasClassMatching(child, /^lookFirstContainer-/))
    : undefined
  const pepeContainer = lookFirstContainer
    ? findDescendantElement(lookFirstContainer, (child) => hasClassMatching(child, /^pepeContainer-/))
    : undefined
  const pepeLauncher = container
    ? directElementChildren(container).find((child) => hasClassMatching(child, /^pepeLauncher-/))
    : undefined
  const images = findDescendantElements(lookFirstContainer ?? node, (child) => child.name?.toLowerCase() === "img")
    .map((image) => ({
      src: normalizeReferencedAssetUrl(image.attribs?.src ?? ""),
      alt: image.attribs?.alt ?? "",
      className: image.attribs?.class ?? "",
    }))
    .filter((image) => image.src && image.src !== "data:,")
    .slice(0, 12)
  const componentName = sourceRegionComponentName.replace(/Region\d*$/, "Navigation")
  return {
    componentName:
      componentName === sourceRegionComponentName ? `${sourceRegionComponentName}Navigation` : componentName,
    rootClassName: node.attribs?.class ?? "",
    rootSourceNodeId: node.attribs?.["data-source-node-id"],
    dataNosnippet: node.attribs?.["data-nosnippet"],
    promoClassName: promo?.attribs?.class ?? "",
    visualRootClassName: visualRoot?.attribs?.class ?? "",
    containerClassName: container?.attribs?.class ?? "",
    contentClassName: content?.attribs?.class ?? "",
    leadingClassName: leading?.attribs?.class ?? "",
    logoSocialsClassName: logoSocials?.attribs?.class ?? "",
    logoLink: logoAnchor ? semanticFooterLogoLink(logoAnchor, logoMark) : undefined,
    socialsClassName: socials?.attribs?.class ?? "",
    socialLinks,
    copyrightContainerClassName: copyrightContainer?.attribs?.class ?? "",
    languageButtonClassName: languageButton?.attribs?.class ?? "",
    copyrightClassName: copyright?.attribs?.class ?? "",
    legalParts: copyright ? semanticFooterLegalParts(copyright) : [],
    footerLinksClassName: footerLinks?.attribs?.class ?? "",
    linkGroups,
    backgroundImageClassName: backgroundImage?.attribs?.class ?? "",
    lookFirstContainerClassName: lookFirstContainer?.attribs?.class ?? "",
    images,
    pepeContainerClassName: pepeContainer?.attribs?.class ?? "",
    pepeLauncherClassName: pepeLauncher?.attribs?.class ?? "",
    languageLabel: languageButton ? normalizeVisibleText(visibleText(languageButton)) : undefined,
  }
}

function semanticFooterLink(anchor: DomNode): SemanticFooterLink | undefined {
  const label = normalizeVisibleText(anchor.attribs?.["aria-label"] ?? visibleText(anchor))
  const href = normalizeReferencedAssetUrl(anchor.attribs?.href ?? "")
  if (!label || !href) return undefined
  return {
    href,
    label,
    ariaLabel: anchor.attribs?.["aria-label"],
    className: anchor.attribs?.class ?? "",
    target: anchor.attribs?.target,
    rel: anchor.attribs?.rel,
    iconClassName: findDescendantElement(anchor, (child) => child.name?.toLowerCase() === "span")?.attribs?.class,
  }
}

function semanticFooterLogoLink(anchor: DomNode, mark?: DomNode): SemanticFooterLogoLink | undefined {
  const link = semanticFooterLink(anchor)
  if (!link) return undefined
  return {
    ...link,
    markClassName: mark?.attribs?.class ?? "",
  }
}

function extractSemanticFooterLinkGroups(footerLinks?: DomNode): SemanticFooterLinkGroup[] {
  if (!footerLinks) return []
  const groupNodes = directElementChildren(footerLinks).filter((child) => hasClassMatching(child, /^footerLinksGroup-/))
  const groups = groupNodes.length > 0 ? groupNodes : [footerLinks]
  return groups
    .map((group) => ({
      className: group === footerLinks ? "" : (group.attribs?.class ?? ""),
      columns: extractSemanticFooterLinkColumns(group),
    }))
    .filter((group) => group.columns.length > 0)
    .slice(0, 12)
}

function extractSemanticFooterLinkColumns(group: DomNode): SemanticFooterLinkColumn[] {
  const columnNodes = directElementChildren(group).filter((child) => hasClassMatching(child, /^footerLinksColumn-/))
  const columns = columnNodes.length > 0 ? columnNodes : [group]
  return columns
    .map((column) => {
      const titleNode = directElementChildren(column).find((child) =>
        hasClassMatching(child, /^footerLinksColumnTitle-/),
      )
      const listNode = directElementChildren(column).find(
        (child) => hasClassMatching(child, /^footerLinksColumnList-/) || child.name?.toLowerCase() === "ul",
      )
      const anchorScope = listNode ?? column
      const links = findDescendantElements(anchorScope, (child) => child.name?.toLowerCase() === "a")
        .map(semanticFooterLink)
        .filter((item): item is SemanticFooterLink => Boolean(item))
        .slice(0, 40)
      return {
        className: column === group ? "" : (column.attribs?.class ?? ""),
        titleClassName: titleNode?.attribs?.class ?? "",
        title: normalizeVisibleText(titleNode ? visibleText(titleNode) : ""),
        listClassName: listNode?.attribs?.class ?? "",
        links,
      }
    })
    .filter((column) => column.links.length > 0)
    .slice(0, 24)
}

function semanticFooterLegalParts(node: DomNode): SemanticFooterLegalPart[] {
  const parts: SemanticFooterLegalPart[] = []
  function visit(current: DomNode): void {
    if (current.type === "text") {
      const text = normalizeVisibleText(current.data ?? "")
      if (text) parts.push({ kind: "text", text })
      return
    }
    if (current.type !== "tag") return
    if (current.name?.toLowerCase() === "a") {
      const link = semanticFooterLink(current)
      if (link) parts.push({ kind: "link", text: link.label, link })
      return
    }
    for (const child of current.children ?? []) visit(child)
  }
  for (const child of node.children ?? []) visit(child)
  return parts.slice(0, 80)
}

function isSemanticHeaderNavigationCandidate(node: DomNode): boolean {
  if (node.type !== "tag") return false
  const className = node.attribs?.class ?? ""
  if (!/\btv-header\b/.test(className) && node.attribs?.["data-source-role"] !== "header") return false
  const nav = findSemanticHeaderNav(node)
  if (!nav) return false
  const menuItems = extractSemanticHeaderMenuItems(nav, new Map())
  if (menuItems.length < 3) return false
  const searchButton = findDescendantElement(
    node,
    (child) =>
      child.name?.toLowerCase() === "button" &&
      normalizeVisibleText(child.attribs?.["aria-label"] ?? visibleText(child)).toLowerCase() === "search",
  )
  return Boolean(searchButton) || /\b(products|community|markets|brokers)\b/i.test(visibleText(node))
}

function extractSemanticHeaderNavigation(
  node: DomNode,
  sourceRegionComponentName: string,
  context: SourceDomRenderContext,
): SemanticHeaderNavigation | undefined {
  const nav = findSemanticHeaderNav(node)
  if (!nav) return undefined
  const menuItems = extractSemanticHeaderMenuItems(nav, context.nodeStyleFallbacks)
  if (menuItems.length < 3) return undefined

  const backdrop = findDescendantByClass(node, /^tv-header__backdrop$/)
  const inner = findDescendantByClass(node, /^tv-header__inner$/)
  const logoArea = findDescendantByClass(node, /^tv-header__area--logo-menu$/)
  const hamburger = findDescendantByClass(node, /^tv-header__hamburger-menu$/)
  const logoWrapper = findDescendantByClass(node, /^tv-header__logo$/)
  const logoLink = findDescendantElement(
    logoWrapper ?? node,
    (child) => child.name?.toLowerCase() === "a" && hasClassMatching(child, /^tv-header__link--logo$/),
  )
  const logoIconWrapper = findDescendantByClass(logoLink ?? node, /^tv-header__icon$/)
  const logoTextWrapper = findDescendantByClass(logoLink ?? node, /^tv-header__logo-text$/)
  const logoPro = findDescendantByClass(logoLink ?? node, /^js-logo-pro$/)
  const middleWrapper = findDescendantByClass(node, /^tv-header__middle-wrapper$/)
  const middleContent = findDescendantByClass(node, /^tv-header__middle-content$/)
  const searchArea = findDescendantByClass(node, /^tv-header__area--search$/)
  const searchContainer = findDescendantByClass(node, /^tv-header-search-container$/)
  const searchButton = findDescendantElement(
    searchContainer ?? node,
    (child) =>
      child.name?.toLowerCase() === "button" && hasClassMatching(child, /^tv-header-search-container__button--full$/),
  )
  const simpleSearchButton = findDescendantElement(
    searchContainer ?? node,
    (child) =>
      child.name?.toLowerCase() === "button" && hasClassMatching(child, /^tv-header-search-container__button--simple$/),
  )
  const menu = findDescendantElement(
    nav,
    (child) => child.name?.toLowerCase() === "ul" && hasClassMatching(child, /^tv-header__main-menu$/),
  )
  const userArea = findDescendantByClass(node, /^tv-header__area--user$/)
  const languageButton = findDescendantByClass(userArea ?? node, /^tv-header__language-button$/)
  const anonymousUserButton = findDescendantByClass(userArea ?? node, /^tv-header__user-menu-button--anonymous$/)
  const loggedUserButton = findDescendantByClass(userArea ?? node, /^tv-header__user-menu-button--logged$/)
  const offerShell = findDescendantByClass(userArea ?? node, /^js-offer-button$/)
  const offerContainer = findDescendantByClass(offerShell ?? userArea ?? node, /^tv-header__offer-button-container/)
  const offerAnchor = findDescendantElement(
    offerContainer ?? node,
    (child) => child.name?.toLowerCase() === "a" && hasClassMatching(child, /^tv-header__offer-button$/),
  )
  const offerContent = findDescendantElement(offerAnchor ?? node, (child) => hasClassMatching(child, /^content-/))
  const offerChildren = findDescendantElement(offerContent ?? node, (child) => hasClassMatching(child, /^children-/))
  const offerTitle = findDescendantByClass(offerAnchor ?? node, /^tv-header__offer-button-title$/)

  const logoHeaderLink = logoLink ? semanticHeaderLink(logoLink, "TradingView main page") : undefined
  if (!logoHeaderLink) return undefined
  const componentBase = sourceRegionComponentName.replace(/Region\d*$/, "Navigation")
  return {
    componentName:
      componentBase === sourceRegionComponentName ? `${sourceRegionComponentName}Navigation` : componentBase,
    rootClassName: node.attribs?.class ?? "",
    rootSourceNodeId: node.attribs?.["data-source-node-id"],
    rootDataAttrs: pickDataAttributes(node.attribs ?? {}, ["data-source-role"]),
    backdropClassName: backdrop?.attribs?.class ?? "",
    innerClassName: inner?.attribs?.class ?? "",
    logoAreaClassName: logoArea?.attribs?.class ?? "",
    hamburger: hamburger ? semanticHeaderButton(hamburger, context.nodeStyleFallbacks) : undefined,
    logoWrapperClassName: logoWrapper?.attribs?.class ?? "",
    logoLink: logoHeaderLink,
    logoIconWrapperClassName: logoIconWrapper?.attribs?.class ?? "",
    logoIcon: semanticSvgIcon(
      findDescendantElement(logoIconWrapper ?? logoLink ?? node, (child) => child.name?.toLowerCase() === "svg"),
      context.nodeStyleFallbacks,
    ),
    logoTextWrapperClassName: logoTextWrapper?.attribs?.class ?? "",
    logoTextIcon: logoTextWrapper
      ? semanticSvgIcon(
          findDescendantElement(logoTextWrapper, (child) => child.name?.toLowerCase() === "svg"),
          context.nodeStyleFallbacks,
        )
      : undefined,
    logoTextFallback: logoTextWrapper ? undefined : semanticHeaderLogoFallbackText(logoHeaderLink),
    logoProClassName: logoPro?.attribs?.class ?? "",
    middleWrapperClassName: middleWrapper?.attribs?.class ?? "",
    middleContentClassName: middleContent?.attribs?.class ?? "",
    searchAreaClassName: searchArea?.attribs?.class ?? "",
    searchContainerClassName: searchContainer?.attribs?.class ?? "",
    searchButton: searchButton ? semanticHeaderButton(searchButton, context.nodeStyleFallbacks) : undefined,
    simpleSearchButton: simpleSearchButton
      ? semanticHeaderButton(simpleSearchButton, context.nodeStyleFallbacks)
      : undefined,
    navClassName: nav.attribs?.class ?? "",
    menuClassName: menu?.attribs?.class ?? "",
    menuItems,
    userAreaClassName: userArea?.attribs?.class ?? "",
    languageButton: languageButton ? semanticHeaderButton(languageButton, context.nodeStyleFallbacks) : undefined,
    anonymousUserButton: anonymousUserButton
      ? semanticHeaderButton(anonymousUserButton, context.nodeStyleFallbacks)
      : undefined,
    loggedUserButtonClassName: loggedUserButton?.attribs?.class ?? "",
    offerShellClassName: offerShell?.attribs?.class ?? "",
    offerPropsId: offerShell?.attribs?.["data-props-id"],
    offerRenderMode: offerShell?.attribs?.["data-render-mode"],
    offerContainerClassName: offerContainer?.attribs?.class ?? "",
    offerLink: offerAnchor
      ? semanticHeaderLink(offerAnchor, normalizeVisibleText(visibleText(offerAnchor)))
      : undefined,
    offerContentClassName: offerContent?.attribs?.class ?? "",
    offerChildrenClassName: offerChildren?.attribs?.class ?? "",
    offerTitleClassName: offerTitle?.attribs?.class ?? "",
  }
}

function findSemanticHeaderNav(node: DomNode): DomNode | undefined {
  return findDescendantElement(
    node,
    (child) =>
      child.name?.toLowerCase() === "nav" &&
      (child.attribs?.["data-source-role"] === "nav" || hasClassMatching(child, /^tv-header__area--menu$/)),
  )
}

function extractSemanticHeaderMenuItems(
  nav: DomNode,
  nodeStyleFallbacks: Map<string, string>,
): SemanticHeaderMenuItem[] {
  const menu = findDescendantElement(
    nav,
    (child) => child.name?.toLowerCase() === "ul" && hasClassMatching(child, /^tv-header__main-menu$/),
  )
  const listItems = menu ? directElementChildren(menu).filter((child) => child.name?.toLowerCase() === "li") : []
  return listItems
    .map((item): SemanticHeaderMenuItem | undefined => {
      const link = directElementChildren(item).find((child) => child.name?.toLowerCase() === "a")
      if (!link) return undefined
      const href = normalizeReferencedAssetUrl(link.attribs?.href ?? "")
      const label = normalizeVisibleText(visibleText(link))
      if (!href || !label) return undefined
      const chevron = findDescendantElement(link, (child) =>
        hasClassMatching(child, /^tv-header__main-menu-item__chevron$/),
      )
      return {
        className: item.attribs?.class ?? "",
        dropdownRootIndex: item.attribs?.["data-main-menu-dropdown-root-index"],
        href,
        trackId: link.attribs?.["data-main-menu-root-track-id"],
        label,
        chevronClassName: chevron?.attribs?.class ?? "",
        chevronAriaLabel: chevron?.attribs?.["aria-label"],
        chevronAriaHasPopup: chevron?.attribs?.["aria-haspopup"],
        chevronAriaExpanded: chevron?.attribs?.["aria-expanded"],
        chevronRole: chevron?.attribs?.role,
        chevronIcon: semanticSvgIcon(
          findDescendantElement(chevron ?? link, (child) => child.name?.toLowerCase() === "svg"),
          nodeStyleFallbacks,
        ),
      }
    })
    .filter((item): item is SemanticHeaderMenuItem => Boolean(item))
    .slice(0, 12)
}

function semanticHeaderButton(node: DomNode, nodeStyleFallbacks: Map<string, string>): SemanticHeaderButton {
  const textNode = findDescendantElement(
    node,
    (child) =>
      hasClassMatching(child, /^tv-header-search-container__text$/) ||
      hasClassMatching(child, /^tv-header__offer-button-title$/),
  )
  const visibleLabel = normalizeVisibleText(visibleText(textNode ?? node))
  return {
    className: node.attribs?.class ?? "",
    label: visibleLabel,
    ariaLabel: node.attribs?.["aria-label"],
    ariaHasPopup: node.attribs?.["aria-haspopup"],
    ariaExpanded: node.attribs?.["aria-expanded"],
    type: node.attribs?.type,
    icon: semanticSvgIcon(
      findDescendantElement(node, (child) => child.name?.toLowerCase() === "svg"),
      nodeStyleFallbacks,
    ),
    textClassName: textNode?.attribs?.class,
  }
}

function semanticHeaderLink(node: DomNode, fallbackLabel: string): SemanticHeaderLink | undefined {
  const href = normalizeReferencedAssetUrl(node.attribs?.href ?? "")
  const label = normalizeVisibleText(visibleText(node) || node.attribs?.["aria-label"] || fallbackLabel)
  if (!href || !label) return undefined
  return {
    className: node.attribs?.class ?? "",
    href,
    label,
    ariaLabel: node.attribs?.["aria-label"],
    target: node.attribs?.target,
    rel: node.attribs?.rel,
  }
}

function semanticHeaderLogoFallbackText(link: SemanticHeaderLink): string | undefined {
  const label = normalizeVisibleText(link.ariaLabel ?? link.label)
    .replace(/\bmain page\b/gi, "")
    .replace(/\bhome page\b/gi, "")
    .trim()
  return label || undefined
}

function semanticSvgIcon(
  svg: DomNode | undefined,
  nodeStyleFallbacks: Map<string, string>,
): SemanticSvgIcon | undefined {
  if (!svg || svg.type !== "tag" || svg.name?.toLowerCase() !== "svg") return undefined
  const paths = findDescendantElements(
    svg,
    (child) => child.name?.toLowerCase() === "path" && Boolean(child.attribs?.["data-asset-d"]),
  )
    .map((pathNode) => semanticMapPath(pathNode, nodeStyleFallbacks))
    .filter((item): item is SemanticMapPath => Boolean(item))
  const circles = findDescendantElements(svg, (child) => child.name?.toLowerCase() === "circle").map((circle) =>
    semanticElementAttributeRecord(circle),
  )
  return {
    width: svg.attribs?.width,
    height: svg.attribs?.height,
    viewBox: svg.attribs?.viewBox,
    className: svg.attribs?.class,
    fill: svg.attribs?.fill,
    xmlns: svg.attribs?.xmlns,
    preserveAspectRatio: svg.attribs?.preserveAspectRatio ?? svg.attribs?.preserveaspectratio,
    paths,
    circles,
  }
}

function semanticElementAttributeRecord(node: DomNode): Record<string, unknown> {
  const record: Record<string, unknown> = {}
  for (const [rawName, rawValue] of Object.entries(node.attribs ?? {})) {
    if (rawName === "data-source-node-id" || rawName === "data-source-segment-id") continue
    const name = toJsxAttributeName(rawName)
    if (!name) continue
    if (name === "style") {
      const style = renderStyleRecord(rawValue)
      if (style) record.style = style
      continue
    }
    record[name] = rawValue
  }
  return record
}

function findDescendantByClass(node: DomNode, pattern: RegExp): DomNode | undefined {
  return findDescendantElement(node, (child) => hasClassMatching(child, pattern))
}

function isSemanticMapSurfaceCandidate(node: DomNode): boolean {
  if (isCompositeSemanticCardContainer(node)) return false
  const svg = findDominantAssetSvg(node)
  if (!svg?.attribs?.viewBox) return false
  if (dominantSvgBelongsToMixedCardSibling(node, svg)) return false
  const svgDistance = descendantElementDistance(node, svg)
  if (svgDistance === undefined || svgDistance > 10) return false
  const text = visibleText(node).toLowerCase()
  const classSignal = `${node.attribs?.class ?? ""} ${svg.attribs?.class ?? ""}`.toLowerCase()
  if (/\b(map|trend|chart|graph|inflation|industrial|global|country|countries|%)\b/.test(text)) return true
  if (/\b(?:map|chart|graph|series|sparkline)\b/.test(classSignal)) return true
  return node.attribs?.["data-source-role"] === "card"
}

function extractSemanticMapSurface(
  node: DomNode,
  sourceRegionComponentName: string,
  nodeStyleFallbacks: Map<string, string>,
): SemanticMapSurface | undefined {
  const svg = findDominantAssetSvg(node)
  if (!svg?.attribs?.viewBox) return undefined
  const pathNodes = findDescendantElements(
    svg,
    (child) => child.name?.toLowerCase() === "path" && Boolean(child.attribs?.["data-asset-d"]),
  )
  if (pathNodes.length < 16) return undefined
  const mapAncestorChain = elementAncestorChain(node, svg)
  const directBodyWrapper = mapAncestorChain.find(
    (ancestor, index) =>
      index > 0 &&
      findParentElement(node, ancestor) === node &&
      (ancestor.attribs?.["data-source-role"] === "card" || hasClassMatching(ancestor, /^card-/)),
  )
  const bodyWrapperIndex = directBodyWrapper ? mapAncestorChain.indexOf(directBodyWrapper) : -1
  const mapFrameStartIndex = bodyWrapperIndex >= 0 ? bodyWrapperIndex + 1 : 1
  const mapFrameNodes = mapAncestorChain
    .slice(mapFrameStartIndex)
    .filter(isSemanticMapFrameNode)
    .map((ancestor) => semanticElementFrame(ancestor, nodeStyleFallbacks))
  const header = findDirectChildBySourceRole(node, "header")
  const headerWrapper = header ? firstElementChild(header) : undefined
  const titleWrapper = headerWrapper ? firstElementChild(headerWrapper) : undefined
  const titleContainer = titleWrapper ? firstElementChild(titleWrapper) : undefined
  const titleLink = titleContainer
    ? findDescendantElement(titleContainer, (child) => child.name?.toLowerCase() === "a")
    : undefined
  const titleScope = titleContainer ?? directBodyWrapper ?? node
  const titleNode = findDescendantElement(
    titleScope,
    (child) => /^h[1-4]$/i.test(child.name ?? "") || hasClassMatching(child, /^title-/),
  )
  const content = mapAncestorChain.find(
    (child) =>
      child !== node &&
      child.attribs?.["data-qa-id"] !== "core-map-content" &&
      (child.attribs?.["data-qa-id"]?.endsWith("-content") || hasClassMatching(child, /^content-/)),
  )
  const mapContainer =
    findAncestorElement(node, svg, (child) => hasClassMatching(child, /^mapContainer-/)) ??
    findAncestorElement(node, svg, (child) => hasClassMatching(child, /^container-/) && child !== node)
  const mapWrapper =
    findAncestorElement(node, svg, (child) => hasClassMatching(child, /^mapWrapper-/)) ??
    findAncestorElement(node, svg, (child) => hasClassMatching(child, /^wrapper-/))
  const mapSpan =
    findAncestorElement(node, svg, (child) => child.attribs?.["data-qa-id"] === "core-map-content") ??
    findAncestorElement(node, svg, (child) => child.name?.toLowerCase() === "span" && hasClassMatching(child, /^map-/))
  const legend = extractSemanticMapLegend(node, svg, nodeStyleFallbacks)
  const footerAnchor = findDescendantElement(
    node,
    (child) =>
      child.name?.toLowerCase() === "a" &&
      Boolean(findAncestorElement(node, child, (ancestor) => ancestor.attribs?.["data-source-role"] === "footer")),
  )
  const rootDataAttrs = pickDataAttributes(node.attribs ?? {}, [
    "data-base-widget",
    "data-container-name",
    "data-an-widget-id",
    "data-source-role",
  ])
  const componentName = sourceRegionComponentName.replace(/Region\d*$/, "Surface")
  return {
    componentName: componentName === sourceRegionComponentName ? `${sourceRegionComponentName}Surface` : componentName,
    rootClassName: node.attribs?.class ?? "",
    rootDataAttrs,
    rootSourceNodeId: node.attribs?.["data-source-node-id"],
    rootStyle: semanticElementStyleRecord(node, nodeStyleFallbacks),
    bodyWrapperFrame: directBodyWrapper ? semanticElementFrame(directBodyWrapper, nodeStyleFallbacks) : undefined,
    headerClassName: header?.attribs?.class ?? "",
    headerWrapperClassName: headerWrapper?.attribs?.class ?? "",
    titleWrapperClassName: titleWrapper?.attribs?.class ?? "",
    titleContainerClassName: titleContainer?.attribs?.class ?? "",
    titleClassName: titleNode?.attribs?.class ?? "",
    titleId: titleNode?.attribs?.id,
    titleHref: normalizeReferencedAssetUrl(titleLink?.attribs?.href ?? ""),
    titleLinkClassName: titleLink?.attribs?.class ?? "",
    titleText: normalizeVisibleText(
      titleNode ? visibleText(titleNode) : sourceRegionComponentName.replace(/Region\d*$/, ""),
    ),
    contentClassName: content?.attribs?.class ?? "",
    mapContainerClassName: mapContainer?.attribs?.class ?? "",
    mapWrapperClassName: mapWrapper?.attribs?.class ?? "",
    mapClassName: mapSpan?.attribs?.class ?? "",
    mapFrameNodes,
    svgViewBox: svg.attribs.viewBox,
    svgClassName: svg.attribs.class ?? "",
    legend,
    legendLabels: extractMapLegendLabels(node),
    paths: pathNodes
      .map((pathNode) => semanticMapPath(pathNode, nodeStyleFallbacks))
      .filter((item): item is SemanticMapPath => Boolean(item))
      .slice(0, 500),
    footerLink: footerAnchor ? semanticFooterLink(footerAnchor) : undefined,
  }
}

function findDominantAssetSvg(node: DomNode): DomNode | undefined {
  const svgs = findDescendantElements(
    node,
    (child) => child.name?.toLowerCase() === "svg" && Boolean(child.attribs?.viewBox),
  )
  return svgs
    .map((svg) => ({
      svg,
      pathCount: findDescendantElements(
        svg,
        (child) => child.name?.toLowerCase() === "path" && Boolean(child.attribs?.["data-asset-d"]),
      ).length,
    }))
    .filter((item) => item.pathCount >= 16)
    .sort((a, b) => b.pathCount - a.pathCount)[0]?.svg
}

function elementAncestorChain(root: DomNode, target: DomNode): DomNode[] {
  function visit(current: DomNode, ancestors: DomNode[]): DomNode[] | undefined {
    if (current === target) return ancestors.filter((ancestor) => ancestor.type === "tag")
    for (const child of current.children ?? []) {
      const found = visit(child, current.type === "tag" ? [...ancestors, current] : ancestors)
      if (found) return found
    }
    return undefined
  }
  return visit(root, []) ?? []
}

function isSemanticMapFrameNode(node: DomNode): boolean {
  const tagName = node.name?.toLowerCase()
  if (tagName !== "div" && tagName !== "span") return false
  if (node.attribs?.["data-qa-id"] === "core-map-content") return true
  if (node.attribs?.["data-color-preset"] || node.attribs?.["data-loading-status"]) return true
  return hasClassMatching(node, /^(?:content|container|map|mapContainer|mapWrapper|wrapper)-/)
}

function semanticElementFrame(node: DomNode, nodeStyleFallbacks: Map<string, string>): SemanticElementFrame {
  const attrs = node.attribs ?? {}
  const style = semanticElementStyleRecord(node, nodeStyleFallbacks)
  return {
    tagName: node.name?.toLowerCase() ?? "div",
    className: attrs.class ?? "",
    dataAttrs: pickDataAttributes(attrs, ["data-qa-id", "data-color-preset", "data-loading-status"]),
    style,
    id: attrs.id,
    semanticRole: semanticElementFrameRole(node),
  }
}

function semanticElementStyleRecord(
  node: DomNode,
  nodeStyleFallbacks: Map<string, string>,
): Record<string, string> | undefined {
  const attrs = node.attribs ?? {}
  const fallbackStyle = attrs["data-source-node-id"] ? nodeStyleFallbacks.get(attrs["data-source-node-id"]) : undefined
  return parseStyleRecord(fallbackStyle ? `${attrs.style ?? ""};${fallbackStyle}` : (attrs.style ?? ""))
}

function semanticElementFrameRole(node: DomNode): string | undefined {
  if (node.attribs?.["data-qa-id"] === "core-map-content") return "mapContent"
  if (hasClassMatching(node, /^mapContainer-/)) return "mapContainer"
  if (hasClassMatching(node, /^mapWrapper-/)) return "mapWrapper"
  if (hasClassMatching(node, /^wrapper-/)) return "mapInnerWrapper"
  if (hasClassMatching(node, /^map-/)) return "mapLayer"
  if (hasClassMatching(node, /^content-/)) return "content"
  if (hasClassMatching(node, /^card-/)) return "card"
  if (hasClassMatching(node, /^container-/)) return "container"
  return undefined
}

function semanticMapPath(pathNode: DomNode, nodeStyleFallbacks: Map<string, string>): SemanticMapPath | undefined {
  const assetPath = normalizeAssetPath(pathNode.attribs?.["data-asset-d"] ?? "")
  if (!assetPath) return undefined
  const item = sourceSvgAssetGroupItem(pathNode, nodeStyleFallbacks) as SemanticMapPath
  delete item["data-source-node-id"]
  delete item["data-source-segment-id"]
  return item
}

function extractSemanticMapLegend(
  root: DomNode,
  dominantSvg: DomNode,
  nodeStyleFallbacks: Map<string, string>,
): SemanticMapLegend | undefined {
  const legendContainer = findDescendantElement(
    root,
    (child) =>
      child !== root &&
      hasClassMatching(child, /(?:^|-)legend-/) &&
      Boolean(
        findDescendantElement(
          child,
          (grandchild) =>
            grandchild !== dominantSvg &&
            grandchild.name?.toLowerCase() === "svg" &&
            Boolean(grandchild.attribs?.viewBox),
        ),
      ),
  )
  const legendSvg = legendContainer
    ? findDescendantElement(
        legendContainer,
        (child) => child !== dominantSvg && child.name?.toLowerCase() === "svg" && Boolean(child.attribs?.viewBox),
      )
    : undefined
  if (!legendContainer || !legendSvg) return undefined
  const toolbar = findParentElement(legendContainer, legendSvg)
  const items = directElementChildren(legendSvg)
    .map((child) => semanticMapLegendItem(child, nodeStyleFallbacks))
    .filter((item): item is SemanticMapLegendItem => Boolean(item))
  if (items.length === 0) return undefined
  return {
    containerFrame: semanticElementFrame(legendContainer, nodeStyleFallbacks),
    toolbarFrame:
      toolbar && toolbar !== legendContainer ? semanticElementFrame(toolbar, nodeStyleFallbacks) : undefined,
    svg: semanticSvgRoot(legendSvg),
    items,
  }
}

function semanticSvgRoot(svg: DomNode): SemanticSvgRoot {
  return {
    width: svg.attribs?.width,
    height: svg.attribs?.height,
    viewBox: svg.attribs?.viewBox,
    fill: svg.attribs?.fill,
    className: svg.attribs?.class,
    style: parseStyleRecord(svg.attribs?.style ?? ""),
  }
}

function semanticMapLegendItem(
  node: DomNode,
  nodeStyleFallbacks: Map<string, string>,
): SemanticMapLegendItem | undefined {
  if (node.type !== "tag" || node.name?.toLowerCase() !== "g") return undefined
  const tooltip = directElementChildren(node).find((child) => hasClassMatching(child, /^apply-common-tooltip$/))
  const figureGroup = tooltip
    ? findDescendantElement(tooltip, (child) => hasClassMatching(child, /^groupFigure-/))
    : undefined
  const pathNodes = figureGroup
    ? findDescendantElements(
        figureGroup,
        (child) => child.name?.toLowerCase() === "path" && Boolean(child.attribs?.["data-asset-d"]),
      )
    : []
  const paths = pathNodes
    .map((pathNode) => semanticMapPath(pathNode, nodeStyleFallbacks))
    .filter((item): item is SemanticMapPath => Boolean(item))
  const text = directElementChildren(node).find((child) => child.name?.toLowerCase() === "text")
  const rect = tooltip ? findDescendantElement(tooltip, (child) => child.name?.toLowerCase() === "rect") : undefined
  if (paths.length === 0 && !text) return undefined
  return {
    className: node.attribs?.class ?? "",
    dataAttrs: pickDataAttributes(node.attribs ?? {}, ["data-focus-manager"]),
    tooltipClassName: tooltip?.attribs?.class ?? "",
    tooltipTitle: tooltip?.attribs?.title,
    rect: rect ? semanticElementAttributeRecord(rect) : undefined,
    figureGroupClassName: figureGroup?.attribs?.class ?? "",
    paths,
    text: text ? semanticMapLegendText(text) : undefined,
  }
}

function semanticMapLegendText(node: DomNode): SemanticMapLegendText {
  return {
    className: node.attribs?.class ?? "",
    x: node.attribs?.x,
    y: node.attribs?.y,
    label: normalizeVisibleText(visibleText(node)),
    tspans: directElementChildren(node)
      .filter((child) => child.name?.toLowerCase() === "tspan")
      .map((child) => semanticElementAttributeRecord(child)),
  }
}

function extractMapLegendLabels(node: DomNode): string[] {
  const labels = [
    ...findDescendantElements(node, (child) => child.name?.toLowerCase() === "text").map((child) =>
      normalizeVisibleText(visibleText(child)),
    ),
    ...findDescendantElements(node, (child) => (child.attribs?.title ? /\d|%/.test(child.attribs.title) : false)).map(
      (child) => normalizeVisibleText(child.attribs?.title ?? ""),
    ),
  ].filter(Boolean)
  return Array.from(new Set(labels)).slice(0, 16)
}

function isSemanticLinkGridCandidate(node: DomNode): boolean {
  if (node.type !== "tag") return false
  if (
    isSemanticDataTableCandidate(node) ||
    isSemanticMetricRankingCardCandidate(node) ||
    isSemanticEventCardListCandidate(node) ||
    isSemanticIdeaCardCollectionCandidate(node) ||
    isSemanticMapSurfaceCandidate(node)
  )
    return false
  const container = findLinkGridContainer(node)
  if (!container) return false
  const links = semanticLinkGridAnchors(container)
  if (links.length < 6) return false
  const containerDistance = descendantElementDistance(node, container)
  if (containerDistance === undefined || containerDistance > 4) return false
  return Boolean(findFirstHeadingText(node) || visibleText(node).length > 20)
}

function findLinkGridContainer(node: DomNode): DomNode | undefined {
  return findDescendantElement(node, (child) => {
    const anchors = semanticLinkGridAnchors(child)
    if (anchors.length < 6) return false
    const className = child.attribs?.class ?? ""
    return /^container-/.test(className) || /(?:buttons?|links?|grid|list)/i.test(className) || anchors.length >= 10
  })
}

function semanticLinkGridAnchors(node: DomNode): DomNode[] {
  return directElementChildren(node)
    .filter((child) => child.name?.toLowerCase() === "a")
    .filter((anchor) => normalizeVisibleText(visibleText(anchor)).length > 0)
}

function extractSemanticLinkGrid(node: DomNode, sourceRegionComponentName: string): SemanticLinkGrid | undefined {
  const container = findLinkGridContainer(node)
  if (!container) return undefined
  const links = semanticLinkGridAnchors(container)
    .map((anchor) => semanticFooterLink(anchor))
    .filter((item): item is SemanticFooterLink => Boolean(item))
  if (links.length < 6) return undefined

  const header = findDirectChildBySourceRole(node, "header")
  const headerWrapper = header ? firstElementChild(header) : undefined
  const titleWrapper = headerWrapper ? firstElementChild(headerWrapper) : undefined
  const titleContainer = titleWrapper ? firstElementChild(titleWrapper) : undefined
  const titleLink = titleContainer
    ? findDescendantElement(titleContainer, (child) => child.name?.toLowerCase() === "a")
    : undefined
  const titleNode = findDescendantElement(
    titleContainer ?? node,
    (child) => /^h[1-4]$/i.test(child.name ?? "") || hasClassMatching(child, /^title-/),
  )
  const content = findDescendantElement(
    node,
    (child) => child.attribs?.["data-qa-id"]?.endsWith("-content") || hasClassMatching(child, /^content-/),
  )
  const titleText = normalizeVisibleText(
    titleNode
      ? visibleText(titleNode)
      : (findFirstHeadingText(node) ?? sourceRegionComponentName.replace(/Region\d*$/, "")),
  )
  const replacementKind = semanticLinkGridReplacementKind(node, titleText)
  const componentBase = titleText ? toPascalIdentifier(titleText) : sourceRegionComponentName.replace(/Region\d*$/, "")
  const suffix =
    replacementKind === "event_or_news_list_component"
      ? "List"
      : replacementKind === "card_collection_component"
        ? "Cards"
        : "Links"
  const rootDataAttrs = pickDataAttributes(node.attribs ?? {}, [
    "data-base-widget",
    "data-container-name",
    "data-an-widget-id",
    "data-source-role",
  ])
  return {
    componentName: `${componentBase}${suffix}`,
    replacementKind,
    rootClassName: node.attribs?.class ?? "",
    rootDataAttrs,
    rootSourceNodeId: node.attribs?.["data-source-node-id"],
    headerClassName: header?.attribs?.class ?? "",
    headerWrapperClassName: headerWrapper?.attribs?.class ?? "",
    titleWrapperClassName: titleWrapper?.attribs?.class ?? "",
    titleContainerClassName: titleContainer?.attribs?.class ?? "",
    titleClassName: titleNode?.attribs?.class ?? "",
    titleId: titleNode?.attribs?.id,
    titleHref: normalizeReferencedAssetUrl(titleLink?.attribs?.href ?? ""),
    titleLinkClassName: titleLink?.attribs?.class ?? "",
    titleText,
    contentClassName: content?.attribs?.class ?? "",
    linksContainerClassName: container.attribs?.class ?? "",
    links,
  }
}

function semanticLinkGridReplacementKind(
  node: DomNode,
  titleText: string,
): SemanticSourceReplacementMetric["replacementKind"] {
  const text = `${titleText} ${visibleText(node)}`.toLowerCase()
  if (/\b(news|reuters|dow jones|dpa-afx|calendar|event)\b/.test(text)) return "event_or_news_list_component"
  if (/\b(ideas?|video|popular|recent)\b/.test(text)) return "card_collection_component"
  return "navigation_or_footer_component"
}

function isSemanticIdeaCardCollectionCandidate(node: DomNode): boolean {
  if (node.type !== "tag") return false
  if (node.attribs?.["data-base-widget"] !== "true") return false
  const container = findSemanticIdeaCardsContainer(node)
  if (!container) return false
  const cards = semanticIdeaCardNodes(container)
  if (cards.length < 3) return false
  const containerDistance = descendantElementDistance(node, container)
  if (containerDistance === undefined || containerDistance > 7) return false
  const attrs = node.attribs ?? {}
  const label =
    `${attrs["data-container-name"] ?? ""} ${attrs["data-an-widget-id"] ?? ""} ${findFirstHeadingText(node) ?? ""} ${visibleText(node)}`.toLowerCase()
  if (/\bideas?\b/.test(label)) return true
  if (findSemanticSectionTabs(node).length >= 2 && /\b(popular|recent|video)\b/.test(label)) return true
  return cards.length >= 4 && /\bby\s+\S+|\bboosts?\b/.test(label)
}

function extractSemanticIdeaCardCollection(
  node: DomNode,
  sourceRegionComponentName: string,
  context: SourceDomRenderContext,
): SemanticIdeaCardCollection | undefined {
  const cardsContainer = findSemanticIdeaCardsContainer(node)
  if (!cardsContainer) return undefined
  const cards = semanticIdeaCardNodes(cardsContainer)
    .map((card) => semanticIdeaCardItem(card, context))
    .filter((card): card is SemanticIdeaCard => Boolean(card))
    .slice(0, 80)
  if (cards.length < 3) return undefined

  const header = findDirectChildBySourceRole(node, "header")
  const headerWrapper = header ? firstElementChild(header) : undefined
  const titleWrapper = headerWrapper ? firstElementChild(headerWrapper) : undefined
  const titleContainer = titleWrapper ? firstElementChild(titleWrapper) : undefined
  const titleLink = titleContainer
    ? findDescendantElement(titleContainer, (child) => child.name?.toLowerCase() === "a")
    : undefined
  const titleNode = findDescendantElement(
    titleContainer ?? node,
    (child) => /^h[1-4]$/i.test(child.name ?? "") || hasClassMatching(child, /^title-/),
  )
  const content = findDescendantElement(
    node,
    (child) => child.attribs?.["data-qa-id"]?.endsWith("-content") || hasClassMatching(child, /^content-/),
  )
  const tabs = findSemanticSectionTabs(node)
  const tabList = tabs[0] ? findAncestorElement(node, tabs[0], (child) => child.attribs?.role === "tablist") : undefined
  const tabsScrollWrap = tabList
    ? findAncestorElement(
        node,
        tabList,
        (child) => hasClassMatching(child, /^scrollWrap-/) || Boolean(child.attribs?.["data-name"]?.includes("tabs")),
      )
    : undefined
  const tabsContainer = tabsScrollWrap
    ? findAncestorElement(node, tabsScrollWrap, (child) => hasClassMatching(child, /^tabsContainer-/))
    : tabList
      ? findAncestorElement(node, tabList, (child) => hasClassMatching(child, /^tabsContainer-/))
      : undefined
  const filmstripContainer = findParentElement(node, cardsContainer)
  const cardsWrapper = filmstripContainer ? findParentElement(node, filmstripContainer) : undefined
  const moreLinkNode = directElementChildren(cardsContainer).find(isSemanticIdeaMoreLinkNode)
  const componentBase = sourceRegionComponentName.replace(/Region\d*$/, "Cards")
  const titleText = normalizeVisibleText(
    titleNode
      ? visibleText(titleNode)
      : (findFirstHeadingText(node) ?? sourceRegionComponentName.replace(/Region\d*$/, "")),
  )
  const chromeItems = directElementChildren(cardsContainer)
    .filter((child) => !isSemanticIdeaCardNode(child) && !isSemanticIdeaMoreLinkNode(child))
    .map((child) => ({
      className: child.attribs?.class ?? "",
      style: semanticNodeStyleRecord(child, context),
    }))
    .filter((item) => item.className || item.style)
    .slice(0, 12)

  return {
    componentName: componentBase === sourceRegionComponentName ? `${sourceRegionComponentName}Cards` : componentBase,
    rootClassName: node.attribs?.class ?? "",
    rootDataAttrs: pickDataAttributes(node.attribs ?? {}, [
      "data-base-widget",
      "data-container-name",
      "data-an-widget-id",
      "data-source-role",
    ]),
    rootSourceNodeId: node.attribs?.["data-source-node-id"],
    rootStyle: semanticNodeStyleRecord(node, context),
    headerClassName: header?.attribs?.class ?? "",
    headerWrapperClassName: headerWrapper?.attribs?.class ?? "",
    titleWrapperClassName: titleWrapper?.attribs?.class ?? "",
    titleContainerClassName: titleContainer?.attribs?.class ?? "",
    titleClassName: titleNode?.attribs?.class ?? "",
    titleId: titleNode?.attribs?.id,
    titleHref: normalizeReferencedAssetUrl(titleLink?.attribs?.href ?? ""),
    titleLinkClassName: titleLink?.attribs?.class ?? "",
    titleText,
    contentClassName: content?.attribs?.class ?? "",
    contentQaId: content?.attribs?.["data-qa-id"],
    tabsContainerClassName: tabsContainer?.attribs?.class ?? "",
    tabsScrollWrapClassName: tabsScrollWrap?.attribs?.class ?? "",
    tabsScrollWrapDataName: tabsScrollWrap?.attribs?.["data-name"],
    tabsScrollWrapStyle: tabsScrollWrap ? semanticNodeStyleRecord(tabsScrollWrap, context) : undefined,
    tabsListId: tabList?.attribs?.id,
    tabsListClassName: tabList?.attribs?.class ?? "",
    tabsListOrientation: tabList?.attribs?.["aria-orientation"],
    tabs: tabs.map(semanticSectionTab).filter((tab): tab is SemanticSectionTab => Boolean(tab)),
    cardsWrapperClassName: cardsWrapper?.attribs?.class ?? "",
    filmstripContainerClassName: filmstripContainer?.attribs?.class ?? "",
    itemsClassName: cardsContainer.attribs?.class ?? "",
    chromeItems,
    cards,
    moreLink: moreLinkNode ? semanticIdeaMoreLink(moreLinkNode, context) : undefined,
  }
}

function findSemanticIdeaCardsContainer(node: DomNode): DomNode | undefined {
  const candidates = findDescendantElements(node, (child) => {
    if (child.type !== "tag") return false
    const directIdeaCards = semanticIdeaCardNodes(child)
    if (directIdeaCards.length < 3) return false
    const className = child.attribs?.class ?? ""
    return hasClassMatching(child, /^items-/) || /(?:filmstrip|cards?|items)/i.test(className)
  })
  return candidates.sort((a, b) => semanticIdeaCardNodes(b).length - semanticIdeaCardNodes(a).length)[0]
}

function semanticIdeaCardNodes(node: DomNode): DomNode[] {
  return directElementChildren(node).filter(isSemanticIdeaCardNode)
}

function isSemanticIdeaCardNode(node: DomNode): boolean {
  if (node.type !== "tag" || node.name?.toLowerCase() !== "article") return false
  const attrs = node.attribs ?? {}
  if (attrs["data-source-role"] !== "card" && !hasClassMatching(node, /^ideaCard-/)) return false
  return Boolean(
    findDescendantElement(
      node,
      (child) => child.name?.toLowerCase() === "a" && child.attribs?.["data-qa-id"] === "ui-lib-card-link-title",
    ),
  )
}

function isSemanticIdeaMoreLinkNode(node: DomNode): boolean {
  if (node.type !== "tag" || node.name?.toLowerCase() !== "a") return false
  if (node.attribs?.["data-source-role"] !== "card") return false
  const text = normalizeVisibleText(visibleText(node)).toLowerCase()
  return /\bsee all\b|\bmore ideas?\b/.test(text)
}

function semanticIdeaCardItem(card: DomNode, context: SourceDomRenderContext): SemanticIdeaCard | undefined {
  const mergedCard = mergeDomNodeWithIrChildren(card, context)
  const titleAnchor = findDescendantElement(
    mergedCard,
    (child) => child.name?.toLowerCase() === "a" && child.attribs?.["data-qa-id"] === "ui-lib-card-link-title",
  )
  const paragraphAnchor = findDescendantElement(
    mergedCard,
    (child) => child.name?.toLowerCase() === "a" && child.attribs?.["data-qa-id"] === "ui-lib-card-link-paragraph",
  )
  const title = normalizeVisibleText(titleAnchor ? visibleText(titleAnchor) : "")
  if (!title || !titleAnchor) return undefined

  const textBlock = findAncestorElement(mergedCard, titleAnchor, (child) => hasClassMatching(child, /^text-block-/))
  const paragraphContainer = paragraphAnchor ? firstElementChild(paragraphAnchor) : undefined
  const paragraphContent = paragraphContainer ? firstElementChild(paragraphContainer) : undefined
  const rawPreview = findDescendantElement(
    card,
    (child) => hasClassMatching(child, /^preview-/) || /\bpreview-fSver7BK\b/.test(child.attribs?.class ?? ""),
  )
  const preview = findDescendantElement(
    mergedCard,
    (child) => hasClassMatching(child, /^preview-/) || /\bpreview-fSver7BK\b/.test(child.attribs?.class ?? ""),
  )
  const previewGrid = preview
    ? findDescendantElement(preview, (child) => hasClassMatching(child, /^preview-grid-/))
    : undefined
  const imageLink = preview
    ? findDescendantElement(
        preview,
        (child) => child.name?.toLowerCase() === "a" && child.attribs?.["data-qa-id"] === "ui-lib-card-link-image",
      )
    : undefined
  const picture = imageLink
    ? findDescendantElement(imageLink, (child) => child.name?.toLowerCase() === "picture")
    : undefined
  const image = imageLink ? findDescendantElement(imageLink, (child) => child.name?.toLowerCase() === "img") : undefined
  const imageSrc = image ? semanticIdeaImageSource(image, context) : undefined
  const previewFallbackImageSrc =
    rawPreview && !containsClass(rawPreview, "image-fSver7BK") ? consumePreviewImagePath(context) : undefined
  const logoLink = previewGrid ? semanticIdeaLogoLink(previewGrid) : undefined
  const strategyBadge = previewGrid ? semanticIdeaStrategyBadge(previewGrid, context) : undefined
  const previewBadgeRow = logoLink
    ? findParentElement(previewGrid ?? mergedCard, logoLink.sourceNode)
    : strategyBadge
      ? findParentElement(previewGrid ?? mergedCard, strategyBadge.sourceNode)
      : undefined
  const previewChromeClassNames = previewGrid
    ? directElementChildren(previewGrid)
        .filter((child) => child !== imageLink)
        .filter((child) => child !== logoLink?.sourceNode)
        .filter((child) => child !== strategyBadge?.sourceNode)
        .filter((child) => child !== previewBadgeRow)
        .map((child) => child.attribs?.class ?? "")
        .filter(Boolean)
        .slice(0, 6)
    : []
  const metaRow = findDescendantElement(mergedCard, (child) => hasClassMatching(child, /^credsButtonsRow-/))
  const publicationInfo = metaRow
    ? findDescendantElement(metaRow, (child) => hasClassMatching(child, /^publicationInfoWrapper-/))
    : undefined
  const authorWrap = findDescendantElement(
    mergedCard,
    (child) => child.attribs?.["data-qa-id"] === "ui-lib-card-link-author",
  )
  const authorLink = authorWrap
    ? findDescendantElement(authorWrap, (child) => child.name?.toLowerCase() === "a")
    : undefined
  const authorNode = authorWrap
    ? findDescendantElement(authorWrap, (child) => hasClassMatching(child, /^cardAuthor-/))
    : undefined
  const dateNode = findDescendantElement(mergedCard, (child) => child.name?.toLowerCase() === "time")
  const dateWrap = dateNode
    ? findAncestorElement(mergedCard, dateNode, (child) => hasClassMatching(child, /^section-/))
    : undefined
  const buttons = findDescendantElement(mergedCard, (child) => hasClassMatching(child, /^buttons-/))
  const commentButton = findDescendantElement(
    buttons ?? mergedCard,
    (child) => child.attribs?.["data-qa-id"] === "ui-lib-card-comment-button",
  )
  const likeButton = findDescendantElement(
    buttons ?? mergedCard,
    (child) => child.attribs?.["data-qa-id"] === "ui-lib-card-like-button",
  )
  const likeDigit = likeButton
    ? findDescendantElement(likeButton, (child) => hasClassMatching(child, /^digit-/))
    : undefined
  const likeDigitGrid = likeDigit
    ? findAncestorElement(likeButton ?? mergedCard, likeDigit, (child) => hasClassMatching(child, /^digitGrid-/))
    : undefined
  const likeCountWrap = likeDigit
    ? findAncestorElement(likeButton ?? mergedCard, likeDigit, (child) => hasClassMatching(child, /^container-/))
    : undefined

  return {
    rootClassName: card.attribs?.class ?? "",
    rootStyle: semanticNodeStyleRecord(card, context),
    textBlockClassName: textBlock?.attribs?.class ?? "",
    textBlockStyle: textBlock ? semanticNodeStyleRecord(textBlock, context) : undefined,
    href: normalizeReferencedAssetUrl(titleAnchor.attribs?.href ?? paragraphAnchor?.attribs?.href ?? ""),
    titleClassName: titleAnchor.attribs?.class ?? "",
    titleQaId: titleAnchor.attribs?.["data-qa-id"],
    title,
    paragraphClassName: paragraphAnchor?.attribs?.class ?? "",
    paragraphQaId: paragraphAnchor?.attribs?.["data-qa-id"],
    paragraphContainerClassName: paragraphContainer?.attribs?.class ?? "",
    paragraphContentClassName: paragraphContent?.attribs?.class ?? "",
    paragraph: normalizeVisibleText(paragraphAnchor ? visibleText(paragraphAnchor) : ""),
    previewClassName: preview?.attribs?.class ?? "",
    previewFallbackImageSrc,
    previewGridClassName: previewGrid?.attribs?.class ?? "",
    previewChromeClassNames,
    previewBadgeRowClassName: previewBadgeRow?.attribs?.class ?? "",
    logoLink: logoLink ? omitSourceNode(logoLink) : undefined,
    strategyBadge: strategyBadge ? omitSourceNode(strategyBadge) : undefined,
    imageLinkClassName: imageLink?.attribs?.class ?? "",
    imagePictureClassName: picture?.attribs?.class ?? "",
    imageSrc,
    imageClassName: image?.attribs?.class ?? "",
    imageStyle: image ? semanticNodeStyleRecord(image, context) : undefined,
    metaRowClassName: metaRow?.attribs?.class ?? "",
    publicationInfoClassName: publicationInfo?.attribs?.class ?? "",
    authorWrapClassName: authorWrap?.attribs?.class ?? "",
    authorHref: normalizeReferencedAssetUrl(authorLink?.attribs?.href ?? ""),
    authorLinkClassName: authorLink?.attribs?.class ?? "",
    authorClassName: authorNode?.attribs?.class ?? "",
    author: normalizeVisibleText(authorNode ? visibleText(authorNode) : authorWrap ? visibleText(authorWrap) : ""),
    dateWrapClassName: dateWrap?.attribs?.class ?? "",
    dateClassName: dateNode?.attribs?.class ?? "",
    dateTitle: dateNode?.attribs?.title,
    date: normalizeVisibleText(dateNode ? visibleText(dateNode) : ""),
    buttonsClassName: buttons?.attribs?.class ?? "",
    commentHref: normalizeReferencedAssetUrl(commentButton?.attribs?.href ?? ""),
    commentClassName: commentButton?.attribs?.class ?? "",
    commentAriaLabel: commentButton?.attribs?.["aria-label"],
    likeClassName: likeButton?.attribs?.class ?? "",
    likeAriaLabel: findDescendantElement(likeButton ?? mergedCard, (child) =>
      Boolean(child.attribs?.["aria-label"]?.includes("boost")),
    )?.attribs?.["aria-label"],
    likeCountWrapClassName: likeCountWrap?.attribs?.class ?? "",
    likeDigitGridClassName: likeDigitGrid?.attribs?.class ?? "",
    likeDigitClassName: likeDigit?.attribs?.class ?? "",
    likeCount: normalizeVisibleText(likeDigit ? visibleText(likeDigit) : ""),
  }
}

function semanticIdeaLogoLink(node: DomNode): (SemanticIdeaLogoLink & { sourceNode: DomNode }) | undefined {
  const link = findDescendantElement(
    node,
    (child) => child.name?.toLowerCase() === "a" && child.attribs?.["data-qa-id"] === "ui-lib-card-preview-link-icon",
  )
  const image = link ? findDescendantElement(link, (child) => child.name?.toLowerCase() === "img") : undefined
  const href = normalizeReferencedAssetUrl(link?.attribs?.href ?? "")
  const imageSrc = normalizeReferencedAssetUrl(image?.attribs?.src ?? "")
  if (!link || !href || !imageSrc) return undefined
  return {
    sourceNode: link,
    className: link.attribs?.class ?? "",
    href,
    title: link.attribs?.title,
    qaId: link.attribs?.["data-qa-id"],
    imageClassName: image?.attribs?.class ?? "",
    imageSrc,
    imageAlt: image?.attribs?.alt ?? "",
  }
}

function semanticIdeaStrategyBadge(
  node: DomNode,
  context: SourceDomRenderContext,
): (SemanticIdeaStrategyBadge & { sourceNode: DomNode }) | undefined {
  const badge = findDescendantElement(
    node,
    (child) => hasClassMatching(child, /^root-cYxls/) || /\b(Long|Short|Neutral)\b/.test(child.attribs?.title ?? ""),
  )
  if (!badge) return undefined
  const iconNode = findDescendantElement(badge, (child) => hasClassMatching(child, /^ideaStrategyIcon-/))
  const labelNode = findDescendantElement(badge, (child) => hasClassMatching(child, /^visuallyHiddenLabel-/))
  return {
    sourceNode: badge,
    className: badge.attribs?.class ?? "",
    title: badge.attribs?.title,
    iconClassName: iconNode?.attribs?.class ?? "",
    labelClassName: labelNode?.attribs?.class ?? "",
    label: normalizeVisibleText(labelNode ? visibleText(labelNode) : (badge.attribs?.title ?? "")),
    icon: semanticSvgIcon(
      findDescendantElement(badge, (child) => child.name?.toLowerCase() === "svg"),
      context.nodeStyleFallbacks,
    ),
  }
}

function semanticIdeaMoreLink(anchor: DomNode, context: SourceDomRenderContext): SemanticIdeaMoreLink | undefined {
  const href = normalizeReferencedAssetUrl(anchor.attribs?.href ?? "")
  const content = findDescendantElement(
    anchor,
    (child) => child.name?.toLowerCase() === "p" || hasClassMatching(child, /^content-/),
  )
  const wrap = content ? firstElementChild(content) : undefined
  const textNode = findDescendantElement(anchor, (child) => hasClassMatching(child, /^text-/))
  const arrow = findDescendantElement(anchor, (child) => hasClassMatching(child, /^arrow-/))
  const label = normalizeVisibleText(textNode ? visibleText(textNode) : visibleText(anchor))
  if (!href || !label) return undefined
  return {
    className: anchor.attribs?.class ?? "",
    href,
    style: semanticNodeStyleRecord(anchor, context),
    contentClassName: content?.attribs?.class ?? "",
    wrapClassName: wrap?.attribs?.class ?? "",
    textClassName: textNode?.attribs?.class ?? "",
    label,
    arrowClassName: arrow?.attribs?.class ?? "",
    icon: semanticSvgIcon(
      findDescendantElement(arrow ?? anchor, (child) => child.name?.toLowerCase() === "svg"),
      context.nodeStyleFallbacks,
    ),
  }
}

function semanticIdeaImageSource(image: DomNode, context: SourceDomRenderContext): string | undefined {
  const src = image.attribs?.src ?? ""
  if (!src) return undefined
  if (isPlaceholderDataImage(src)) return consumePreviewImagePath(context)
  return normalizeReferencedAssetUrl(src)
}

function consumePreviewImagePath(context: {
  previewImagePaths: string[]
  previewImageIndex: number
}): string | undefined {
  const imagePath = context.previewImagePaths[context.previewImageIndex]
  context.previewImageIndex += 1
  return imagePath
}

function omitSourceNode<T extends { sourceNode: DomNode }>(value: T): Omit<T, "sourceNode"> {
  const { sourceNode: _sourceNode, ...rest } = value
  return rest
}

function isSemanticSectionShellCandidate(node: DomNode): boolean {
  if (node.type !== "tag") return false
  if (
    isSemanticDataTableCandidate(node) ||
    isSemanticMetricRankingCardCandidate(node) ||
    isSemanticEventCardListCandidate(node) ||
    isSemanticIdeaCardCollectionCandidate(node) ||
    isSemanticLinkGridCandidate(node)
  )
    return false
  const compositeCardContainer = isCompositeSemanticCardContainer(node)
  if (node.attribs?.["data-base-widget"] !== "true" && !compositeCardContainer) return false
  if (hasUncoveredMixedCardSiblings(node)) return false
  const tabs = findSemanticSectionTabs(node)
  if (isSemanticMapSurfaceCandidate(node) && tabs.length === 0 && !hasSemanticCardSurfaceChild(node)) return false
  const children = findSemanticSectionChildCandidates(node)
  if (children.length === 0) return false
  const directChildren = directElementChildren(node)
  const isWrapperOnly = directChildren.length === 1 && children[0] === directChildren[0]
  if (isWrapperOnly) return true
  if (compositeCardContainer) return true
  if (findDirectChildBySourceRole(node, "header")) return true
  if (tabs.length > 0) return true
  return false
}

function isCompositeSemanticCardContainer(node: DomNode): boolean {
  if (node.type !== "tag") return false
  const cardChildren = directElementChildren(node).filter(isSemanticCardLikeElement)
  if (cardChildren.length < 2) return false
  return cardChildren.some(
    (child) =>
      isSemanticMetricRankingCardCandidate(child) ||
      isSemanticDataTableCandidate(child) ||
      isSemanticEventCardListCandidate(child) ||
      isSemanticIdeaCardCollectionCandidate(child) ||
      isSemanticMapSurfaceCandidate(child) ||
      isSemanticLinkGridCandidate(child) ||
      isSemanticNewsListCandidate(child, countRenderableElements(child)),
  )
}

function isSemanticCardLikeElement(node: DomNode): boolean {
  return node.type === "tag" && (node.attribs?.["data-source-role"] === "card" || hasClassMatching(node, /^card-/))
}

function dominantSvgBelongsToMixedCardSibling(node: DomNode, svg: DomNode): boolean {
  const chain = elementAncestorChain(node, svg)
  const card = chain.find((ancestor) => ancestor !== node && isSemanticCardLikeElement(ancestor))
  if (!card) return false
  const parent = findParentElement(node, card)
  if (!parent) return false
  return directElementChildren(parent).filter(isSemanticCardLikeElement).length > 1
}

function hasUncoveredMixedCardSiblings(node: DomNode): boolean {
  const containers = findDescendantElements(
    node,
    (child) => directElementChildren(child).filter(isSemanticCardLikeElement).length > 1,
  )
  return containers.some((container) =>
    directElementChildren(container)
      .filter(isSemanticCardLikeElement)
      .some((card) => !isSemanticSectionChildCandidate(card)),
  )
}

function hasSemanticCardSurfaceChild(node: DomNode): boolean {
  function visit(child: DomNode, depth: number): boolean {
    if (depth > 5 || child.type !== "tag") return false
    if (child !== node && child.attribs?.["data-source-role"] === "card" && isSemanticMapSurfaceCandidate(child))
      return true
    return directElementChildren(child).some((grandchild) => visit(grandchild, depth + 1))
  }
  return directElementChildren(node).some((child) => visit(child, 1))
}

function findSemanticSectionChildCandidates(node: DomNode): DomNode[] {
  const result: DomNode[] = []
  function visit(child: DomNode, depth: number): void {
    if (depth > 8 || result.length >= 8 || child.type !== "tag") return
    if (child !== node && isSemanticSectionChildCandidate(child)) {
      result.push(child)
      return
    }
    for (const grandchild of directElementChildren(child)) visit(grandchild, depth + 1)
  }
  for (const child of directElementChildren(node)) visit(child, 1)
  return result
}

function isSemanticSectionChildCandidate(node: DomNode): boolean {
  if (isSemanticDataTableCandidate(node)) return true
  if (isSemanticMetricRankingCardCandidate(node)) return true
  if (isSemanticEventCardListCandidate(node)) return true
  if (isSemanticIdeaCardCollectionCandidate(node)) return true
  if (isSemanticMapSurfaceCandidate(node)) return true
  if (isSemanticLinkGridCandidate(node)) return true
  if (isSemanticNewsListCandidate(node, countRenderableElements(node))) return true
  return isSemanticSectionShellCandidate(node)
}

function extractSemanticSectionShell(
  node: DomNode,
  sourceRegionComponentName: string,
  context: SourceDomRenderContext,
): SemanticSectionShell | undefined {
  const childNodes = findSemanticSectionChildCandidates(node)
  const children = childNodes
    .map((child) => renderSemanticSectionChild(child, context))
    .filter((child): child is SemanticSectionChild => Boolean(child))
  if (children.length === 0) return undefined

  const header = findDirectChildBySourceRole(node, "header")
  const headerWrapper = header ? firstElementChild(header) : undefined
  const titleWrapper = headerWrapper ? firstElementChild(headerWrapper) : undefined
  const titleContainer = titleWrapper ? firstElementChild(titleWrapper) : undefined
  const titleLink = titleContainer
    ? findDescendantElement(titleContainer, (child) => child.name?.toLowerCase() === "a")
    : undefined
  const tabs = findSemanticSectionTabs(node)
  const compositeCardContainer = isCompositeSemanticCardContainer(node)
  const titleSearchRoot = titleContainer ?? (header ? node : undefined)
  const titleNode = titleSearchRoot
    ? findDescendantElement(
        titleSearchRoot,
        (child) => /^h[1-4]$/i.test(child.name ?? "") || hasClassMatching(child, /^title-/),
      )
    : undefined
  const titleText = normalizeVisibleText(
    titleNode
      ? visibleText(titleNode)
      : findDirectChildBySourceRole(node, "header") || tabs.length > 0 || node.attribs?.["data-base-widget"] === "true"
        ? (findFirstHeadingText(node) ?? sourceRegionComponentName.replace(/Region\d*$/, ""))
        : "",
  )
  const content =
    compositeCardContainer && node.attribs?.["data-base-widget"] !== "true"
      ? undefined
      : findDescendantElement(
          node,
          (child) => child.attribs?.["data-qa-id"]?.endsWith("-content") || hasClassMatching(child, /^content-/),
        )
  const tabsContainer = tabs[0]
    ? findAncestorElement(node, tabs[0], (child) => child.attribs?.role === "tablist")
    : undefined
  const footerAnchor = findDescendantElement(
    node,
    (child) =>
      child.name?.toLowerCase() === "a" &&
      Boolean(findAncestorElement(node, child, (ancestor) => ancestor.attribs?.["data-source-role"] === "footer")),
  )
  const rootDataAttrs = pickDataAttributes(node.attribs ?? {}, [
    "data-base-widget",
    "data-container-name",
    "data-an-widget-id",
    "data-source-role",
  ])
  const componentBase = sourceRegionComponentName.replace(/Region(\d*)$/, "Section$1")
  return {
    componentName: componentBase === sourceRegionComponentName ? `${sourceRegionComponentName}Section` : componentBase,
    replacementKind: semanticSectionShellReplacementKind(node, titleText),
    rootClassName: node.attribs?.class ?? "",
    rootDataAttrs,
    rootSourceNodeId: node.attribs?.["data-source-node-id"],
    rootStyle: parseStyleRecord(node.attribs?.style ?? ""),
    headerClassName: header?.attribs?.class ?? "",
    headerWrapperClassName: headerWrapper?.attribs?.class ?? "",
    titleWrapperClassName: titleWrapper?.attribs?.class ?? "",
    titleContainerClassName: titleContainer?.attribs?.class ?? "",
    titleClassName: titleNode?.attribs?.class ?? "",
    titleId: titleNode?.attribs?.id,
    titleHref: normalizeReferencedAssetUrl(titleLink?.attribs?.href ?? ""),
    titleLinkClassName: titleLink?.attribs?.class ?? "",
    titleText,
    contentClassName: content?.attribs?.class ?? "",
    tabsContainerClassName: tabsContainer?.attribs?.class ?? "",
    tabs: tabs.map(semanticSectionTab).filter((tab): tab is SemanticSectionTab => Boolean(tab)),
    footerLink: footerAnchor ? semanticFooterLink(footerAnchor) : undefined,
    children,
  }
}

function renderSemanticSectionChild(node: DomNode, context: SourceDomRenderContext): SemanticSectionChild | undefined {
  const childSourceRegionComponentName = allocateSourceRegionComponentName(node, context)
  const ref =
    renderSemanticNewsListRegion(node, childSourceRegionComponentName, context) ??
    renderSemanticEventCardListRegion(node, childSourceRegionComponentName, context) ??
    renderSemanticDataTableRegion(node, childSourceRegionComponentName, context) ??
    renderSemanticMetricRankingCardRegion(node, childSourceRegionComponentName, context) ??
    renderSemanticMetricChartCardRegion(node, childSourceRegionComponentName, context) ??
    renderSemanticIdeaCardCollectionRegion(node, childSourceRegionComponentName, context) ??
    renderSemanticMapSurfaceRegion(node, childSourceRegionComponentName, context) ??
    renderSemanticLinkGridRegion(node, childSourceRegionComponentName, context) ??
    renderSemanticFaqRegion(node, childSourceRegionComponentName, context) ??
    renderSemanticSectionShellRegion(node, childSourceRegionComponentName, context)
  return ref ? { componentName: ref.componentName } : undefined
}

function findSemanticSectionTabs(node: DomNode): DomNode[] {
  const tablist = findDescendantElement(node, (child) => child.attribs?.role === "tablist")
  if (!tablist) return []
  return directElementChildren(tablist).filter((child) => {
    const tag = child.name?.toLowerCase()
    return (tag === "button" || tag === "a") && child.attribs?.role === "tab"
  })
}

function semanticSectionTab(node: DomNode): SemanticSectionTab | undefined {
  const attrs = node.attribs ?? {}
  const label = normalizeVisibleText(
    attrs["data-overflow-tooltip-text"] ?? attrs["data-qa-id"] ?? attrs["aria-label"] ?? visibleText(node),
  )
  if (!label) return undefined
  const tagName = node.name?.toLowerCase() === "a" ? "a" : "button"
  return {
    tagName,
    className: attrs.class ?? "",
    id: attrs.id,
    href: tagName === "a" ? normalizeReferencedAssetUrl(attrs.href ?? "") : undefined,
    label,
    role: attrs.role,
    ariaSelected: attrs["aria-selected"],
    ariaDisabled: attrs["aria-disabled"],
    ariaLabel: attrs["aria-label"],
    dataId: attrs["data-id"],
    dataQaId: attrs["data-qa-id"],
  }
}

function semanticSectionShellReplacementKind(
  node: DomNode,
  titleText: string,
): SemanticSourceReplacementMetric["replacementKind"] {
  const text = `${titleText} ${visibleText(node)}`.toLowerCase()
  if (/\b(ideas?|video|popular|recent)\b/.test(text)) return "card_collection_component"
  if (/\b(news|calendar|event|dow jones|reuters)\b/.test(text)) return "event_or_news_list_component"
  if (/\b(map|trend|inflation|industrial|indicator|heatmap|country|countries)\b/.test(text))
    return "data_table_or_heatmap_component"
  return "navigation_or_footer_component"
}

function isNewsCardAnchor(node: DomNode): boolean {
  if (node.type !== "tag" || node.name?.toLowerCase() !== "a") return false
  const article = findDescendantElement(node, (child) => {
    const qa = child.attribs?.["data-qa-id"] ?? ""
    return qa === "news-headline-card"
  })
  const title = findDescendantElement(node, (child) => {
    const qa = child.attribs?.["data-qa-id"] ?? ""
    return /^(?:news-headline-title|headline-unauth-title)$/.test(qa)
  })
  return Boolean(article && title)
}

function findSemanticNewsListGrid(node: DomNode): DomNode | undefined {
  const grids = findDescendantElements(node, isSemanticNewsListGrid)
  return grids.length === 1 ? grids[0] : undefined
}

function isSemanticNewsListGrid(node: DomNode): boolean {
  if (node.type !== "tag") return false
  if (node.attribs?.["data-source-role"] !== "grid" && !hasClassMatching(node, /^grid-/)) return false
  const elementChildren = directElementChildren(node)
  const cardChildren = elementChildren.filter(isNewsCardAnchor)
  return cardChildren.length >= 3 && cardChildren.length === elementChildren.length
}

function directNewsCardAnchors(node: DomNode): DomNode[] {
  return directElementChildren(node).filter(isNewsCardAnchor)
}

function semanticNewsItem(anchor: DomNode): SemanticNewsItem | undefined {
  const article = findDescendantElement(anchor, (child) => child.name?.toLowerCase() === "article")
  const container = article ? firstElementChild(article) : undefined
  const header = findDescendantElement(
    anchor,
    (child) => child.attribs?.["data-source-role"] === "header" || hasClassMatching(child, /^header-/),
  )
  const titleNode = findDescendantElement(anchor, (child) => {
    const qa = child.attribs?.["data-qa-id"] ?? ""
    return /news-headline-(?:title|unauth-title)/.test(qa)
  })
  const title = normalizeVisibleText(
    titleNode?.attribs?.["data-overflow-tooltip-text"] ?? visibleText(titleNode ?? anchor),
  )
  if (!title) return undefined

  const relativeTime = findDescendantElement(anchor, (child) => child.name?.toLowerCase() === "relative-time")
  const dateWrapper = relativeTime
    ? findAncestorElement(anchor, relativeTime, (child) => child.name?.toLowerCase() === "span")
    : undefined
  const logoImages = header
    ? findDescendantElements(header, (child) => child.name?.toLowerCase() === "img")
        .map((image) => ({
          src: normalizeReferencedAssetUrl(image.attribs?.src ?? ""),
          alt: image.attribs?.alt ?? "",
          className: image.attribs?.class ?? "",
        }))
        .filter((image) => image.src)
        .slice(0, 6)
    : []
  return {
    href: normalizeReferencedAssetUrl(anchor.attribs?.href ?? ""),
    cardClassName: anchor.attribs?.class ?? "",
    articleClassName: article?.attribs?.class ?? "",
    containerClassName: container?.attribs?.class ?? "",
    headerClassName: header?.attribs?.class ?? "",
    titleClassName: titleNode?.attribs?.class ?? "",
    titleQaId: titleNode?.attribs?.["data-qa-id"],
    title,
    sourceLabel: normalizeNewsSourceLabel(header ? visibleText(header) : ""),
    dateClassName: dateWrapper?.attribs?.class ?? "",
    timestampTitle: relativeTime?.attribs?.title,
    logoImages,
  }
}

function normalizeNewsSourceLabel(value: string): string {
  return normalizeVisibleText(value)
    .replace(/\b(news|flash)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function renderSemanticNewsListComponent(list: SemanticNewsList): string {
  const itemsName = `${list.componentName.charAt(0).toLowerCase()}${list.componentName.slice(1)}Items`
  const rootAttrs = [
    list.rootClassName ? `className={${JSON.stringify(list.rootClassName)}}` : "",
    list.rootQaId ? `data-qa-id={${JSON.stringify(list.rootQaId)}}` : "",
    list.rootSourceNodeId ? `data-source-region={${JSON.stringify(list.rootSourceNodeId)}}` : "",
  ]
    .filter(Boolean)
    .join(" ")
  return [
    "// @ts-nocheck",
    "// semantic-source-replacement: generated from repeated source news/event cards with explicit data and render loops.",
    "",
    `const ${itemsName} = ${JSON.stringify(list.items, null, 2)} as const`,
    "",
    `export function ${list.componentName}() {`,
    "  return (",
    `    <div${rootAttrs ? ` ${rootAttrs}` : ""}>`,
    list.wrapperClassName ? `      <div className={${JSON.stringify(list.wrapperClassName)}}>` : "      <div>",
    list.gridClassName ? `        <div className={${JSON.stringify(list.gridClassName)}}>` : "        <div>",
    `          {${itemsName}.map((item) => (`,
    '            <a className={item.cardClassName} href={item.href} key={`${item.href}-${item.title}`} target="_blank" rel="noreferrer">',
    '              <article className={item.articleClassName} data-qa-id="news-headline-card">',
    "                <div className={item.containerClassName}>",
    "                  <div className={item.headerClassName}>",
    "                    {item.logoImages.length > 0 ? (",
    '                      <ul className="semantic-source-logo-list">',
    "                        {item.logoImages.map((logo) => (",
    "                          <li key={`${item.href}-${logo.src}`}>",
    "                            <img className={logo.className} src={logo.src} alt={logo.alt} />",
    "                          </li>",
    "                        ))}",
    "                      </ul>",
    "                    ) : null}",
    "                    {item.timestampTitle ? (",
    "                      <span className={item.dateClassName}>",
    '                        <relative-time className="apply-common-tooltip" title={item.timestampTitle} />',
    "                      </span>",
    "                    ) : null}",
    "                    {item.sourceLabel ? <span>{` ${item.sourceLabel} `}</span> : null}",
    "                  </div>",
    "                  <div className={item.titleClassName} data-qa-id={item.titleQaId}>",
    "                    {item.title}",
    "                  </div>",
    "                </div>",
    "              </article>",
    "            </a>",
    "          ))}",
    "        </div>",
    "      </div>",
    "    </div>",
    "  )",
    "}",
    "",
  ].join("\n")
}

function renderSemanticRepeatedListComponent(collection: SemanticRepeatedListCollection): string {
  const rootTag = collection.rootTagName
  return [
    "// @ts-nocheck",
    "// semantic-source-replacement: generated from repeated sibling source structure with explicit data and render loops.",
    "",
    `const items = ${JSON.stringify(collection.items, null, 2)} as const`,
    "",
    `export function ${collection.componentName}() {`,
    "  return (",
    `    <${rootTag} className={${JSON.stringify(collection.rootClassName)}} data-source-region={${JSON.stringify(collection.rootSourceNodeId ?? "")}}>`,
    "      {items.map((item) => (",
    '        <li key={item.id} className={item.itemClassName} data-source-role="promo_item">',
    "          <article className={item.cardClassName}>",
    "            {item.imageSrc ? <img className={item.imageClassName} src={item.imageSrc} alt={item.imageAlt} /> : null}",
    "            <a href={item.href}>",
    "              <span className={item.titleClassName}>{item.title}</span>",
    "            </a>",
    "            {item.meta ? <span className={item.metaClassName}>{item.meta}</span> : null}",
    "          </article>",
    "        </li>",
    "      ))}",
    `    </${rootTag}>`,
    "  )",
    "}",
    "",
  ].join("\n")
}

function renderSemanticDataTableComponent(table: SemanticDataTable): string {
  const tableName = `${table.componentName.charAt(0).toLowerCase()}${table.componentName.slice(1)}Data`
  const rootDataAttrLines = Object.keys(table.rootDataAttrs)
    .sort()
    .map((name) => `      ${name}={${tableName}.rootDataAttrs[${JSON.stringify(name)}]}`)
  return [
    "// @ts-nocheck",
    "// semantic-source-replacement: generated from source table/heatmap DOM with explicit rows, columns, classes, and render loops.",
    "",
    `const ${tableName} = ${JSON.stringify(table, null, 2)} as const`,
    "",
    `export function ${table.componentName}() {`,
    `  const table = ${tableName}`,
    "  return (",
    "    <div",
    "      className={table.rootClassName}",
    "      data-source-region={table.rootSourceNodeId}",
    ...rootDataAttrLines,
    "    >",
    "      <div className={table.headerClassName}>",
    "        <div className={table.headerWrapperClassName}>",
    "          <span className={table.titleWrapperClassName}>",
    "            <div className={table.titleContainerClassName}>",
    "              {table.titleHref ? (",
    "                <a className={table.titleLinkClassName} href={table.titleHref}>",
    "                  <h2 className={table.titleClassName} id={table.titleId}>{table.titleText}</h2>",
    "                </a>",
    "              ) : (",
    "                <h2 className={table.titleClassName} id={table.titleId}>{table.titleText}</h2>",
    "              )}",
    "            </div>",
    "          </span>",
    "        </div>",
    "      </div>",
    "      <div className={table.contentClassName}>",
    "        <div className={table.tableContainerClassName} style={table.tableContainerStyle}>",
    "          <div className={table.innerContainerClassName}>",
    "            <table className={table.tableClassName}>",
    "              <tbody className={table.bodyClassName}>",
    "                <tr>",
    "                  <th />",
    "                  {table.headers.map((header) => (",
    "                    <th className={header.thClassName} key={header.label}>",
    "                      {header.href ? (",
    "                        <a className={header.anchorClassName} href={header.href}>",
    "                          <span className={header.spanClassName}>{header.label}</span>",
    "                        </a>",
    "                      ) : (",
    "                        <span className={header.spanClassName}>{header.label}</span>",
    "                      )}",
    "                    </th>",
    "                  ))}",
    "                </tr>",
    "                {table.rows.map((row) => (",
    "                  <tr key={row.label}>",
    "                    <th className={row.thClassName}>",
    "                      {row.href ? (",
    "                        <a className={row.labelLinkClassName} href={row.href}>",
    "                          {row.imageSrc ? <img className={row.imageClassName} src={row.imageSrc} alt={row.imageAlt} /> : null}",
    "                          <span className={row.labelClassName}>{row.label}</span>",
    "                        </a>",
    "                      ) : (",
    "                        <span className={row.labelClassName}>{row.label}</span>",
    "                      )}",
    "                    </th>",
    "                    {row.cells.map((cell, index) => (",
    "                      <td className={cell.className} key={`${row.label}-${table.headers[index]?.label ?? index}`}>",
    "                        <span className={cell.contentClassName}>",
    "                          <div className={cell.rowClassName}>",
    "                            <span className={cell.valueClassName}>{cell.value}</span>",
    "                            {cell.unit ? <span className={cell.unitClassName}>{cell.unit}</span> : null}",
    "                          </div>",
    "                        </span>",
    "                      </td>",
    "                    ))}",
    "                  </tr>",
    "                ))}",
    "              </tbody>",
    "            </table>",
    "          </div>",
    "        </div>",
    "      </div>",
    "    </div>",
    "  )",
    "}",
    "",
  ].join("\n")
}

function renderSemanticMetricRankingCardComponent(ranking: SemanticMetricRankingCard): string {
  const rankingName = `${ranking.componentName.charAt(0).toLowerCase()}${ranking.componentName.slice(1)}Data`
  return [
    "// @ts-nocheck",
    "// semantic-source-replacement: generated from source metric ranking card rows with explicit labels, values, images, and render loops.",
    "",
    `const ${rankingName} = ${JSON.stringify(ranking, null, 2)} as const`,
    "",
    `export function ${ranking.componentName}() {`,
    `  const ranking = ${rankingName}`,
    "  return (",
    "    <div className={ranking.rootClassName} data-source-region={ranking.rootSourceNodeId} style={ranking.rootStyle}>",
    "      <div className={ranking.wrapperClassName}>",
    "        <div className={ranking.titleClassName}>{ranking.titleText}</div>",
    "        <div className={ranking.headerRowClassName}>",
    "          {ranking.headerLabels.map((label) => <span className={ranking.headerLabelClassName} key={label}>{label}</span>)}",
    "        </div>",
    "        <ul className={ranking.listClassName}>",
    "          {ranking.rows.map((row) => (",
    "            <li className={ranking.itemClassName} key={`${row.href}-${row.label}`}>",
    "              <div className={ranking.rowOuterClassName}>",
    "                <div className={ranking.rowInnerClassName}>",
    "                  {row.imageSrc ? <img className={ranking.imageClassName} src={row.imageSrc} alt={row.imageAlt} /> : null}",
    "                  <a className={ranking.linkClassName} href={row.href}>",
    "                    <div className={ranking.titleContainerClassName}>",
    "                      <span className={ranking.labelClassName}>{row.label}</span>",
    "                    </div>",
    "                  </a>",
    "                  {row.values.map((cell, index) => (",
    "                    <span className={ranking.valueCellClassName} key={`${row.label}-${ranking.headerLabels[index + 1] ?? index}`}>",
    "                      <span className={ranking.valueClassName}>{cell.value}</span>",
    "                      {cell.unit ? <span className={ranking.unitClassName}>{cell.unit}</span> : null}",
    "                    </span>",
    "                  ))}",
    "                </div>",
    "              </div>",
    "            </li>",
    "          ))}",
    "        </ul>",
    "      </div>",
    "    </div>",
    "  )",
    "}",
    "",
  ].join("\n")
}

function renderSemanticMetricChartCardComponent(card: SemanticMetricChartCard): string {
  const cardName = `${card.componentName.charAt(0).toLowerCase()}${card.componentName.slice(1)}Data`
  return [
    "// @ts-nocheck",
    "// semantic-source-replacement: generated from source mini metric chart card structure, chart asset layers, and stat rows.",
    "",
    `const ${cardName} = ${JSON.stringify(card, null, 2)} as const`,
    "",
    "function ChartNode({ node }) {",
    "  if (!node) return null",
    "  const Tag = node.tagName",
    "  const props = { className: node.className, style: node.style, width: node.width, height: node.height }",
    "  return (",
    "    <Tag {...props}>",
    "      {node.children.map((child, index) => <ChartNode node={child} key={`${child.tagName}-${index}`} />)}",
    "    </Tag>",
    "  )",
    "}",
    "",
    `export function ${card.componentName}() {`,
    `  const card = ${cardName}`,
    "  return (",
    "    <div className={card.rootClassName} data-source-region={card.rootSourceNodeId} style={card.rootStyle}>",
    "      <div className={card.headerClassName}>",
    "        <a href={card.linkHref} className={card.linkClassName}>",
    "          <span className={card.titleClassName} data-overflow-tooltip-text={card.titleTooltip}>{card.title}</span>",
    "          {card.ticker ? <span className={card.tickerClassName}>{card.ticker}</span> : null}",
    "        </a>",
    "      </div>",
    "      <div className={card.contentClassName}>",
    "        <div className={card.chartShellClassName}>",
    "          <ChartNode node={card.chartFrame} />",
    "        </div>",
    "      </div>",
    "      <div className={card.statsWrapperClassName}>",
    "        <div className={card.statsContainerClassName}>",
    "          {card.stats.map((stat) => (",
    "            <div className={stat.wrapperClassName} key={`${stat.label}-${stat.value}`}>",
    "              <div className={stat.labelClassName}>{stat.label}</div>",
    "              <div className={stat.valueClassName}>",
    "                {stat.valueInnerClassName ? <div className={stat.valueInnerClassName}>{stat.value}</div> : stat.value}",
    "              </div>",
    "            </div>",
    "          ))}",
    "        </div>",
    "      </div>",
    "    </div>",
    "  )",
    "}",
    "",
  ].join("\n")
}

function renderSemanticEventCardListComponent(list: SemanticEventCardList): string {
  const listName = `${list.componentName.charAt(0).toLowerCase()}${list.componentName.slice(1)}Data`
  const rootDataAttrLines = Object.keys(list.rootDataAttrs)
    .sort()
    .map((name) => `      ${name}={${listName}.rootDataAttrs[${JSON.stringify(name)}]}`)
  return [
    "// @ts-nocheck",
    "// semantic-source-replacement: generated from repeated source event cards with explicit data and render loops.",
    "",
    `const ${listName} = ${JSON.stringify(list, null, 2)} as const`,
    "",
    `export function ${list.componentName}() {`,
    `  const list = ${listName}`,
    "  return (",
    "    <div",
    "      className={list.rootClassName}",
    "      data-source-region={list.rootSourceNodeId}",
    ...rootDataAttrLines,
    "    >",
    "      <div className={list.headerClassName}>",
    "        <div className={list.headerWrapperClassName}>",
    "          <span className={list.titleWrapperClassName}>",
    "            <div className={list.titleContainerClassName}>",
    "              {list.titleHref ? (",
    "                <a className={list.titleLinkClassName} href={list.titleHref}>",
    "                  <h2 className={list.titleClassName} id={list.titleId}>{list.titleText}</h2>",
    "                </a>",
    "              ) : (",
    "                <h2 className={list.titleClassName} id={list.titleId}>{list.titleText}</h2>",
    "              )}",
    "            </div>",
    "          </span>",
    "        </div>",
    "      </div>",
    "      <div className={list.contentClassName}>",
    "        <div className={list.wrapperClassName}>",
    "          <div className={list.containerClassName}>",
    "            <div className={list.itemsClassName}>",
    "              {list.chromeClassNames.map((className) => <div className={className} key={className} />)}",
    "              {list.items.map((item) => (",
    "                <a className={item.cardClassName} href={item.href} key={`${item.href}-${item.title}`}>",
    "                  <div className={item.topClassName}>",
    "                    <div className={item.dateClassName}>",
    "                      <div className={item.dayClassName}>{item.dayText}</div>",
    "                      {item.dotText ? <div className={item.dotClassName}>{item.dotText}</div> : null}",
    "                      {item.timestampTitle ? (",
    "                        <div className={item.timestampWrapperClassName} title={item.timestampTitle}>",
    "                          <span className={item.badgeClassName}>",
    "                            <span className={item.badgeContentClassName} />",
    "                          </span>",
    "                        </div>",
    "                      ) : null}",
    "                    </div>",
    "                  </div>",
    "                  <div className={item.titleBlockClassName}>",
    "                    {item.flagSrc ? <img className={item.flagClassName} data-tooltip={item.flagTooltip} src={item.flagSrc} /> : null}",
    "                    <div className={item.columnClassName}>",
    "                      <span className={item.titleClassName}>{item.title}</span>",
    "                    </div>",
    "                  </div>",
    "                  <div className={item.statsClassName}>",
    "                    {item.stats.map((stat) => (",
    "                      <div className={stat.wrapperClassName} key={`${item.title}-${stat.label}`}>",
    "                        <div className={stat.titleClassName}>{stat.label}</div>",
    "                        <div className={stat.valueWrapClassName}>",
    "                          <div className={stat.valueClassName}>{stat.value}</div>",
    "                          {stat.unit ? <div className={stat.unitClassName}>{stat.unit}</div> : null}",
    "                        </div>",
    "                      </div>",
    "                    ))}",
    "                  </div>",
    "                </a>",
    "              ))}",
    "            </div>",
    "          </div>",
    "        </div>",
    "      </div>",
    "    </div>",
    "  )",
    "}",
    "",
  ].join("\n")
}

function renderSemanticFooterComponent(footer: SemanticFooter): string {
  const footerName = `${footer.componentName.charAt(0).toLowerCase()}${footer.componentName.slice(1)}Data`
  return [
    "// @ts-nocheck",
    "// semantic-source-replacement: generated from source footer structure, navigation groups, social links, assets, and legal text with data loops.",
    "",
    `const ${footerName} = ${JSON.stringify(footer, null, 2)} as const`,
    "",
    `export function ${footer.componentName}() {`,
    `  const footer = ${footerName}`,
    "  return (",
    "    <footer className={footer.rootClassName} data-source-region={footer.rootSourceNodeId} data-nosnippet={footer.dataNosnippet}>",
    "      <div className={footer.promoClassName}>",
    "        <div className={footer.visualRootClassName}>",
    "          <div className={footer.containerClassName}>",
    "            <div className={footer.contentClassName}>",
    "              <div className={footer.leadingClassName}>",
    "                <div className={footer.logoSocialsClassName}>",
    "                  {footer.logoLink ? (",
    "                    <a className={footer.logoLink.className} href={footer.logoLink.href} aria-label={footer.logoLink.ariaLabel} target={footer.logoLink.target} rel={footer.logoLink.rel}>",
    "                      <span className={footer.logoLink.markClassName}></span>",
    "                    </a>",
    "                  ) : null}",
    "                  <div className={footer.socialsClassName}>",
    "                    {footer.socialLinks.map((link) => (",
    "                      <a className={link.className} href={link.href} aria-label={link.ariaLabel} target={link.target} rel={link.rel} key={`${link.href}-${link.ariaLabel ?? link.label}`}>",
    "                        <span className={link.iconClassName}></span>",
    "                      </a>",
    "                    ))}",
    "                  </div>",
    "                </div>",
    "                <div className={footer.copyrightContainerClassName}>",
    "                  {footer.languageLabel ? <button className={footer.languageButtonClassName}>{footer.languageLabel}</button> : null}",
    "                  <p className={footer.copyrightClassName}>",
    '                    {footer.legalParts.map((part, index) => part.kind === "link" && part.link ? (',
    "                      <a className={part.link.className} href={part.link.href} target={part.link.target} rel={part.link.rel} key={`${part.link.href}-${index}`}>{part.text}</a>",
    "                    ) : (",
    "                      <span key={`${part.text}-${index}`}>{part.text}</span>",
    "                    ))}",
    "                  </p>",
    "                </div>",
    "              </div>",
    "              <div className={footer.footerLinksClassName}>",
    "                {footer.linkGroups.map((group, groupIndex) => (",
    "                  <div className={group.className} key={groupIndex}>",
    "                    {group.columns.map((column) => (",
    "                      <div className={column.className} key={column.title}>",
    "                        {column.title ? <span className={column.titleClassName}>{column.title}</span> : null}",
    "                        <ul className={column.listClassName}>",
    "                          {column.links.map((link) => (",
    "                            <li key={`${column.title}-${link.href}-${link.label}`}>",
    "                              <a className={link.className} href={link.href} aria-label={link.ariaLabel} target={link.target} rel={link.rel}>{link.label}</a>",
    "                            </li>",
    "                          ))}",
    "                        </ul>",
    "                      </div>",
    "                    ))}",
    "                  </div>",
    "                ))}",
    "              </div>",
    "            </div>",
    "            {footer.backgroundImageClassName ? <div className={footer.backgroundImageClassName}></div> : null}",
    "            {footer.lookFirstContainerClassName ? (",
    "              <div className={footer.lookFirstContainerClassName}>",
    "                {footer.images.map((image) => <img className={image.className} src={image.src} alt={image.alt} key={`${image.src}-${image.alt}`} />)}",
    "                {footer.pepeContainerClassName ? <div className={footer.pepeContainerClassName}></div> : null}",
    "              </div>",
    "            ) : null}",
    "            {footer.pepeLauncherClassName ? <div className={footer.pepeLauncherClassName}></div> : null}",
    "          </div>",
    "        </div>",
    "      </div>",
    "    </footer>",
    "  )",
    "}",
    "",
  ].join("\n")
}

function renderSemanticHeaderNavigationComponent(header: SemanticHeaderNavigation): string {
  const dataName = `${header.componentName.charAt(0).toLowerCase()}${header.componentName.slice(1)}Data`
  const rootDataAttrLines = Object.keys(header.rootDataAttrs)
    .sort()
    .map((name) => `      ${name}={${dataName}.rootDataAttrs[${JSON.stringify(name)}]}`)
  return [
    "// @ts-nocheck",
    "// semantic-source-replacement: generated from source header navigation, logo assets, menu links, and action buttons with data loops.",
    'import { AssetPath } from "../AssetPath"',
    "",
    `const ${dataName} = ${JSON.stringify(header, null, 2)} as const`,
    "",
    "function HeaderIcon({ icon }) {",
    "  if (!icon) return null",
    "  return (",
    "    <svg width={icon.width} height={icon.height} viewBox={icon.viewBox} className={icon.className} fill={icon.fill} xmlns={icon.xmlns} preserveAspectRatio={icon.preserveAspectRatio}>",
    "      {icon.paths.map((path, index) => (",
    "        <AssetPath key={`${path.assetPath}-${path.id ?? index}`} {...path} />",
    "      ))}",
    "      {icon.circles.map((circle, index) => <circle key={index} {...circle} />)}",
    "    </svg>",
    "  )",
    "}",
    "",
    "function HeaderButton({ button }) {",
    "  if (!button) return null",
    "  return (",
    '    <button className={button.className} aria-label={button.ariaLabel} aria-haspopup={button.ariaHasPopup} aria-expanded={button.ariaExpanded} type={button.type ?? "button"}>',
    "      <HeaderIcon icon={button.icon} />",
    "      {button.label ? (button.textClassName ? <span className={button.textClassName}>{button.label}</span> : button.label) : null}",
    "    </button>",
    "  )",
    "}",
    "",
    `export function ${header.componentName}() {`,
    `  const header = ${dataName}`,
    "  return (",
    "    <div",
    "      className={header.rootClassName}",
    "      data-source-region={header.rootSourceNodeId}",
    ...rootDataAttrLines,
    "    >",
    "      {header.backdropClassName ? <div className={header.backdropClassName} /> : null}",
    "      <div className={header.innerClassName}>",
    "        <div className={header.logoAreaClassName}>",
    "          <HeaderButton button={header.hamburger} />",
    "          <span className={header.logoWrapperClassName}>",
    "            <a className={header.logoLink.className} href={header.logoLink.href} aria-label={header.logoLink.ariaLabel} target={header.logoLink.target} rel={header.logoLink.rel}>",
    "              <span className={header.logoIconWrapperClassName}>",
    "                <HeaderIcon icon={header.logoIcon} />",
    "              </span>",
    "              {header.logoTextIcon ? (",
    "                <span className={header.logoTextWrapperClassName}>",
    "                  <HeaderIcon icon={header.logoTextIcon} />",
    "                </span>",
    "              ) : null}",
    '              {!header.logoTextIcon && header.logoTextFallback ? <span className="semantic-source-header-logo-text">{header.logoTextFallback}</span> : null}',
    "              {header.logoProClassName ? <span className={header.logoProClassName} /> : null}",
    "            </a>",
    "          </span>",
    "        </div>",
    "        <div className={header.middleWrapperClassName}>",
    "          <div className={header.middleContentClassName}>",
    "            <div className={header.searchAreaClassName}>",
    "              <div className={header.searchContainerClassName}>",
    "                <HeaderButton button={header.searchButton} />",
    "                <HeaderButton button={header.simpleSearchButton} />",
    "              </div>",
    "            </div>",
    "            <nav className={header.navClassName}>",
    "              <ul className={header.menuClassName}>",
    "                {header.menuItems.map((item) => (",
    "                  <li className={item.className} data-main-menu-dropdown-root-index={item.dropdownRootIndex} key={`${item.href}-${item.label}`}>",
    "                    <a href={item.href} data-main-menu-root-track-id={item.trackId}>",
    "                      {item.label}",
    "                      <span className={item.chevronClassName} aria-haspopup={item.chevronAriaHasPopup} aria-expanded={item.chevronAriaExpanded} aria-label={item.chevronAriaLabel} role={item.chevronRole}>",
    "                        <HeaderIcon icon={item.chevronIcon} />",
    "                      </span>",
    "                    </a>",
    "                  </li>",
    "                ))}",
    "              </ul>",
    "            </nav>",
    "          </div>",
    "        </div>",
    "        <div className={header.userAreaClassName}>",
    "          <HeaderButton button={header.languageButton} />",
    "          <HeaderButton button={header.anonymousUserButton} />",
    '          {header.loggedUserButtonClassName ? <button aria-label="Open user menu" type="button" className={header.loggedUserButtonClassName} /> : null}',
    "          {header.offerLink ? (",
    "            <div className={header.offerShellClassName} data-props-id={header.offerPropsId} data-render-mode={header.offerRenderMode}>",
    "              <div className={header.offerContainerClassName}>",
    "                <a href={header.offerLink.href} className={header.offerLink.className} target={header.offerLink.target} rel={header.offerLink.rel}>",
    "                  <span className={header.offerContentClassName} data-overflow-tooltip-text={header.offerLink.label}>",
    "                    <span className={header.offerChildrenClassName}>",
    "                      <span className={header.offerTitleClassName}>{header.offerLink.label}</span>",
    "                    </span>",
    "                  </span>",
    "                </a>",
    "              </div>",
    "            </div>",
    "          ) : null}",
    "        </div>",
    "      </div>",
    "    </div>",
    "  )",
    "}",
    "",
  ].join("\n")
}

function renderSemanticMapSurfaceComponent(surface: SemanticMapSurface): string {
  const surfaceName = `${surface.componentName.charAt(0).toLowerCase()}${surface.componentName.slice(1)}Data`
  const rootDataAttrLines = Object.keys(surface.rootDataAttrs)
    .sort()
    .map((name) => `      ${name}={${surfaceName}.rootDataAttrs[${JSON.stringify(name)}]}`)
  return [
    "// @ts-nocheck",
    "// semantic-source-replacement: generated from source SVG map sidecar paths, critical map frames, structured legend SVG, and footer link with data loops.",
    'import { AssetPath } from "../AssetPath"',
    "",
    `const ${surfaceName} = ${JSON.stringify(surface, null, 2)} as const`,
    "",
    "function Frame({ frame, children }) {",
    '  const Element = frame.tagName || "div"',
    "  return (",
    "    <Element className={frame.className || undefined} id={frame.id} style={frame.style} {...frame.dataAttrs}>",
    "      {children}",
    "    </Element>",
    "  )",
    "}",
    "",
    "function MapFrame({ frames, children }) {",
    "  return frames.reduceRight((current, frame, index) => (",
    "    <Frame key={`${frame.tagName}-${frame.className}-${index}`} frame={frame}>",
    "      {current}",
    "    </Frame>",
    "  ), children)",
    "}",
    "",
    "function MapTitle({ surface }) {",
    "  if (!surface.titleText) return null",
    "  if (!surface.headerClassName) {",
    "    return surface.titleHref ? (",
    "      <a className={surface.titleLinkClassName} href={surface.titleHref}>",
    "        <span className={surface.titleClassName} id={surface.titleId}>{surface.titleText}</span>",
    "      </a>",
    "    ) : (",
    "      <span className={surface.titleClassName} id={surface.titleId}>{surface.titleText}</span>",
    "    )",
    "  }",
    "  return (",
    "    <div className={surface.headerClassName}>",
    "      <div className={surface.headerWrapperClassName}>",
    "        <span className={surface.titleWrapperClassName}>",
    "          <div className={surface.titleContainerClassName}>",
    "            {surface.titleHref ? (",
    "              <a className={surface.titleLinkClassName} href={surface.titleHref}>",
    "                <h2 className={surface.titleClassName} id={surface.titleId}>{surface.titleText}</h2>",
    "              </a>",
    "            ) : (",
    "              <h2 className={surface.titleClassName} id={surface.titleId}>{surface.titleText}</h2>",
    "            )}",
    "          </div>",
    "        </span>",
    "      </div>",
    "    </div>",
    "  )",
    "}",
    "",
    "function MapLegend({ surface }) {",
    "  const legend = surface.legend",
    "  if (!legend) return null",
    "  const legendSvg = (",
    "    <svg width={legend.svg.width} height={legend.svg.height} viewBox={legend.svg.viewBox} fill={legend.svg.fill} className={legend.svg.className} style={legend.svg.style}>",
    "      {legend.items.map((item, index) => (",
    '        <g className={item.className} key={`${item.tooltipTitle ?? "legend"}-${index}`} {...item.dataAttrs}>',
    "          <g className={item.tooltipClassName} title={item.tooltipTitle}>",
    "            {item.rect ? <rect {...item.rect} /> : null}",
    "            <g className={item.figureGroupClassName}>",
    "              {item.paths.map((path, pathIndex) => <AssetPath key={`${path.assetPath}-${pathIndex}`} {...path} />)}",
    "            </g>",
    "          </g>",
    "          {item.text ? (",
    "            <text className={item.text.className} x={item.text.x} y={item.text.y}>",
    "              {item.text.label}",
    "              {item.text.tspans.map((tspan, tspanIndex) => <tspan key={tspanIndex} {...tspan} />)}",
    "            </text>",
    "          ) : null}",
    "        </g>",
    "      ))}",
    "    </svg>",
    "  )",
    "  const legendBody = legend.toolbarFrame ? <Frame frame={legend.toolbarFrame}>{legendSvg}</Frame> : legendSvg",
    "  return (",
    "    <Frame frame={legend.containerFrame}>",
    "      {legendBody}",
    "    </Frame>",
    "  )",
    "}",
    "",
    "function MapSvg({ surface }) {",
    "  return (",
    '    <svg viewBox={surface.svgViewBox} fill="currentColor" preserveAspectRatio="xMidYMid meet" className={surface.svgClassName} style={{ width: "100%", height: "auto", display: "block" }}>',
    "      {surface.paths.map((path, index) => (",
    "        <AssetPath key={`${path.assetPath}-${path.id ?? index}`} {...path} />",
    "      ))}",
    "    </svg>",
    "  )",
    "}",
    "",
    "function MapContent({ surface }) {",
    '  const mapContainerIndex = surface.mapFrameNodes.findIndex((frame) => frame.semanticRole === "mapContainer")',
    "  const outerFrames = mapContainerIndex >= 0 ? surface.mapFrameNodes.slice(0, mapContainerIndex + 1) : []",
    "  const innerFrames = mapContainerIndex >= 0 ? surface.mapFrameNodes.slice(mapContainerIndex + 1) : surface.mapFrameNodes",
    "  const mapSvg = (",
    "    <MapFrame frames={innerFrames}>",
    "      <MapSvg surface={surface} />",
    "    </MapFrame>",
    "  )",
    "  const mapContent = (",
    "    <>",
    "      <MapLegend surface={surface} />",
    "      {mapSvg}",
    "    </>",
    "  )",
    "  return outerFrames.length > 0 ? <MapFrame frames={outerFrames}>{mapContent}</MapFrame> : mapContent",
    "}",
    "",
    "function MapBody({ surface }) {",
    "  const body = (",
    "    <>",
    "      {!surface.headerClassName ? <MapTitle surface={surface} /> : null}",
    "      <MapContent surface={surface} />",
    "    </>",
    "  )",
    "  return surface.bodyWrapperFrame ? <Frame frame={surface.bodyWrapperFrame}>{body}</Frame> : body",
    "}",
    "",
    `export function ${surface.componentName}() {`,
    `  const surface = ${surfaceName}`,
    "  return (",
    "    <div",
    "      className={surface.rootClassName}",
    "      data-source-region={surface.rootSourceNodeId}",
    "      style={surface.rootStyle}",
    ...rootDataAttrLines,
    "    >",
    "      {surface.headerClassName ? <MapTitle surface={surface} /> : null}",
    "      <MapBody surface={surface} />",
    "      {surface.footerLink ? (",
    '        <div className="semantic-source-map-footer">',
    "          <a className={surface.footerLink.className} href={surface.footerLink.href} target={surface.footerLink.target} rel={surface.footerLink.rel}>",
    "            {surface.footerLink.label}",
    "          </a>",
    "        </div>",
    "      ) : null}",
    "    </div>",
    "  )",
    "}",
    "",
  ].join("\n")
}

function renderSemanticLinkGridComponent(grid: SemanticLinkGrid): string {
  const dataName = `${grid.componentName.charAt(0).toLowerCase()}${grid.componentName.slice(1)}Data`
  const rootDataAttrLines = Object.keys(grid.rootDataAttrs)
    .sort()
    .map((name) => `      ${name}={${dataName}.rootDataAttrs[${JSON.stringify(name)}]}`)
  return [
    "// @ts-nocheck",
    "// semantic-source-replacement: generated from source link-grid anchors with data loops.",
    "",
    `const ${dataName} = ${JSON.stringify(grid, null, 2)} as const`,
    "",
    `export function ${grid.componentName}() {`,
    `  const grid = ${dataName}`,
    "  return (",
    "    <div",
    "      className={grid.rootClassName}",
    "      data-source-region={grid.rootSourceNodeId}",
    ...rootDataAttrLines,
    "    >",
    "      <div className={grid.headerClassName}>",
    "        <div className={grid.headerWrapperClassName}>",
    "          <span className={grid.titleWrapperClassName}>",
    "            <div className={grid.titleContainerClassName}>",
    "              {grid.titleHref ? (",
    "                <a className={grid.titleLinkClassName} href={grid.titleHref}>",
    "                  <h2 className={grid.titleClassName} id={grid.titleId}>{grid.titleText}</h2>",
    "                </a>",
    "              ) : (",
    "                <h2 className={grid.titleClassName} id={grid.titleId}>{grid.titleText}</h2>",
    "              )}",
    "            </div>",
    "          </span>",
    "        </div>",
    "      </div>",
    "      <div className={grid.contentClassName}>",
    "        <div className={grid.linksContainerClassName}>",
    "          {grid.links.map((link) => (",
    "            <a key={`${link.href}-${link.label}`} className={link.className} href={link.href} target={link.target} rel={link.rel} aria-label={link.ariaLabel}>",
    "              <span>{link.label}</span>",
    "            </a>",
    "          ))}",
    "        </div>",
    "      </div>",
    "    </div>",
    "  )",
    "}",
    "",
  ].join("\n")
}

function renderSemanticIdeaCardCollectionComponent(collection: SemanticIdeaCardCollection): string {
  const dataName = `${collection.componentName.charAt(0).toLowerCase()}${collection.componentName.slice(1)}Data`
  const rootDataAttrLines = Object.keys(collection.rootDataAttrs)
    .sort()
    .map((name) => `      ${name}={${dataName}.rootDataAttrs[${JSON.stringify(name)}]}`)
  return [
    "// @ts-nocheck",
    "// semantic-source-replacement: generated from repeated source idea cards with explicit data, thumbnails, metadata, and render loops.",
    'import { AssetPath } from "../AssetPath"',
    "",
    `const ${dataName} = ${JSON.stringify(collection, null, 2)} as const`,
    "",
    "function SemanticIcon({ icon }) {",
    "  if (!icon) return null",
    "  return (",
    "    <svg width={icon.width} height={icon.height} viewBox={icon.viewBox} className={icon.className} fill={icon.fill} xmlns={icon.xmlns} preserveAspectRatio={icon.preserveAspectRatio}>",
    "      {icon.paths.map((path, index) => (",
    "        <AssetPath key={`${path.assetPath}-${path.id ?? index}`} {...path} />",
    "      ))}",
    "      {icon.circles.map((circle, index) => <circle key={index} {...circle} />)}",
    "    </svg>",
    "  )",
    "}",
    "",
    "function StrategyBadge({ badge }) {",
    "  if (!badge) return null",
    "  return (",
    "    <span className={badge.className} title={badge.title}>",
    '      <span role="img" className={badge.iconClassName} aria-hidden="true">',
    "        <SemanticIcon icon={badge.icon} />",
    "      </span>",
    "      {badge.label ? <span className={badge.labelClassName}>{badge.label}</span> : null}",
    "    </span>",
    "  )",
    "}",
    "",
    "function MoreCard({ link }) {",
    "  if (!link) return null",
    "  return (",
    "    <a className={link.className} href={link.href} style={link.style}>",
    "      <p className={link.contentClassName}>",
    "        <span className={link.wrapClassName}>",
    "          <span className={link.textClassName}>{link.label}</span>",
    '          <span role="img" className={link.arrowClassName} aria-hidden="true">',
    "            <SemanticIcon icon={link.icon} />",
    "          </span>",
    "        </span>",
    "      </p>",
    "    </a>",
    "  )",
    "}",
    "",
    `export function ${collection.componentName}() {`,
    `  const collection = ${dataName}`,
    "  return (",
    "    <div",
    "      className={collection.rootClassName}",
    "      data-source-region={collection.rootSourceNodeId}",
    "      style={collection.rootStyle}",
    ...rootDataAttrLines,
    "    >",
    "      <div className={collection.headerClassName}>",
    "        <div className={collection.headerWrapperClassName}>",
    "          <span className={collection.titleWrapperClassName}>",
    "            <div className={collection.titleContainerClassName}>",
    "              {collection.titleHref ? (",
    "                <a className={collection.titleLinkClassName} href={collection.titleHref}>",
    "                  <h2 className={collection.titleClassName} id={collection.titleId}>{collection.titleText}</h2>",
    "                </a>",
    "              ) : (",
    "                <h2 className={collection.titleClassName} id={collection.titleId}>{collection.titleText}</h2>",
    "              )}",
    "            </div>",
    "          </span>",
    "        </div>",
    "      </div>",
    "      <div className={collection.contentClassName} data-qa-id={collection.contentQaId}>",
    "        {collection.tabs.length > 0 ? (",
    "          <div className={collection.tabsContainerClassName}>",
    "            <div className={collection.tabsScrollWrapClassName} data-name={collection.tabsScrollWrapDataName} style={collection.tabsScrollWrapStyle}>",
    '              <div id={collection.tabsListId} role="tablist" aria-orientation={collection.tabsListOrientation} className={collection.tabsListClassName}>',
    '                {collection.tabs.map((tab) => tab.tagName === "a" ? (',
    "                  <a key={tab.id ?? tab.label} id={tab.id} className={tab.className} href={tab.href} role={tab.role} aria-selected={tab.ariaSelected} aria-disabled={tab.ariaDisabled} aria-label={tab.ariaLabel} data-id={tab.dataId} data-qa-id={tab.dataQaId}>",
    "                    <span>{tab.label}</span>",
    "                  </a>",
    "                ) : (",
    '                  <button key={tab.id ?? tab.label} id={tab.id} type="button" className={tab.className} role={tab.role} aria-selected={tab.ariaSelected} aria-disabled={tab.ariaDisabled} aria-label={tab.ariaLabel} data-id={tab.dataId} data-qa-id={tab.dataQaId}>',
    "                    <span>{tab.label}</span>",
    "                  </button>",
    "                ))}",
    "              </div>",
    "            </div>",
    "          </div>",
    "        ) : null}",
    "        <div className={collection.cardsWrapperClassName}>",
    "          <div className={collection.filmstripContainerClassName}>",
    "            <div className={collection.itemsClassName}>",
    "              {collection.chromeItems.map((chrome, index) => <div className={chrome.className} style={chrome.style} key={`${chrome.className}-${index}`} />)}",
    "              {collection.cards.map((card) => (",
    "                <article className={card.rootClassName} style={card.rootStyle} key={`${card.href}-${card.title}`}>",
    "                  <div className={card.textBlockClassName} style={card.textBlockStyle}>",
    "                    <a href={card.href} data-qa-id={card.titleQaId} className={card.titleClassName}>",
    "                      {card.title}",
    "                    </a>",
    "                    {card.paragraph ? (",
    "                      <a href={card.href} data-qa-id={card.paragraphQaId} className={card.paragraphClassName}>",
    "                        <span className={card.paragraphContainerClassName}>",
    "                          <span className={card.paragraphContentClassName}>{card.paragraph}</span>",
    "                        </span>",
    "                      </a>",
    "                    ) : null}",
    "                  </div>",
    "                  <div className={card.previewClassName}>",
    '                    {card.previewFallbackImageSrc ? <img className="image-fSver7BK" src={card.previewFallbackImageSrc} alt="" /> : null}',
    "                    <div className={card.previewGridClassName}>",
    "                      {card.previewChromeClassNames.map((className) => <div className={className} key={`${card.href}-${className}`} />)}",
    "                      {(card.logoLink || card.strategyBadge) ? (",
    "                        <div className={card.previewBadgeRowClassName}>",
    "                          {card.logoLink ? (",
    "                            <a className={card.logoLink.className} href={card.logoLink.href} title={card.logoLink.title} data-qa-id={card.logoLink.qaId}>",
    "                              <img className={card.logoLink.imageClassName} src={card.logoLink.imageSrc} alt={card.logoLink.imageAlt} />",
    "                            </a>",
    "                          ) : null}",
    "                          <StrategyBadge badge={card.strategyBadge} />",
    "                        </div>",
    "                      ) : null}",
    "                      {card.imageSrc ? (",
    '                        <a href={card.href} data-qa-id="ui-lib-card-link-image" tabIndex={-1} aria-hidden="true" className={card.imageLinkClassName}>',
    "                          <picture className={card.imagePictureClassName}>",
    '                            <img style={card.imageStyle} alt="" src={card.imageSrc} role="presentation" loading="lazy" className={card.imageClassName} />',
    "                          </picture>",
    "                        </a>",
    "                      ) : null}",
    "                    </div>",
    "                  </div>",
    "                  <div className={card.metaRowClassName}>",
    "                    <div className={card.publicationInfoClassName}>",
    '                      <address className={card.authorWrapClassName} data-qa-id="ui-lib-card-link-author">',
    "                        {card.authorHref ? (",
    "                          <a href={card.authorHref} className={card.authorLinkClassName}>",
    "                            <span className={card.authorClassName}>{card.author}</span>",
    "                          </a>",
    "                        ) : (",
    "                          <span className={card.authorClassName}>{card.author}</span>",
    "                        )}",
    "                      </address>",
    "                      {card.date ? (",
    "                        <div className={card.dateWrapClassName}>",
    "                          <time className={card.dateClassName} title={card.dateTitle}>{card.date}</time>",
    "                        </div>",
    "                      ) : null}",
    "                    </div>",
    "                    <div className={card.buttonsClassName}>",
    '                      {card.commentHref ? <a data-qa-id="ui-lib-card-comment-button" title="Comment" href={card.commentHref} aria-label={card.commentAriaLabel} className={card.commentClassName}><span /></a> : null}',
    '                      <button className={card.likeClassName} type="button" title="Boost" aria-pressed="false" data-qa-id="ui-lib-card-like-button">',
    "                        <span className={card.likeCountWrapClassName}>",
    "                          <span className={card.likeDigitGridClassName}>",
    "                            <span className={card.likeDigitClassName}>{card.likeCount}</span>",
    "                          </span>",
    "                        </span>",
    "                      </button>",
    "                    </div>",
    "                  </div>",
    "                </article>",
    "              ))}",
    "              <MoreCard link={collection.moreLink} />",
    "            </div>",
    "          </div>",
    "        </div>",
    "      </div>",
    "    </div>",
    "  )",
    "}",
    "",
  ].join("\n")
}

function renderSemanticSectionShellComponent(section: SemanticSectionShell): string {
  const dataName = `${section.componentName.charAt(0).toLowerCase()}${section.componentName.slice(1)}Data`
  const rootDataAttrLines = Object.keys(section.rootDataAttrs)
    .sort()
    .map((name) => `      ${name}={${dataName}.rootDataAttrs[${JSON.stringify(name)}]}`)
  const imports = section.children
    .map((child) => child.componentName)
    .filter((componentName, index, list) => list.indexOf(componentName) === index)
    .sort((a, b) => a.localeCompare(b))
    .map((componentName) => `import { ${componentName} } from "./${componentName}"`)
  const tabRenderLines = [
    "        {section.tabs.length > 0 ? (",
    "          <div className={section.tabsContainerClassName}>",
    '            {section.tabs.map((tab) => tab.tagName === "a" ? (',
    "              <a key={tab.id ?? tab.label} id={tab.id} className={tab.className} href={tab.href} role={tab.role} aria-selected={tab.ariaSelected} aria-disabled={tab.ariaDisabled} aria-label={tab.ariaLabel} data-id={tab.dataId} data-qa-id={tab.dataQaId}>",
    "                <span>{tab.label}</span>",
    "              </a>",
    "            ) : (",
    '              <button key={tab.id ?? tab.label} id={tab.id} type="button" className={tab.className} role={tab.role} aria-selected={tab.ariaSelected} aria-disabled={tab.ariaDisabled} aria-label={tab.ariaLabel} data-id={tab.dataId} data-qa-id={tab.dataQaId}>',
    "                <span>{tab.label}</span>",
    "              </button>",
    "            ))}",
    "          </div>",
    "        ) : null}",
  ]
  const childRenderLines = section.children.map((child) => `        <${child.componentName} />`)
  const contentRenderLines = section.contentClassName
    ? [
        "      <div className={section.contentClassName}>",
        ...tabRenderLines.map((line) => `  ${line}`),
        ...childRenderLines.map((line) => `  ${line}`),
        "      </div>",
      ]
    : [...tabRenderLines, ...childRenderLines]
  return [
    "// @ts-nocheck",
    "// semantic-source-replacement: generated from source section chrome plus semantic child surfaces.",
    ...imports,
    "",
    `const ${dataName} = ${JSON.stringify(section, null, 2)} as const`,
    "",
    `export function ${section.componentName}() {`,
    `  const section = ${dataName}`,
    "  return (",
    "    <div",
    "      className={section.rootClassName}",
    "      data-source-region={section.rootSourceNodeId}",
    "      style={section.rootStyle}",
    ...rootDataAttrLines,
    "    >",
    "      {section.titleText ? (",
    "        <div className={section.headerClassName}>",
    "          <div className={section.headerWrapperClassName}>",
    "            <span className={section.titleWrapperClassName}>",
    "              <div className={section.titleContainerClassName}>",
    "                {section.titleHref ? (",
    "                  <a className={section.titleLinkClassName} href={section.titleHref}>",
    "                    <h2 className={section.titleClassName} id={section.titleId}>{section.titleText}</h2>",
    "                  </a>",
    "                ) : (",
    "                  <h2 className={section.titleClassName} id={section.titleId}>{section.titleText}</h2>",
    "                )}",
    "              </div>",
    "            </span>",
    "          </div>",
    "        </div>",
    "      ) : null}",
    ...contentRenderLines,
    "      {section.footerLink ? (",
    '        <div className="semantic-source-section-footer">',
    "          <a className={section.footerLink.className} href={section.footerLink.href} target={section.footerLink.target} rel={section.footerLink.rel}>",
    "            {section.footerLink.label}",
    "          </a>",
    "        </div>",
    "      ) : null}",
    "    </div>",
    "  )",
    "}",
    "",
  ].join("\n")
}

function firstElementChild(node: DomNode): DomNode | undefined {
  return (node.children ?? []).find((child) => child.type === "tag")
}

function firstElementChildBetween(root: DomNode, target: DomNode): DomNode | undefined {
  for (const child of root.children ?? []) {
    if (child === target) return child
    if (containsDomNode(child, target)) return child.type === "tag" ? child : undefined
  }
  return undefined
}

function containsDomNode(root: DomNode, target: DomNode): boolean {
  if (root === target) return true
  return (root.children ?? []).some((child) => containsDomNode(child, target))
}

function semanticNodeStyleRecord(node: DomNode, context: SourceDomRenderContext): Record<string, string> | undefined {
  const fallbackStyle = node.attribs?.["data-source-node-id"]
    ? context.nodeStyleFallbacks.get(node.attribs["data-source-node-id"])
    : undefined
  const rawStyle = node.attribs?.style ?? ""
  const style = fallbackStyle ? `${rawStyle};${fallbackStyle}` : rawStyle
  return renderStyleRecord(style)
}

function mergeDomNodeWithIrChildren(node: DomNode, context: SourceDomRenderContext): DomNode {
  if (node.type !== "tag") return node
  const id = node.attribs?.["data-source-node-id"]
  const mergedChildren = mergeDomChildrenBySourceId(
    node.children ?? [],
    id ? (context.irChildrenByNodeId.get(id) ?? []) : [],
  )
  return {
    ...node,
    children: mergedChildren.map((child) => mergeDomNodeWithIrChildren(child, context)),
  }
}

function findParentElement(root: DomNode, target: DomNode): DomNode | undefined {
  function visit(current: DomNode): DomNode | undefined {
    for (const child of current.children ?? []) {
      if (child === target) return current.type === "tag" ? current : undefined
      const found = visit(child)
      if (found) return found
    }
    return undefined
  }
  return visit(root)
}

function findAncestorElement(
  root: DomNode,
  target: DomNode,
  predicate: (node: DomNode) => boolean,
): DomNode | undefined {
  function visit(current: DomNode, ancestors: DomNode[]): DomNode | undefined {
    if (current === target)
      return ancestors
        .slice()
        .reverse()
        .find((ancestor) => ancestor.type === "tag" && predicate(ancestor))
    for (const child of current.children ?? []) {
      const found = visit(child, [...ancestors, current])
      if (found) return found
    }
    return undefined
  }
  return visit(root, [])
}

function isSourceSvgAssetPathNode(node: DomNode): boolean {
  return node.type === "tag" && node.name?.toLowerCase() === "path" && Boolean(node.attribs?.["data-asset-d"])
}

function allocateSourceSvgAssetGroupName(context: SourceDomRenderContext): string {
  context.svgAssetGroupCount += 1
  return `sourceSvgAssetGroup${String(context.svgAssetGroupCount).padStart(3, "0")}`
}

function sourceSvgAssetGroupItem(node: DomNode, nodeStyleFallbacks: Map<string, string>): SourceSvgAssetGroupItem {
  const attribs = node.attribs ?? {}
  const item: SourceSvgAssetGroupItem = { assetPath: normalizeAssetPath(attribs["data-asset-d"] ?? "") }
  const fallbackStyle = attribs["data-source-node-id"]
    ? nodeStyleFallbacks.get(attribs["data-source-node-id"])
    : undefined
  let hasStyle = false
  for (const [rawName, rawValue] of Object.entries(attribs)) {
    if (rawName === "data-asset-d") continue
    const name = toJsxAttributeName(rawName)
    if (!name) continue
    if (name === "style") {
      hasStyle = true
      const style = renderStyleRecord(fallbackStyle ? `${rawValue};${fallbackStyle}` : rawValue)
      if (style) item.style = style
      continue
    }
    const value =
      name === "src" || name === "href" || name === "xlinkHref" ? normalizeReferencedAssetUrl(rawValue) : rawValue
    item[name] = value
  }
  if (fallbackStyle && !hasStyle) {
    const style = renderStyleRecord(fallbackStyle)
    if (style) item.style = style
  }
  return item
}

function allocateSourceFaqGroupName(context: SourceDomRenderContext): string {
  context.faqGroupCount += 1
  return `sourceFaqGroup${String(context.faqGroupCount).padStart(3, "0")}`
}

function extractSourceFaqGroup(node: DomNode, context: SourceDomRenderContext): SourceFaqGroup | undefined {
  const heading = findFirstHeadingText(node) ?? ""
  const label =
    `${heading} ${node.attribs?.["data-container-name"] ?? ""} ${node.attribs?.["data-an-widget-id"] ?? ""}`.toLowerCase()
  if (!/\bfaq\b|frequently asked/.test(label)) return undefined

  const columnNodes = findDescendantElements(node, (child) => hasClassMatching(child, /^column-/))
  const itemColumns = columnNodes
    .map((column) =>
      findDescendantElements(column, isFaqItemElement)
        .map((item) => sourceFaqItem(item))
        .filter((item): item is SourceFaqItem => Boolean(item)),
    )
    .filter((column) => column.length > 0)
  const columns =
    itemColumns.length > 0
      ? itemColumns
      : [
          findDescendantElements(node, isFaqItemElement)
            .map((item) => sourceFaqItem(item))
            .filter((item): item is SourceFaqItem => Boolean(item)),
        ]
  const itemCount = columns.reduce((sum, column) => sum + column.length, 0)
  if (itemCount < 4) return undefined

  const firstItem = findDescendantElements(node, isFaqItemElement)[0]
  const firstSummary = firstItem
    ? findDescendantElement(firstItem, (child) => child.name?.toLowerCase() === "button")
    : undefined
  const firstDetailsWrapper = firstItem
    ? findDescendantElement(firstItem, (child) => hasClassMatching(child, /^detailsWrapper-/))
    : undefined
  const firstDetails = firstItem
    ? findDescendantElement(firstItem, (child) => hasClassMatching(child, /^details-/))
    : undefined
  const header = findDescendantElement(node, (child) => hasClassMatching(child, /^header-/))
  const headerWrapper = header
    ? findDescendantElement(header, (child) => hasClassMatching(child, /^wrapper-/))
    : undefined
  const titleAndHintWrapper = header
    ? findDescendantElement(header, (child) => hasClassMatching(child, /^titleAndHintWrapper-/))
    : undefined
  const titleContainer = header
    ? findDescendantElement(header, (child) => hasClassMatching(child, /^container-/))
    : undefined
  const titleNode = findDescendantElement(node, (child) => /^h[1-4]$/i.test(child.name ?? ""))
  const content = findDescendantElement(node, (child) => hasClassMatching(child, /^content-/))
  const wrapper = content ? findDescendantElement(content, (child) => hasClassMatching(child, /^wrapper-/)) : undefined
  const firstColumn = columnNodes[0]
  const firstSummaryLine = firstSummary
    ? findDescendantElement(firstSummary, (child) => hasClassMatching(child, /^summaryLine-/))
    : undefined
  const firstBackground = firstSummary
    ? findDescendantElement(firstSummary, (child) => hasClassMatching(child, /^background-/))
    : undefined
  const firstSummaryText = firstSummary
    ? findDescendantElement(firstSummary, (child) => hasClassMatching(child, /^summaryText-/))
    : undefined
  const firstIconPresentation = firstSummary
    ? findDescendantElement(firstSummary, (child) => child.attribs?.role === "presentation")
    : undefined
  const firstIconWrapper = firstIconPresentation
    ? findDescendantElement(firstIconPresentation, (child) => hasClassMatching(child, /^wrapper-/))
    : undefined
  const firstIconHorizontal = firstIconWrapper
    ? findDescendantElement(firstIconWrapper, (child) => hasClassMatching(child, /^horizontal-/))
    : undefined
  const firstIconVertical = firstIconWrapper
    ? findDescendantElement(firstIconWrapper, (child) => hasClassMatching(child, /^vertical-/))
    : undefined

  return {
    title: normalizeVisibleText(heading || "Frequently asked questions"),
    titleId: titleNode?.attribs?.id,
    classes: {
      container: node.attribs?.class ?? "",
      header: header?.attribs?.class ?? "",
      headerWrapper: headerWrapper?.attribs?.class ?? "",
      titleAndHintWrapper: titleAndHintWrapper?.attribs?.class ?? "",
      titleContainer: titleContainer?.attribs?.class ?? "",
      title: titleNode?.attribs?.class ?? "",
      content: content?.attribs?.class ?? "",
      wrapper: wrapper?.attribs?.class ?? "",
      column: firstColumn?.attribs?.class ?? "",
      item: firstItem?.attribs?.class ?? "",
      summary: firstSummary?.attribs?.class ?? "",
      summaryLine: firstSummaryLine?.attribs?.class ?? "",
      background: firstBackground?.attribs?.class ?? "",
      summaryText: firstSummaryText?.attribs?.class ?? "",
      iconPresentation: firstIconPresentation?.attribs?.class ?? "",
      iconWrapper: firstIconWrapper?.attribs?.class ?? "",
      iconHorizontal: firstIconHorizontal?.attribs?.class ?? "",
      iconVertical: firstIconVertical?.attribs?.class ?? "",
      detailsWrapper: firstDetailsWrapper?.attribs?.class ?? "",
      details: firstDetails?.attribs?.class ?? "",
    },
    dataAttributes: {
      containerName: node.attribs?.["data-container-name"],
      widgetId: node.attribs?.["data-an-widget-id"],
      contentQaId: content?.attribs?.["data-qa-id"],
    },
    columns,
  }
}

function isFaqItemElement(node: DomNode): boolean {
  return (
    node.type === "tag" &&
    hasClassMatching(node, /^item-/) &&
    Boolean(findDescendantElement(node, (child) => child.name?.toLowerCase() === "button"))
  )
}

function sourceFaqItem(node: DomNode): SourceFaqItem | undefined {
  const summary = findDescendantElement(node, (child) => child.name?.toLowerCase() === "button")
  const summaryText = summary
    ? findDescendantElement(summary, (child) => hasClassMatching(child, /^summaryText-/))
    : undefined
  const question = normalizeVisibleText(summaryText ? visibleText(summaryText) : "")
  if (!question) return undefined
  const detailsWrapper = findDescendantElement(node, (child) => hasClassMatching(child, /^detailsWrapper-/))
  const details = findDescendantElement(node, (child) => hasClassMatching(child, /^details-/))
  return {
    question,
    answerText: normalizeVisibleText(details ? visibleText(details) : ""),
    links: details
      ? findDescendantElements(details, (child) => child.name?.toLowerCase() === "a")
          .map((link) => ({ href: link.attribs?.href ?? "", label: normalizeVisibleText(visibleText(link)) }))
          .filter((link) => link.href || link.label)
      : [],
    order: extractCssProperty(node.attribs?.style ?? "", "order"),
    itemClassName: node.attribs?.class,
    summaryId: summary?.attribs?.id,
    detailsId: detailsWrapper?.attribs?.id,
  }
}

function findDescendantElement(node: DomNode, predicate: (node: DomNode) => boolean): DomNode | undefined {
  if (node.type === "tag" && predicate(node)) return node
  for (const child of node.children ?? []) {
    const found = findDescendantElement(child, predicate)
    if (found) return found
  }
  return undefined
}

function findDescendantElements(node: DomNode, predicate: (node: DomNode) => boolean): DomNode[] {
  const results: DomNode[] = []
  function visit(current: DomNode): void {
    if (current.type === "tag" && predicate(current)) results.push(current)
    for (const child of current.children ?? []) visit(child)
  }
  visit(node)
  return results
}

function hasClassMatching(node: DomNode, pattern: RegExp): boolean {
  return (node.attribs?.class ?? "").split(/\s+/).some((className) => pattern.test(className))
}

function extractCssProperty(style: string, property: string): string | undefined {
  for (const part of style.split(";")) {
    const colon = part.indexOf(":")
    if (colon < 1) continue
    const key = part.slice(0, colon).trim().toLowerCase()
    const value = part.slice(colon + 1).trim()
    if (key === property.toLowerCase() && value) return value
  }
  return undefined
}

function normalizeVisibleText(value: string): string {
  return decodeEntities(value).replace(/\s+/g, " ").trim()
}

function sourceDomReplacementPriority(
  bytes: number,
  elementCount: number,
): SourceDomRegionMetric["replacementPriority"] {
  if (bytes >= 32_000 || elementCount >= 220) return "high"
  if (bytes >= 12_000 || elementCount >= 80) return "medium"
  return "low"
}

function buildSourceDomReplacementPlan(
  regions: SourceDomRegionMetric[],
  data: SourceProjectData,
): SourceDomReplacementPlanItem[] {
  return regions.map((region) => {
    const replacementKind = classifySourceDomReplacementKind(region)
    const recommendedComponentName = semanticReplacementComponentName(region, replacementKind)
    const dataSources = sourceDomDataSources(data, replacementKind)
    const assetSources = sourceDomAssetSources(data, replacementKind)
    const styleSources = sourceDomStyleSources(replacementKind)
    const visualSources = sourceDomVisualSources(region)
    return {
      regionComponentName: region.componentName,
      regionFilePath: region.filePath,
      priority: region.replacementPriority,
      recommendedComponentName,
      replacementKind,
      problem: sourceDomReplacementProblem(region),
      sourceMap: {
        sourceNodeId: region.sourceNodeId,
        sourceSegmentId: region.sourceSegmentId,
        bounds: region.sourceBounds,
        domRegion: region.filePath,
        styleSources,
        dataSources,
        assetSources,
        visualSources,
      },
      reusableSources: sourceDomReusableSources(region, replacementKind),
      dataSources,
      assetSources,
      generatedCleanupTargets: sourceDomGeneratedCleanupTargets(region),
      verticalSliceSteps: sourceDomVerticalSliceSteps(region, recommendedComponentName, replacementKind),
      firstReplacementStep: sourceDomFirstReplacementStep(region, recommendedComponentName, replacementKind),
      parityGuard: sourceDomParityGuard(region, replacementKind),
    }
  })
}

function classifySourceDomReplacementKind(
  region: SourceDomRegionMetric,
): SourceDomReplacementPlanItem["replacementKind"] {
  if (region.sourceComponentPattern?.recommendedReplacementKind)
    return region.sourceComponentPattern.recommendedReplacementKind
  const componentWords = region.componentName.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
  const haystack = `${componentWords} ${region.heading ?? ""} ${region.textPreview}`.toLowerCase()
  if (/\b(main content|page shell)\b/.test(haystack)) return "baseline_defer"
  if (/\b(faq|frequently asked|what is|formula)\b/.test(haystack)) return "faq_disclosure_component"
  if (/\b(footer|header|navigation|tools|subscriptions|social|community|market data provided)\b/.test(haystack))
    return "navigation_or_footer_component"
  if (/\b(ideas?|stocks?|mortgage|savings)\b/.test(haystack)) return "card_collection_component"
  if (/\b(news|calendar|event|today|actual|forecast|prior)\b/.test(haystack)) return "event_or_news_list_component"
  if (/\b(heatmap|indicator|gdp|country|countries|rate|table)\b/.test(haystack))
    return "data_table_or_heatmap_component"
  if (/\b(map|industrial|inflation)\b/.test(haystack)) return "map_or_chart_asset_component"
  return "baseline_defer"
}

function semanticReplacementComponentName(
  region: SourceDomRegionMetric,
  kind: SourceDomReplacementPlanItem["replacementKind"],
): string {
  const label = region.heading || region.componentName.replace(/Region\d*$/, "")
  const suffix = {
    map_or_chart_asset_component: "Surface",
    data_table_or_heatmap_component: "Table",
    card_collection_component: "Cards",
    faq_disclosure_component: "FAQ",
    navigation_or_footer_component: "Navigation",
    event_or_news_list_component: "List",
    baseline_defer: "Region",
  } satisfies Record<SourceDomReplacementPlanItem["replacementKind"], string>
  return `${toPascalIdentifier(label)}${suffix[kind]}`
}

function sourceDomReplacementProblem(region: SourceDomRegionMetric): string {
  return `Generated source-dom region is ${region.bytes} bytes with ${region.elementCount} DOM elements; keep it as visual evidence only until replaced by a semantic component with explicit data/assets.`
}

function sourceDomReusableSources(
  region: SourceDomRegionMetric,
  kind: SourceDomReplacementPlanItem["replacementKind"],
): string[] {
  const sources = [
    region.filePath,
    "src/data/sourceDomRegions.ts",
    "web-clone-source/reference.png",
    "web-clone-source/source-skeleton/critical.css",
    "web-clone-source/source-ir/style-profile.json",
  ]
  if (kind === "map_or_chart_asset_component")
    sources.push("src/data/svgPaths.ts", "src/data/sourceSvgAssetGroups.ts", "web-clone-source/assets/svg/")
  if (kind === "faq_disclosure_component") sources.push("src/data/sourceFaqGroups.ts")
  if (kind === "navigation_or_footer_component") sources.push("web-clone-source/source-ir/component-tree.json")
  return Array.from(new Set(sources))
}

function sourceDomDataSources(
  data: SourceProjectData,
  kind: SourceDomReplacementPlanItem["replacementKind"],
): string[] {
  const sources = ["src/data/sourceData.ts"]
  if (kind === "data_table_or_heatmap_component" && data.tables.length > 0) sources.push("sourceTables")
  if (kind === "card_collection_component" && (data.cards.length > 0 || data.lists.length > 0))
    sources.push("sourceCards", "sourceLists")
  if (kind === "event_or_news_list_component" && (data.lists.length > 0 || data.repeatedGroups.length > 0))
    sources.push("sourceLists", "sourceRepeatedGroups")
  if (kind === "faq_disclosure_component") sources.push("sourceTextSignals", "sourceFaqGroups")
  if (kind === "navigation_or_footer_component") sources.push("sourceComponents", "sourceTextSignals")
  return Array.from(new Set(sources))
}

function sourceDomAssetSources(
  data: SourceProjectData,
  kind: SourceDomReplacementPlanItem["replacementKind"],
): string[] {
  const sources: string[] = []
  if (kind === "map_or_chart_asset_component")
    sources.push("src/data/svgPaths.ts", "src/data/sourceSvgAssetGroups.ts", "public/assets/svg/")
  if (kind === "card_collection_component" || kind === "map_or_chart_asset_component")
    sources.push("public/assets/images/")
  if (data.assets.length > 0) sources.push("src/data/sourceData.ts:sourceAssets")
  return Array.from(new Set(sources))
}

function sourceDomStyleSources(kind: SourceDomReplacementPlanItem["replacementKind"]): string[] {
  const sources = [
    "src/styles/source-critical.css",
    "src/styles/source-full.css",
    "web-clone-source/source-skeleton/critical.css",
    "web-clone-source/source-ir/style-profile.json",
    "web-clone-source/source-ir/style-tokens.json",
  ]
  if (kind === "map_or_chart_asset_component") sources.push("src/data/sourceSvgAssetGroups.ts", "src/data/svgPaths.ts")
  return Array.from(new Set(sources))
}

function sourceDomVisualSources(region: SourceDomRegionMetric): string[] {
  return Array.from(
    new Set(
      [
        "web-clone-source/reference.png",
        "reference.png",
        "web-clone-source/visual-surface-candidates.json",
        region.sourceNodeId ? `source-node:${region.sourceNodeId}` : "",
        region.sourceSegmentId ? `source-segment:${region.sourceSegmentId}` : "",
      ].filter(Boolean),
    ),
  )
}

function sourceDomGeneratedCleanupTargets(region: SourceDomRegionMetric): string[] {
  return [
    region.filePath,
    "src/components/SourceDomPage.tsx import/render reference for this region",
    "unused selectors in src/styles/source-critical.css and src/styles/source-full.css after visual parity is preserved",
  ]
}

function sourceDomVerticalSliceSteps(
  region: SourceDomRegionMetric,
  recommendedComponentName: string,
  kind: SourceDomReplacementPlanItem["replacementKind"],
): string[] {
  return [
    `Read ${region.filePath} plus sourceMap evidence for source ids, text, classes, and asset references.`,
    "Read web-clone-source/source-ir/style-profile.json for this source node/segment before editing layout CSS.",
    `Extract the visible data for ${recommendedComponentName} into sourceData.ts or a small typed module instead of duplicating JSX literals.`,
    `Render ${recommendedComponentName} as a semantic component with loops/props/states appropriate for ${kind}.`,
    "Preserve only the scoped classes or CSS variables needed by the replacement; leave unrelated source CSS untouched.",
    `Swap ${region.componentName} for ${recommendedComponentName} at the existing SourceDomPage boundary.`,
    "Compare the same visual viewport matrix against reference.png before deleting generated DOM/CSS coverage.",
  ]
}

function sourceDomFirstReplacementStep(
  region: SourceDomRegionMetric,
  recommendedComponentName: string,
  kind: SourceDomReplacementPlanItem["replacementKind"],
): string {
  if (kind === "map_or_chart_asset_component") {
    return `Create ${recommendedComponentName} beside the app components using sidecar SVG/image assets and explicit legend/scale data, then swap it for ${region.componentName} only after screenshot parity is preserved.`
  }
  if (kind === "data_table_or_heatmap_component") {
    return `Model rows/columns/colors as arrays in sourceData or a new data module, render ${recommendedComponentName} with loops, and keep table dimensions/colors matched to ${region.componentName}.`
  }
  if (kind === "card_collection_component") {
    return `Extract card data into arrays, render ${recommendedComponentName} as repeated card components, and preserve thumbnail assets plus card spacing before removing ${region.componentName}.`
  }
  if (kind === "faq_disclosure_component") {
    return `Extract question/answer pairs into data, render ${recommendedComponentName} with disclosure controls from the project/design system, and verify expanded/collapsed states do not shift the baseline unexpectedly.`
  }
  if (kind === "navigation_or_footer_component") {
    return `Extract link groups/social/language state into arrays, render ${recommendedComponentName} with existing navigation/footer primitives when available, and keep legal/source text intact.`
  }
  if (kind === "event_or_news_list_component") {
    return `Extract rows into news/event arrays, render ${recommendedComponentName} with list/card primitives, and preserve timestamps, source labels, and column density.`
  }
  return `Keep ${region.componentName} as extracted baseline until a narrower semantic component and data contract are identified.`
}

function sourceDomParityGuard(
  region: SourceDomRegionMetric,
  kind: SourceDomReplacementPlanItem["replacementKind"],
): string {
  const base = `Before deleting ${region.componentName}, compare the root app against web-clone-source/reference.png and keep unchanged clone surfaces above the requested visual threshold.`
  if (kind === "map_or_chart_asset_component")
    return `${base} Check map/chart fills, legend ticks, geographic/chart geometry, and extracted asset references.`
  if (kind === "data_table_or_heatmap_component")
    return `${base} Check row/column count, cell colors, typography, and numeric text coverage.`
  if (kind === "card_collection_component")
    return `${base} Check card count, thumbnail rendering, titles, author/time metadata, and carousel overflow.`
  return base
}

function shouldExtractSourceRegion(node: DomNode, siblings: DomNode[], context: SourceDomRenderContext): boolean {
  if (!context.extractRegions || context.regionDepth >= context.maxRegionDepth) return false
  if (context.regionFiles.size >= context.maxRegionCount) return false
  if (node.type !== "tag") return false
  const tag = node.name?.toLowerCase() ?? ""
  if (!tag || tag === "html" || tag === "body" || tag === "script" || tag === "style") return false
  if (VOID_TAGS.has(tag)) return false
  if (isSourcePageShellNode(node)) return false
  if (isSingleSemanticChildWrapper(node)) return false
  const sourcePattern = sourceComponentPatternForNode(node, context)
  if (sourcePattern?.recommendedReplacementKind && sourcePattern.recommendedReplacementKind !== "baseline_defer")
    return true
  if (isSemanticHeaderNavigationCandidate(node)) return true
  if (isSemanticFooterCandidate(node)) return true
  if (isSemanticIdeaCardCollectionCandidate(node)) return true
  if (isSemanticMetricRankingCardCandidate(node)) return true
  if (isSemanticMetricChartCardCandidate(node)) return true
  if (isCompositeSourceWidgetShell(node)) return false
  if (isSemanticSectionShellCandidate(node)) return true
  if (isSemanticMapSurfaceCandidate(node)) return true
  if (isSemanticLinkGridCandidate(node)) return true

  const elementCount = countRenderableElements(node)
  if (elementCount < 24) return false
  if (isSemanticNewsListCandidate(node, elementCount)) return true
  if (isSemanticEventCardListCandidate(node)) return true
  if (isSemanticDataTableCandidate(node)) return true
  if (isSemanticMetricRankingCardCandidate(node)) return true
  if (isSemanticMetricChartCardCandidate(node)) return true
  if (isSemanticIdeaCardCollectionCandidate(node)) return true
  if (isSemanticMapSurfaceCandidate(node)) return true
  if (isSemanticLinkGridCandidate(node)) return true
  if (isSemanticSectionShellCandidate(node)) return true
  const siblingElementCount = siblings.filter((child) => child.type === "tag").length
  const className = node.attribs?.class ?? ""

  if (/\btv-header\b/.test(className)) return elementCount > 24
  const headingCount = countHeadings(node)
  if (headingCount > 1) return false
  if (findFirstHeadingText(node) && (siblingElementCount >= 3 || elementCount > 60)) return true
  if (context.regionDepth >= 2 && siblingElementCount >= 3 && elementCount > 16 && visibleText(node).length > 16)
    return true
  if (siblingElementCount >= 4 && elementCount > 80 && visibleText(node).length > 16) return true
  return false
}

function isSingleSemanticChildWrapper(node: DomNode): boolean {
  if (node.type !== "tag") return false
  const children = directElementChildren(node)
  if (children.length !== 1) return false
  if (
    normalizeVisibleText(
      (node.children ?? [])
        .filter((child) => child.type === "text")
        .map((child) => child.data ?? "")
        .join(" "),
    )
  )
    return false
  return (
    isSemanticIdeaCardCollectionCandidate(children[0] as DomNode) ||
    isSemanticSectionShellCandidate(children[0] as DomNode)
  )
}

function isSourcePageShellNode(node: DomNode): boolean {
  const tag = node.name?.toLowerCase() ?? ""
  if (tag === "main") return true
  const className = node.attribs?.class ?? ""
  return /\btv-main\b|\blayout__area\b|\bpage-shell\b/.test(className)
}

function isCompositeSourceWidgetShell(node: DomNode): boolean {
  const attrs = node.attribs ?? {}
  const className = attrs.class ?? ""
  if (attrs["data-base-widget"] !== "true" && !/^container-/.test(className)) return false
  const surfaces = countDescendantSurfaceCandidates(node, 4)
  return surfaces >= 3
}

function countDescendantSurfaceCandidates(root: DomNode, maxDepth: number): number {
  let count = 0
  function visit(node: DomNode, depth: number): void {
    if (depth > maxDepth) return
    if (node !== root && isNestedSurfaceCandidate(node)) {
      count += 1
      return
    }
    for (const child of directElementChildren(node)) visit(child, depth + 1)
  }
  visit(root, 0)
  return count
}

function isNestedSurfaceCandidate(node: DomNode): boolean {
  const attrs = node.attribs ?? {}
  if (attrs["data-source-role"] === "card") return true
  if (attrs["data-base-widget"] === "true") return true
  if (isSemanticDataTableCandidate(node)) return true
  if (isSemanticMetricRankingCardCandidate(node)) return true
  if (isSemanticMetricChartCardCandidate(node)) return true
  if (isSemanticEventCardListCandidate(node)) return true
  if (isSemanticIdeaCardCollectionCandidate(node)) return true
  if (isSemanticMapSurfaceCandidate(node)) return true
  if (isSemanticLinkGridCandidate(node)) return true
  if (isSemanticSectionShellCandidate(node)) return true
  if (isSemanticNewsListCandidate(node, countRenderableElements(node))) return true
  return false
}

function isSemanticNewsListCandidate(node: DomNode, elementCount: number): boolean {
  const tag = node.name?.toLowerCase() ?? ""
  if (tag === "html" || tag === "body" || tag === "main") return false
  const className = node.attribs?.class ?? ""
  if (/\btv-main\b|\blayout__area\b/.test(className)) return false
  const grid = findSemanticNewsListGrid(node)
  if (!grid) return false
  const newsCardCount = directNewsCardAnchors(grid).length
  if (newsCardCount < 3) return false
  const gridDistance = descendantElementDistance(node, grid)
  if (gridDistance === undefined || gridDistance > 2) return false
  const gridElementCount = countRenderableElements(grid)
  if (elementCount > gridElementCount + 6) return false
  const text = visibleText(node).toLowerCase()
  if (!/\b(news|reuters|dow jones|dpa-afx|calendar|actual|forecast|prior)\b/.test(text)) return false
  return true
}

function directElementChildren(node: DomNode): DomNode[] {
  return (node.children ?? []).filter((child) => child.type === "tag")
}

function descendantElementDistance(root: DomNode, target: DomNode): number | undefined {
  function visit(current: DomNode, depth: number): number | undefined {
    if (current === target) return depth
    for (const child of directElementChildren(current)) {
      const found = visit(child, depth + 1)
      if (found !== undefined) return found
    }
    return undefined
  }
  return visit(root, 0)
}

function allocateSourceRegionComponentName(node: DomNode, context: SourceDomRenderContext): string {
  const tag = node.name?.toLowerCase() ?? "region"
  const className = node.attribs?.class ?? ""
  const explicitLabel =
    (/(\btv-header\b)/.test(className) ? "Header" : undefined) ??
    (/(\btv-footer\b)/.test(className) ? "Footer" : undefined) ??
    (/(\btv-main\b)/.test(className) ? "Page Shell" : undefined) ??
    (tag === "main" ? "Main Content" : undefined) ??
    findFirstHeadingText(node) ??
    visibleText(node).slice(0, 40)
  const base = `${toPascalIdentifier(explicitLabel || tag || "Source")}Region`
  const count = (context.regionNameCounts.get(base) ?? 0) + 1
  context.regionNameCounts.set(base, count)
  return count === 1 ? base : `${base}${count}`
}

function countRenderableElements(node: DomNode): number {
  if (node.type !== "tag") return 0
  const tag = node.name?.toLowerCase() ?? ""
  if (tag === "script" || tag === "style") return 0
  return 1 + (node.children ?? []).reduce((sum, child) => sum + countRenderableElements(child), 0)
}

function countHeadings(node: DomNode): number {
  if (node.type !== "tag") return 0
  const own = /^h[1-2]$/i.test(node.name ?? "") ? 1 : 0
  return own + (node.children ?? []).reduce((sum, child) => sum + countHeadings(child), 0)
}

function findFirstHeadingText(node: DomNode): string | undefined {
  if (node.type === "tag" && /^h[1-4]$/i.test(node.name ?? "")) {
    const text = visibleText(node)
    if (text) return text
  }
  for (const child of node.children ?? []) {
    const text = findFirstHeadingText(child)
    if (text) return text
  }
  return undefined
}

function visibleText(node: DomNode): string {
  if (node.type === "text")
    return decodeEntities(node.data ?? "")
      .replace(/\s+/g, " ")
      .trim()
  if (node.type !== "tag" && node.type !== "script" && node.type !== "style") return ""
  if (node.name?.toLowerCase() === "script" || node.name?.toLowerCase() === "style") return ""
  return (node.children ?? []).map(visibleText).filter(Boolean).join(" ").replace(/\s+/g, " ").trim()
}

function toPascalIdentifier(value: string): string {
  const words = value
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
  const label = words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join("")
  return /^[A-Za-z]/.test(label) ? label : `Source${label || "Region"}`
}

function mergeDomChildrenBySourceId(skeletonChildren: DomNode[], irChildren: DomNode[]): DomNode[] {
  if (irChildren.length === 0) return skeletonChildren
  if (skeletonChildren.length === 0) return irChildren

  const skeletonIds = new Set<string>()
  const skeletonById = new Map<string, DomNode>()
  for (const child of skeletonChildren) {
    const id = child.attribs?.["data-source-node-id"]
    if (id) {
      skeletonIds.add(id)
      skeletonById.set(id, child)
    }
  }
  if (skeletonIds.size === 0) return skeletonChildren

  const insertBefore = new Map<DomNode, DomNode[]>()
  const append: DomNode[] = []
  for (let index = 0; index < irChildren.length; index += 1) {
    const irChild = irChildren[index]
    const id = irChild.attribs?.["data-source-node-id"]
    if (id && skeletonIds.has(id)) continue
    if (!isRenderableIrElement(irChild)) continue
    const nextMatchedSkeleton = irChildren
      .slice(index + 1)
      .map((candidate) => candidate.attribs?.["data-source-node-id"])
      .filter((candidateId): candidateId is string => Boolean(candidateId))
      .map((candidateId) => skeletonById.get(candidateId))
      .find((candidate): candidate is DomNode => Boolean(candidate))
    if (nextMatchedSkeleton) {
      const pending = insertBefore.get(nextMatchedSkeleton) ?? []
      pending.push(irChild)
      insertBefore.set(nextMatchedSkeleton, pending)
    } else {
      append.push(irChild)
    }
  }

  const merged: DomNode[] = []
  for (const child of skeletonChildren) {
    merged.push(...(insertBefore.get(child) ?? []))
    merged.push(child)
  }
  merged.push(...append)
  return merged
}

function isRenderableIrElement(node: DomNode): boolean {
  if (node.type !== "tag") return false
  const tag = node.name?.toLowerCase() ?? ""
  return Boolean(tag) && tag !== "script" && tag !== "style" && tag !== "meta" && tag !== "link" && tag !== "title"
}

function renderMissingPreviewImage(
  node: DomNode,
  indentLevel: number,
  context: { previewImagePaths: string[]; previewImageIndex: number },
): string | undefined {
  const className = node.attribs?.class ?? ""
  if (!/\bpreview-fSver7BK\b/.test(className)) return undefined
  if (containsClass(node, "image-fSver7BK")) return undefined
  const imagePath = context.previewImagePaths[context.previewImageIndex++]
  if (!imagePath) return undefined
  return `${indent(indentLevel)}<img className="image-fSver7BK" src={${JSON.stringify(imagePath)}} alt="" />`
}

function rewriteImagePlaceholderAttributes(
  tag: string,
  attribs: Record<string, string>,
  context: { previewImagePaths: string[]; previewImageIndex: number },
): Record<string, string> {
  if (tag.toLowerCase() !== "img") return attribs
  const src = attribs.src ?? ""
  if (!isPlaceholderDataImage(src)) return attribs
  const imagePath = context.previewImagePaths[context.previewImageIndex++]
  const next: Record<string, string> = { ...attribs, src: imagePath ?? "" }
  delete next.srcset
  delete next.sizes
  return next
}

function isPlaceholderDataImage(value: string): boolean {
  return /^data:image\//i.test(value) && /__WEB_CLONE_DATA_URI_ASSET__/.test(value)
}

function containsClass(node: DomNode, className: string): boolean {
  if (node.attribs?.class?.split(/\s+/).includes(className)) return true
  return (node.children ?? []).some((child) => containsClass(child, className))
}

function renderJsxAttributes(
  tag: string,
  attribs: Record<string, string>,
  nodeStyleFallbacks: Map<string, string>,
  omitSourceProvenanceAttributes = false,
): string {
  const parts: string[] = []
  const isAssetPath = tag.toLowerCase() === "path" && Boolean(attribs["data-asset-d"])
  const fallbackStyle = attribs["data-source-node-id"]
    ? nodeStyleFallbacks.get(attribs["data-source-node-id"])
    : undefined
  let hasStyle = false
  for (const [rawName, rawValue] of Object.entries(attribs)) {
    if (omitSourceProvenanceAttributes && (rawName === "data-source-node-id" || rawName === "data-source-segment-id"))
      continue
    if (isAssetPath && rawName === "data-asset-d") {
      parts.push(`assetPath={${JSON.stringify(normalizeAssetPath(rawValue))}}`)
      continue
    }
    if (rawName === "data-asset-d") continue
    const name = toJsxAttributeName(rawName)
    if (!name) continue
    if (name === "style") {
      hasStyle = true
      const style = renderStyleObject(fallbackStyle ? `${rawValue};${fallbackStyle}` : rawValue)
      if (style) parts.push(`style={${style}}`)
      continue
    }
    const value =
      name === "src" || name === "href" || name === "xlinkHref" ? normalizeReferencedAssetUrl(rawValue) : rawValue
    parts.push(`${name}={${JSON.stringify(value)}}`)
  }
  if (fallbackStyle && !hasStyle) {
    const style = renderStyleObject(fallbackStyle)
    if (style) parts.push(`style={${style}}`)
  }
  return parts.join(" ")
}

function toJsxAttributeName(name: string): string | undefined {
  if (/^on/i.test(name)) return undefined
  if (name === "class") return "className"
  if (name === "for") return "htmlFor"
  if (name === "charset") return "charSet"
  if (name === "srcset") return "srcSet"
  if (name === "tabindex") return "tabIndex"
  if (name === "http-equiv") return "httpEquiv"
  if (name === "xlink:href") return "xlinkHref"
  const mappedSvg = SVG_ATTRIBUTE_MAP[name]
  if (mappedSvg) return mappedSvg
  if (/^(data|aria)-[a-zA-Z0-9_.:-]+$/.test(name)) return name
  if (/^[A-Za-z_$][\w$]*$/.test(name)) return name
  return undefined
}

function renderStyleObject(style: string): string | undefined {
  const entries = new Map<string, string>()
  for (const rawPart of style.split(";")) {
    const part = rawPart.trim()
    if (!part) continue
    const colon = part.indexOf(":")
    if (colon < 1) continue
    const key = part.slice(0, colon).trim()
    const value = part
      .slice(colon + 1)
      .trim()
      .replace(/\s*!important\s*$/i, "")
    if (!key || !value) continue
    const styleKey = toStyleKey(key)
    entries.set(styleKey, `${JSON.stringify(styleKey)}: ${JSON.stringify(value)}`)
  }
  return entries.size > 0 ? `{ ${Array.from(entries.values()).join(", ")} }` : undefined
}

function renderStyleRecord(style: string): Record<string, string> | undefined {
  const entries: Record<string, string> = {}
  for (const rawPart of style.split(";")) {
    const part = rawPart.trim()
    if (!part) continue
    const colon = part.indexOf(":")
    if (colon < 1) continue
    const key = part.slice(0, colon).trim()
    const value = part
      .slice(colon + 1)
      .trim()
      .replace(/\s*!important\s*$/i, "")
    if (!key || !value) continue
    entries[toStyleKey(key)] = value
  }
  return Object.keys(entries).length > 0 ? entries : undefined
}

function toStyleKey(name: string): string {
  if (name.startsWith("--")) return name
  return name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
}

function normalizeAssetPath(value: string): string {
  return value.replaceAll("\\", "/")
}

function normalizeReferencedAssetUrl(value: string): string {
  const normalized = value.replaceAll("\\", "/")
  if (/^(?:https?:|mailto:|tel:|#)/i.test(normalized)) return normalized
  const assetMatch = /^\.\.\/assets\/(.+?)\.txt$/i.exec(normalized)
  if (assetMatch) return `/assets/${assetMatch[1]}`
  if (normalized.startsWith("../assets/")) return `/${normalized.slice(3)}`
  return normalized
}

function normalizeTextNode(value: string): string | undefined {
  const decoded = decodeEntities(value)
  const collapsed = decoded.replace(/\s+/g, " ")
  return collapsed.trim().length > 0 ? collapsed : undefined
}

function indent(level: number): string {
  return "  ".repeat(level)
}

const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
])

const SVG_ATTRIBUTE_MAP: Record<string, string> = {
  "accent-height": "accentHeight",
  "alignment-baseline": "alignmentBaseline",
  "baseline-shift": "baselineShift",
  "clip-path": "clipPath",
  "clip-rule": "clipRule",
  "color-interpolation": "colorInterpolation",
  "color-interpolation-filters": "colorInterpolationFilters",
  "color-profile": "colorProfile",
  "color-rendering": "colorRendering",
  "dominant-baseline": "dominantBaseline",
  "enable-background": "enableBackground",
  "fill-opacity": "fillOpacity",
  "fill-rule": "fillRule",
  "flood-color": "floodColor",
  "flood-opacity": "floodOpacity",
  "font-family": "fontFamily",
  "font-size": "fontSize",
  "font-size-adjust": "fontSizeAdjust",
  "font-stretch": "fontStretch",
  "font-style": "fontStyle",
  "font-variant": "fontVariant",
  "font-weight": "fontWeight",
  "glyph-name": "glyphName",
  "glyph-orientation-horizontal": "glyphOrientationHorizontal",
  "glyph-orientation-vertical": "glyphOrientationVertical",
  "horiz-adv-x": "horizAdvX",
  "horiz-origin-x": "horizOriginX",
  "image-rendering": "imageRendering",
  "letter-spacing": "letterSpacing",
  "lighting-color": "lightingColor",
  "marker-end": "markerEnd",
  "marker-mid": "markerMid",
  "marker-start": "markerStart",
  "overline-position": "overlinePosition",
  "overline-thickness": "overlineThickness",
  "paint-order": "paintOrder",
  "panose-1": "panose1",
  "pointer-events": "pointerEvents",
  "rendering-intent": "renderingIntent",
  "shape-rendering": "shapeRendering",
  "stop-color": "stopColor",
  "stop-opacity": "stopOpacity",
  "strikethrough-position": "strikethroughPosition",
  "strikethrough-thickness": "strikethroughThickness",
  "stroke-dasharray": "strokeDasharray",
  "stroke-dashoffset": "strokeDashoffset",
  "stroke-linecap": "strokeLinecap",
  "stroke-linejoin": "strokeLinejoin",
  "stroke-miterlimit": "strokeMiterlimit",
  "stroke-opacity": "strokeOpacity",
  "stroke-width": "strokeWidth",
  "text-anchor": "textAnchor",
  "text-decoration": "textDecoration",
  "text-rendering": "textRendering",
  "underline-position": "underlinePosition",
  "underline-thickness": "underlineThickness",
  "unicode-bidi": "unicodeBidi",
  "unicode-range": "unicodeRange",
  "units-per-em": "unitsPerEm",
  "v-alphabetic": "vAlphabetic",
  "v-hanging": "vHanging",
  "v-ideographic": "vIdeographic",
  "v-mathematical": "vMathematical",
  "vector-effect": "vectorEffect",
  "vert-adv-y": "vertAdvY",
  "vert-origin-x": "vertOriginX",
  "vert-origin-y": "vertOriginY",
  "word-spacing": "wordSpacing",
  "writing-mode": "writingMode",
}

const SVG_TAG_NAME_MAP: Record<string, string> = {
  altglyph: "altGlyph",
  altglyphdef: "altGlyphDef",
  altglyphitem: "altGlyphItem",
  animatecolor: "animateColor",
  animatemotion: "animateMotion",
  animatetransform: "animateTransform",
  clippath: "clipPath",
  feblend: "feBlend",
  fecolormatrix: "feColorMatrix",
  fecomponenttransfer: "feComponentTransfer",
  fecomposite: "feComposite",
  feconvolvematrix: "feConvolveMatrix",
  fediffuselighting: "feDiffuseLighting",
  fedisplacementmap: "feDisplacementMap",
  fedistantlight: "feDistantLight",
  fedropshadow: "feDropShadow",
  feflood: "feFlood",
  fefunca: "feFuncA",
  fefuncb: "feFuncB",
  fefuncg: "feFuncG",
  fefuncr: "feFuncR",
  fegaussianblur: "feGaussianBlur",
  feimage: "feImage",
  femerge: "feMerge",
  femergenode: "feMergeNode",
  femorphology: "feMorphology",
  feoffset: "feOffset",
  fepointlight: "fePointLight",
  fespecularlighting: "feSpecularLighting",
  fespotlight: "feSpotLight",
  fetile: "feTile",
  feturbulence: "feTurbulence",
  foreignobject: "foreignObject",
  glyphref: "glyphRef",
  lineargradient: "linearGradient",
  radialgradient: "radialGradient",
  textpath: "textPath",
}

function toJsxTagName(tag: string, isAssetPath: boolean): string {
  if (isAssetPath) return "AssetPath"
  return SVG_TAG_NAME_MAP[tag.toLowerCase()] ?? tag
}

function renderContentTableTsx(): string {
  return [
    "export interface SourceTable {",
    "  title?: string",
    "  headers: string[]",
    "  rows: string[][]",
    "}",
    "",
    "export function ContentTable({ table }: { table: SourceTable }) {",
    "  const columnCount = Math.max(table.headers.length, ...table.rows.map((row) => row.length), 1)",
    "  return (",
    '    <article className="web-clone-table">',
    "      <h2>{table.title}</h2>",
    "      <table>",
    "        {table.headers.length > 0 && (",
    "          <thead>",
    "            <tr>",
    "              {table.headers.map((header, index) => <th key={`${header}-${index}`}>{header}</th>)}",
    "            </tr>",
    "          </thead>",
    "        )}",
    "        <tbody>",
    "          {table.rows.map((row, rowIndex) => (",
    "            <tr key={row.join('|') || rowIndex}>",
    "              {Array.from({ length: columnCount }, (_, columnIndex) => (",
    "                <td key={columnIndex}>{row[columnIndex] ?? ''}</td>",
    "              ))}",
    "            </tr>",
    "          ))}",
    "        </tbody>",
    "      </table>",
    "    </article>",
    "  )",
    "}",
    "",
  ].join("\n")
}

function renderSourceDataTs(data: SourceProjectData): string {
  return [
    "export const sourceTextSignals = " + JSON.stringify(data.textSignals, null, 2) + " as const",
    "",
    "export const sourceComponents = " + JSON.stringify(data.components, null, 2) + " as const",
    "",
    "export const sourceTables = " + JSON.stringify(data.tables, null, 2) + " as const",
    "",
    "export const sourceLists = " + JSON.stringify(data.lists, null, 2) + " as const",
    "",
    "export const sourceCards = " + JSON.stringify(data.cards, null, 2) + " as const",
    "",
    "export const sourceRepeatedGroups = " + JSON.stringify(data.repeatedGroups, null, 2) + " as const",
    "",
    "export const sourceAssets = " + JSON.stringify(data.assets, null, 2) + " as const",
    "",
  ].join("\n")
}

function renderSourceDomRegionsTs(regions: SourceDomRegionMetric[]): string {
  return [
    "export const sourceDomRegions = " + JSON.stringify(regions, null, 2) + " as const",
    "",
    'export const highPrioritySourceDomRegions = sourceDomRegions.filter((region) => region.replacementPriority === "high")',
    "",
  ].join("\n")
}

function renderSourceDomReplacementPlanTs(items: SourceDomReplacementPlanItem[]): string {
  return [
    "export const sourceDomReplacementPlan = " + JSON.stringify(items, null, 2) + " as const",
    "",
    'export const highPrioritySourceDomReplacementPlan = sourceDomReplacementPlan.filter((item) => item.priority === "high")',
    "",
  ].join("\n")
}

function renderSourceDomIterationStateTs(
  regions: SourceDomRegionMetric[],
  replacementPlan: SourceDomReplacementPlanItem[],
  semanticReplacements: SemanticSourceReplacementMetric[],
  visualIteration: SourceProjectVisualIteration,
): string {
  const planByRegion = new Map(replacementPlan.map((item) => [item.regionComponentName, item]))
  const remainingGeneratedRegions = regions
    .slice()
    .sort(compareSourceDomRegionReplacementOrder)
    .map((region) => {
      const plan = planByRegion.get(region.componentName)
      return {
        regionComponentName: region.componentName,
        regionFilePath: region.filePath,
        priority: region.replacementPriority,
        bytes: region.bytes,
        elementCount: region.elementCount,
        tag: region.tag,
        heading: region.heading,
        textPreview: region.textPreview,
        sourceNodeId: region.sourceNodeId,
        sourceSegmentId: region.sourceSegmentId,
        replacementKind: plan?.replacementKind ?? classifySourceDomReplacementKind(region),
        recommendedComponentName:
          plan?.recommendedComponentName ??
          semanticReplacementComponentName(region, plan?.replacementKind ?? classifySourceDomReplacementKind(region)),
        firstReplacementStep:
          plan?.firstReplacementStep ??
          sourceDomFirstReplacementStep(
            region,
            semanticReplacementComponentName(region, plan?.replacementKind ?? classifySourceDomReplacementKind(region)),
            plan?.replacementKind ?? classifySourceDomReplacementKind(region),
          ),
        parityGuard:
          plan?.parityGuard ??
          sourceDomParityGuard(region, plan?.replacementKind ?? classifySourceDomReplacementKind(region)),
      }
    })
  const nextReplacement = remainingGeneratedRegions[0] ?? null
  const viewportMatrix = visualIteration.viewportMatrix
  const viewportNames = viewportMatrix
    .map((viewport) => `${viewport.name} ${viewport.width}x${viewport.height}`)
    .join(", ")
  const state = {
    version: 1,
    purpose: "source-dom-maintainable-iteration-state",
    generatedRegionCount: regions.length,
    semanticReplacementCount: semanticReplacements.length,
    remainingRegionCount: remainingGeneratedRegions.length,
    semanticReplacements,
    remainingGeneratedRegions,
    nextReplacement,
    visualIteration: {
      referenceImage: "web-clone-source/reference.png",
      evidenceMethod: visualIteration.evidenceMethod,
      viewportMatrix,
      evidenceRule:
        "Do not delete a source-dom region after replacement until desktop-reference has inspected preview screenshot evidence and responsive-review captures have either matching evidence or an explicit source-evidence gap.",
    },
    recommendedLoop: [
      `Adopt the current source project as the visual baseline and compare the viewport matrix (${viewportNames}) against reference.png or matching reference artifacts.`,
      "Replace nextReplacement.regionFilePath with nextReplacement.recommendedComponentName using source data, sidecar assets, and scoped styles.",
      "Delete the replaced source-dom region only after rendered screenshot inspection is stable for the unchanged surrounding surface.",
      "Review the replacement against source evidence and rendered preview screenshots after each region replacement.",
      "Repeat until remainingRegionCount is zero or each remaining source-dom region has preview screenshot evidence proving it is outside the requested acceptance surface.",
    ],
    stopCondition: {
      sourceDomRegionFileCount: 0,
      generatedBaselineDetected: false,
      requiresSourceEvidenceReview: true,
      requiresInspectedVisualParity: true,
      visualIterationViewports: viewportMatrix.map((viewport) => viewport.name),
    },
  }
  return [
    "export const sourceDomIterationState = " + JSON.stringify(state, null, 2) + " as const",
    "",
    "export const nextSourceDomReplacement = sourceDomIterationState.nextReplacement",
    "",
  ].join("\n")
}

function compareSourceDomRegionReplacementOrder(a: SourceDomRegionMetric, b: SourceDomRegionMetric): number {
  return (
    sourceDomPriorityRank(a.replacementPriority) - sourceDomPriorityRank(b.replacementPriority) ||
    b.bytes - a.bytes ||
    b.elementCount - a.elementCount ||
    a.componentName.localeCompare(b.componentName)
  )
}

function sourceDomPriorityRank(value: SourceDomRegionMetric["replacementPriority"]): number {
  if (value === "high") return 0
  if (value === "medium") return 1
  return 2
}

function renderSourceSvgAssetGroupsTs(groups: Map<string, SourceSvgAssetGroupItem[]>): string {
  return [
    "export interface SourceSvgAssetGroupItem {",
    "  assetPath: string",
    "  [attribute: string]: unknown",
    "}",
    "",
    "export const sourceSvgAssetGroups = " +
      JSON.stringify(Object.fromEntries(groups), null, 2) +
      " as const satisfies Record<string, readonly SourceSvgAssetGroupItem[]>",
    "",
  ].join("\n")
}

function renderSourceFaqGroupsTs(groups: Map<string, SourceFaqGroup>): string {
  return [
    "export interface SourceFaqGroup {",
    "  title: string",
    "  titleId?: string",
    "  classes: Record<string, string>",
    "  dataAttributes: Record<string, string | undefined>",
    "  columns: readonly (readonly SourceFaqItem[])[]",
    "}",
    "",
    "export interface SourceFaqItem {",
    "  question: string",
    "  answerText: string",
    "  links: readonly { href: string; label: string }[]",
    "  order?: string",
    "  itemClassName?: string",
    "  summaryId?: string",
    "  detailsId?: string",
    "}",
    "",
    "export const sourceFaqGroups = " +
      JSON.stringify(Object.fromEntries(groups), null, 2) +
      " as const satisfies Record<string, SourceFaqGroup>",
    "",
  ].join("\n")
}

function renderSvgPathsTs(paths: Record<string, string>): string {
  return ["export const svgPaths: Record<string, string> = " + JSON.stringify(paths, null, 2), ""].join("\n")
}

function renderStylesCss(input: { hasCriticalCss: boolean; hasFullCss: boolean }): string {
  return [
    input.hasCriticalCss ? '@import "./styles/source-critical.css";' : "",
    input.hasFullCss ? '@import "./styles/source-full.css";' : "",
    "",
    "html, body, #root { margin: 0; min-width: 320px; }",
    ".source-dom-page { min-height: 100vh; }",
    ".semantic-source-header-logo-text { display: inline-flex; align-items: center; margin-inline-start: 2px; color: currentColor; font-family: -apple-system, BlinkMacSystemFont, Trebuchet MS, Roboto, Ubuntu, sans-serif; font-size: 26px; font-weight: 700; line-height: 28px; letter-spacing: 0; }",
    "",
    "",
  ]
    .filter(Boolean)
    .join("\n")
}

function renderReadme(webpageEvidenceDir: string, visualIteration: SourceProjectVisualIteration): string {
  return [
    "# Web Clone Source Project",
    "",
    "This project is generated from a web-clone-source handoff. It is the editable implementation seed for downstream React work, not a separate scoring artifact.",
    "",
    "Inputs consumed:",
    "- `source-skeleton/index.html` for visible text and DOM order hints",
    "- `source-skeleton/critical.css` and `source-skeleton/full-source.css` for CSS sidecars",
    "- `source-ir/content-model.json` for tables, lists, cards, and repeated groups",
    "- `source-ir/component-tree.json` for component boundary hints",
    "- `source-ir/style-profile.json` for region-scoped typography, spacing, color, selector, asset, and implementation guidance",
    "- `assets/manifest.json` for sidecar asset references",
    "- `src/data/sourceDomRegions.ts` for generated-region size, text preview, and replacement priority metrics",
    "- `src/data/sourceDomReplacementPlan.ts` for concrete semantic replacement steps, sourceMap evidence, data/style/asset/visual sources, generated cleanup targets, verticalSliceSteps, and parity guards",
    "- `src/data/sourceDomIterationState.ts` for static replacement progress metadata: semantic replacements already produced, remaining source-dom debt, and the next candidate region",
    "- `src/data/sourceProjectManifest.json` for the visual iteration viewport matrix and generated-source ownership rules",
    "- `src/data/sourceSvgAssetGroups.ts` for large SVG path runs that are data-driven through `SourceAssetPathGroup` instead of hand-maintained TSX repetition",
    "- `src/data/sourceFaqGroups.ts` for FAQ/disclosure content that is data-driven through `SourceFaqList` instead of repeated generated accordion JSX",
    "",
    "Implementation guidance:",
    "- The default app entrypoint renders `src/components/SourceDomPage.tsx` through `src/components/SourceClonePage.tsx`; this is the high-fidelity visual baseline, not a placeholder scaffold.",
    "- `src/components/source-dom/*Region.tsx` splits the high-fidelity baseline into bounded source regions. Use `nextSourceDomReplacement` in `src/data/sourceDomIterationState.ts` as a static priority hint, then use the matching row in `src/data/sourceDomReplacementPlan.ts` instead of editing a monolithic DOM file.",
    "- Keep `src/styles/source-critical.css`, `src/styles/source-full.css`, `src/data/svgPaths.ts`, `src/data/sourceSvgAssetGroups.ts`, `src/data/sourceFaqGroups.ts`, and `public/assets/` copied together with the React entrypoints; they are required for visual parity.",
    "- Use `src/data/sourceData.ts`, source IR, and component metadata as the maintainability/refactor material for replacing specific regions with semantic components or mature libraries.",
    "- Refine this baseline region by region while checking against `reference.png`.",
    `- Visual iteration viewport matrix: ${renderSourceProjectVisualIterationMatrix(visualIteration.viewportMatrix)}`,
    "- Use `reference.png` only as visual validation evidence. Do not render it, replay screenshots, or add hidden semantic coverage layers.",
    "- Use source evidence review and overlay/visual comparison as diagnostics; fix the implementation when their findings describe a real user-visible or maintainability defect.",
    "",
    `Webpage evidence source: ${webpageEvidenceDir}`,
    "",
  ].join("\n")
}

function collectVisibleStrings(value: unknown, key = ""): string[] {
  const visibleKeys = new Set([
    "alt",
    "fields",
    "headers",
    "items",
    "label",
    "rows",
    "sampleTexts",
    "text",
    "textPreview",
    "title",
    "value",
  ])
  if (typeof value === "string") return visibleKeys.has(key) ? [value] : []
  if (Array.isArray(value)) return value.flatMap((item) => collectVisibleStrings(item, key))
  if (!value || typeof value !== "object") return []
  return Object.entries(value as Record<string, unknown>).flatMap(([childKey, child]) =>
    collectVisibleStrings(child, childKey),
  )
}

function collectSkeletonText(html: string): string[] {
  const withoutScripts = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
  return Array.from(withoutScripts.matchAll(/>([^<>]{2,180})</g), (match) => decodeEntities(match[1] ?? ""))
}

function rankTextSignals(values: string[]): string[] {
  const unique = Array.from(new Set(values.map(canonicalText).filter((value): value is string => Boolean(value))))
  return unique
    .filter((value) => value.length >= 3 && value.length <= 120)
    .filter((value) => !/^https?:\/\//i.test(value))
    .map((value) => ({ value, score: textSignalScore(value) }))
    .sort((a, b) => b.score - a.score || a.value.length - b.value.length)
    .map((item) => item.value)
}

function textSignalScore(value: string): number {
  let score = Math.min(value.length, 40)
  if (/\d/.test(value)) score += 40
  if (/[A-Za-z]\s+[A-Za-z]/.test(value)) score += 20
  if (/[.%$€¥£]/.test(value)) score += 12
  if (value.length <= 24) score += 8
  return score
}

function canonicalText(value: string): string | undefined {
  const normalized = decodeEntities(value).replace(/\s+/g, " ").trim()
  if (!normalized) return undefined
  if (/^__WEB_CLONE_[A-Z_]+_\d+__$/.test(normalized)) return undefined
  if (/^[{}[\],:;./\\|_-]+$/.test(normalized)) return undefined
  return normalized
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => readString(item)).filter((item): item is string => Boolean(item))
}

function readTableRows(value: unknown): string[][] {
  if (!Array.isArray(value)) return []
  return value
    .map((row) => (Array.isArray(row) ? row.map((cell) => readString(cell) ?? "") : []))
    .filter((row) => row.some((cell) => cell.length > 0))
}

function readArray(value: unknown, key: string): unknown[] {
  const row = asRecord(value)
  return Array.isArray(row[key]) ? (row[key] as unknown[]) : []
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {}
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? decodeEntities(value).replace(/\s+/g, " ").trim()
    : undefined
}

function toComponentName(name: string, index: number): string {
  const normalized = name
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("")
  if (!normalized) return `SourceComponent${index + 1}`
  return /^[A-Za-z]/.test(normalized) ? normalized : `SourceComponent${normalized}`
}

function normalizePackageName(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return normalized || "web-clone-source-project"
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

async function assertWebpageEvidenceInputs(webpageEvidenceDir: string): Promise<void> {
  const required = [
    path.join(webpageEvidenceDir, "source-skeleton", "index.html"),
    path.join(webpageEvidenceDir, "source-ir", "content-model.json"),
    path.join(webpageEvidenceDir, "source-ir", "component-tree.json"),
  ]
  const missing: string[] = []
  for (const file of required) {
    if (!(await exists(file))) missing.push(file)
  }
  if (missing.length > 0) throw new Error(`Webpage evidence source-project inputs are missing: ${missing.join(", ")}`)
}

async function prepareOutputDir(outputDir: string, overwrite: boolean): Promise<void> {
  if (await exists(outputDir)) {
    const entries = await fs.readdir(outputDir)
    if (entries.length > 0 && !overwrite) {
      throw new Error(`Output directory is not empty: ${outputDir}. Pass overwrite=true to replace it.`)
    }
    if (entries.length > 0) await fs.rm(outputDir, { recursive: true, force: true })
  }
  await fs.mkdir(outputDir, { recursive: true })
}

async function copyPublicAssets(
  webpageEvidenceDir: string,
  outputDir: string,
  extractedAssets: Map<string, ExtractedPublicAsset>,
): Promise<void> {
  const sourceSvgDir = path.join(webpageEvidenceDir, "assets", "svg")
  const sourceImagesDir = path.join(webpageEvidenceDir, "assets", "images")
  const targetAssetsDir = path.join(outputDir, "public", "assets")
  const targetSvgDir = path.join(targetAssetsDir, "svg")
  await fs.rm(targetAssetsDir, { recursive: true, force: true })
  if (await exists(sourceSvgDir)) {
    await fs.cp(sourceSvgDir, targetSvgDir, { recursive: true })
  }
  if (await exists(sourceImagesDir)) {
    await copyDecodedImageAssets(sourceImagesDir, path.join(targetAssetsDir, "images"))
  }
  for (const asset of extractedAssets.values()) {
    await fs.mkdir(path.dirname(path.join(outputDir, "public", asset.relativePath)), { recursive: true })
    await fs.writeFile(path.join(outputDir, "public", asset.relativePath), asset.bytes)
  }
}

async function copyReferenceImage(webpageEvidenceDir: string, outputDir: string): Promise<string[]> {
  const source = path.join(webpageEvidenceDir, "reference.png")
  if (!(await exists(source))) {
    throw new Error(`webpage evidence is missing required reference image: ${source}`)
  }
  await fs.copyFile(source, path.join(outputDir, "reference.png"))
  return ["reference.png"]
}

async function copyDecodedImageAssets(sourceDir: string, targetDir: string): Promise<void> {
  await fs.mkdir(targetDir, { recursive: true })
  const entries = await fs.readdir(sourceDir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".txt")) continue
    const sourcePath = path.join(sourceDir, entry.name)
    const text = await readOptionalText(sourcePath)
    const parsed = parseDataUrl(text.trim())
    if (!parsed) continue
    const targetName = entry.name.replace(/\.txt$/i, "")
    await fs.writeFile(path.join(targetDir, targetName), parsed.bytes)
  }
}

async function readPreviewImagePaths(webpageEvidenceDir: string): Promise<string[]> {
  const imagesDir = path.join(webpageEvidenceDir, "assets", "images")
  if (!(await exists(imagesDir))) return []
  const entries = await fs.readdir(imagesDir, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && /\.webp\.txt$/i.test(entry.name))
    .map((entry) => entry.name.replace(/\.txt$/i, ""))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .filter((name) => /\.webp$/i.test(name))
    .map((name) => `/assets/images/${name}`)
}

async function readSvgPathData(webpageEvidenceDir: string): Promise<Record<string, string>> {
  const svgDir = path.join(webpageEvidenceDir, "assets", "svg")
  if (!(await exists(svgDir))) return {}
  const entries = await fs.readdir(svgDir, { withFileTypes: true })
  const result: Record<string, string> = {}
  for (const entry of entries) {
    if (!entry.isFile() || !/\.path\.txt$/i.test(entry.name)) continue
    const text = (await readOptionalText(path.join(svgDir, entry.name))).trim()
    if (!text) continue
    result[`assets/svg/${entry.name}`] = text
  }
  return result
}

async function writeFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, content, "utf8")
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

async function readText(filePath: string): Promise<string> {
  return fs.readFile(filePath, "utf8")
}

async function readOptionalText(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8")
  } catch {
    return ""
  }
}

async function readJsonOptional(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"))
  } catch {
    return undefined
  }
}

async function buildSourceProjectVisualIteration(webpageEvidenceDir: string): Promise<SourceProjectVisualIteration> {
  const manifest = asRecord(await readJsonOptional(path.join(webpageEvidenceDir, "web-clone-source-manifest.json")))
  const provenance = asRecord(manifest.provenance)
  const manifestViewport = readVisualViewport(asRecord(provenance.captureViewport))
  const extractedViewport = await readExtractedPageViewport(webpageEvidenceDir)
  const reference = asRecord(provenance.reference)
  const referenceWidth = readPositiveInteger(reference.width)
  const referenceHeight = readPositiveInteger(reference.height)
  const referenceViewport =
    referenceWidth && referenceHeight
      ? readVisualViewport({
          width: referenceWidth,
          height: inferReferenceViewportHeight(referenceWidth, referenceHeight),
        })
      : undefined
  const primary = manifestViewport
    ? { ...manifestViewport, evidenceSource: "capture_viewport" as const }
    : extractedViewport
      ? { ...extractedViewport, evidenceSource: "capture_viewport" as const }
      : referenceViewport
        ? { ...referenceViewport, evidenceSource: "reference_manifest" as const }
        : DEFAULT_SOURCE_PROJECT_PRIMARY_VIEWPORT
  const viewportMatrix = buildSourceProjectVisualIterationViewports(primary)
  return {
    referenceImage: "reference.png",
    evidenceMethod: "task_scoped_preview_screenshots",
    viewportMatrix,
    rule: "Use the desktop-reference viewport as the primary inspected preview screenshot after each region replacement. Use responsive-review viewports for screenshot review when matching reference evidence exists; otherwise record the missing evidence instead of claiming responsive parity.",
  }
}

async function readExtractedPageViewport(
  webpageEvidenceDir: string,
): Promise<{ width: number; height: number } | undefined> {
  const extractedPage = asRecord(await readJsonOptional(path.join(webpageEvidenceDir, "extracted-page.json")))
  return readVisualViewport(asRecord(extractedPage.viewport))
}

function readVisualViewport(value: Record<string, unknown>): { width: number; height: number } | undefined {
  const width = readPositiveInteger(value.width)
  const height = readPositiveInteger(value.height)
  if (!width || !height) return undefined
  if (width < 240 || height < 180) return undefined
  return { width, height }
}

function readPositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined
}

function inferReferenceViewportHeight(width: number, referenceHeight: number): number {
  if (referenceHeight <= 1200) return referenceHeight
  if (width <= 480) return Math.min(referenceHeight, 844)
  return 900
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}
