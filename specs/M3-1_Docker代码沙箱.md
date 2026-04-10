# AimeCode M3-1 · Docker 代码沙箱

> **自包含文档**：一个 AI 模型只读这一个文件，就能将 M1-5 的 Pyodide 沙箱升级为 Docker 容器级隔离。
> **前置条件**：M1-5（Pyodide 沙箱，IExecutorService 接口已定义）+ M1-1（API 框架）已完成。
> **包含**：Docker 沙箱镜像、容器生命周期管理、stdout/stderr/图表捕获、资源限制、超时控制、安全隔离。
> **不包含**：Pyodide 降级（保留作为 Docker 不可用时的开发模式）、R/SQL 执行、GPU 支持。

---

## 1. 目标与验收标准

### 1.1 里程碑目标

将代码执行从浏览器 WASM (Pyodide) 升级为 Docker 容器隔离，支持完整 CPython 3.11 生态（pip 包任意安装），matplotlib 图表输出，文件 I/O 隔离。

### 1.2 验收标准

| # | 验收项 | 操作 | 预期结果 |
|---|---|---|---|
| V1 | 基础执行 | `print("hello")` | `status: 'ok'`, `stdout: 'hello\n'` |
| V2 | pandas + plotly | 执行含 `pd.DataFrame` + `fig.show()` 的代码 | charts 数组有 spec |
| V3 | matplotlib | 执行 `plt.savefig('/output/chart.png')` | charts 数组有 `imageDataUrl`（base64 PNG） |
| V4 | pip 安装 | `!pip install scipy && import scipy` | 安装成功并可 import |
| V5 | 超时 | `time.sleep(120)` | 30s 后 `status: 'timeout'` |
| V6 | 内存限制 | `[0]*10**9` | `status: 'error'`，stderr 含 OOM |
| V7 | 网络隔离 | `import requests; requests.get('http://example.com')` | 网络不可达，`status: 'error'` |
| V8 | 文件隔离 | `open('/etc/passwd')` | Permission denied |
| V9 | 容器清理 | 查看 `docker ps -a` | 执行完成后容器自动删除 |
| V10 | 并发执行 | 同时提交 5 个代码执行请求 | 全部返回结果，无死锁 |

---

## 2. 架构

```
┌─────────────────────────────────────────────────────────┐
│  AimeCode API Server                                     │
│                                                          │
│  POST /api/execute                                       │
│       │                                                  │
│       ▼                                                  │
│  DockerExecutorService                                   │
│       │                                                  │
│       ├─ docker create (aimecode-sandbox:latest)         │
│       ├─ docker cp (code.py → /workspace/code.py)       │
│       ├─ docker start                                    │
│       ├─ docker logs --follow (stdout/stderr)            │
│       ├─ docker cp (/output/* → host)                    │
│       └─ docker rm -f                                    │
└─────────────────────────────────────────────────────────┘

容器内部：
┌─────────────────────────────────────────────────────────┐
│  aimecode-sandbox:latest (Python 3.11-slim)              │
│                                                          │
│  /workspace/code.py        ← 用户代码                    │
│  /workspace/runner.py      ← 执行器（捕获输出+图表）     │
│  /output/                  ← 图表输出目录                 │
│  /output/charts.json       ← Plotly spec JSON            │
│  /output/*.png             ← matplotlib 图表             │
│                                                          │
│  限制：                                                   │
│  - CPU: 1 core                                           │
│  - Memory: 512MB                                          │
│  - Network: none                                          │
│  - PID limit: 100                                         │
│  - Timeout: 30s                                           │
│  - No privileged / no capabilities                        │
└─────────────────────────────────────────────────────────┘
```

---

## 3. Dockerfile

文件路径：`docker/sandbox/Dockerfile`

```dockerfile
FROM python:3.11-slim

# 预装常用金融分析包
RUN pip install --no-cache-dir \
    pandas==2.2.0 \
    numpy==1.26.4 \
    matplotlib==3.8.3 \
    plotly==5.19.0 \
    scipy==1.12.0 \
    scikit-learn==1.4.1 \
    statsmodels==0.14.1 \
    kaleido==0.2.1

# 创建工作目录和输出目录
RUN mkdir -p /workspace /output && \
    chmod 777 /workspace /output

# 复制执行器脚本
COPY runner.py /workspace/runner.py

# 非 root 用户
RUN useradd -m sandbox
USER sandbox

WORKDIR /workspace

ENTRYPOINT ["python", "/workspace/runner.py"]
```

---

## 4. Runner 脚本

文件路径：`docker/sandbox/runner.py`

```python
"""
AimeCode Sandbox Runner
- 执行用户代码
- 捕获 stdout/stderr
- 拦截 Plotly fig.show() 输出 JSON spec
- 拦截 matplotlib plt.show() 输出 PNG
"""
import sys
import os
import json
import io
import traceback

# ── Plotly 捕获 ──────────────────────────────────────────────
_charts = []

try:
    import plotly.io as pio
    import plotly.graph_objects as go

    def _capture_plotly_show(fig, *args, **kwargs):
        spec = json.loads(fig.to_json())
        chart_id = f"chart_{len(_charts)}"
        _charts.append({"id": chart_id, "spec": spec})

    pio.show = _capture_plotly_show
    go.Figure.show = lambda self, *a, **kw: _capture_plotly_show(self, *a, **kw)
except ImportError:
    pass

# ── Matplotlib 捕获 ──────────────────────────────────────────
try:
    import matplotlib
    matplotlib.use('Agg')  # 无头渲染
    import matplotlib.pyplot as plt

    _original_show = plt.show

    def _capture_mpl_show(*args, **kwargs):
        chart_id = f"chart_{len(_charts)}"
        png_path = f"/output/{chart_id}.png"
        plt.savefig(png_path, dpi=150, bbox_inches='tight',
                    facecolor='#1A1D23', edgecolor='none')
        plt.close('all')

        # 读取 PNG 转 base64
        import base64
        with open(png_path, 'rb') as f:
            b64 = base64.b64encode(f.read()).decode('utf-8')
        _charts.append({
            "id": chart_id,
            "spec": {},
            "imageDataUrl": f"data:image/png;base64,{b64}"
        })

    plt.show = _capture_mpl_show
except ImportError:
    pass

# ── 执行用户代码 ─────────────────────────────────────────────
def main():
    code_path = "/workspace/code.py"
    if not os.path.exists(code_path):
        print("Error: code.py not found", file=sys.stderr)
        sys.exit(1)

    with open(code_path, 'r') as f:
        code = f.read()

    try:
        exec(compile(code, 'user_code.py', 'exec'), {'__name__': '__main__'})
    except Exception:
        traceback.print_exc()
        # 不 sys.exit(1) — 让调用方通过 stderr 判断是否有错

    # 输出图表 JSON
    charts_path = "/output/charts.json"
    with open(charts_path, 'w') as f:
        json.dump(_charts, f)

if __name__ == '__main__':
    main()
```

---

## 5. DockerExecutorService

文件路径：`server/services/executor/docker-executor.ts`

```typescript
import { $ } from 'bun'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import type { ExecutionResult } from '@shared/types'

const IMAGE_NAME = 'aimecode-sandbox:latest'
const EXECUTION_TIMEOUT_MS = 30_000
const MEMORY_LIMIT = '512m'
const CPU_LIMIT = '1.0'
const PID_LIMIT = 100
const STAGING_DIR = '/tmp/aimecode-sandbox'

export class DockerExecutorService {
  private imageReady = false

  async ensureImage(): Promise<void> {
    if (this.imageReady) return

    // 检查镜像是否存在
    const check = await $`docker image inspect ${IMAGE_NAME} 2>/dev/null`.quiet()
    if (check.exitCode !== 0) {
      console.log('[Executor] Building sandbox image...')
      await $`docker build -t ${IMAGE_NAME} docker/sandbox/`
      console.log('[Executor] Sandbox image built')
    }
    this.imageReady = true
  }

  async execute(params: {
    code: string
    language: 'python' | 'sql' | 'r'
    sessionId: string
  }): Promise<ExecutionResult> {
    if (params.language !== 'python') {
      return {
        status: 'error',
        stdout: '',
        stderr: `Language '${params.language}' is not supported.`,
        charts: [],
        durationMs: 0,
      }
    }

    await this.ensureImage()

    const execId = crypto.randomUUID().slice(0, 8)
    const containerName = `aimecode-exec-${execId}`
    const stagingPath = join(STAGING_DIR, execId)
    const start = performance.now()

    try {
      // 1. 准备 staging 目录
      await mkdir(stagingPath, { recursive: true })
      await mkdir(join(stagingPath, 'output'), { recursive: true })
      await writeFile(join(stagingPath, 'code.py'), params.code, 'utf-8')

      // 2. 创建容器
      await $`docker create \
        --name ${containerName} \
        --memory ${MEMORY_LIMIT} \
        --cpus ${CPU_LIMIT} \
        --pids-limit ${PID_LIMIT} \
        --network none \
        --read-only \
        --tmpfs /tmp:rw,size=64m \
        --security-opt no-new-privileges \
        -v ${join(stagingPath, 'output')}:/output \
        ${IMAGE_NAME}`.quiet()

      // 3. 复制代码到容器
      await $`docker cp ${join(stagingPath, 'code.py')} ${containerName}:/workspace/code.py`.quiet()

      // 4. 启动容器并等待完成（带超时）
      const startPromise = $`docker start -a ${containerName}`.quiet()

      const timeoutPromise = new Promise<'timeout'>((resolve) =>
        setTimeout(() => resolve('timeout'), EXECUTION_TIMEOUT_MS)
      )

      const race = await Promise.race([
        startPromise.then(r => ({ type: 'done' as const, result: r })),
        timeoutPromise.then(t => ({ type: 'timeout' as const })),
      ])

      if (race.type === 'timeout') {
        await $`docker kill ${containerName}`.quiet().catch(() => {})
        return {
          status: 'timeout',
          stdout: '',
          stderr: `Execution timed out after ${EXECUTION_TIMEOUT_MS / 1000}s`,
          charts: [],
          durationMs: Math.round(performance.now() - start),
        }
      }

      // 5. 收集输出
      const logs = await $`docker logs ${containerName}`.quiet()
      const stdout = logs.stdout.toString()
      const stderr = logs.stderr.toString()

      // 6. 收集图表
      let charts: ExecutionResult['charts'] = []
      const chartsJsonPath = join(stagingPath, 'output', 'charts.json')
      if (existsSync(chartsJsonPath)) {
        const raw = await readFile(chartsJsonPath, 'utf-8')
        charts = JSON.parse(raw)
      }

      const status = stderr && !stdout ? 'error' : 'ok'

      return {
        status,
        stdout,
        stderr,
        charts,
        durationMs: Math.round(performance.now() - start),
      }
    } catch (err: any) {
      return {
        status: 'error',
        stdout: '',
        stderr: err.message || 'Docker execution failed',
        charts: [],
        durationMs: Math.round(performance.now() - start),
      }
    } finally {
      // 7. 清理
      await $`docker rm -f ${containerName}`.quiet().catch(() => {})
      await $`rm -rf ${stagingPath}`.quiet().catch(() => {})
    }
  }
}
```

---

## 6. 构建镜像命令

```bash
cd docker/sandbox
docker build -t aimecode-sandbox:latest .
```

---

## 7. 集成陷阱

| # | 问题 | 解决方案 |
|---|---|---|
| T1 | Docker Desktop 在 Windows/Mac 上运行 Linux 容器需要 WSL2/HyperKit | 文档注明前置要求；开发模式 fallback 到 Pyodide |
| T2 | `--network none` 阻止 `pip install` | 预装常用包在 Dockerfile 中；不支持运行时 pip |
| T3 | `--read-only` 阻止写 `/workspace` | 用 volume mount 挂载 `/output`；`/tmp` 用 tmpfs |
| T4 | matplotlib 暗色背景 | `runner.py` 中 `facecolor='#1A1D23'` |
| T5 | 并发执行时 container name 冲突 | 用 UUID 前缀 `aimecode-exec-{uuid[:8]}` |
| T6 | 超时后容器残留 | `finally` 块中 `docker rm -f`；定期 cron 清理 `docker ps -a -f name=aimecode-exec` |
| T7 | `docker cp` 在 Windows 路径有反斜杠问题 | 用 `path.join()` + forward slash |
| T8 | 大输出（>1MB stdout）阻塞 | `docker logs` 有流式输出，可截断 |
