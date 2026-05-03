# Deliver Runtime Capture 单一来源方案

## 目标

deliver 阶段只保留一个运行时证据来源：`RuntimeCapture`。截图、页面完整性评估、runtime evidence 和视觉评分复用同一次 capture 产物，不再各自开浏览器、各自判断页面是否完整。

## 实施规则

1. mirror 的 `webpage_render` 属于 mirror 场景，不在本次改动范围内。
2. delivery 新增 `captureRuntimePage()`，集中处理视口默认值、视口上限、页面加载、等待、DOM、JS、HTTP、资产、像素方差、截图路径和交互探针。
3. `screenshot` 工具只调用 `captureRuntimePage()` 并返回该 capture 的 PNG、sha、尺寸和像素信号。
4. `verify_page_integrity` 工具只调用 `captureRuntimePage()` 并把同一个 capture 映射为完整性报告；它不得再直接 `puppeteer.launch()`。
5. `computeRuntimeEvidence()` 只调用 `captureRuntimePage()`；下游 `DeliveryService` 和 visual metric 继续使用 `runtimeReport.evidence.renderedPngPath`，但这个路径必须来自同一个 capture。
6. capture 崩溃和页面层失败必须分开表达：浏览器/导航/截图失败是 `capture_error`；HTTP、资产、DOM、JS、像素、expected 是页面层失败。
7. 页面加载使用 `load + settle + optional selector`，不使用 `networkidle0` 作为完成条件。
8. 测试必须覆盖默认视口、`verify_page_integrity` 不直接打开 Puppeteer、runtime evidence 复用 capture、以及最小本地页面 capture。

## 验收

- 省略 viewport 调 `verify_page_integrity` 不再把 `undefined/null` 传给 Chrome。
- `verify_page_integrity`、`screenshot`、`computeRuntimeEvidence` 的截图路径均来自 `captureRuntimePage()`。
- delivery 失败反馈能区分 capture 本身失败和页面内容不完整。
- mirror 目录无改动。
