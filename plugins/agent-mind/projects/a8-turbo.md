# 项目详情卡片：a8-turbo (核心生产)

- **物理绝对路径**：`E:\a8-turbo`
- **生态位定位**：`core`（生产核心系统）
- **职责边界**：A8 智能数据库代理加速系统与 Web 前端加速网关。
- **独立交付产物**：三进程独立运行、各自端口互不干扰：
  1. `a8-turbo.exe` (HTTP `:8010` / gRPC `:8330`)：数据代理核心与 DuckDB 强类型缓存引擎；
  2. `a8-intake.exe` (H2 `:8443` / HTTP `:8090`)：前端 Web 加速网关（Preload 图谱拍扁、静态资源受控缓存）；
  3. `a8-ui.exe` (HTTP `:8011`)：Admin 控制台 Java 宿主与 React 前端。
- **关键质量门禁**：
  - 后端：`mvn compile` 必须 100% 编译通过；
  - 前端：`modules/ui/web` 下执行 `npx oxlint` 必须 0 Error；
  - 核心红线：DuckDB 物理 Schema 必须与源库强类型 100% 对齐，绝对禁止退化为 VARCHAR。
- **与外部协作**：向 `BeX5-V38-turbo` 输出 `turbo-jdbc-driver.jar` 进行实操代理对拍验证。
