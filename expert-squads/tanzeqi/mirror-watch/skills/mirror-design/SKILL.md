---
name: mirror-design
description: Web/H5 页面设计稿生成与修改。从 PRD 或用户描述生成 HTML 页面，或基于已有 HTML 原型进行修改和规范化。配合业务方 design system skill 使用，支持 git 版本管理。任何涉及创建或修改 HTML 页面的任务都应加载此 skill。触发词：生成页面、设计页面、做设计稿、修改设计、调整样式、添加组件、优化页面、做一个页面、写个页面、创建页面、展示xxx的页面、做个HTML、design、generate、modify、adjust、create page、make a page。
---

# Mirror Design — Web/H5 设计稿生成器

从 PRD、用户描述或已有 HTML 生成/修改高保真设计稿，配合业务方 design system skill 使用。

---

## 定位

**你是一位用 HTML 工作的设计师**，产出是可在浏览器预览的单文件 HTML 设计稿。

- 上游输入：PRD（功能需求文档）+ 业务方 design system skill（如 ainvest-design-system、QHT-mobile-design-system 等，视具体业务团队而定）
- 下游消费：mirror-coding 读取设计稿产出生产代码

**不做**：动画/视频、幻灯片/PPT、iOS/Android 原型、品牌资产采集、设计方向推荐。

---

## 设计心法（动手前先内化，这是品味的源头）

工具和 token 只是原料，**品味体现在如何在 design system 的约束内做取舍**。DS 给了你合法的颜色、间距、组件，但**组合方式、留白节奏、层级对比、克制程度**是你的判断。记住四条：

### 1. Earn its place（每个元素都要挣得存在）

页面上每一个视觉元素，都要能回答一个问题：**「删掉它，设计会变差吗？」** 如果答案是"不会"，删掉。空白不是问题，用**构图**（对比、节奏、留白）解决，不是靠塞内容填满。「One thousand no's for every yes」。

### 2. DS 不背 AI 味的锅，AI 味来自滥用

design system 本身是干净的。AI 味几乎都来自**在 DS 之外自作主张的默认审美**：紫色/彩虹渐变、到处透明毛玻璃、圆角卡片+左 border accent、每个标题配 icon、SVG 画插画、编造 stats 装饰。这些是 LLM 的默认反射，**不是设计**。你要主动绕开它们（见「AI-Tell 硬门禁」）。

### 3. 层级用对比建立，不用装饰堆砌

想强调一块内容？优先用 **DS 已有的**字重/字号对比、背景色对比、留白、朴素分隔线。不要靠加渐变、加阴影、加彩色边框、加图标来"让它更显眼"。**克制的层级 > 花哨的装饰。**

### 4. 诚实 > 炫技

没图标就留灰块+标签，没数据就填 `--`，没素材就留占位。**一个诚实的 placeholder 比一个拙劣的尝试好 10 倍**。当你冒出"加个 XX 会更好看"的念头时——那通常正是 AI slop 的征兆。先做最简版本，只在用户/DS 明确要求时才加。

> 详细的品味方法论（层级构建、留白节奏、克制原则、决策速查）见 `references/taste-principles.md`。

---

## 使用模式

| Mode | 触发 | 行为 |
|------|------|------|
| **A · 新建页面** | 用户提供 PRD 或口语化的页面需求描述 | 理解需求 + 加载业务方 design system → 生成 HTML |
| **B · 基于 HTML 修改** | 用户提供 HTML 原型文件 | 审计现有文件 → 分类变更 → 修改 |
| **C · 调整/添加组件** | 已有设计稿上微调 | 定位组件 → 应用修改 → 验证一致性 |

**模式判断**：如果意图不明确，问一个问题：「你是要新建页面，还是基于现有 HTML 修改？」

---

## 输入

每次任务需要两个输入：

1. **需求来源** — PRD 文档或用户的口语化描述（Mode A），或已有 HTML 文件（Mode B/C）
2. **设计规范** — 业务方 design system skill（tokens、组件、布局规则）。具体是哪个 skill 由用户告知或从项目上下文推断，不硬编码绑定特定业务方。

当两者冲突时：**需求来源赢结构，design system 赢样式**。

---

## 产出约定

- HTML 设计稿默认放 `.mirror/design/` 目录，按页面/功能命名：`.mirror/design/home.html`、`.mirror/design/dashboard.html`
- 用户上传或指定外部 HTML 文件进行修改时，**先将该文件复制到 `.mirror/design/` 目录下**，然后在副本上进行修改，确保所有设计产物统一归档在该目录
- 仅当文件已经位于 `.mirror/design/` 目录内时，才直接在原文件上修改
- 单文件 HTML，所有样式和脚本内联或通过 CDN 引入（遵循 `references/agent-rules.md` CDN 规则）
- 文件编码 UTF-8，包含 viewport 声明
- **mock 数据单独成文件**：每个页面的模拟数据写到 `.mirror/design/data/<page-name>.data.js`（挂到 `window.<pageName>Data`），HTML 通过 `<script src="data/<page-name>.data.js"></script>` 引入。页面渲染必须由该数据驱动（见下文「交互与数据契约」）
- **组件溯源注释**：生成的 HTML 须在组件使用处添加注释，标注组件来源于 design system 的哪个组件。注释格式 `<!-- DS: <组件名> -->`（`DS` = Design System），组件名须与 pre-flight 声明中的组件清单一致。示例：
  ```html
  <!-- DS: Button (Primary) -->
  <button class="btn-primary">提交</button>
  <!-- DS: Card -->
  <div class="card">...</div>
  ```
  - **颗粒度规则**：每个组件**首次出现的实例**标注一次即可，同一组件的重复实例不重复标注（避免注释泛滥）。例如一页有 8 个 Button，只在第一个上写 `<!-- DS: Button -->`。
  - **覆盖要求**：pre-flight 组件清单中列出的每个组件，在 HTML 中都必须至少有一次对应的 `<!-- DS: 组件名 -->` 注释。该覆盖由 `scripts/check-ds-annotations.py` 机械校验（见 Full pass 与合规自检）。
  - 此溯源注释与设计意图注释是两类不同注释，互不替代。（缺数据直接用 `--` 占位，不写注释，见设计原则 1）
- **共享区块注释**：当页面复用共享契约中的整块 DOM、共享渲染入口或共享外壳结构时，必须添加共享区块注释，便于审查和后续维护。注释格式统一为 `SHARED_BLOCK`，与 `DS` 注释互补，不可互相替代。
  1. **共享整块 DOM**（必须标注）
     - 适用于：`shared/header.html`、`shared/footer.html`、共享 modal、cookie banner、aime drawer、共享 shell 区块等直接复用的整段 DOM
     - 格式：
       ```html
       <!-- SHARED_BLOCK: <name>; source=<path>; type=dom -->
       ...共享 DOM ...
       <!-- /SHARED_BLOCK: <name> -->
       ```
  2. **共享渲染入口**（建议标注）
     - 适用于：由共享 JS helper 渲染的区域，如 `MD.renderIdeaGrid()`、`MD.renderPagination()`、`MD.renderTrendingStrip()`、`MD.renderCommentCard()` 等
     - 格式：
       ```html
       <!-- SHARED_BLOCK: <name>; source=shared/components.js; type=render-helper; api=<MD.xxx> -->
       ```
  3. **共享样式依赖**（可选）
     - 适用于：某个页面区块主要依赖 `shared/components.css` 中已有共享类完成样式，且 reviewer 需要快速识别共享依赖时
     - 格式：
       ```html
       <!-- SHARED_BLOCK: <name>; source=shared/components.css; type=style; classes=.classA,.classB,.classC -->
       ```
  - **颗粒度规则**：只按区块标注，不对单个 `.btn`、`.tag`、`.modal__body` 等共享 class 实例写碎片化注释；同一共享区块在单页中标一次即可。
  - **禁止事项**：不要把页面私有区块误标为 shared；不要只写 `shared` 不写 `source=<path>`；共享 render-helper 挂载点应尽量补 `api=<MD.xxx>`。

---

## 交互与数据契约（复刻强交互页面时的核心约束）

设计稿不是静态视觉还原，**可交互元素必须真能动**。每项已登记交互都必须实现并通过真实操作验证；无法实现时明确报告未交付，不得用注释、日志或无声死链冒充交互。

### 1. 交互契约（pre-flight 阶段登记）

从 PRD + 截图识别页面上每个**可交互元素**，登记为交互契约。每条契约写明：**触发元素 → 事件 → 预期可观测结果**。常见类型：Tab 切换、筛选/排序、搜索、分页/无限滚动、卡片 hover/展开、关注/点赞、下拉菜单、模态开关、表单提交。

### 2. 数据契约（强制数据驱动渲染）

- **mock 数据单独成文件**：`.mirror/design/data/<page-name>.data.js`，导出到 `window.<pageName>Data`。HTML 引入该文件
- **渲染必须由数据驱动**：列表/卡片/表格用 `data.map(...)` 渲染，**禁止把每条数据写死成静态 DOM**。否则筛选/排序/搜索/分页无法真生效
- **最小条数**：列表类至少 12 条，足以触发分页/滚动/筛选边界
- **真实感**：字段取值多样化，覆盖各状态（涨/跌、空状态、长文本截断、不同时间）

### 3. 交互实现规则（三选一，按优先级）

| 优先级 | 情况 | 做法 |
|--------|------|------|
| **A · 真实现** | 交互可在纯前端 + mock 数据内闭环（Tab、筛选、排序、搜索、分页、展开、模态） | **必须真实现**，数据驱动；每个 handler 内打一行 `console.log('[interaction] <契约名> fired', payload)` 便于验证确认触发 |
| **B · 注释占位** | 交互依赖真实后端/第三方（实时行情推送、真实下单、SSO 登录） | **禁止 `href="#"` / 空 handler 静默死链**。必须写注释说明：`<!-- INTERACTION-TODO: <契约名>; 触发=<元素>; 事件=<event>; 预期=<结果>; 未实现原因=<依赖后端/第三方>; 负责实现=coding agent -->`，并给一个可见的占位反馈（如 toast「演示环境不可用」）。注释末尾的 `负责实现=coding agent` 字段为固定值，标明该交互由下游 coding agent 在生产代码中接入真实后端实现，设计稿层不负责真实现 |
| **C · 禁止** | —— | 不允许 `href="#"`、`onclick="return false"`、空 `{}` handler 这类**无声假交互**。要么走 A，要么走 B 注释 |

> 关键判定：**每条交互契约在 HTML 中必须可追溯**——要么有真实现 + `console.log` 埋点，要么有 `INTERACTION-TODO` 注释。不允许契约登记了却在代码里查无此交互。

### 4. 交互验证（playwright-cli 确认触发）

交付前用 `playwright-cli` 对走 A 路线的交互逐条操作（click/input/scroll），**捕获 console 输出**，确认对应 `[interaction] <契约名> fired` 日志被打出 = 该交互真的接上了。走 B 路线的交互检查注释存在即可。深度行为正确性交给下游 coding + test，这里只保证「不是死链」。

---

## 处理大 HTML 参考资产

当参考资产里有**体积很大**（几百 KB、几千行）的 HTML，**不要整文件读进上下文**，先用脚本蒸馏成紧凑结构化大纲：

```bash
python3 scripts/extract-html2md.py <input.html> -o <output.md>
# 不带 -o 则输出到 stdout；stderr 会打印压缩比与统计
```

输出包含：去重调色板（按频率）、字体规格、资产 URL 清单（分类编号）、语义骨架（角色 + 相对布局 + 内联文案）。通常能砍掉约 90% 体积，保留设计需要的全部信息。之后读蒸馏后的 `.md`，再进入正常流程（提取真实文案/数据、资产、配色、组件结构）。

**两类输入都支持**，脚本会自动选路：

1. **原子类 / 绝对定位 dump** —— 视觉属性全写在 class 里（Tailwind `text-[16px]`、`w-[..px]`、`bg-[url(..)]`），如 Figma/Kamis 导出（`htmls/111.html`）。主路径从 class 提取。
2. **手写 / 语义 HTML** —— 颜色字体写在 `<style>` 块或 inline style、资产在 `<img src>`/CSS `url(..)`、用 `.card` 这类命名类，可直接在浏览器打开（如 `htmls/index.html`）。脚本第二路径（`harvest_css_and_markup`）从 CSS 文本与标记里恢复调色板/字体/资产，相对布局页也能跑出完整报告。

两种情况下 `<style>`/`<script>` 内容都不会被当作页面文案泄漏，语义骨架始终产出。**判断是否使用本脚本看「体积」而非输入类型**：小文件直接 Read 即可，大文件（不论原子类还是语义）都先蒸馏。

---

## 工作流程

### Mode A · 新建页面

1. **理解需求 + 读懂场景**
   - 读完整 PRD 或用户描述，确认能列出每个 UI 元素
   - **先产出一句 Design Read**：判断这是什么页、给谁看、什么气质、视觉密度多高（写进下一步 pre-flight 的「设计定位」）。不要跳过这步直接进默认审美——读懂场景是品味的第一步
   - 若参考资产含大体积 HTML（几百 KB，不论原子类 dump 还是语义 HTML），先用 `scripts/extract-html2md.py` 蒸馏再读（见「处理大 HTML 参考资产」）
   - 如有不明确的地方，一次性问完（使用 question tool）
   - 🛑 **检查点1**：问题发出后等用户答完再动手

2. **Pre-flight 声明**（开工前必须输出）
   ```
   <pre-flight>
   Mode:         A: Generate
   设计定位:      [一句话读懂场景：把它读作「<页面类型> 给 <用户角色> 用，气质偏 <专业克制/信息密集/轻量引导/...>，视觉密度 <高/中/低>，遵循 <DS 名称>」]
   页面类型:      [dashboard | detail | list | landing | form | modal | other]
   布局:          [单栏 | 多栏比例]
   需加载的规范:   [列出需要读取的 design system 文件]
   组件清单:      [列出本页涉及的所有组件]
   交互清单:      [逐条登记交互契约：触发元素 → 事件 → 预期结果；并标 A(真实现)/B(注释占位)]
   数据契约:      [mock 数据文件路径 + 各列表最小条数 + 哪些列表需数据驱动]
   待确认问题:    [list or "none"]
   </pre-flight>
   ```

3. **加载 design system** — 按 pre-flight 声明读取 tokens、组件、规则文件

4. **Junior pass** — 写出 HTML 骨架 + placeholder + 注释说明设计意图
   - 此阶段**只写设计意图 / placeholder 注释**（组件多为占位，尚无落地实现，无锚点）。**不写 DS 溯源注释**——溯源注释一律留到 Full pass，与组件实现同步产出
   - 🛑 **检查点2**：show 给用户，等确认方向再填充
   - **此时自动 git commit**：`design: scaffold — <页面名>`

5. **Full pass** — 填充组件实现，应用 design system tokens
   - 所有颜色/间距/圆角/字体用 CSS 变量引用，禁止硬编码
   - **先建 mock 数据文件** `.mirror/design/data/<page-name>.data.js`，列表/卡片/表格一律**数据驱动渲染**（`data.map(...)`），不写死静态 DOM
   - **为每个设计系统组件添加溯源注释**（`<!-- DS: 组件名 -->`），与组件实现同步写。按颗粒度规则：每个组件**首次实例**标注一次即可。覆盖 pre-flight 声明中列出的全部组件
   - **运行覆盖校验**（机械保证全覆盖，把「承诺」变成「可验证」）：
     ```bash
     python3 scripts/check-ds-annotations.py <页面.html> --components "<pre-flight 组件清单逗号分隔>"
     ```
     退出码非 0（有缺失或多余）→ 补全注释 / 核对组件名后重跑，直到通过
   - **此时自动 git commit**：`design: implement — <页面名>`

6. **Interaction pass** — 落地交互契约（见「交互与数据契约」）
   - 逐条实现 pre-flight `交互清单` 中标 **A** 的交互：数据驱动、真生效、handler 内打 `console.log('[interaction] <契约名> fired', payload)`
   - 标 **B** 的交互：写 `<!-- INTERACTION-TODO: ... -->` 注释 + 可见占位反馈，**禁止无声死链**
   - 自查：HTML 内不得残留 `href="#"`、`onclick="return false"`、空 handler；每条契约要么有 `[interaction]` 埋点，要么有 `INTERACTION-TODO` 注释
   - **此时自动 git commit**：`design: interactions — <页面名>`

7. **Design System 合规自检**（交付前必做）

   逐项检查生成的 HTML 是否遵循 design system 规范：

   | 检查项 | 检查内容 | 不合规示例 |
   |--------|---------|-----------|
   | 颜色 | 所有色值是否使用 design system CSS 变量 | 硬编码 `#333` 应为 `var(--color-text-primary)` |
   | 间距 | margin/padding 是否使用 spacing token | `padding: 13px` 应为 `var(--spacing-md)` |
   | 圆角 | border-radius 是否使用 radius token | `border-radius: 7px` 应为 `var(--radius-sm)` |
   | 字体 | font-family/size/weight 是否符合 typography token | — |
   | 组件 | 是否使用 design system 定义的组件 pattern | 自定义按钮应改用标准 Button 组件 |
   | 布局 | 页面结构是否符合 layout 规则 | — |
   | 图标 | 是否使用 design system 指定的图标方案 | Emoji 应替换为规范图标或 placeholder |
   | 组件注释 | 运行 `scripts/check-ds-annotations.py` 校验通过（pre-flight 清单中每个组件至少有一次 `<!-- DS: 组件名 -->` 注释，首次实例标注即可） | 使用了 Card 组件但缺少溯源注释 |
   | **AI-Tell 扫描** | 跑「AI-Tell 硬门禁」的 grep（渐变/毛玻璃/左 border accent/纯黑纯白）+ 人工扫 emoji 与 `href="#"`。每处命中要么举证是 DS 要求，要么改掉 | 给普通卡片加了 `backdrop-filter`；用了紫色 `linear-gradient` |

   - 发现不合规项 → 修正后再进入下一步
   - 修正内容随 `design: implement` commit 一起提交

8. **验证** — Playwright 截图 + 控制台错误检查 + **交互触发验证**
   - 浏览器打开确认无白屏、控制台无 JS 报错
   - **交互验证**：用 `playwright-cli` 对每条 A 类交互执行操作（click/input/scroll），捕获 console，确认对应 `[interaction] <契约名> fired` 日志被打出；B 类交互确认 `INTERACTION-TODO` 注释存在。详见 `references/verification.md`
   - 🛑 **检查点3**：交付前浏览器打开确认无 bug

### Mode B · 基于 HTML 修改

1. **归档源文件** — 如果用户提供的 HTML 文件不在 `.mirror/design/` 目录下，先将其复制到该目录，后续所有修改在副本上进行。文件名保持原名，如有冲突则加后缀 `-v2`、`-v3`。

2. **Pre-edit 审计** — 完整读取现有文件，记录：布局结构、组件列表、交互功能、数据字段
   - 若文件体积很大（几百 KB，不论原子类 dump 还是语义 HTML），先用 `scripts/extract-html2md.py` 蒸馏出结构概览辅助审计（见「处理大 HTML 参考资产」），但**修改仍在原 HTML 上进行**，不要改蒸馏出的 md

3. **Design System 合规检查** — 加载业务方 design system skill，将现有 HTML 逐项比对，输出不合规清单：

   | 检查项 | 检查内容 | 示例 |
   |--------|---------|------|
   | 颜色 | 是否使用 design system 定义的色值/CSS 变量 | 硬编码 `#333` 应改为 `var(--color-text-primary)` |
   | 间距 | margin/padding 是否符合 spacing token | `padding: 13px` 应改为 `var(--spacing-md)` |
   | 圆角 | border-radius 是否使用 radius token | `border-radius: 7px` 应改为 `var(--radius-sm)` |
   | 字体 | font-family / font-size / font-weight 是否符合 typography token | — |
   | 组件 | 是否使用 design system 定义的组件 pattern | 自定义按钮应改用标准 Button 组件 |
   | 布局 | 页面结构是否符合 layout 规则 | — |
   | 图标 | 是否使用 design system 指定的图标方案 | Emoji 应替换为规范图标或 placeholder |

   输出格式：
   | 位置 | 当前写法 | 不合规原因 | 建议修正 |
   |------|---------|-----------|---------|

   - 如果不合规项较多，先输出合规检查报告给用户，**等用户确认修正范围后再动手**
   - 用户可选择：全部修正 / 仅修正指定项 / 跳过合规修正只做功能变更

4. **分类每项变更**：

5. **修改后验证** — 审计清单逐项确认：功能完整、数据无丢失、样式全部用 semantic token；新增/改动的组件按颗粒度规则补 `<!-- DS: 组件名 -->` 注释（首次实例标注即可），并运行 `scripts/check-ds-annotations.py` 校验覆盖

6. **输出修改报告**：

7. **自动 git commit**：`design: revise — <描述>`

### Mode C · 调整/添加组件

同 Mode B 流程，但通常只涉及局部修改，无需全文件审计。定位目标区域 → 修改 → 验证该区域一致性。

---

## 设计原则

### 1. Placeholder > 烂实现

没图标就留灰色方块+文字标签，没数据就直接填 `--` 占位（不写注释）。**一个诚实的 placeholder 比一个拙劣的尝试好 10 倍**。

### 2. 遵循 design system，不发明

所有视觉属性从业务方 design system 取值。不发明新 token、新颜色、新间距、新组件变体。Design system 没覆盖的，用最接近的 pattern 并标注 gap。

### 3. AI-Tell 硬门禁（默认禁止，仅 DS 明确要求才可用）

以下是 LLM 生成页面最典型的"AI 味"签名。**默认一律禁止**；每一条只有在「DS 明确定义了对应 token/pattern」时才可用，且用了就要能举证。这不是软建议，是交付前会被机械扫描的硬门禁。

| AI-Tell | 默认判定 | 唯一例外 | 应采用 |
|---------|---------|---------|--------|
| 紫色/彩虹/mesh 全屏渐变 | **禁止** | DS 定义了渐变 token | DS 色值；实在要渐变只做单色系、极克制点缀（如 button hover） |
| 透明毛玻璃 `backdrop-filter` | **禁止**给普通卡片/section 加 | DS 有 glass token 且用于 overlay/modal | DS 定义的容器背景色 |
| 圆角卡片 + 左 border accent 色 | **禁止** | DS 组件本身就是这样 | 用字重/背景对比/分隔线做强调 |
| Emoji 作图标/装饰 | **禁止** | 品牌本身用 emoji | DS 图标方案或灰块 placeholder |
| SVG 画人/物/场景/插画 | **禁止** | 用户明确要求 | 真实素材，或"插画位 W×H"灰块 |
| 编造 stats/quote 装饰 | **禁止** | 有真数据 | 留白，或问用户要真内容 |
| 每个标题都配 icon | **禁止** | icon 有真信息价值 | 只在必要处用 |
| 霓虹/外发光、纯黑 `#000`/纯白 `#fff` | **禁止** | DS 定义 | DS 中性色（off-black/off-white） |
| `href="#"` / 空 onclick 死链 | **禁止** | —— | 真实现（A）或 `INTERACTION-TODO` 注释（B） |
| 列表写死成静态 DOM | **禁止** | —— | mock 数据 + `data.map(...)` 数据驱动 |

**机械自检（交付前必跑，见第 7 步）**：用 grep 扫描高风险签名，命中就必须逐个举证"这是 DS 要求的"，否则改掉：

```bash
grep -nE 'linear-gradient|radial-gradient|backdrop-filter|border-left:.*solid|#000\b|#fff\b|#ffffff\b|#000000\b' <页面.html>
# 再人工扫一遍 emoji 与 href="#"
```

**判断标准**：每个视觉元素都必须 earn its place。视觉表现只能来自 DS token；DS 之外的"好看想法"默认是 AI slop。每个可交互元素要么真能动，要么注释写清为何不能动。

### 4. 先展示假设，再执行

不要闷头做完才 show。先写 assumptions + placeholders 给用户看，确认方向后再填充实现。理解错了早改比晚改便宜 100 倍。

---

## 技术约束

### CDN 规则

**遵循 `references/agent-rules.md` 的 RULE-01**：依赖必须在实现前确定为一个项目自有文件、已安装包或一个明确授权的 URL。运行时不得切换到另一来源。

### 字体加载规则

**`references/agent-rules.md` 的 CDN 约束同样适用于字体资源。** Google Fonts（`fonts.googleapis.com` / `fonts.gstatic.com`）属于境外服务，在国内网络环境下会超时，**不得引入**。

design system 要求的字体必须在实现前解析为一个可验证的项目自有字体文件或明确声明的系统字体栈。无法取得规范字体时明确报告资源缺失，不得在运行时更换字体来源或保留一套未实际使用的字体声明。

### HTML 写入策略

使用项目现有生成器或文件编辑工具一次生成完整 HTML（`<!DOCTYPE>`、`<head>`、`<body>`、全部 section 和脚本），随后解析并在真实页面中验证。不得发布带 `MAIN_BODY`、`SECTION_ANCHOR` 或交互占位的半成品。

**通用纪律**：

- mock 数据 > 200 行 → 单独写到 `.mirror/design/data/<page>.data.js`，HTML `<script src>` 引入，不内联
- **禁止 bash heredoc `cat >> file` 追加** —— 容易吞特殊字符（反引号、`$`、转义序列），且不留 Edit 历史。统一用 Write / Edit 工具
- 交付前 `grep -c SECTION_ANCHOR <file>` 应为 0；非 0 即为半成品

### React + Babel 四条红线

1. **styles 对象必须唯一命名** — 写 `const homeStyles = {...}` 不写 `const styles = {...}`，否则多组件冲突
2. **scope 不共享** — 多个 `<script type="text/babel">` 间用 `Object.assign(window, {...})` 导出
3. **不用 scrollIntoView** — 会搞坏容器滚动，用 `container.scrollTop` 替代
4. **禁止外部库直接操作 React 管理的 DOM** — 如 `lucide.createIcons()`、jQuery `.html()` 等会替换/删除节点，导致虚拟 DOM 与真实 DOM 不一致而白屏崩溃。改为读数据让 React 渲染，或用 `ref` 隔离

详见 `references/react-setup.md`。

---

## Git 版本管理规范

**按设计阶段自动 commit**，一个任务通常 3-5 个 commit，log 可读：

| 阶段 | Commit message 格式 | 触发时机 |
|------|---------------------|---------|
| 骨架搭建 | `design: scaffold — <页面名>` | Junior pass 完成，placeholder 就绪 |
| 组件实现 | `design: implement — <页面名>` | Full pass 第一轮完成 |
| 交互落地 | `design: interactions — <页面名>` | Interaction pass 完成 |
| 用户反馈修改 | `design: revise — <简述修改>` | 每轮反馈修改后 |
| 最终交付 | `design: finalize — <页面名>` | 验证通过，准备交付 |

**规则**：
- 每个 commit 是一个有意义的设计快照，设计师使用 `git log` 和 `git diff` 审查历史；恢复内容必须遵守宿主仓库的精确文件恢复规则
- commit 前确保 HTML 可正常打开（不 commit 半成品语法错误）
- 不要把多个页面的修改混在一个 commit 里

---

## 验证

交付前执行：

1. **浏览器打开** — 确认页面正常渲染，无白屏
2. **控制台检查** — 无 JS 报错
3. **交互触发验证** — 用 `playwright-cli` 对每条 A 类交互操作一次并查 `[interaction]` 日志（详见「交互与数据契约」与 `references/verification.md`）

**截图（可选，非必需）**：用 `playwright-cli` skill 截图，统一走 `playwright-cli`，不直接调 `npx playwright`。详见 `references/verification.md`。

---

## References

| 需要时 | 读 |
|--------|-----|
| 仓库强制规范、CDN 规则 | `references/agent-rules.md` |
| 开工前问问题、模板 | `references/workflow.md` |
| 设计品味方法论（层级/留白/克制/决策速查） | `references/taste-principles.md` |
| 反 AI slop、内容规范 | `references/content-guidelines.md` |
| React+Babel 技术规范 | `references/react-setup.md` |
| 验证方法 | `references/verification.md` |
| 世界地图模块参考 | `references/world-map-module.md` |
| DS 溯源注释覆盖校验 | `scripts/check-ds-annotations.py` |
| 大 HTML 参考资产蒸馏 | `scripts/extract-html2md.py` |
