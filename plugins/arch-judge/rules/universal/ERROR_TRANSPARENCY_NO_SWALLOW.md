---
id: UNIVERSAL_ERROR_TRANSPARENCY_NO_SWALLOW
name: 错误现场保留与零隐式吞异常红线
category: implementation_hygiene
severity: BLOCKER
triggers:
  syntax_tokens:
    - "catch ("
    - "catch("
    - "except:"
    - "except "
    - "recover()"
    - "System.out.print"
    - "System.err.print"
---

# 规则意图
如果调用没有预定的有界重试或降级策略，失败时应当明确返回错误并保留物理第一现场，严禁吞掉异常用默认空值继续，也不能在未处理时把任务标记为成功；严禁随手在生产代码中使用标准输出（System.out/err），必须统一使用日志门面。

# 违规判定依据 (Violation Criteria)
1. 在非入口逻辑中捕获异常后，既不抛出也不记录日志，仅返回 `null` 或假自愈默认值；
2. 捕获宽泛的 `Throwable` 或 `Exception` 并掩盖根本异常堆栈；
3. 直接调用标准输出打印日志，破坏生产脱敏日志体系。

# 合法豁免标准 (Exemptions)
1. 单元测试断言与独立命令行脚手架入口；
2. 架构规范明确规定的优雅降级链路，且具备完整的监控指标与降级日志埋点。
