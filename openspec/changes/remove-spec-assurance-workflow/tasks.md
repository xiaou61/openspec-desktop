## 1. 固定必须保留的基础行为

- [x] 1.1 补充 lifecycle 回归测试，固定活跃 Change 的归档就绪只由项目可用性、规划工件、任务和当前严格验证决定，`archiveReadiness.gates` 仅包含 `artifacts`、`tasks`、`validation`
- [x] 1.2 补充严格验证回归测试，覆盖 `lifecycle:run-validation`、`ValidationCoordinator`、`ValidationCache`、passed/failed/stale 诊断和顶部“验证”节点，防止删除保障时误伤
- [x] 1.3 补充项目洞察冲突回归测试，证明无保障输入时 `CollisionEvaluator` 仍能报告 duplicate add、remove/modify、rename 和 unknown，并保留关系图投影

## 2. 移除共享契约与生命周期耦合

- [x] 2.1 从 shared contracts、IPC contracts、Desktop API 和公共 exports 中删除 assurance mode、Requirement review、实现/测试证据、报告、冲突裁决、保障快照及对应请求响应 schema
- [x] 2.2 从 lifecycle assessment、archive readiness、next action 和 spec-sync 投影中删除保障 policy、gate、fingerprint 与状态派生，保持归档目录仍显示 archived、sync 仍只提供影响预览
- [x] 2.3 从 action center、Codex handoff 和 work-state 中删除保障 action type、摘要、证据指纹、排序与 invalidation，保持任务再次实施仍只由已完成任务重新变为未完成触发
- [x] 2.4 更新 shared、lifecycle、action-center、handoff 和 work-state 单元测试，确认输出中不存在不可操作的保障建议或旧模式字段

## 3. 移除主进程、IPC 与 preload 能力

- [x] 3.1 从 `AppController` 的构造、项目加载、投影和公开方法中移除 `SpecAssuranceStore`、保障服务、报告文件 token、清理入口及其状态事件
- [x] 3.2 删除全部 `assurance:*` IPC channel、router handler、preload bridge 和 renderer 暴露，并增加边界测试确认旧调用被当作未知通道且没有残留 write/import/clear API
- [x] 3.3 移除仅由保障状态驱动的 query/cache/projection 失效路径，保留 lifecycle、任务、历史和项目洞察现有的精确失效行为
- [x] 3.4 增加启动回归测试：`userData/spec-assurance` 不存在、存在或包含损坏旧数据时均不读取、不迁移、不备份、不清除、不写入，也不影响项目打开

## 4. 移除 renderer 与设置产品面

- [x] 4.1 删除 Change 详情“保障”标签、保障 model/view/style、聚焦路由、React Query keys、Requirement 审阅、证据展示、报告导入和冲突裁决交互
- [x] 4.2 删除项目设置中的“标准 / 严格”保障模式和清除保障记录入口，同时移除相关表单状态、提示文案和测试选择器
- [x] 4.3 更新 workspace、Change 详情、行动中心和设置组件测试，确认界面不再出现保障入口，生命周期“验证”、任务再次实施和基础归档操作仍可用
- [x] 4.4 更新 Playwright/Electron 场景，在最小窗口和刷新、项目切换后验证无空白标签、失效深链、横向溢出或保障请求

## 5. 迁移项目洞察与用户文档

- [x] 5.1 配合 `add-project-insights-and-review-workbench` 的 6.0，从 snapshot、缓存指纹和公共契约中移除 assurance/provenance、产品意图、实现证据与测试证据字段，将能力状态收缩为 `planned | pending-baseline | baselined | unknown`
- [x] 5.2 更新能力表格、详情、关系图和简报，主规格存在时直接显示“已基线化”，归档来源不可观察时显示“未记录”，同时保留严格验证、阻塞、再次实施、待沉淀能力和独立 Change 冲突
- [x] 5.3 更新项目洞察服务、renderer 和真实多项目夹具测试，证明任务完成或验证通过不会把 `pending-baseline` 推断为 `baselined`，且 partial/truncation 语义保持不变
- [x] 5.4 更新 README，删除保障模式和工作流说明，明确“归档就绪”不证明需求或实现正确，并说明旧 `userData/spec-assurance` 已停用且只能由用户自行清理

## 6. 物理删除与历史收口

- [x] 6.1 删除 `src/main/spec-assurance/`、保障专用 shared/renderer 文件、测试、fixture 和样式，清理 package/type/test 配置中的孤立引用
- [x] 6.2 对生产 `src/`、README、当前项目洞察工件和活跃产品测试执行负向扫描，确认不再出现 assurance API、规格保障标签、保障模式、报告导入、Requirement 审阅或实现/测试证据 UI
- [x] 6.3 在保障实现和回归测试均完成后删除未归档的 `openspec/changes/add-spec-trust-and-drift-audit/`，不得归档、同步或写入主规格，并验证项目扫描不再把它显示为待归档能力
- [x] 6.4 完成并勾选 `add-project-insights-and-review-workbench` 的 6.0，然后运行 `codegraph index --force .` 重建索引并定向确认无生产调用者或动态路由残留

## 7. 审查与最终验证

- [x] 7.1 运行 typecheck、lint、单元测试、renderer boundary 和 build，修复由契约删除产生的编译、导出与测试问题
- [x] 7.2 运行项目洞察 Playwright 和完整 Electron E2E，覆盖归档就绪、验证、行动中心、交接、项目切换、旧本机数据与最小窗口
- [x] 7.3 运行 `openspec validate remove-spec-assurance-workflow --strict --no-interactive` 和 `openspec validate add-project-insights-and-review-workbench --strict --no-interactive`，两个 Change 必须同时通过
- [x] 7.4 由未参与实现的低成本模型执行一次只读审查；仅将确认有效且可复现的 bug 交给高能力模型做根因诊断、最小修复和针对性回归，本任务不自动归档任何 Change

范围交叉更新：后续的 `remove-project-insights-workbench` 覆盖本 Change 此前“保留项目洞察及其 Change 冲突评估”的决定，连同 `CollisionEvaluator` 和关系图一并删除；严格验证和基础生命周期能力仍保留。
