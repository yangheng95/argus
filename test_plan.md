 测试总结：OpenCorvus 端到端集成测试 — "Slack指挥开发坦克大战"
  测试目标
  
  通过 Slack API 扮演开发者，向 OpenCorvus 发送自然语言指令，OpenCorvus 回复， 自主调度 Claude Code
  终端完成一个完整项目（经典FC坦克大战，HTML5+Canvas+JS），验证全链路闭环。

  测试链路

  开发者(我) --Slack API--> OpenCorvus Slack Listener
      --> 意图解析 (Brain/Intelligence)
      --> 任务分解 (TaskDecomposer)
      --> 命令执行 (Hands/ControlEngine → Claude Code终端)
      --> 屏幕监控 (Eyes → 截图 → Brain视觉分析)
      --> 进度汇报 (Voice → Slack)
      --> 错误恢复 (5级递进策略)
      --> 交付确认 (截图+通知)

注意，你来发真实的slack消息，触发整个流程，完成一个实际的开发任务（坦克大战）。你来读取slack上的opencorvus回复，你来确保opencorvus行为正确，你来修复opencorvus的bug，你来管控迭代arugs框架设计，你来总结测试结果，你来评估opencorvus的表现，你来提出改进建议，你来执行改进，你来验证改进。
测试重点是**全链路集成**，而非单元测试。全程都是你来开发和测试，模拟真实用户交互，确保系统在实际使用场景下的可靠性和有效性。
CODING_DASHSCOPE_API_KEY=sk-sp-80785e87eb044f9e99f9167e7d11090a # Bailian Coding Plan API Key
MODEL=alibaba-cn/qwen3.5-plus

给截图加上坐标基准线，方便视觉分析和监控。

顺一下框架设计，有哪些不合理，过时的，冗余的，不专业的，缺陷，不符合专业软件工程哲学的地方？设计方案修复

逻辑分辨率和物理分辨率的bug，修复方案：引入统一的坐标转换模块，确保所有组件使用一致的坐标系统进行交互和监控。
截图坐标系铺满屏幕
opencode的遗留删除，例如plan系统
opencorvus的记忆系统测试
打包测试opencorvus-e2e-smoke
窗口绑定bug，聚焦测试
goal目标设计
vision分析采用独立agent，不混入主要信息流，避免干扰主流程的决策和执行。
monitor和session agent合并
删除slack回复用户的图片，这个logo图片没有什么意义，反而占用资源和带宽，增加不必要的复杂度。
popup修复测试
