# 仓库强制规范：CDN 与 HTML 通用约定

生成或修改 HTML 设计稿时须遵守以下规则。

## RULE-01 · CDN 链接须优先使用国内源

**背景**：Agent 生成的 HTML 页面通过 CDN 引入 React、React-DOM、Babel 等第三方库。
若使用境外 CDN（如 `unpkg.com`、`cdnjs.cloudflare.com`），在国内网络环境下极易超时，
导致页面白屏或无法预览。

**规则**：生成 HTML 前，为每个依赖确定一个项目自有文件、已安装包或任务明确授权的 URL，并在产物中只使用该来源。下表用于设计时选择，不是运行时多源加载顺序；选定来源不可用时明确失败。

### 国内 CDN 优先级与常用库地址

> 优先级：BootCDN ≥ jsDelivr（国内节点） > 其他

| 库 | 推荐版本 | BootCDN（首选） | jsDelivr（备选） |
|---|---|---|---|
| React | 18.x | `https://cdn.bootcdn.net/ajax/libs/react/18.3.1/umd/react.production.min.js` | `https://cdn.jsdelivr.net/npm/react@18/umd/react.production.min.js` |
| React-DOM | 18.x | `https://cdn.bootcdn.net/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js` | `https://cdn.jsdelivr.net/npm/react-dom@18/umd/react-dom.production.min.js` |
| React（dev） | 18.x | `https://cdn.bootcdn.net/ajax/libs/react/18.3.1/umd/react.development.js` | `https://cdn.jsdelivr.net/npm/react@18/umd/react.development.js` |
| React-DOM（dev） | 18.x | `https://cdn.bootcdn.net/ajax/libs/react-dom/18.3.1/umd/react-dom.development.js` | `https://cdn.jsdelivr.net/npm/react-dom@18/umd/react-dom.development.js` |
| Babel Standalone | 7.x | `https://cdn.bootcdn.net/ajax/libs/babel-standalone/7.23.10/babel.min.js` | `https://cdn.jsdelivr.net/npm/@babel/standalone@7/babel.min.js` |
| Vue 3 | 3.x | `https://cdn.bootcdn.net/ajax/libs/vue/3.4.21/vue.global.prod.min.js` | `https://cdn.jsdelivr.net/npm/vue@3/dist/vue.global.prod.js` |
| Vue 2 | 2.x | `https://cdn.bootcdn.net/ajax/libs/vue/2.7.16/vue.min.js` | `https://cdn.jsdelivr.net/npm/vue@2/dist/vue.min.js` |
| Axios | 1.x | `https://cdn.bootcdn.net/ajax/libs/axios/1.6.8/axios.min.js` | `https://cdn.jsdelivr.net/npm/axios@1/dist/axios.min.js` |
| Lodash | 4.x | `https://cdn.bootcdn.net/ajax/libs/lodash.js/4.17.21/lodash.min.js` | `https://cdn.jsdelivr.net/npm/lodash@4/lodash.min.js` |
| Day.js | 1.x | `https://cdn.bootcdn.net/ajax/libs/dayjs/1.11.10/dayjs.min.js` | `https://cdn.jsdelivr.net/npm/dayjs@1/dayjs.min.js` |
| ECharts | 5.x | `https://cdn.bootcdn.net/ajax/libs/echarts/5.4.3/echarts.min.js` | `https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js` |
| Ant Design | 5.x | — | `https://cdn.jsdelivr.net/npm/antd@5/dist/antd.min.js` |

### 境外 CDN（仅在任务事先明确授权时选择）

| 域名 | 说明 |
|---|---|
| `unpkg.com` | npm 包直连，境外，速度慢 |
| `cdnjs.cloudflare.com` | Cloudflare CDN，境外 |
| `esm.sh` | ESM 格式，境外 |

### 示例

**正确写法**：

```html
<!-- React 18 + Babel — 优先 BootCDN -->
<script src="https://cdn.bootcdn.net/ajax/libs/react/18.3.1/umd/react.development.js"></script>
<script src="https://cdn.bootcdn.net/ajax/libs/react-dom/18.3.1/umd/react-dom.development.js"></script>
<script src="https://cdn.bootcdn.net/ajax/libs/babel-standalone/7.23.10/babel.min.js"></script>
```

**错误写法（禁止）**：

```html
<!-- 禁止直接使用境外 CDN，国内访问超时 -->
<script src="https://unpkg.com/react@18/umd/react.development.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.development.js"></script>
```

### 查询国内是否有对应资源的方法

- BootCDN 检索：`https://www.bootcdn.cn/` 搜索库名
- jsDelivr 检索：`https://cdn.jsdelivr.net/npm/<package-name>@<version>/`

## HTML 通用约定

- 生成的 HTML 文件为**单文件**，所有样式和脚本内联或通过 CDN 引入，不依赖本地构建工具。
- 文件编码统一使用 **UTF-8**，HTML 须声明 `<meta charset="UTF-8">`。
- 页面须包含 `<meta name="viewport" content="width=device-width, initial-scale=1.0">`。
- 不引入未经使用的第三方库，保持 HTML 文件精简。
