## Why

规格保障要求用户维护 Requirement 审阅、实现与测试证据、报告、冲突裁决和保障模式，实际使用成本高于带来的价值，并让归档就绪、行动中心和项目详情变得难以理解。产品决定完整撤回这套尚未归档的能力，恢复以 OpenSpec 工件、任务和严格验证为核心的简单流程。

## What Changes

- **BREAKING** 删除 Change 详情中的“保障”标签，以及 Requirement 审阅、实现证据、测试证据、证据新鲜度、报告导入、保障冲突裁决和清除保障记录等交互。
- **BREAKING** 删除项目设置中的“标准 / 严格”保障模式；归档就绪不再读取保障策略或保障事实，只依据规划工件、任务、OpenSpec 严格验证、规格同步和项目可用性等基础生命周期事实。
- 删除全部 `assurance:*` IPC、preload/Desktop API、共享保障契约、主进程保障服务与 store、renderer model/view/style，以及仅验证这些能力的测试和夹具。
- 从行动中心和 Codex 交接中删除核对 Requirement、导入保障报告、裁决保障冲突、刷新保障证据及相关摘要；不得保留不可操作的保障建议或旧模式文案。
- 从项目洞察 snapshot、能力表格、简报、缓存失效和 README 中删除保障/provenance/产品意图/实现证据/测试证据依赖；独立的 Change operation 冲突地图继续保留。
- 保留生命周期顶部“验证”节点、`openspec validate --strict` 执行与缓存、基础归档影响预览、任务再次实施、活动/修订和项目洞察的 Change 冲突检测。
- `add-spec-trust-and-drift-audit` 从未进入主规格，MUST NOT 被归档；删除功能实现后同时移除该活跃 Change，避免应用继续把它显示为待归档能力。本 Change 作为撤回决定的历史记录。
- 已存在的 `userData/spec-assurance` 数据停止读取和写入。首版卸载不自动删除该目录，避免升级时静默销毁本机记录；README 说明它已停用且可由用户自行清理。

## Capabilities

### New Capabilities

无。本 Change 撤回尚未归档的本机规格保障实现，不创建新的长期 capability。

### Modified Capabilities

无。`spec-assurance-and-drift-audit` 从未进入 `openspec/specs` 主规格，因此没有主规格 Requirement 可做 REMOVED delta；本 Change 使用 `skip_specs: true`，只记录实现、集成和文档撤回。

## Impact

- `src/main/spec-assurance/`、保障专用 shared contracts、IPC、controller 方法、preload API、renderer 视图/模型/样式和对应测试将被删除。
- lifecycle evaluator/service、action center、Codex handoff、app controller、projection invalidation、project insights 和 README 将移除保障依赖并重新固定基础行为。
- `src/main/lifecycle/validation.ts`、严格验证 IPC、验证节点和项目洞察 `CollisionEvaluator` 明确不在删除范围内。
- 需要覆盖归档就绪恢复、行动中心优先级、交接材料、项目洞察状态、无保障 IPC 暴露、旧本机数据存在时启动、最小窗口和完整 Electron 回归。
