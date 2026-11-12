# 跨项目协作与交互关系 (Inter-Project Relations)

> **按需查阅**：仅在跨项目联调、环境集成部署、或排查跨进程链路时才需读取本文件。

---

## 1. a8-devtools ↔ a8-turbo
- **驱动服务**：`a8-devtools` 的 CowFS 提供多分支差异隔离与虚拟化挂载，保护 C 盘不被构建产物写爆；
- **治理规范**：`a8-devtools/plugins/agent-mind` 是全局插件真源，为 `a8-turbo` 提供唯一的规则引擎与红线门禁。

---

## 2. a8-turbo ↔ BeX5-V38-turbo
- **输入产物**：`a8-turbo` 交付的 `turbo-jdbc-driver.jar` 部署至 BeX5，透明代理对底层真实 MySQL 的 SQL 查询；
- **对拍验证**：验证 A8 本地 DuckDB 缓存的数据准确性，断言源库 MySQL 与 DuckDB 物理字段类型 100% 对齐；
- **边界隔离**：BeX5 作为黑盒靶场运行，严禁为了迁就 A8 而侵入修改 BeX5 内部业务逻辑。
