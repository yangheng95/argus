# 世界地图模块实现规范

当页面涉及**世界地图**相关模块（全球分布图、国家热力图、地理数据可视化等）时，**必须参考**本 skill 内 `assets/_module-*` 中的已有实现，技术架构与 CDN 策略保持一致。

## 已有参考实现

- `assets/_module-inflation-map.html` —— 全球通胀热力图，D3 + TopoJSON + 国内 CDN
- `assets/_module-industrial-map.html` —— 全球工业产值地图，同技术栈

## 技术要点

- **投影**：D3.js `geoNaturalEarth1()`
- **地理数据**：TopoJSON `countries-110m.json`
- **资源来源**：在实现前确定一份项目自有 D3/TopoJSON 资源或一个任务明确授权的 URL
- **着色命名**：BEM 风格 `<module>__country--t1` ~ `--t5` 分层着色
- **图例组件**：色带 + 端点标签 + 分界值
- **SVG 尺寸**：`viewBox="0 0 960 500"` + `preserveAspectRatio="xMidYMid meet"` 保持自适应
- **数据键**：以 ISO 3166-1 numeric code 为键
- **资源错误**：加载失败时暴露明确错误并判定模块未交付，不得改用另一来源

## 可调整 / 不可调整

| 维度 | 是否允许调整 |
|------|-------------|
| 配色 | ✅ 允许，但必须使用 design system tokens |
| 数据维度（着色指标） | ✅ 允许，按业务需求替换 |
| 图例文案 | ✅ 允许 |
| 投影方式 / TopoJSON 源 | ❌ 不允许，保持与已有实现一致 |
| D3 / TopoJSON 来源 | ❌ 不允许运行时切换；保持实现前选定的单一来源 |
| SVG viewBox 与 `preserveAspectRatio` | ❌ 不允许，影响自适应一致性 |
