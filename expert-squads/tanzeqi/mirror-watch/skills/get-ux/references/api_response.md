# API Response Format Reference

Example response from browser agent API:

```json
{
  "description": "# 功能操作描述文档\n\n---\n\n## 步骤 1\n\n**截图**: `screenshot_0.png`\n\n**描述**:\n\n- 页面/布局概述：用户已到达 TradingView 主页（tradingview.com）。顶部为常驻全局导航条，从左到右包含：TradingView logo、全局搜索框（占位文本"Search (Ctrl+K)"）、导航项目：Products、Community、Markets（当前已被交互检索，交互索引 [2290]）、Brokers、More；右上角有语言/地区切换（地球图标 + EN）、用户图标和显眼的 "Get started"（紫蓝渐变）按钮。\n- 主视觉区：页面中央为大型横幅（hero），主标题文案 "Look first / Then leap."，副标题 "The best trades require research, then commitment."，中心有白色实心圆角按钮 "Get started for free" 及其下方小字 "$0 forever, no credit card needed"。\n- 可交互点识别：顶部导航中的 "Markets" 是可点击的入口，用于进入市场概览页面（操作日志表明已在此处定位到该入口）。\n- 操作结果说明：在此步骤用户只是到达并确认了主页与顶部导航，识别到 "Markets" 为下一步入口，页面本身未发生状态变化（未打开菜单或弹窗）。\n\n---\n\n## 步骤 2\n\n**截图**: `screenshot_1.png`\n\n**描述**:\n\n- 页面/布局与当前状态：用户从主页通过顶部导航进入了 Markets 页面（在日志中标注为 tab B07E）。Markets 页面顶部保留全局导航；主标题变为 "Markets, everywhere" 并带下拉箭头（表示可切换或折叠区域）。\n- 可见 UI 组件（第一屏摘要）：\n  - "Indices" 区块标题（左对齐）和多个指数卡片横向排列：S&P 500（左侧红色圆标 500），Nasdaq 100（蓝色 100），Dow 30（青蓝 30），US 2000 small cap（酒红 2000），NASDAQ Composite（青绿图标）。每个卡片下有当前数值与百分比变动（value + delta）。\n  - 页面还预留了更下方的 "World indices" 区域（卡片式索引），位于页面可视区域下方。\n- 目标说明与当前进度：用户在此步骤计划定位 Screeners（选股器） -> Stock Screener 并应用筛选条件；但在当前可见区域尚未看到 Screener 的直接链接或按钮（页面上未展开任何筛选器）。\n- 操作结果：Markets 页面成功加载并可视，用户尚未启动 Screener 功能或打开任何筛选界面，页面状态保持为市场概览列表（无弹出或遮罩）。",
  "full_image": "http://101.35.31.251:9000/despilot-server/4b43a2121c4046e7ab92d400d343eeda_full_storyboard.png",
  "thumbnail_image": "iVBORw0KGgoAAAANSU..."
}
```

## Response Fields

- **description**: Markdown-formatted string containing step-by-step description of the user experience workflow
- **full_image**: URL string to the full storyboard image (PNG format)
- **thumbnail_image**: Base64-encoded PNG thumbnail image string

## Usage

To display thumbnail in markdown:
```markdown
![UX Flow](data:image/png;base64,<thumbnail_image>)
```
