## Context

参见 `proposal.md` 的 Why。规格保障由尚未归档的 `add-spec-trust-and-drift-audit` 引入，当前实现横跨 `src/main/spec-assurance/`、共享契约、lifecycle、action center、AppController、IPC/preload、renderer、项目设置、项目洞察、README 和大量测试。`openspec/specs` 仍为空，因此该能力从未成为主规格，不能通过归档旧 Change 再做 REMOVED delta。

生命周期中的严格验证是独立能力：`ValidationCoordinator` 调用受限 OpenSpec CLI 并缓存与当前 Change 指纹绑定的结果。项目洞察的 `CollisionEvaluator` 也直接比较活跃 delta operation。两者虽在现有代码中与 assurance 同时出现，但不属于保障功能，删除时必须保留。

当前工作区有多个未提交且彼此依赖的已实现 Change。实施必须在当前 main 工作区串行完成，不得 reset/revert 无关修改。`add-project-insights-and-review-workbench` 仍处于收口阶段，其工件已新增 6.0 迁移任务，本 Change 必须与之保持一致。

范围交叉更新：后续的 `remove-project-insights-workbench` 已覆盖本 Change 中“保留项目洞察及其 Change 冲突评估”的决定，连同 `CollisionEvaluator` 和关系图一并删除。严格验证、`ValidationCache/Coordinator`、生命周期轨道和基础归档影响预览继续保留，不随项目洞察撤回。

## Goals / Non-Goals

**Goals:**

- 物理删除规格保障的产品界面、状态模型、运行时服务、持久化入口和集成逻辑，而不是只隐藏标签。
- 让生命周期归档建议重新只依赖项目可用性、工件、任务和当前严格验证；spec sync 继续只提供归档影响预览。
- 让行动中心和 Codex 交接只反映仍然可操作的生命周期事实。
- 让项目洞察不再读取 assurance/provenance，同时保留主规格、活跃/归档 Change、任务、验证、冲突和简报。
- 保留旧本机保障数据文件但使其完全惰性，升级过程不自动删除用户数据。

**Non-Goals:**

- 不删除或弱化 OpenSpec 严格验证、验证缓存、验证节点和相关诊断。
- 不删除项目洞察基于 delta operation 的 Change 冲突检测。
- 不删除 lifecycle spec sync、任务再次实施、历史、活动、项目目录扫描或行动中心本身。
- 不把旧保障 Change 归档，也不为其创建主规格或 REMOVED delta。
- 不提供保障数据导出、迁移或兼容只读页面；停用后应用不再解释这些私有 schema。

## Decisions

### 1. 这是未归档能力撤回，使用 skip_specs

`remove-spec-assurance-workflow` 设置 `skip_specs: true`。实施完成后删除活跃的 `add-spec-trust-and-drift-audit` 目录，但保留本 Change 作为为何撤回的记录。本 Change 最终可以按 skip-specs 流程归档，不更新主规格。

备选方案是先归档旧保障 Change，再用 REMOVED Requirements 删除。它会短暂且错误地把已经决定弃用的能力写入长期基线，还会生成没有产品价值的规格往返，因此不采用。

### 2. 先建立基础生命周期契约，再删除保障模块

删除顺序按依赖进行：

1. 用测试固定无 assurance 时的基础 lifecycle、action center、handoff 和 project insights 行为；
2. 从 shared contracts、lifecycle assessment/archive readiness/next action 和 action center item 中移除保障字段与 action type；
3. 从 controller、IPC、preload 和 renderer 移除所有消费者；
4. 删除 `src/main/spec-assurance/`、保障专用测试/fixture/style 和旧 Change。

最终 `archiveReadiness.gates` 只包含 `artifacts`、`tasks` 和 `validation`。active Change 只有在项目可用、所需工件完成、任务门槛满足且严格验证为当前 passed 时显示 ready；归档目录中的 Change 仍显示 archived。`sync` 保留在 lifecycle assessment 中供影响预览，不新增隐藏 gate。

备选方案是保留 assurance 类型但永远返回 `undefined`。这会留下大量不可达 API、旧 schema 和未来误接入风险，不符合“全部去掉”，因此不采用。

### 3. 保留严格验证和独立冲突，删除保障冲突

保留 `lifecycle:run-validation`、`ValidationCache`、`ValidationCoordinator`、顶部“验证”节点、验证诊断和 stale 语义。删除的是外部 `openspec-desktop-assurance-report`、报告内实现/测试声明、Requirement 审阅、证据哈希、保障冲突及裁决。

项目洞察 `CollisionEvaluator` 继续从 scanner/spec-sync 的 ADDED/MODIFIED/REMOVED/RENAMED operation 计算跨 Change 冲突。其 collision contract、关系图和详情不依赖保障报告，不能因名称中同为“冲突”而删除。

### 4. 行动中心和交接回到可执行基础行动

从 action type、排序、evidence 和 handoff 中删除 `review-requirements`、`import-assurance-report`、`resolve-assurance-conflict`、`refresh-assurance` 及保障摘要。`deriveChangeAction` 只依据 lifecycle 的恢复项目、完成工件、继续任务、运行/修复验证和确认归档等 action。

action identity/evidence fingerprint 不再包含 assurance fingerprint、mode、report 或 conflict。相关保障状态变化事件也不再发布或触发 query invalidation。已有再次实施仍只能由 tasks 从完成转为未完成触发。

### 5. 项目洞察采用可直接观察的能力状态

`ProjectInsightsSnapshotV1` 去掉 assurance/provenance、产品意图、实现证据和测试证据字段。能力状态收缩为：

- `baselined`：存在可读的 `openspec/specs/<capability>/spec.md`；
- `pending-baseline`：不存在主规格但存在活跃 delta；
- `planned`：只有可观察归档/计划记录，且没有活跃 delta 或主规格；
- `unknown`：文件/operation 无法可靠解析或输入被截断到无法下结论。

任务完成或严格验证通过仍不能把 `pending-baseline` 变成 `baselined`。归档来源只是从可读归档 Change 推导的可选说明；找不到来源时显示“未记录”，不再推导“来源待确认”或“已漂移”。简报删除保障、产品意图及实现/测试证据栏目，但保留严格验证、阻塞、再次实施和待沉淀能力。

### 6. IPC 与前端按产品面整体删除

删除所有 `assurance:*` channel、请求/响应 schema、DesktopApi 方法、preload bridge、AppController 方法及 report-file/clear token 状态。项目设置删除保障模式和清除保障数据；Change 详情删除保障 tab、聚焦路由、React Query keys、model/view/style 和导入对话框。

严格 schema 应使旧 renderer 调用未知 assurance channel 时得到“未知 IPC 通道”，而不是保留兼容空响应。升级由同一应用包整体完成，不支持新旧 renderer/main 混用。

### 7. 旧本机数据保留但永不访问

启动时不再构造 `SpecAssuranceStore`，不读取、迁移、备份、清除或写入 `userData/spec-assurance`。目录即使损坏也不得影响应用启动或项目状态。README 说明该目录已停用，可由用户在确认不需回退后手工清理。

自动删除可以减少磁盘占用，但会造成不可恢复的数据销毁，并无必要；因此不采用。未来如确需一键清理，应另建窄 Change 并提供明确确认。

### 8. 用负向扫描证明没有残留产品能力

除本撤回 Change 的历史说明和必要迁移测试外，生产 `src/`、README、当前项目洞察工件和活跃产品测试不得再出现 assurance API、规格保障标签、保障模式、报告导入、Requirement 审阅或实现/测试证据 UI。删除 exports 后强制重建 CodeGraph，再用定向搜索确认没有调用者和动态路由残留。

## Risks / Trade-offs

- **[删除共享契约造成大面积编译失败]** → 先修改消费者和契约测试，再物理删除模块；每组任务后运行定向 typecheck/test。
- **[把严格验证误删]** → 对 `lifecycle:run-validation`、validation node/cache 和失败/stale 场景建立保留回归测试。
- **[把独立 Change 冲突误删]** → 用无 assurance fixture 验证 `CollisionEvaluator` 和关系图仍能报告 duplicate add、remove/modify 和 unknown。
- **[归档建议变宽松]** → UI 和 README 明确 ready 只代表工件、任务和严格验证满足，不证明需求或实现正确。
- **[旧保障数据占用磁盘]** → 保持惰性并文档说明手工清理位置，以可恢复性换取少量残留磁盘占用。
- **[旧保障 Change 仍被扫描为待沉淀能力]** → 在代码回归通过后删除其活跃 Change 目录，并用真实 workspace 验证不再出现。
- **[项目洞察 Change 与本 Change 不一致]** → 同一实施批次完成其 6.0，并同时严格验证两个 Change。

## Migration Plan

1. 添加基础 lifecycle/action center/insights 回归测试，记录当前保留行为。
2. 移除 shared/lifecycle/action-center/work-state/project-insights 中的保障字段、gate、action、fingerprint 和 invalidation。
3. 移除 AppController、IPC、preload、renderer 和设置中的全部保障产品面。
4. 删除保障模块、专用测试/fixture/style，更新 README，并确认旧本机目录不被访问。
5. 删除未归档的 `add-spec-trust-and-drift-audit` Change，完成项目洞察 6.0，重建 CodeGraph。
6. 运行全套静态、单元、Playwright、Electron 和 OpenSpec 严格验证；由低成本独立模型做常规审查，有可复现 bug 时再交高能力模型修复。

回滚需要恢复同一批删除的代码与旧 Change 文档。由于 `userData/spec-assurance` 没有被自动删除，回滚版本仍可读取原记录；新版本则始终忽略它。
