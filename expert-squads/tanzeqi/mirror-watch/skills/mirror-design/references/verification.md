# Verification：输出验证流程

## 验证清单

每次产出 HTML 后，按这个清单做一遍：

### 1. 浏览器渲染检查（必做）

最基础：**HTML 能不能打开**？

```bash
open -a "Google Chrome" "/path/to/your/design.html"
```

确认页面正常渲染，无白屏。

### 2. 控制台错误检查（必做）

打开 DevTools Console，确认无 JS 报错。常见问题：

- React/Babel CDN 加载超时 → 检查网络或换 CDN 源
- `const styles` 命名冲突 → 改唯一前缀命名
- 跨文件组件未 export → 加 `Object.assign(window, {...})`
- JSX 语法错误 → 换 `babel.js` 非压缩版看报错

### 3. 交互触发验证（强交互页面必做）

目标：确认设计稿里**不是假交互/死链**。不验证深度行为正确性（那交给下游 coding + test），只确认每条 A 类交互契约「点了真有反应」。

做法依赖 `playwright-cli` skill，对每条标 A 的交互契约：

1. 打开页面，开启 console 监听
2. 执行该交互的操作（`click` / `fill` / `scroll` / `hover`）
3. 在捕获的 console 输出里查找对应 `[interaction] <契约名> fired` 日志
   - 找到 → 该交互真的接上了 ✅
   - 没找到 → 死链或 handler 没绑定 ❌，回 Interaction pass 修
4. 每项交互都必须验证操作前后的可观察页面状态、键盘/焦点路径和预期结果；注释或日志不能作为交互完成证据

判定通过 = 所有交互契约均产生预期可观察状态变化、键盘/焦点路径正确、截图符合目标且全程无 console error。

> **仅跑一遍**：playwright 交互验证对每个页面只执行一次，逐条记录结果（pass/fail）。相同校验不重复执行；若被多个环节调用，下游应直接采信已有结果，仅在 fail/缺失时重做。

### 4. 截图（可选，非必需）

统一通过 `playwright-cli` skill 截图，**不直接调 `npx playwright`**。基础用法：单视口截图 / 多视口（响应式）截图，文件输出到指定路径。具体命令以 `playwright-cli` skill 文档为准。截图非交付必需项，缺失不阻塞交付。

---

## 验证出错时

### 页面白屏

控制台一定有错。按顺序检查：

1. CDN script 是否加载成功（Network tab 看 404/timeout）
2. `const styles = {...}` 命名冲突
3. 跨文件的组件有没有 export 到 `window`
4. JSX 语法错误（babel.min.js 不报错，换 babel.js 非压缩版）

### 字体不对

- 检查 `@font-face` 的 url 是否可访问
- 检查声明的唯一字体资源或显式系统字体栈
- 字体资源加载失败即判定该视觉验收未通过，不得切换字体来源

### 布局错位

- 检查 `box-sizing: border-box` 是否全局应用
- 检查 `* { margin: 0; padding: 0; }` reset
- Chrome DevTools 里打开 gridlines 看实际布局

---

## 验证原则

**永远要自己过一遍**。AI 写代码时经常出现：

- 看起来对但 interaction 有 bug
- 静态截图好但 scroll 时错位
- 宽屏好看但窄屏崩

**最后 1 分钟的验证可以省 1 小时的返工**。
