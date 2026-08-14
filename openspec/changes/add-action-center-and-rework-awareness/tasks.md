## 1. 修正任务节点与任务门槛语义

- [x] 1.1 扩展共享契约，为 `LifecycleTaskGate` 增加 `empty`、为生命周期节点增加中性 `ready`，并补齐严格 Zod 契约与向后兼容测试。
- [x] 1.2 重构 `LifecycleService` 的 task gate 归一化，明确区分不适用、缺失/不可读、0/0、部分完成和非空全完成，并覆盖自定义 schema 的 apply 依赖。
- [x] 1.3 修改生命周期 evaluator，使 tasks 节点同时消费 artifact graph 与 task gate；确保 `57/64` 为当前实施、`0/0` 为中性就绪、只有非空全完成才为 complete。
- [x] 1.4 更新归档 task gate、节点证据和下一步文案，验证 empty 不阻塞后续验证但不产生实施完成结论。
- [x] 1.5 增加 evaluator/service 回归测试，固定 `tasks artifact done + 57/64` 不显示完成、57/57 显示完成、0/0 不显示完成以及任务解析失败显示不可用。

## 2. 建立实施轮次与 Change 分类领域模型

- [x] 2.1 定义版本化 `ChangeWorkState`、任务观察、完成里程碑、reopened 证据、能力演进和归档完整性契约，并为所有计数、时间、指纹和轮次增加边界校验。
- [x] 2.2 实现纯函数 `transitionImplementationIteration`，支持首次 incomplete、首次非空 complete、完成后新增任务、取消勾选、混合任务变化、再次完成和后续再次打开。
- [x] 2.3 为轮次转换实现稳定事件键和 active generation 规则，确保重复扫描、格式变化、unknown/empty 状态、active -> archive 和同名新 active 不会重复或串用轮次。
- [x] 2.4 实现重新打开原因分类与版本上下文快照，并用 `57/57 -> 57/64`、完成数下降和总数/完成数同时变化的单元测试验证。
- [x] 2.5 实现 `assessChangeEvolution`，按 delta capability 路径与主规格存在性区分新能力、能力迭代、mixed 和 unknown，并覆盖多 capability Change。
- [x] 2.6 实现归档 Change 聚合指纹与 baseline/changed/restored 状态转换，验证首次观察不告警、后续内容变化告警且恢复原指纹后解除当前警告。

## 3. 持久化本地轮次与归档证据

- [x] 3.1 创建 `ChangeWorkStateStore`，在 `userData/change-work-state/<projectId>/index.json` 使用版本化 schema、项目内串行队列和原子临时文件替换保存状态。
- [x] 3.2 提供初始化、内存快照、按 Change 更新、active 归档冻结、项目清空和 flush API，并确保普通历史 retention/prune 不触碰 work-state 文件。
- [x] 3.3 实现损坏或不兼容状态文件的时间戳备份与保守恢复，向上层暴露本地证据不可用诊断而不从当前任务计数补猜轮次。
- [x] 3.4 增加 store 测试，覆盖首次创建、重启恢复、并发更新顺序、幂等写入、损坏恢复、普通历史裁剪独立性和显式清空。

## 4. 接入稳定投影、历史活动和应用快照

- [x] 4.1 创建 `ChangeWorkStateService`，按项目串行 reconcile 稳定扫描；对当前 Change 复用生命周期 assessment，对归档 Change 只处理内容指纹。
- [x] 4.2 在 AppController 投影链路中按“更新扫描 -> 失效 lifecycle -> reconcile work state -> 广播失效”顺序接入服务，并防止 reconcile 自身事件形成循环。
- [x] 4.3 在 reopened 或归档异常首次发生时通过现有 HistoryStore 写语义化活动，保留任务差量、发生时间和当时项目版本，且重复扫描不得重复记录。
- [x] 4.4 将内存中的 ChangeWorkState 和能力演进评估覆盖到 AppSnapshot 的 ChangeProjection，并在单 Change 生命周期结果中返回同一份结构化状态。
- [x] 4.5 扩展“清除本地历史”流程和确认文案，使显式确认同时清空轮次/归档基线；清空后的稳定扫描只能建立新基线，不能回溯标记再次实施。
- [x] 4.6 增加 AppController/Watcher 集成测试，覆盖启动基线、57/57 -> 57/64、重启、版本切换、历史裁剪、归档移动、归档修改和投影事件去重。

## 5. 扩展 OpenSpec CLI 适配与自定义工件行动

- [x] 5.1 为 doctor、context 和 instructions JSON 建立受限归一化契约，只保留健康、root 角色、关系状态、依赖、进度和根内相对路径等行动所需字段。
- [x] 5.2 扩展 `RestrictedOpenSpecCli` 的 `doctor`、`context` 和 `instructions` 方法，使用硬编码参数、无 shell、最小环境、独立超时/输出上限，且永不调用 `context --code-workspace` 或任何写入选项。
- [x] 5.3 为 `LifecycleNextAction` 增加可选真实 `targetArtifactId`，让自定义 schema 工件在六节点轨道外仍能被行动中心和 instructions 准确引用。
- [x] 5.4 增加 CLI 适配测试，覆盖正常 OpenSpec 1.8 输出、未知字段、恶意/根外路径、超量诊断、超时、不兼容 JSON、自定义 artifact 和单项目失败隔离。

## 6. 实现跨项目行动中心与 Codex 交接服务

- [x] 6.1 定义 `ActionCenterSnapshot`、项目健康、行动项、作用域、partial 状态、稳定 action key 和 `CodexHandoff` 共享契约及 schema 测试。
- [x] 6.2 实现纯行动聚合与排序，保证每个 Change 至多一个主要行动，过滤普通 archived review，并按健康、工件、实施、验证、归档、归档异常及稳定同级规则排序。
- [x] 6.3 实现 `ActionCenterService` 的全部项目/当前项目查询，以最多 4 个并发生命周期评估复用缓存，并为 doctor/context 提供按 root 的短缓存和逐项目 partial 诊断。
- [x] 6.4 确保某个项目不可用、CLI 超时或输出不兼容只降级该项目，其他项目行动仍返回；结构扫描能证明的未完成任务在降级时继续可见并标明来源。
- [x] 6.5 实现按 action key 和 evidence fingerprint 重新解析的 handoff builder，按工件/apply/archive/健康行动懒加载 instructions，并生成长度受限、仅引用安全路径的 Markdown。
- [x] 6.6 增加行动中心服务测试，覆盖多项目混合阶段、空行动范围、57/64、能力迭代、归档异常、自定义工件、partial 聚合、稳定排序、过期 handoff 和项目只读不变性。

## 7. 暴露受限 IPC 与查询失效

- [x] 7.1 增加 get/refresh action center 与 build Codex handoff 的 IPC 请求 schema、channel、router 和 AppController 处理器，由 catalog 重新解析项目与 Change，拒绝伪造或失效 action。
- [x] 7.2 更新 preload、DesktopApi 和 renderer 全局类型，只暴露结构化行动查询与交接结果，不暴露通用命令、cwd、文件读写或原始 CLI 输出。
- [x] 7.3 将项目投影、版本上下文、验证结果和 work-state 变化连接到对应 action-center/lifecycle 查询失效；显式刷新绕过短缓存但保留并发与安全限制。
- [x] 7.4 增加 IPC/preload 测试，覆盖非法 ID/action key/fingerprint、跨项目伪造、过期 action、输出上限、partial 响应和所有请求不修改项目文件。

## 8. 构建应用级行动中心界面

- [x] 8.1 增加行动中心 React Query hooks、全部项目/当前项目作用域状态、稳定选择和刷新状态，刷新时保留上一份可用证据。
- [x] 8.2 在项目侧栏加入带未处理计数的行动中心入口，并让 Workspace 在正常 Change 模式与行动模式之间可预测切换和恢复选择。
- [x] 8.3 在第二栏实现高密度行动队列、全部项目/当前项目分段控制、稳定状态图标、空状态、partial/降级提示和键盘选择。
- [x] 8.4 在第三栏实现行动证据、项目 root 健康、任务/轮次信息、Codex 交接预览、复制交接和打开对应 Change；复制失败时提供可选择文本。
- [x] 8.5 完成最小窗口、长项目名/路径、自定义 artifact、独立滚动、可见焦点、非颜色状态和 reduced-motion/reduced-transparency 样式。
- [x] 8.6 增加 renderer 组件测试，覆盖跨项目排序/筛选、选择保持、partial 刷新、空状态、复制/打开 Change、键盘交互和无障碍名称。

## 9. 呈现再次实施、能力迭代和归档异常

- [x] 9.1 更新生命周期轨道的 ready/current/complete 图标、标签、live region 和证据，使 57/64 永不渲染完成对勾，0/0 使用中性清单状态。
- [x] 9.2 在 Change 列表和详情标题显示“再次实施 · 第 N 轮”，并展示 reopened 时间、原因、前后计数和版本上下文；初次 incomplete 不显示该徽标。
- [x] 9.3 在 Change 列表、详情和行动证据中独立显示“能力迭代”，支持它与再次实施同时存在且不修改旧 Change 的完成/归档事实。
- [x] 9.4 在归档 Change 详情与行动中心显示归档内容异常和“创建新 Change”建议，不提供还原、移动或自动重新实施操作。
- [x] 9.5 更新活动视图对语义化 task-progress/归档异常 summary、任务差量和版本筛选的呈现，并增加列表、标题、轨道和活动回归测试。

## 10. 文档、真实夹具与发布验证

- [x] 10.1 建立覆盖 57/57 -> 57/64、取消勾选、首次 57/64、0/0、再次完成再打开、自定义 schema、多个项目部分失败、能力迭代和归档修改的真实组合夹具。
- [x] 10.2 更新 README/应用内隐私与清除说明，说明轮次从本地观察开始、严格验证不等于代码交付、行动中心只读以及清除本地历史会重置轮次基线。
- [x] 10.3 运行 `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm check:renderer-boundary` 和 `pnpm build`，修复所有共享契约、主进程、preload 与 renderer 回归。
- [x] 10.4 运行 Electron/Playwright 端到端测试，在桌面和最小支持窗口验证行动模式、57/64 任务节点、再次实施徽标、复制交接、键盘流和项目文件哈希保持不变。
- [x] 10.5 在新增跨文件导出稳定后运行 `codegraph index --force .` 并复核关键调用/影响路径，然后执行 `openspec validate add-action-center-and-rework-awareness --strict --no-interactive`。
