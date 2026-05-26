# 行情业务组件批量重写 Prompt  (此任务需要>10 goals才能覆盖所有组件)

> 说明：以下 prompt 可逐条复制给编码助手执行。统一约束：基于现状、使用 skill、从 C# 组件转写为 TS/React 组件、注意复用已有组件和能力，并保留右键/上下文功能。

## 1. CandlestickChart K线图

> 已剔除：Hithink.PrefabLibrary 仓库无 K 线图业务组件，只有 `Prefab/BasePrefab/Chart/CandleStick/HevoCandleStickChartViewModel.cs` 基础图表层 + Oxyplot 第三方图形库（`Oxyplot/OxyPlot/Series/FinancialSeries/CandleStickSeries.cs` 等），需自行组合或基于设计稿/PRD 重写。

## 2. TrendChart 分时图

> 已剔除：Hithink.PrefabLibrary 仓库内**完全没有**分时图相关代码（无 TrendChart / MinuteChart / IntraDay / 分时 等任何匹配），需基于设计稿/PRD 从零实现。

## 3. KeyStatisticsMTts 关键数据

```text
使用agent team（所有agent都要使用）搭配skill 帮我将 C# 的 KeyStatistics 关键数据组件转写成 TS/React 组件。C# 组件目录：Hithink.PrefabLibrary\PrefabLibrary\PrefabLibrary\Business\KeyStatistics。重写后的 TS 组件放在：src\web\src\components\composite\KeyStatisticsMTts。你需要全面调查C#代码，确保不丢失任何属性，交互和功能细节，例如API和鼠标右键功能。基于本地运行的PipeServerAPI（API无法连接则提供mock数据），确保真实场景下接入API完美还原。如果目标目录已存在该组件实现，先整体删除再从零重写，禁止增量打补丁。重写完成后必须集成到 electron 组件预览页面：在 `src/web/src/pages/test/data/` 下新增 `<ComponentName>.ts` 场景数据文件，并在 `src/web/src/pages/test/registry.tsx` 的 `TEST_REGISTRY` 中注册该组件；如已有 barrel export（`src/web/src/components/npm/business.ts` 或 `src/web/src/lib/business.ts`），也需补齐导出；若该组件已被预览页注册则覆盖更新，确保 `pnpm dev` 启动后能在测试台下拉菜单中选中并正常渲染。
```

## 4. QuotationTable 行情表格

> 已剔除：`QuotationTableControl` / `QuotationTableViewModel` 来自外部 assembly `Hevo.Table`（不在 Hithink.PrefabLibrary 仓库内）。仓库里只有 `UIDemoPlugin/Example/Business/QuotaTable/QuotationTableExample.cs` 用法示例，需依赖外部 assembly 文档或基于示例代码 + PRD 重写。

## 5. AuctionDataMTts 竞价数据柱状图

```text
使用agent team（所有agent都要使用）搭配skill 帮我将 C# 的 AuctionData 竞价数据柱状图组件转写成 TS/React 组件。C# 组件目录：Hithink.PrefabLibrary\PrefabLibrary\PrefabLibrary\Business\AuctionData。重写后的 TS 组件放在：src\web\src\components\composite\AuctionDataMTts。你需要全面调查C#代码，确保不丢失任何属性，交互和功能细节，例如API和鼠标右键功能。基于本地运行的PipeServerAPI（API无法连接则提供mock数据），确保真实场景下接入API完美还原。如果目标目录已存在该组件实现，先整体删除再从零重写，禁止增量打补丁。重写完成后必须集成到 electron 组件预览页面：在 `src/web/src/pages/test/data/` 下新增 `<ComponentName>.ts` 场景数据文件，并在 `src/web/src/pages/test/registry.tsx` 的 `TEST_REGISTRY` 中注册该组件；如已有 barrel export（`src/web/src/components/npm/business.ts` 或 `src/web/src/lib/business.ts`），也需补齐导出；若该组件已被预览页注册则覆盖更新，确保 `pnpm dev` 启动后能在测试台下拉菜单中选中并正常渲染。
```

## 6. AigcConnectLimitLadder 连板天梯

```text
使用agent team（所有agent都要使用）搭配skill 帮我将 C# 的 AigcConnectLimitLadder 连板天梯组件转写成 TS/React 组件。C# 组件目录优先查找：Hithink.PrefabLibrary\PrefabLibrary\PrefabLibrary\Business\AigcConnectLimitLadder。重写后的 TS 组件放在：src\web\src\components\composite\AigcConnectLimitLadder。你需要全面调查C#代码，确保不丢失任何属性，交互和功能细节，例如API和鼠标右键功能。基于本地运行的PipeServerAPI（API无法连接则提供mock数据），确保真实场景下接入API完美还原。如果目标目录已存在该组件实现，先整体删除再从零重写，禁止增量打补丁。重写完成后必须集成到 electron 组件预览页面：在 `src/web/src/pages/test/data/` 下新增 `<ComponentName>.ts` 场景数据文件，并在 `src/web/src/pages/test/registry.tsx` 的 `TEST_REGISTRY` 中注册该组件；如已有 barrel export（`src/web/src/components/npm/business.ts` 或 `src/web/src/lib/business.ts`），也需补齐导出；若该组件已被预览页注册则覆盖更新，确保 `pnpm dev` 启动后能在测试台下拉菜单中选中并正常渲染。
```

## 7. GgtNetBuyMTts 港股通净买入

```text
使用agent team（所有agent都要使用）搭配skill 帮我将 C# 的 GgtNetBuy 港股通净买入组件转写成 TS/React 组件。C# 组件目录优先查找：Hithink.PrefabLibrary\PrefabLibrary\PrefabLibrary\Business\GgtNetBuy。重写后的 TS 组件放在：src\web\src\components\composite\GgtNetBuyMTts。你需要全面调查C#代码，确保不丢失任何属性，交互和功能细节，例如API和鼠标右键功能。基于本地运行的PipeServerAPI（API无法连接则提供mock数据），确保真实场景下接入API完美还原。如果目标目录已存在该组件实现，先整体删除再从零重写，禁止增量打补丁。重写完成后必须集成到 electron 组件预览页面：在 `src/web/src/pages/test/data/` 下新增 `<ComponentName>.ts` 场景数据文件，并在 `src/web/src/pages/test/registry.tsx` 的 `TEST_REGISTRY` 中注册该组件；如已有 barrel export（`src/web/src/components/npm/business.ts` 或 `src/web/src/lib/business.ts`），也需补齐导出；若该组件已被预览页注册则覆盖更新，确保 `pnpm dev` 启动后能在测试台下拉菜单中选中并正常渲染。
```

## 8. AigcBlockCloudMTts 涨停板块云

```text
使用agent team（所有agent都要使用）搭配skill 帮我将 C# 的 AigcBlockCloud 涨停板块云组件转写成 TS/React 组件。C# 组件目录优先查找：Hithink.PrefabLibrary\PrefabLibrary\PrefabLibrary\Business\AigcBlockCloud。重写后的 TS 组件放在：src\web\src\components\composite\AigcBlockCloudMTts。你需要全面调查C#代码，确保不丢失任何属性，交互和功能细节，例如API和鼠标右键功能。基于本地运行的PipeServerAPI（API无法连接则提供mock数据），确保真实场景下接入API完美还原。如果目标目录已存在该组件实现，先整体删除再从零重写，禁止增量打补丁。重写完成后必须集成到 electron 组件预览页面：在 `src/web/src/pages/test/data/` 下新增 `<ComponentName>.ts` 场景数据文件，并在 `src/web/src/pages/test/registry.tsx` 的 `TEST_REGISTRY` 中注册该组件；如已有 barrel export（`src/web/src/components/npm/business.ts` 或 `src/web/src/lib/business.ts`），也需补齐导出；若该组件已被预览页注册则覆盖更新，确保 `pnpm dev` 启动后能在测试台下拉菜单中选中并正常渲染。
```

## 9. TradingStatusMTts 港股交易状态

```text
使用agent team（所有agent都要使用）搭配skill 帮我将 C# 的 TradingStatus 港股交易状态组件转写成 TS/React 组件。C# 组件目录优先查找：Hithink.PrefabLibrary\PrefabLibrary\PrefabLibrary\Business\TradingStatus。重写后的 TS 组件放在：src\web\src\components\composite\TradingStatusMTts。你需要全面调查C#代码，确保不丢失任何属性，交互和功能细节，例如API和鼠标右键功能。基于本地运行的PipeServerAPI（API无法连接则提供mock数据），确保真实场景下接入API完美还原。如果目标目录已存在该组件实现，先整体删除再从零重写，禁止增量打补丁。重写完成后必须集成到 electron 组件预览页面：在 `src/web/src/pages/test/data/` 下新增 `<ComponentName>.ts` 场景数据文件，并在 `src/web/src/pages/test/registry.tsx` 的 `TEST_REGISTRY` 中注册该组件；如已有 barrel export（`src/web/src/components/npm/business.ts` 或 `src/web/src/lib/business.ts`），也需补齐导出；若该组件已被预览页注册则覆盖更新，确保 `pnpm dev` 启动后能在测试台下拉菜单中选中并正常渲染。
```

## 10. StrengthRatingMTts 强弱评级折线图

```text
使用agent team（所有agent都要使用）搭配skill 帮我将 C# 的 StrengthRating 强弱评级折线图组件转写成 TS/React 组件。C# 组件目录优先查找：Hithink.PrefabLibrary\PrefabLibrary\PrefabLibrary\Business\StrengthRating。重写后的 TS 组件放在：src\web\src\components\composite\StrengthRatingMTts。你需要全面调查C#代码，确保不丢失任何属性，交互和功能细节，例如API和鼠标右键功能。基于本地运行的PipeServerAPI（API无法连接则提供mock数据），确保真实场景下接入API完美还原。如果目标目录已存在该组件实现，先整体删除再从零重写，禁止增量打补丁。重写完成后必须集成到 electron 组件预览页面：在 `src/web/src/pages/test/data/` 下新增 `<ComponentName>.ts` 场景数据文件，并在 `src/web/src/pages/test/registry.tsx` 的 `TEST_REGISTRY` 中注册该组件；如已有 barrel export（`src/web/src/components/npm/business.ts` 或 `src/web/src/lib/business.ts`），也需补齐导出；若该组件已被预览页注册则覆盖更新，确保 `pnpm dev` 启动后能在测试台下拉菜单中选中并正常渲染。
```

## 11. IndexTreeMTts 热度板块热力图

```text
使用agent team（所有agent都要使用）搭配skill 帮我将 C# 的 IndexTree 热度板块热力图组件转写成 TS/React 组件。C# 组件目录优先查找：Hithink.PrefabLibrary\PrefabLibrary\PrefabLibrary\Business\IndexTree。重写后的 TS 组件放在：src\web\src\components\composite\IndexTreeMTts。你需要全面调查C#代码，确保不丢失任何属性，交互和功能细节，例如API和鼠标右键功能。基于本地运行的PipeServerAPI（API无法连接则提供mock数据），确保真实场景下接入API完美还原。如果目标目录已存在该组件实现，先整体删除再从零重写，禁止增量打补丁。重写完成后必须集成到 electron 组件预览页面：在 `src/web/src/pages/test/data/` 下新增 `<ComponentName>.ts` 场景数据文件，并在 `src/web/src/pages/test/registry.tsx` 的 `TEST_REGISTRY` 中注册该组件；如已有 barrel export（`src/web/src/components/npm/business.ts` 或 `src/web/src/lib/business.ts`），也需补齐导出；若该组件已被预览页注册则覆盖更新，确保 `pnpm dev` 启动后能在测试台下拉菜单中选中并正常渲染。
```

## 12. AigcStockAnalysis 异动看点

```text
使用agent team（所有agent都要使用）搭配skill 帮我将 C# 的 AigcStockAnalysis 异动看点组件转写成 TS/React 组件。C# 组件目录优先查找：Hithink.PrefabLibrary\PrefabLibrary\PrefabLibrary\Business\AigcStockAnalysis。重写后的 TS 组件放在：src\web\src\components\composite\AigcStockAnalysis。你需要全面调查C#代码，确保不丢失任何属性，交互和功能细节，例如API和鼠标右键功能。基于本地运行的PipeServerAPI（API无法连接则提供mock数据），确保真实场景下接入API完美还原。如果目标目录已存在该组件实现，先整体删除再从零重写，禁止增量打补丁。重写完成后必须集成到 electron 组件预览页面：在 `src/web/src/pages/test/data/` 下新增 `<ComponentName>.ts` 场景数据文件，并在 `src/web/src/pages/test/registry.tsx` 的 `TEST_REGISTRY` 中注册该组件；如已有 barrel export（`src/web/src/components/npm/business.ts` 或 `src/web/src/lib/business.ts`），也需补齐导出；若该组件已被预览页注册则覆盖更新，确保 `pnpm dev` 启动后能在测试台下拉菜单中选中并正常渲染。
```

## 13. AigcLimitStrength 涨跌停强度

```text
使用agent team（所有agent都要使用）搭配skill 帮我将 C# 的 AigcLimitStrength 涨跌停强度组件转写成 TS/React 组件。C# 组件目录优先查找：Hithink.PrefabLibrary\PrefabLibrary\PrefabLibrary\Business\AigcLimitStrength。重写后的 TS 组件放在：src\web\src\components\composite\AigcLimitStrength。你需要全面调查C#代码，确保不丢失任何属性，交互和功能细节，例如API和鼠标右键功能。基于本地运行的PipeServerAPI（API无法连接则提供mock数据），确保真实场景下接入API完美还原。如果目标目录已存在该组件实现，先整体删除再从零重写，禁止增量打补丁。重写完成后必须集成到 electron 组件预览页面：在 `src/web/src/pages/test/data/` 下新增 `<ComponentName>.ts` 场景数据文件，并在 `src/web/src/pages/test/registry.tsx` 的 `TEST_REGISTRY` 中注册该组件；如已有 barrel export（`src/web/src/components/npm/business.ts` 或 `src/web/src/lib/business.ts`），也需补齐导出；若该组件已被预览页注册则覆盖更新，确保 `pnpm dev` 启动后能在测试台下拉菜单中选中并正常渲染。
```

## 14. AIInterpretationMTts 港股AI解盘

```text
使用agent team（所有agent都要使用）搭配skill 帮我将 C# 的 AIInterpretation 港股AI解盘组件转写成 TS/React 组件。C# 组件目录优先查找：Hithink.PrefabLibrary\PrefabLibrary\PrefabLibrary\Business\AIInterpretation。重写后的 TS 组件放在：src\web\src\components\composite\AIInterpretationMTts。你需要全面调查C#代码，确保不丢失任何属性，交互和功能细节，例如API和鼠标右键功能。基于本地运行的PipeServerAPI（API无法连接则提供mock数据），确保真实场景下接入API完美还原。如果目标目录已存在该组件实现，先整体删除再从零重写，禁止增量打补丁。重写完成后必须集成到 electron 组件预览页面：在 `src/web/src/pages/test/data/` 下新增 `<ComponentName>.ts` 场景数据文件，并在 `src/web/src/pages/test/registry.tsx` 的 `TEST_REGISTRY` 中注册该组件；如已有 barrel export（`src/web/src/components/npm/business.ts` 或 `src/web/src/lib/business.ts`），也需补齐导出；若该组件已被预览页注册则覆盖更新，确保 `pnpm dev` 启动后能在测试台下拉菜单中选中并正常渲染。
```

## 15. RiseFallStatisticsMTts 涨跌统计

```text
使用agent team（所有agent都要使用）搭配skill 帮我将 C# 的 RiseFallStatistics 涨跌统计组件转写成 TS/React 组件。C# 组件目录优先查找：Hithink.PrefabLibrary\PrefabLibrary\PrefabLibrary\Business\RiseFallStatistics。重写后的 TS 组件放在：src\web\src\components\composite\RiseFallStatisticsMTts。你需要全面调查C#代码，确保不丢失任何属性，交互和功能细节，例如API和鼠标右键功能。基于本地运行的PipeServerAPI（API无法连接则提供mock数据）和复用组件（禁止编造组件），确保真实场景下接入API完美还原。如果目标目录已存在该组件实现，先整体删除再从零重写，禁止增量打补丁。重写完成后必须集成到 electron 组件预览页面：在 `src/web/src/pages/test/data/` 下新增 `<ComponentName>.ts` 场景数据文件，并在 `src/web/src/pages/test/registry.tsx` 的 `TEST_REGISTRY` 中注册该组件；如已有 barrel export（`src/web/src/components/npm/business.ts` 或 `src/web/src/lib/business.ts`），也需补齐导出；若该组件已被预览页注册则覆盖更新，确保 `pnpm dev` 启动后能在测试台下拉菜单中选中并正常渲染。
```

## 16. MarketTurnoverMTts 市场成交额

```text
使用agent team（所有agent都要使用）搭配skill 帮我将 C# 的 MarketTurnover 市场成交额组件转写成 TS/React 组件。C# 组件目录优先查找：Hithink.PrefabLibrary\PrefabLibrary\PrefabLibrary\Business\MarketTurnover。重写后的 TS 组件放在：src\web\src\components\composite\MarketTurnoverMTts。你需要全面调查C#代码，确保不丢失任何属性，交互和功能细节，例如API和鼠标右键功能。基于本地运行的PipeServerAPI（API无法连接则提供mock数据），确保真实场景下接入API完美还原。如果目标目录已存在该组件实现，先整体删除再从零重写，禁止增量打补丁。重写完成后必须集成到 electron 组件预览页面：在 `src/web/src/pages/test/data/` 下新增 `<ComponentName>.ts` 场景数据文件，并在 `src/web/src/pages/test/registry.tsx` 的 `TEST_REGISTRY` 中注册该组件；如已有 barrel export（`src/web/src/components/npm/business.ts` 或 `src/web/src/lib/business.ts`），也需补齐导出；若该组件已被预览页注册则覆盖更新，确保 `pnpm dev` 启动后能在测试台下拉菜单中选中并正常渲染。
```

## 17. HkHot24HMTts 24小时热门港股

```text
使用agent team（所有agent都要使用）搭配skill 帮我将 C# 的 HkHot24H 24小时热门港股组件转写成 TS/React 组件。C# 组件目录优先查找：Hithink.PrefabLibrary\PrefabLibrary\PrefabLibrary\Business\HkHot24H。重写后的 TS 组件放在：src\web\src\components\composite\HkHot24HMTts。你需要全面调查C#代码，确保不丢失任何属性，交互和功能细节，例如API和鼠标右键功能。基于本地运行的PipeServerAPI（API无法连接则提供mock数据），确保真实场景下接入API完美还原。如果目标目录已存在该组件实现，先整体删除再从零重写，禁止增量打补丁。重写完成后必须集成到 electron 组件预览页面：在 `src/web/src/pages/test/data/` 下新增 `<ComponentName>.ts` 场景数据文件，并在 `src/web/src/pages/test/registry.tsx` 的 `TEST_REGISTRY` 中注册该组件；如已有 barrel export（`src/web/src/components/npm/business.ts` 或 `src/web/src/lib/business.ts`），也需补齐导出；若该组件已被预览页注册则覆盖更新，确保 `pnpm dev` 启动后能在测试台下拉菜单中选中并正常渲染。
```

## 18. AuctionMonitorMTts 竞价监控

```text
使用agent team（所有agent都要使用）搭配skill 帮我将 C# 的 AuctionMonitor 竞价监控组件转写成 TS/React 组件。C# 组件目录优先查找：Hithink.PrefabLibrary\PrefabLibrary\PrefabLibrary\Business\AuctionMonitor。重写后的 TS 组件放在：src\web\src\components\composite\AuctionMonitorMTts。你需要全面调查C#代码，确保不丢失任何属性，交互和功能细节，例如API和鼠标右键功能。基于本地运行的PipeServerAPI（API无法连接则提供mock数据），确保真实场景下接入API完美还原。如果目标目录已存在该组件实现，先整体删除再从零重写，禁止增量打补丁。重写完成后必须集成到 electron 组件预览页面：在 `src/web/src/pages/test/data/` 下新增 `<ComponentName>.ts` 场景数据文件，并在 `src/web/src/pages/test/registry.tsx` 的 `TEST_REGISTRY` 中注册该组件；如已有 barrel export（`src/web/src/components/npm/business.ts` 或 `src/web/src/lib/business.ts`），也需补齐导出；若该组件已被预览页注册则覆盖更新，确保 `pnpm dev` 启动后能在测试台下拉菜单中选中并正常渲染。
```

## 19. IndustryCardListMTts 行业卡片列表

```text
使用agent team（所有agent都要使用）搭配skill 帮我将 C# 的 IndustryCardList 行业卡片列表组件转写成 TS/React 组件。C# 组件目录优先查找：Hithink.PrefabLibrary\PrefabLibrary\PrefabLibrary\Business\IndustryCardList。重写后的 TS 组件放在：src\web\src\components\composite\IndustryCardListMTts。你需要全面调查C#代码，确保不丢失任何属性，交互和功能细节，例如API和鼠标右键功能。基于本地运行的PipeServerAPI（API无法连接则提供mock数据），确保真实场景下接入API完美还原。如果目标目录已存在该组件实现，先整体删除再从零重写，禁止增量打补丁。重写完成后必须集成到 electron 组件预览页面：在 `src/web/src/pages/test/data/` 下新增 `<ComponentName>.ts` 场景数据文件，并在 `src/web/src/pages/test/registry.tsx` 的 `TEST_REGISTRY` 中注册该组件；如已有 barrel export（`src/web/src/components/npm/business.ts` 或 `src/web/src/lib/business.ts`），也需补齐导出；若该组件已被预览页注册则覆盖更新，确保 `pnpm dev` 启动后能在测试台下拉菜单中选中并正常渲染。
```

## 20. AigcStockTableMTts 成分股/行业板块

```text
使用agent team（所有agent都要使用）搭配skill 帮我将 C# 的 AigcStockTable 成分股/行业板块组件转写成 TS/React 组件。C# 组件目录优先查找：Hithink.PrefabLibrary\PrefabLibrary\PrefabLibrary\Business\AigcStockTable。重写后的 TS 组件放在：src\web\src\components\composite\AigcStockTableMTts。你需要全面调查C#代码，确保不丢失任何属性，交互和功能细节，例如API和鼠标右键功能。基于本地运行的PipeServerAPI（API无法连接则提供mock数据），确保真实场景下接入API完美还原。如果目标目录已存在该组件实现，先整体删除再从零重写，禁止增量打补丁。重写完成后必须集成到 electron 组件预览页面：在 `src/web/src/pages/test/data/` 下新增 `<ComponentName>.ts` 场景数据文件，并在 `src/web/src/pages/test/registry.tsx` 的 `TEST_REGISTRY` 中注册该组件；如已有 barrel export（`src/web/src/components/npm/business.ts` 或 `src/web/src/lib/business.ts`），也需补齐导出；若该组件已被预览页注册则覆盖更新，确保 `pnpm dev` 启动后能在测试台下拉菜单中选中并正常渲染。
```
