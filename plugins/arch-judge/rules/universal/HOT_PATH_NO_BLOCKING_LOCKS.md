---
id: UNIVERSAL_HOT_PATH_NO_BLOCKING_LOCKS
name: 数据面热路径无方法锁红线
category: concurrency_and_performance
severity: BLOCKER
triggers:
  syntax_tokens:
    - "synchronized"
    - "ReentrantLock"
    - "sync.Mutex"
    - "Thread.sleep"
    - "time.Sleep"
  file_patterns:
    - "**/cache/**"
    - "**/store/**"
    - "**/asset/**"
    - "**/buffer/**"
    - "**/pool/**"
---

# 规则意图
高性能中间件、网关与缓存引擎的数据面请求吞吐量极大。在读多写少的核心热数据读取路径上，严禁使用粗粒度方法级排他锁或隐式线程睡眠，坚决杜绝锁争用、上下文频繁切换与吞吐量断崖式暴跌。

# 违规判定依据 (Violation Criteria)
1. 在高并发缓存/资产存储的公开读取方法（如 `get()`, `read()`, `lookup()`）签名上声明 `synchronized`；
2. 在核心数据流通路中加入跨线程的隐式探测轮询与同步 `sleep`。

# 合法豁免标准 (Exemptions)
1. 系统的低频初始化阶段、生命周期启动/关闭钩子（`start()`, `close()`, `init()`）；
2. 已经采用细粒度分段锁（`ConcurrentHashMap` / DCL 双重检查锁）且只在冷写入时竞争的场景。
