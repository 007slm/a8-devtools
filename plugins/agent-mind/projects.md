# 宿主机跨项目全局索引地图 (Machine Project Index)

> **常驻上下文指引**：本表为当前机器全量项目的轻量级索引，用于秒级确立生态位。
> **渐进式披露原则**：日常单项目开发**仅读本表即可，严禁主动展开子卡片**；唯有发生跨项目联调、编译部署或集成验证时，方可按需下钻读取对应文件。

---

## 宿主机项目全景速查表

| 项目代号 | 物理绝对路径 | 生态位 (Role) | 一句话核心定位 | 渐进式详情下钻 |
| :--- | :--- | :--- | :--- | :--- |
| **a8-turbo** | `E:\a8-turbo` | `core` | 生产核心：智能数据库加速代理与 Web 网关 | [projects/a8-turbo.md](projects/a8-turbo.md) |
| **a8-devtools** | `E:\a8-devtools` | `tooling` | 开发者底座：CowFS 虚拟文件系统 / 任务栏 / agent-mind 全局插件 | [projects/a8-devtools.md](projects/a8-devtools.md) |
| **BeX5-V38-turbo** | `E:\BeX5-V38-turbo` | `test-bed` | **测试靶场**：全量运行时宿主，用于对拍验证，**绝对禁止修改其源码** | [projects/bex5.md](projects/bex5.md) |
| **a8-whisper** | `E:\a8-whisper` | `tooling` | 本地语音转录与语音对话服务底座 | [projects/a8-whisper.md](projects/a8-whisper.md) |
| **agent-mind** | `E:\agent-mind` | `reference` | DSH 架构下 AI 离线记忆抽取与知识中枢参考仓库 | [projects/agent-mind-dsh.md](projects/agent-mind-dsh.md) |

---

## 跨项目行为操作红线

1. **测试靶场绝对只读**：`BeX5-V38-turbo` 仅作为黑盒靶场进行驱动接入与对拍验证，严禁直接改写其内部源码；
2. **按需下钻原则**：仅在跨项目联调时读取 [projects/relations.md](projects/relations.md)，单工程内部任务绝不展开，保护上下文纯净。
