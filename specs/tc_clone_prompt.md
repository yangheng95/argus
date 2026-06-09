我需要复刻网页 <https://www.tradingview.com/markets/world-economy/>
这是一个多阶段任务，每一个阶段都需要遵守UI设计规范nova-vibe skills

阶段 1：抽取目标网页可用资源,按网页模块写代码

- 使用 frontend_design / frontend_research 获取目标网页的资源和详细PRD。根据 PRD 和资源，分析页面结构、布局、样式、交互等设计细节，形成清晰的设计规范和实现方案。禁止使用任何未经验证的假设或模糊的描述，所有设计细节必须有明确的证据支持。
- 基于给定的项目脚手架，结合PRD和抽取的资源编写网页组件，每个模块必须消费对应的 source-dom、style-profile、截图和 CSS sidecar。假定所有抽取的模块都是表格、图表、地图等可交互的功能组件，优先使用成熟库或已有抽取资源复原网页上的组件，禁止复制图片或者占位符式的实现。每个组件都必须严格遵守设计规范，禁止任何不一致或不合理的设计细节。

阶段 2：逐模块检查和修复

- 对每个 region 使用 task-scoped backend browser evidence runner 生成的截图、DOM、console、page-error 和 viewport artifact 单独检查：
  - 布局尺寸
  - 字体 / 字重 / 行高
  - 间距 / 边框 / 圆角
  - 颜色 / 背景
  - 表格密度
  - 图表比例
  - 移动端布局
    发现不一致时和不合理，丑陋的地方，回到对应 region 的源材料继续修复视觉和功能。
