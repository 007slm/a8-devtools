---
id: UNIVERSAL_PURE_CLIENT_ISOLATION
name: 客户端 SDK 纯净隔离红线
category: topology_and_boundaries
severity: BLOCKER
triggers:
  syntax_tokens:
    - "import org.springframework"
    - "import io.netty"
    - "import com.zaxxer.hikari"
    - "import jakarta.servlet"
    - "import javax.servlet"
  file_patterns:
    - "**/client/**"
    - "**/driver/**"
    - "**/sdk/**"
---

# 规则意图
客户端 SDK、JDBC 代理驱动或无侵入客户端库，是嵌入在外部宿主系统（如用户的微服务、WebLogic、Tomcat）中运行的组件。绝对禁止依赖任何重型服务端 Web 容器、应用框架或连接池组件，避免导致宿主类加载器冲突与严重污染。

# 违规判定依据 (Violation Criteria)
1. 在客户端/驱动模块中直接或间接引入 Spring、Netty、HikariCP 等重型服务端类库；
2. 模块间出现下层模块反向依赖上层业务宿主的循环或逆向调用（如 license 模块反向依赖 server 进程）。

# 合法豁免标准 (Exemptions)
1. 模块本身明确定义为服务端 Boot 容器模块（如 server/web/intake 宿主）；
2. 仅在单元测试代码（`src/test/**`）中为了验证集成行为引入的测试 Mock 框架。
