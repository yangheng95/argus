# React + Babel 项目规范

用 HTML + React + Babel 做设计稿时必须遵守的技术规范。

## CDN 引入（遵循 agent-rules.md）

优先使用国内 CDN，在 HTML 的 `<head>` 里引入：

```html
<!-- React 18 + Babel — 优先 BootCDN -->
<script src="https://cdn.bootcdn.net/ajax/libs/react/18.3.1/umd/react.development.js"></script>
<script src="https://cdn.bootcdn.net/ajax/libs/react-dom/18.3.1/umd/react-dom.development.js"></script>
<script src="https://cdn.bootcdn.net/ajax/libs/babel-standalone/7.23.10/babel.min.js"></script>
```

**禁止**使用 `unpkg.com`、`cdnjs.cloudflare.com` 等境外 CDN（国内访问超时白屏）。

完整 CDN 地址表见 `agent-rules.md`。

---

## 四条不可违反的规矩

### 规矩1：styles 对象必须用唯一命名

**错误**（多组件时必炸）：
```jsx
// home.jsx
const styles = { button: {...}, card: {...} };

// settings.jsx  ← 同名覆盖！
const styles = { container: {...}, header: {...} };
```

**正确**：每个组件文件的 styles 用唯一前缀。

```jsx
// home.jsx
const homeStyles = { button: {...}, card: {...} };

// settings.jsx
const settingsStyles = { container: {...}, header: {...} };
```

或直接用 inline styles（小组件推荐）。

### 规矩2：Scope 不共享，需手动 export

每个 `<script type="text/babel">` 被 Babel 独立编译，scope 不通。跨文件引用组件需要手动导出到 window：

```jsx
// components.jsx 末尾
function Header(props) { ... }
function Card(props) { ... }

Object.assign(window, { Header, Card });
```

然后其他文件就能直接用 `<Header />` 和 `<Card />`。

### 规矩3：不要用 scrollIntoView

会把整个 HTML 容器往上推，搞坏布局。替代方案：

```js
container.scrollTop = targetElement.offsetTop;
```

### 规矩4：禁止外部库直接操作 React 管理的 DOM

React 通过虚拟 DOM 管理所有节点。如果外部库（如 `lucide.createIcons()`、jQuery `.html()`、D3 `.append()` 等）在 React 管理的 DOM 树上增删替换节点，会导致虚拟 DOM 与真实 DOM 不一致，触发 `removeChild` / `insertBefore` 等致命错误，页面白屏崩溃。

**错误**（必崩）：
```jsx
const Icon = ({ name }) => {
  useEffect(() => {
    lucide.createIcons(); // ← 把 <i> 替换成 <svg>，React 不知情
  }, []);
  return <i data-lucide={name}></i>;
};
```

**正确**：从库中读取数据，让 React 自己渲染 DOM。
```jsx
const Icon = ({ name, size = 20 }) => {
  const iconData = lucide.icons[name];
  if (!iconData) return <span style={{ width: size, height: size }} />;
  const [attrs, paths] = iconData;
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2"
      dangerouslySetInnerHTML={{ __html: paths }}
    />
  );
};
```

**原则**：第三方库只能「读数据」，DOM 渲染必须交给 React。如果确实需要外部库操控 DOM（如 ECharts），必须用 `ref` 指向一个 React 不管理的容器节点，隔离控制权。

---

## 典型 HTML 起手模板

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>页面名称</title>

  <!-- React + Babel — BootCDN -->
  <script src="https://cdn.bootcdn.net/ajax/libs/react/18.3.1/umd/react.development.js"></script>
  <script src="https://cdn.bootcdn.net/ajax/libs/react-dom/18.3.1/umd/react-dom.development.js"></script>
  <script src="https://cdn.bootcdn.net/ajax/libs/babel-standalone/7.23.10/babel.min.js"></script>

  <style>
    :root {
      /* 从 design system 注入 tokens */
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; width: 100%; }
    body { font-family: -apple-system, 'SF Pro Text', sans-serif; }
    #root { min-height: 100vh; }
  </style>
</head>
<body>
  <div id="root"></div>

  <script type="text/babel">
    const { useState, useEffect } = React;

    function App() {
      return (
        <div>
          {/* 页面内容 */}
        </div>
      );
    }

    const root = ReactDOM.createRoot(document.getElementById('root'));
    root.render(<App />);
  </script>
</body>
</html>
```

---

## 常见报错

| 报错 | 原因 | 解决 |
|------|------|------|
| `styles is not defined` | 多文件 styles 同名覆盖 | 改唯一命名 |
| `XXX is not defined` | 跨文件 scope 不通 | `Object.assign(window, {...})` |
| 白屏无报错 | JSX 语法错误 Babel 静默失败 | 换非压缩版 `babel.js` 看报错 |
| `createRoot is not a function` | React 版本不对 | 确认 react-dom@18 |
| `removeChild: The node to be removed is not a child of this node` | 外部库替换了 React 管理的 DOM 节点 | 改为读数据+React 渲染，或用 ref 隔离（见规矩4） |

---

## 大文件拆分

单文件超过 1000 行时拆分：

```
src/
├── page-name.html        # 主 HTML（入口）
├── components.jsx        # 组件（type="text/babel" 加载）
└── data.js              # mock 数据
```

HTML 里按顺序加载，每个 jsx 末尾 `Object.assign(window, {...})` 导出。

**注意**：拆分后需通过 HTTP server 预览（`python3 -m http.server`），`file://` 协议下浏览器会拦截外部 JS。
