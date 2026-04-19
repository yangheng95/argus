# 硬性原则

## 规则

1. 不允许任何 fallback 和兼容逻辑。fallback 会累计 bug、制造级联问题，并使问题不可定位、不可修复。

2. 这是个未发布项目，禁止故意或者无意打补丁兼容旧，留下任何技术债。所有的修复必须同步删除旧代码并测试，保证所有的代码都使用新范式

3. 采用无人值守、自我迭代的方式推进。不达到目标或验收指标，就继续重复执行、修复、复测。

4. 先思考本质问题。任何掩盖问题的补丁都不应视为合格修复。

5. 禁止无脑使用 git 回退修改。不要通过粗暴回退破坏未提交代码或掩盖真实问题。

6. 如果工具本身异常，先修工具。例如 git、rg、测试命令、运行器不可用时，应主动修复工具链，再继续任务。

7. Opencorvus自己验收通过后，你仍然必须复核交付物。二次 review 不通过，不算完成。

8. 不要长时间闷头执行后才一次性暴露大量低级问题。应进行频繁自检与阶段性校验，尽早暴露问题、尽早纠偏。

9. 如果用户的问题定义浮于表面，或当前路径无法根本解决问题，必须主动警示并重定向。不要迎合表面要求，更不要掩盖真正问题。

10. 在必要时查看硬盘上的方案并进行 recall。当改动涉及已有设计决策、架构约束或历史方案时，应先查看相关记录再修改。

11. 如果发现死代码、无意义代码、过时代码或废弃逻辑，应先向用户说明并询问是否删除。

12. 禁止任何"最简单的修复"。禁止任何关键字匹配规则。

13. 禁止 headless overlay benchmark

14. 禁止迁移数据库，直接reset DB，按新范式重建DB

## Debug

- DB 位置与打开方式: C:/Users/[hengu/chuan]/.local/share/opencorvus/opencorvus.db，必须
  bun:sqlite + readonly: true（WAL 模式下防抢锁），废弃 AppData/Local 下那个空文件，不用 sqlite3 CLI
- 嵌入式 server 端口定位: 默认 7878（`packages/opencorvus/server-defaults.json`），被占就 +1
  扫到 +32，再兜底 OS 随机。用 powershell Get-CimInstance 反查命令行可拿到实际端口
- 关键表语义: engine_task.metadata._workflow.taskSteps 是权威阶段状态；engine_run/
  engine_goal_run/engine_goal/engine_plan_version/engine_spec_snapshot 是 finalize
  后产物；protocol_event 是全量事件流；decision_log/scratchpad 是 sub-agent
  临时笔记；engine_interaction_request 是澄清 gate
- 四个查询模板: 任务快照 / 最近 60s 活跃度 / workflow 轨迹 / 某 tool 的 callID
  生命周期
- 排查纪律三条: 必须看 protocol_event.emitted_at 才能断活跃；同 callID 反复重跑是
  session 重建不是幂等问题；register_* 只在进程内存，finalize
  之前中断全作废；绝不手工改 DB
