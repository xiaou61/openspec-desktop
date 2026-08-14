## Context

参见 `proposal.md` 的 Why。当前 `LifecycleService` 已将 OpenSpec 工件图和 Markdown 任务计数组合为独立的 `artifactGraph` 与 `taskGate`，`evaluateLifecycle` 也会优先把未完成任务作为下一步和归档 blocker；问题集中在 `nodeState`：proposal、specs、design 和 tasks 共用同一段工件状态映射，因而 `tasks` 工件一旦被 CLI 标记为 `done` 就得到完成对勾，忽略了同一评估中的 task gate。

应用已有多项目 catalog、稳定文件监听、内容哈希、版本上下文、本地修订/活动历史、生命周期缓存、受限 IPC 和三栏 React 工作区。`WatcherManager.handleProjection` 目前只为 tasks 修订保存完成数与总数的差量；普通历史保留策略会裁剪旧修订和活动，因此不能据此可靠证明一个 Change 曾经全完成。`ChangeProjection`、`ChangeLifecycleAssessment` 和 `ActivityEntry` 都是严格 Zod 契约，新增状态必须有明确的兼容和迁移边界。

本机 OpenSpec 1.8 CLI 提供 `status --change --json`、`instructions <artifact|apply|archive> --change --json`、`doctor --json`、`context --json` 和严格验证。当前 `RestrictedOpenSpecCli` 只封装 status 与 validate，并已具备无 shell 调用、受限环境、超时、输出上限和诊断净化。OpenSpec schema 可以包含自定义 artifact，root 还可能包含 store/reference 关系，因此行动中心不能重新硬编码一套 spec-driven 工作流。

项目文件继续是 OpenSpec 事实来源并保持只读；实施轮次和归档指纹属于可丢弃的应用本地证据。CLI 不是基础项目浏览的强制依赖，任何无法证明的完成、轮次或健康状态都必须降级，而不是乐观猜测。

## Goals / Non-Goals

**Goals:**

- 让任务节点、任务门槛和归档门槛使用同一组任务事实，同时保留“任务工件已就绪”和“实施已完成”的区别。
- 建立幂等、可持久化的 Change 实施轮次状态机，并让普通历史裁剪不影响后续再次实施判断。
- 在所有已登记项目上汇总确定性的下一步和 OpenSpec 根健康，且每条结论都能回到所属项目、Change 和来源证据。
- 复用 OpenSpec 的工件图与 instructions，而不是由应用猜测自定义 schema 的下一工件。
- 生成可审阅、可复制的 Codex 交接内容，同时保持 renderer 无文件系统和进程执行能力。

**Non-Goals:**

- 不从应用创建或修改 OpenSpec 工件、勾选任务、运行实现命令、执行归档或写入 Git。
- 不依据 Git 提交、代码测试或任务文字猜测实现质量；“再次实施”只描述 OpenSpec 任务状态转换。
- 不回溯推断应用开始监控之前发生过几轮开发，也不尝试从已裁剪修订重建轮次。
- 不自动创建 Codex 任务或依赖未公开的 Codex 深链；首版提供交接预览/复制和回到应用内 Change 的入口。
- 不在本变更中实现 OpenSpec store 切换、跨 root 写入或任意 schema 的可视化轨道；行动中心必须能准确呈现自定义 artifact 行动，但现有六节点轨道保持紧凑语义。

## Decisions

### 1. 为 tasks 节点建立独立于工件存在性的状态映射

`LifecycleTaskGate.status` 增加 `empty`，表示 schema 需要 tasks、任务文件可读但没有复选任务。`LifecycleNodeState` 增加中性的 `ready`，表示工件或清单就绪，但不能表达实施完成。任务门槛按以下规则归一化：

- schema 的 apply 依赖不包含 tasks：`not-applicable`。
- 所需 tasks 缺失或不可读：`unknown`。
- 可读且总数为 0：`empty`。
- 总数大于 0 且存在未完成项：`incomplete`。
- 总数大于 0 且全部完成：`complete`。

`nodeState('tasks')` 必须先处理工件缺失、blocked 和 unknown，再使用 task gate：`complete` 映射为完成，`incomplete` 映射为当前实施，`empty` 与 `not-applicable` 映射为中性的就绪/不适用，`unknown` 映射为不可用。`buildNodes` 对 tasks 使用任务计数作为主要证据，并把“任务清单已创建”与“X/Y 项已完成”同时展示；其他工件仍使用现有 artifact graph 映射。

归档 task gate 将 `complete`、`empty` 和 `not-applicable` 视为没有未完成任务，`incomplete` 为失败，`unknown` 为未知。这样空清单不会永久阻塞后续严格验证，但也不会出现实施完成对勾或形成完成里程碑。

备选方案是只在 React 中把 tasks 的图标换掉。它会让共享评估仍对外声称节点 complete，行动中心、可访问文本和测试继续互相矛盾，因此不采用。另一个方案是把空清单归为 complete；这无法满足“0/0 不得证明实施完成”的要求，因此增加独立状态。

### 2. 使用单向状态机识别实施轮次，不从修订历史反推

新增纯函数 `transitionImplementationIteration(previous, observation)`。输入 observation 只接受稳定投影产生、属于未归档 Change 且 task gate 可可靠判断的计数、tasks 内容哈希、观察时间和项目版本。状态包含当前轮次、当前阶段、最近一次非空全完成里程碑和最近一次 reopened 证据。

状态转换如下：

1. 没有状态且首次观察为 incomplete：建立 `initial-in-progress`，轮次为 1，但不显示“再次实施”。
2. 没有状态且首次观察为非空 complete：建立第 1 轮 completed 里程碑。
3. 当前轮次没有确认 completed 时继续 incomplete：只更新当前计数和指纹，不增加轮次。
4. 当前轮次已经确认非空 complete，随后观察为 incomplete：轮次加一，进入 reopened，并生成一次实施重新打开事件。
5. reopened 轮次再次达到非空 complete：把该轮标记 completed；未来再次变为 incomplete 时再加一轮。
6. empty、not-applicable 或 unknown 不建立完成里程碑、不增加轮次，也不抹掉最近一次已确认完成证据。

重新打开原因由前后计数保守分类：总数增加且出现剩余项为 `tasks-added`，总数未增加但完成数下降为 `tasks-unchecked`，两者同时变化或无法唯一分类为 `task-set-changed`。每个转换使用 change key、前后 tasks 指纹和轮次组成幂等事件键，连续扫描同一内容不得重复增加轮次或活动。

Change 从 active 移入 archive 时冻结其实施轮次，不把目录移动算作再次实施。之后若出现同名 active Change，将其视为新的 active generation 并重新建立基线，避免复用旧归档 Change 的轮次。

备选方案是扫描所有历史 revisions，寻找曾经的 `completed === total`。历史可能在应用注册前缺失、已被裁剪或只保存格式变更，结果既昂贵又会产生不可解释的误报，因此不采用。

### 3. 轮次和归档基线使用独立、版本化的本地状态仓库

新增 `ChangeWorkStateStore`，每个项目使用 `userData/change-work-state/<projectId>/index.json`。文件采用版本化 Zod schema、原子临时文件替换和项目内串行写队列，保存：

- active generation 的实施轮次、阶段、最近任务观察、全完成里程碑和 reopened 事件摘要；
- 已归档 Change 的首次稳定内容指纹、当前指纹和可选异常证据；
- schema 版本、项目 ID 和最近更新时间。

仓库在内存中提供同步只读快照，使 `AppController.getAppSnapshot()` 能把 `ChangeWorkState` 覆盖到纯扫描产生的 ChangeProjection 上；文件加载和写入保持异步。损坏或无法迁移的文件先重命名为带时间戳的备份，再建立空状态并报告本地证据不可用，绝不从当前 incomplete 任务补猜“再次实施”。

普通 `HistoryStore.prune()` 和保留设置不处理该目录。用户明确执行“清除本地历史”时，确认文案必须说明实施轮次和归档基线也会被清除；确认后同时清空两个 store，下一次稳定扫描只建立新基线。项目取消登记沿用现有本地历史策略，不自动删除证据。

备选方案是把轮次塞进 `history/index.json`。这会把长期判定基线与可裁剪活动共享 schema 和生命周期，并让历史保留设置产生隐藏副作用，因此采用独立仓库。

### 4. 在 AppController 的稳定投影链路协调生命周期与轮次观察

`WatcherManager` 继续负责稳定文件投影和普通 revisions，不承担 OpenSpec schema 或轮次语义。`AppController` 收到稳定 projection 后先更新扫描结果并使对应生命周期缓存失效，再由 `ChangeWorkStateService` 对受影响 Change 执行 reconcile：

1. 当前 Change 通过 `LifecycleService.getAssessment` 取得 artifact graph 与 task gate；CLI 不可用时只接受生命周期服务明确提供的结构降级结果。
2. 将可靠任务观察送入轮次状态机并持久化。
3. 若产生 reopened 事件，通过现有 `HistoryStore.recordActivity` 写一条 `task-progress` 活动，summary 明确包含“进入第 N 轮实施”、原因和计数，`taskDelta` 与 `projectVersion` 继续使用现有字段。
4. 已归档 Change 不调用 active status，只更新归档内容指纹和异常状态。
5. reconcile 完成后再广播一次具有受影响 Change ID 的本地投影事件，使列表、活动、生命周期和行动中心查询失效。

初次启动的稳定扫描会为全部可读 Change 建立保守基线；后续事件按 project 串行，不同项目可并行。LifecycleService 现有 Promise 去重和短缓存继续避免同一个 Change 在详情、reconcile 和行动中心之间重复启动 status。reopened 活动使用现有 ActivityEntry 形状，避免仅为一个语义事件升级历史索引；结构化轮次详情由 ChangeWorkState 提供，活动 summary 负责时间线表达。

备选方案是在 `WatcherManager.handleProjection` 直接比较 taskTotals。WatcherManager 不知道自定义 schema 是否要求 tasks，也无法区分 active/archive 和 CLI 降级权威度，这会把 OpenSpec 语义泄漏进通用监听层，因此不采用。

### 5. 能力迭代和归档异常作为与实施轮次正交的事实

新增纯评估 `assessChangeEvolution(scan, change)`。它按 delta spec 的 capability 相对路径查找当前 `openspec/specs/<capability-path>/spec.md`：全部目标不存在为新能力，至少一个目标存在且无新目标为能力迭代，两者同时存在为 mixed，解析或路径不可靠为 unknown。`ChangeProjection` 和生命周期详情只在 iteration/mixed 时显示“能力迭代”；该结论不写回旧 Change、不建立旧 Change 与新 Change 的猜测性一对一关系。

归档完整性使用归档 Change 所有受支持工件的相对路径和内容哈希生成稳定指纹。第一次观察只建立 baseline；以后当前指纹与 baseline 不同则为 `changed`，恢复到 baseline 时清除当前警告但保留普通活动记录。归档目录变化生成“归档内容异常”行动和活动摘要，建议创建新 Change，但绝不修改文件、移动目录或进入实施轮次。

备选方案是把任何已有 Change 名称或相似需求文字当成二次开发。名称和自然语言没有稳定身份契约，无法区分同一 Change、能力演进和复制文件，因此只使用目录身份、任务状态转换和 capability 路径这些可验证事实。

### 6. 行动中心组合现有生命周期结论，而不重建工作流

新增 `ActionCenterService` 和版本化 `ActionCenterSnapshot` 契约。快照包含作用域（all 或单个 project）、生成时间、按项目独立的 root health、行动计数以及有序 `ActionCenterItem[]`。每个 Change 最多贡献一项，item 包含稳定 action key、项目/Change 身份、优先级、原始 `LifecycleNextAction`、可定位证据、内容指纹、ChangeWorkState 和最近活动时间。

ActionCenterService 为全部已登记项目取得当前扫描；对 active Change 复用 LifecycleService 评估，对 archived Change 默认不把 `review-archive` 作为待办，仅在归档异常时产生行动。项目级 doctor/context 问题单独形成 health 行动，不覆盖同项目仍能由结构扫描证明的任务待办，也不影响其他项目。

排序固定为：项目/root 不可用或健康异常、工件 incomplete/unknown、继续实施、验证、归档确认、归档异常；同优先级先按最近活动倒序，再按项目 ID 和 Change ID 升序稳定排序。聚焦当前项目只过滤同一份规范化结果，不重新定义优先级。

跨项目构建使用最多 4 个并发 status 调用，复用生命周期短缓存；doctor/context 每个根最多一个并共享 30 秒缓存。单个 CLI 调用失败只降级对应项目或 Change。行动快照带 `complete`/`partial` 计算状态和逐项目诊断，避免一个慢项目让其他结果显示为空白或成功。

自定义 artifact 通过 `LifecycleNextAction.targetArtifactId` 保留真实 artifact ID；六节点轨道无法定位时可回到 proposal/工件列表，但行动中心标题、instructions 和交接内容必须使用真实 ID。

备选方案是从 ChangeProjection.stage 直接生成全局待办。stage 无法表达自定义工件依赖、验证新鲜度和 OpenSpec root 健康，会重复已经集中在 LifecycleService 中的判断，因此只把它用于 CLI 降级时的结构导航。

### 7. 扩展受限 CLI 适配器并只向 renderer 返回归一化摘要

`RestrictedOpenSpecCli` 增加硬编码方法：

- `doctor(projectRoot)` 运行 `doctor --json`，归一化 root healthy/source、reference 关系和有限 status 诊断。
- `context(projectRoot)` 运行 `context --json`，归一化 root role、members 和有限 status；永不传 `--code-workspace` 或 `--force`。
- `instructions(projectRoot, changeId, target)` 只允许 target 为当前工件图返回的 artifact ID、`apply` 或 `archive`，并归一化 schema、依赖、context file 相对路径、任务进度和受限 instruction 摘要。

所有方法继续使用 `execFile` 等价的无 shell 执行、最小环境、固定超时和输出上限。projectRoot 和 changeId 由 AppController 重新解析，renderer 不能传命令、cwd、schema、store 或任意参数。JSON 中的绝对路径只有在归一化到已验证根目录内时才保留为安全相对路径；未知字段忽略，诊断消息去根路径并截断。

status 是构建行动队列的主要来源；instructions 只在用户展开工件行动或生成交接时按需调用，避免为每个列表项加载模板、rules 和 context 正文。doctor/context 按项目根调用并允许结构降级。

备选方案是向 renderer 暴露通用 `openspec(args)`。它会让项目内容、命令范围和输出大小失去主进程控制，也使只读边界不可审计，因此不采用。

### 8. Codex 交接由主进程按当前行动重新生成

新增 `buildCodexHandoff({ actionKey, evidenceFingerprint })`。主进程根据 action key 重新解析 catalog、项目根、Change 和当前行动；若内容指纹已变化，返回 stale 标志和新行动，不按旧证据生成误导性指令。随后按行动类型读取受限 instructions 摘要：工件行动使用真实 artifact ID，实施使用 apply，归档确认使用 archive，健康行动使用 doctor/context。

返回的 `CodexHandoff` 是长度受限的 Markdown，包含显示标题、项目根、Change ID、行动类型、当前计数/阻塞、相关相对文件、OpenSpec 建议命令和明确的只读来源说明。它引用工件路径而不内嵌 proposal/spec/task 正文，也不包含未经归一化的 CLI 原始输出。

renderer 提供“复制交接”和“打开 Change”两个明确命令；复制优先使用受限长度的系统剪贴板能力，失败时显示可选中的交接预览。打开 Change 只切换应用内部项目、Change 和对应详情标签。自动创建 Codex 任务留待有稳定、受支持的桌面集成后单独设计。

备选方案是由 React 根据可见文案拼接 prompt。可见文本可能已截断或过期，并会重复安全路径解析；主进程拥有完整的当前证据和受限 CLI 入口，因此在那里生成。

### 9. 在三栏工作区增加应用级行动模式并保持高密度

项目侧栏顶部增加“行动中心”入口和未处理计数。选中后，第二栏显示跨项目行动队列，顶部使用“全部项目 / 当前项目”分段控制；第三栏显示当前行动的证据、OpenSpec 健康、轮次信息和 Codex 交接预览。行动行使用项目名、Change ID、图标、短行动文案和计数，不使用嵌套卡片；选择行只更新证据，只有“打开 Change”才退出行动模式并切回正常工作区。

正常 Change 列表和详情标题读取同一 `ChangeWorkState`：reopened 显示“再次实施 · 第 N 轮”，evolution/mixed 显示“能力迭代”，两者正交且可同时出现。活动视图继续显示 HistoryStore 的语义 summary、任务差量和版本上下文。归档异常使用警告图标和文字，不使用实施中的颜色或进度。

生命周期 tasks 节点为 `ready` 使用中性清单图标和“清单已就绪/不适用”，`current` 显示实际 X/Y 与剩余数，`complete` 才使用绿色对勾。所有状态具有可访问文本、可见焦点和非颜色编码；最小窗口下行动列表和证据栏独立滚动，长项目根和 Change ID 截断但可查看完整值。

备选方案是在每个项目下嵌入一个小行动面板。它仍要求逐项目切换，无法完成跨项目扫描，也会挤压 Change 列表，因此使用独立工作区模式。

### 10. 用专用 IPC、查询失效和显式刷新保持证据新鲜

preload/DesktopApi 增加：

- `getActionCenter({ projectId? })`：无 projectId 表示全部已登记项目，有 projectId 表示聚焦该项目。
- `refreshActionCenter({ projectId? })`：绕过 action/health 缓存，但仍使用相同边界和并发限制。
- `buildCodexHandoff({ actionKey, evidenceFingerprint })`：返回归一化交接预览。

请求只接受 local ID、受限 action key 和固定长度指纹；AppController 从 catalog 解析根目录并拒绝失效项目、伪造 Change 或过期 action。现有 projection event 在项目文件、版本上下文、轮次状态或验证结果变化时使对应 lifecycle 与 action-center React Query key 失效。刷新期间保留上一份结果并显示新鲜度，不用空白替换可用证据。

备选方案是把全部行动直接塞进 AppSnapshot。它会让每次 catalog 或 UI 偏好更新都触发跨项目 CLI 工作，也无法表达按需刷新与 partial 状态，因此使用独立查询。

## Risks / Trade-offs

- [首次观察时缺少历史会漏标真实二次开发] → 选择保守漏报而非误报；只有应用确认过非空全完成后才允许 reopened，界面明确从本地观察开始计轮次。
- [自定义 schema 的 tasks 语义与结构降级不同] → CLI 工件图可用时以 apply 依赖为准；降级无法证明 tasks 适用时不建立轮次，并显示来源。
- [跨项目 status 调用造成延迟或进程峰值] → 限制并发、复用 Promise/TTL、instructions 懒加载并允许逐项目 partial；文件浏览不等待行动中心。
- [状态文件损坏或旧版本迁移失败] → 原文件备份、回到无轮次的保守基线并显示本地证据问题，项目文件不受影响。
- [active/archive 同名或目录移动导致身份混淆] → active generation 在归档时冻结，新出现的 active 同名目录重新建立基线；归档 baseline 由首次稳定归档指纹建立。
- [归档文件被工具合法重写仍触发警告] → 警告只陈述 baseline 后内容变化并建议新 Change，不自动阻塞、回滚或改变归档事实。
- [行动在用户复制前已过期] → handoff 请求携带 evidence fingerprint 并由主进程重算；不匹配时返回 stale 和新行动。
- [新 `ready`/`empty` 状态影响旧渲染分支] → 共享 schema、标签、图标和 evaluator 测试同时更新；Electron main/preload/renderer 作为同一版本发布。
- [清除历史后轮次徽标消失] → 明确确认文案把轮次证据列为清除范围；操作后以当前稳定状态重新建立第 1 轮基线，不回溯猜测。

## Migration Plan

1. 先扩展共享 task/work-state/action-center 契约和纯 evaluator 测试，修正 tasks 节点，但不启用持久轮次或新 UI。
2. 加入 ChangeWorkStateStore、状态机和损坏恢复测试；在 AppController 稳定投影链路以后台 reconcile 建立基线，并验证不会重复活动。
3. 加入能力迭代和归档指纹评估，把 work state 覆盖到 AppSnapshot/lifecycle 结果；为现有历史清除流程增加明确的联合清理。
4. 扩展 RestrictedOpenSpecCli 的 doctor/context/instructions 归一化与安全测试，再实现 ActionCenterService、partial 聚合和 handoff 重算。
5. 增加 IPC/preload/React Query 契约和投影失效，随后接入应用级行动模式、再次实施/能力迭代徽标、任务节点语义和活动展示。
6. 使用 57/57 -> 57/64、新增任务、取消勾选、0/0、首次 incomplete、重启、历史裁剪、自定义 artifact、CLI 缺失、多个项目部分失败、active -> archive 和归档修改作为端到端夹具。
7. 回滚代码时可移除新 UI、IPC 和服务；`change-work-state/` 是独立可丢弃数据，旧版本会忽略它。未升级现有 history index，OpenSpec 项目目录没有迁移或回写。
