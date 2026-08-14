## Context（背景）

参见 `proposal.md` 的 Why。当前扫描器能够发现标准 OpenSpec 路径、解析 Markdown 标题和任务，并把 Change 投影为 `stage`、`readiness`、工件列表与任务总数。`readiness` 目前只区分结构完整、结构不完整和解析错误，`validation` 固定为尚未运行；渲染进程据此显示阶段徽标和单一任务进度条。

应用已经具备稳定写入去抖、内容哈希、本地修订历史、受限 IPC、React Query 缓存和三栏工作区。项目文件必须继续保持只读，OpenSpec CLI 不是应用启动和基础浏览的强制依赖。生命周期能力因此需要组合 CLI 权威结果与现有结构扫描，并明确标注两者的来源和精度。

本机 OpenSpec CLI 支持 `status --change <id> --json` 和 `validate <id> --strict --json --no-interactive`。前者可以提供实际 schema、工件依赖与 done/skipped/blocked 状态，后者可以提供机器可读的严格验证结果；CLI 没有为任意 delta/main spec 对比提供适合桌面只读预览的直接接口。

## Goals / Non-Goals（目标与非目标）

**Goals（目标）：**

- 建立单一、确定性的生命周期评估器，把目录、工件、任务、验证和归档就绪保持为独立维度，并把规格比较限定为归档影响信息。
- 在 CLI 存在时使用 OpenSpec 自身的工件图和严格验证结果，在 CLI 缺失时保留结构扫描与明确降级。
- 使用结构化 delta spec 比较提供可解释的同步预览，不把普通文本相似度当作同步成功。
- 复用现有实时监控和查询失效链路，使文件变化及时更新结构结论并使旧验证结果过期。
- 保持渲染进程无文件系统和进程执行权限，并让所有状态证据可追溯、可限制、可清除。

**Non-Goals（非目标）：**

- 不从应用执行 spec 同步、Change 归档、任务勾选或任何项目文件写入。
- 不为 Requirement 与 Task 猜测或生成追踪关系；OpenSpec 当前没有强制的逐任务关联契约。
- 不实现项目组合仪表盘、Codex 任务绑定、跨 Change 冲突检测或 GitHub Release 编排。
- 不持续监听或轮询 OpenSpec CLI；严格验证仅由用户触发，结构与同步评估跟随已有扫描生命周期。
- 不把派生生命周期状态写入 `.openspec.yaml`，项目中的 OpenSpec 文件继续是唯一事实来源。

## Decisions（设计决策）

### 1. 使用独立的生命周期评估结果，不扩张现有单一阶段语义

新增版本化的 `ChangeLifecycleAssessment` 契约，包含：

- Change 身份、是否归档、评估时间和内容指纹
- 有序 `nodes`：proposal、specs、design、tasks、validation、archive
- `artifactGraph`：schema、工件状态、依赖和来源
- `taskGate`：完成数、总数、剩余数及是否适用
- `validation`：not-run、running、passed、failed、unavailable 或 stale
- `sync`：not-applicable、pending、synced 或 unknown，以及按 capability/operation 汇总的归档影响证据；该字段不生成节点、门槛、下一步或 blocker
- `archiveReadiness`：not-ready、ready 或 archived
- 一个 `nextAction` 与有序 `blockers`

现有 `ChangeProjection.stage` 和结构 `readiness` 暂时保留，保证列表、历史夹具和旧 IPC 兼容；新界面只在需要判断完整生命周期时消费新契约。派生结果不进入 catalog，也不作为活动历史记录。

备选方案是继续给 `stage` 增加 `needs-validation`、`needs-sync` 等枚举。这样会把互相独立且可能同时成立的事实压成互斥状态，无法解释“任务完成但验证过期”，因此不采用。

### 2. CLI 工件图为权威来源，结构扫描为有标记的降级来源

`LifecycleService` 在项目初次加载、稳定的 OpenSpec 文件变化、重新扫描和显式刷新时，为受影响 Change 调用一个有去重与短缓存的工件状态提供器：

1. 若找到兼容 CLI，执行 `openspec status --change <changeId> --json`，解析 schema、artifact requires 边与 done/skipped/blocked 状态。
2. 若 CLI 不可用、超时或输出不兼容，使用当前扫描器已有的工件存在性、解析健康和默认 spec-driven 顺序生成结构降级结果。
3. 降级结果的来源必须为 `structural`，无法从文件存在性证明的 skipped、条件工件和自定义 schema 状态保持 unknown。

Change ID 必须来自当前扫描投影，不接受渲染进程传入任意 CLI 参数。归档 Change 不再调用需要活动 change 路径的 CLI status，而是使用目录与可读工件生成只读历史评估。

备选方案是完全复制 OpenSpec schema 图解析。OpenSpec 工作流可以扩展且 CLI 已经提供权威 JSON，复制会持续漂移；完全依赖 CLI 又会破坏当前无需安装 CLI 的基础能力，因此采用分层来源。

### 3. 严格验证由显式命令执行，并绑定内容指纹

新增 `ValidationRunner` 与按 project/change 串行去重的协调器。用户点击验证时，主进程使用 `execFile` 运行：

`openspec validate <changeId> --strict --json --no-interactive`

命令使用经过验证的项目根目录作为 cwd，禁止 shell，设置隐藏窗口、固定超时、stdout/stderr 总上限和最小环境继承。返回 JSON 先经过大小限制和 schema 归一化，只把状态、受影响项、严重级别、安全消息和可定位路径送到渲染进程；原始输出不进入日志或历史。

验证开始前基于以下内容生成稳定 SHA-256 指纹：Change 元数据与工件内容哈希、相关 delta specs、对应主规格以及 `openspec/config.yaml`。通过或失败结果连同指纹、CLI 版本和完成时间保存到 user-data 下独立的可丢弃缓存。任何相关哈希变化都会把结果标记为 stale，而不是删除诊断；用户可看到旧结论及其失效原因。

备选方案是在每次文件保存后自动严格验证。大项目中启动 CLI 会造成延迟和进程抖动，也可能在 AI 的多文件保存中间产生短暂失败，因此首版只主动运行并用失效提示要求复验。

### 4. 用 OpenSpec 结构语义计算归档影响

新增独立的 delta spec 解析与比较模块，复用现有 unified/remark 依赖读取标题层级和正文块，不使用正则拼接或全文相似度。解析器识别 Purpose、ADDED、MODIFIED、REMOVED、RENAMED、Requirement 和 Scenario，并保留来源范围供 UI 定位。

每个 capability 使用其 delta 相对路径映射到 `openspec/specs/<capability-path>/spec.md`，在验证根目录边界后比较：

- ADDED：目标 Requirement 与完整场景已存在且等价时为已应用，否则为待应用。
- MODIFIED：目标 Requirement 存在且其完整规范化内容等于 delta 的完整更新块时为已应用；目标缺失或 delta 不是完整块时为冲突/未知。
- REMOVED：目标已不存在时为已应用，仍存在时为待应用。
- RENAMED：旧名称不存在且新名称存在时为已应用；两者同时存在或同时缺失时为冲突/未知。
- 新 capability：主规格不存在时标记为归档时将同步；归档创建后的主规格包含 Purpose 与所有新增内容时为已同步。

规范化只统一换行、标题空白和 Markdown AST 中无语义的格式差异，不改写文本、场景顺序或 MUST/SHALL 语义。任意文件不可读、操作格式不合法或目标不唯一时，该 capability 为 unknown；总体预览状态不能比最不确定的 capability 更乐观。该结论只影响归档详情中的提示，不覆盖 OpenSpec CLI 严格验证，也不参与归档 readiness。

备选方案是调用 `git diff` 或比较整文件文本。归档后的主规格布局与 delta 文件不同，纯文本比较无法识别删除和重命名是否已应用，因此不采用。

### 5. 归档就绪使用纯函数和固定优先级

`evaluateLifecycle` 是无 I/O 纯函数，只消费已归一化输入并返回节点、主要建议与阻塞项。主要建议按以下优先级选择：

1. 项目或 Change 不可用：恢复路径或修复解析。
2. CLI 工件图存在未完成依赖：完成最早的 ready 工件或解除 blocker。
3. 适用的 tasks 存在未勾选项：继续实施。
4. 验证未运行、失败、不可用或 stale：运行或修复严格验证。
5. 工件、任务和验证均满足：等待用户确认归档，结论为 `ready`；若存在 pending delta，则在归档描述中附带影响摘要。
6. Change 已归档：只显示归档事实，不再生成写操作建议。

工件门槛以 CLI 返回的 apply 依赖闭包为准，done 和 skipped 均满足；结构降级无法证明条件跳过时不得给出 `ready`。无 tasks 工件且 schema 不要求 tasks 时任务门槛为不适用，而不是零任务错误。元数据中的 `status: completed` 仅作为展示线索，不能覆盖未完成任务或失败、过期及不可用的验证。归档 gates 只包含 artifacts、tasks 和 validation。

备选方案是让 UI 组件自行拼装状态。多处条件分支容易出现列表、详情和归档提示互相矛盾，且难以穷举测试，因此集中为共享领域规则。

### 6. 生命周期缓存独立、可重建且不会污染历史

只持久化人工触发且成本较高的验证结果；工件图、归档影响预览、节点和下一步建议均从当前扫描结果实时派生。验证缓存位于 user-data 的 `lifecycle-validation/` 下，使用版本化 schema、项目 ID 与包含 archive 前缀的 Change 键，采用现有原子临时文件替换模式。

缓存损坏时移动为带时间戳的备份并回到 not-run，不影响 catalog、文档投影或历史。项目取消登记时按现有本地数据策略保留或清理缓存；设置中的“清除本地历史”必须明确说明是否同时清除验证缓存，避免隐藏副作用。

备选方案是把验证写入 activity/history index。验证不是项目文件修订，保留周期和失效语义也不同，混入历史会制造噪声，因此分离。

### 7. 通过两个受限 IPC 路由暴露评估与验证

preload 增加：

- `getChangeLifecycle({ projectId, changeId, archived })`
- `runChangeValidation({ projectId, changeId })`

主进程根据 catalog 与当前投影重新解析实际路径和 Change 身份，拒绝不存在、路径穿越、归档目标验证请求和并发重复参数。`getChangeLifecycle` 可以触发有去重的 status/sync 读取，但不能执行项目写入；`runChangeValidation` 是唯一允许启动严格验证的入口。

Watcher 的稳定投影事件继续作为统一失效信号：更新项目 snapshot 后，使对应 lifecycle 查询失效，并根据哈希把验证标记 stale。验证进行中收到文件变化时允许进程结束，但结果的起始与结束指纹不一致则直接保存为 stale，不能短暂显示 passed。

备选方案是把 CLI 放在 renderer 或直接暴露通用命令执行 API。两者都会突破当前 Electron 安全边界，因此不采用。

### 8. 在现有三栏工作区中增加轨道与“就绪”视图

Change 详情标题下增加全宽、固定高度的六节点紧凑生命周期轨道；最小窗口时允许水平滚动并保持每个节点稳定尺寸，不缩放字体。轨道不是一排可误认成命令的彩色徽章：工件节点可导航到文档，验证和归档节点切换到新增的“就绪”标签。

“就绪”视图使用无嵌套卡片的分区布局：顶部是唯一建议下一步和阻塞摘要，下方依次为工件依赖、验证诊断与归档门槛；规格比较结果折叠进归档区的“规格影响”，不再拥有独立节点或主要阶段文案。Change 列表把分段名称改为“当前变更 / 已归档”，行内保留任务进度，并只显示“待验证”“可归档”等用户需要采取行动的短阶段。

节点和证据使用 Lucide 图标、文本、边框与状态符号共同编码；绿色只用于有当前证据的通过状态，unknown/stale 使用中性或警告语义。复用现有短时 CSS motion tokens，轨道状态更新只改变 opacity、color 和 transform，并完整遵循 reduced-motion、reduced-transparency 和键盘焦点规则。

备选方案是新增独立大屏仪表盘。个人桌面工具的主要工作流仍是选择 Change 后阅读和判断，独立仪表盘会增加导航层级并降低信息密度，因此首版嵌入现有详情。

### 9. 生命周期评估按 Change 增量更新并限制资源消耗

扫描器为每个 Change 维护由工件内容哈希组成的输入摘要。只有摘要、对应主规格或 config 改变时才重算同步预览；同一 project/change 的并发请求共享 Promise，短时间连续保存由现有 watcher 稳定窗口合并。

CLI status 使用短超时和输出上限；严格验证使用较长但有限的独立超时，运行期间按钮显示忙碌并禁止重复提交，但不得阻止文档、活动和修订交互。项目切换不会强杀共享任务，结果只写入原项目缓存且不会错误更新当前选择。

备选方案是每次 React 渲染直接读取和比较文件。它会绕过主进程边界并重复 I/O，因此所有评估留在主进程并由查询缓存消费。

### 10. Change 列表在渲染层稳定排序并按范围分页

项目快照已经包含全部 `ChangeProjection`，首版不增加分页 IPC。`ChangeList` 先按 active/archive 过滤，再使用纯函数排序：具有 `lastActivityAt` 的条目按 ISO 时间降序，时间相同按 `id` 的英文序升序，缺少时间的条目排在最后。排序始终基于副本，不改变主进程返回的快照。

每个范围固定每页 10 条。组件维护当前页，在项目或 active/archive 范围变化时回到第一页；实时更新导致总页数减少时把页码收敛到最后一个有效页。选择继续由 Change ID 表达，排序和分页不得按数组索引改选其他 Change。总页数为 1 时不渲染分页，超过一页时使用带可访问名称的上一页/下一页图标按钮与“第 N / M 页”文本。

备选方案是引入虚拟列表或主进程 cursor pagination。当前快照规模和固定行高尚不需要新增依赖或 IPC；若未来扫描结果达到数百至数千条，再把同一排序契约下沉到查询层。

## Risks / Trade-offs（风险与权衡）

- [OpenSpec CLI 版本或 JSON schema 漂移] → 对 status/validate 输出做宽松外层、严格所需字段解析；未知字段忽略，缺少关键字段时降级并显示 CLI 不兼容，而不是猜测通过。
- [结构降级与 CLI 权威状态不同] → 始终展示来源；只有权威工件图与当前严格验证才能产生 `ready`，结构降级只用于导航和进度参考。
- [delta/main 结构比较出现格式差异] → 使用 AST 和保守规范化；无法唯一匹配时返回 unknown 并显示具体 capability，但不以本地预览覆盖 CLI 的权威归档就绪结论。
- [验证缓存被旧结果误用] → 指纹覆盖 Change、相关主规格与配置；文件事件即时标记 stale，运行跨越内容变化时结果直接过期。
- [大型规格树比较影响实时体验] → 按受影响 capability 增量计算、共享并发请求并设置文件数量/大小上限；超限时返回明确 unknown。
- [生命周期轨道挤压现有详情空间] → 使用固定紧凑尺寸、六节点布局、最小窗口水平滚动和独立就绪标签，不在每个节点展开正文。
- [“归档时将同步”被误解为应用已经修改主规格] → 文案明确区分只读预览和 OpenSpec 归档将执行的写入；首版不提供同步或归档执行按钮。
- [实时更新导致页码越界或选择漂移] → 每次派生列表时收敛有效页码，选择始终按 Change ID 保留，项目与范围切换明确回到第一页。

## Migration Plan（迁移计划）

1. 先增加向后兼容的共享契约、纯评估器与真实组合夹具，不改变现有 Change 列表行为。
2. 接入 CLI status/validation 适配器、delta spec 结构比较和验证缓存，保持新 IPC 未被 UI 调用时对现有扫描零影响。
3. 在 AppController 与 watcher 投影事件中接入生命周期失效，验证项目切换、文件连续保存和 CLI 缺失降级。
4. 增加“就绪”标签与六节点生命周期轨道，再把列表导航文案切换为“当前变更 / 已归档”。
5. 将规格影响折叠到归档详情，并为两个 Change 范围增加稳定倒序与条件分页。
6. 用已有完整、未完成、解析错误、新能力归档时将更新和归档 Change 作为桌面验收样本，确认每个结论均能展开到证据。
7. 回滚时移除新 UI 与 IPC 即可；新增验证缓存为可丢弃数据，catalog、历史索引和项目文件无需迁移或回写。
