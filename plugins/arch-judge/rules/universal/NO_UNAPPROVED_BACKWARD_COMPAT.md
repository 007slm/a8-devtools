---
id: UNIVERSAL_NO_UNAPPROVED_BACKWARD_COMPAT
name: 零擅自向后兼容红线
category: lifecycle_and_evolution
severity: BLOCKER
triggers:
  syntax_tokens:
    - "@Deprecated"
    - "deprecated"
    - "obsolete"
    - "Legacy"
    - "Compat"
    - "Transition"
    - "fallback"
  diff_actions:
    - "MODIFY_PUBLIC_API"
    - "DELETE_METHOD"
---

# 规则意图
本项目与通用高可靠后端系统秉持极简演化哲学，严禁任何未经显式审批的向后兼容逻辑。包括为照顾旧版本、历史客户端而私自保留的废弃接口、过渡层、过渡方法、双轨分支或临时兜底。

# 违规判定依据 (Violation Criteria)
1. 在代码中保留了退役端点、历史 DTO 或桥接 Service，且未在提交信息或文档中提供显式 ADR 审批凭据；
2. 为避免破坏旧客户端，在核心业务方法中加入“若为空则回退到旧逻辑”的静默双轨判断；
3. 将应当物理删除的旧模块/旧类改为仅标记 `@Deprecated` 并继续保留在生产源码中。

# 合法豁免标准 (Exemptions)
1. 目标元素被显式标注了审批注解（如 `@ApprovedCompatibility`），且明确指明了审批人、原因及关联 Issue；
2. 属于语言标准库或通用驱动规范强制要求实现的接口契约（如 JDBC API 或 gRPC 自动生成的基类桩代码）。
