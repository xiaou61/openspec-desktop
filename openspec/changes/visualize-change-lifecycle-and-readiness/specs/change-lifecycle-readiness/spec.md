## Purpose

把 OpenSpec Change 的工件、任务、验证与归档事实组合成可解释且可追溯的生命周期视图，并以归档影响形式展示规格变化；同时让大量 Change 保持按时间可预测地浏览。

## ADDED Requirements

### Requirement: 生命周期状态必须由独立事实组成

系统 MUST 为每个 Change 分别维护目录状态、工件状态、任务状态、严格验证状态、归档影响预览和归档就绪状态，并 MUST NOT 用任务百分比或单一阶段替代其他维度。归档影响预览 MUST NOT 被建模为生命周期阶段或归档门槛。

#### Scenario: 任务全部完成但尚未归档

- **WHEN** 当前 Change 的任务全部勾选，但尚未取得有效的严格验证结果或归档时仍将应用 delta specs
- **THEN** 系统 MUST 显示任务已完成
- **THEN** 系统 MUST 分别显示验证缺口或归档影响说明，而不是把 Change 标记为已归档

#### Scenario: Change 已进入归档目录

- **WHEN** Change 位于 OpenSpec 归档目录
- **THEN** 系统 MUST 将目录状态显示为已归档
- **THEN** 系统 MUST 保留并展示归档前可读取的任务、验证与规格影响事实，不把它们合并成一个状态

#### Scenario: 某个维度无法判断

- **WHEN** 解析错误、工具不可用或缺少证据导致某个状态无法可靠计算
- **THEN** 系统 MUST 将该维度显示为未知或不可用
- **THEN** 系统 MUST NOT 将未知状态渲染为已完成或已通过

### Requirement: 生命周期轨道必须反映 OpenSpec 工件顺序

系统 MUST 在 Change 详情中按提案、规格、设计、任务、验证和归档的顺序展示生命周期轨道，并为每个节点提供已完成、当前、阻塞、待处理、不可用或已归档中的适用状态。系统 MUST NOT 在该轨道中显示独立的同步节点。

#### Scenario: Change 只有 proposal

- **WHEN** Change 已存在 proposal 但 specs、design 和 tasks 尚未就绪
- **THEN** 轨道 MUST 标记提案已完成
- **THEN** 轨道 MUST 根据 OpenSpec 工件依赖显示下一批可创建或仍受阻塞的节点

#### Scenario: 用户激活工件节点

- **WHEN** 用户点击或通过键盘激活 proposal、specs、design 或 tasks 节点
- **THEN** 系统 MUST 导航到对应工件或工件集合
- **THEN** 焦点、选中状态与可访问名称 MUST 明确指出当前节点

#### Scenario: 用户激活检查节点

- **WHEN** 用户激活验证或归档节点
- **THEN** 系统 MUST 打开该检查的结果与证据，而不是把它伪装成普通 Markdown 文件
- **THEN** 归档节点的证据 MUST 包含可用的规格影响预览

### Requirement: 系统必须给出唯一且可解释的建议下一步

系统 MUST 根据当前可用证据生成一个主要建议下一步，并同时列出阻塞该步骤的具体原因；建议 MUST 按项目不可用、工件缺失、任务未完成、验证未通过或过期、可归档的顺序确定。规格影响预览无论结果如何都 MUST NOT 成为独立的建议步骤。

#### Scenario: 存在最早未完成工件

- **WHEN** proposal 已完成但 specs 仍缺失或受阻塞
- **THEN** 主要建议 MUST 指向规格阶段
- **THEN** 系统 MUST 展示缺失依赖或无法解析的文件作为原因

#### Scenario: 工件完整但任务未完成

- **WHEN** 所需工件均已完成且 tasks 中仍有未勾选任务
- **THEN** 主要建议 MUST 是继续实施剩余任务
- **THEN** 建议区域 MUST 显示已完成数、总数和剩余数

#### Scenario: 所有前置事实满足

- **WHEN** 工件、任务和有效验证均满足归档条件
- **THEN** 主要建议 MUST 是等待用户确认归档
- **THEN** 待应用的 delta MUST 作为归档将执行的操作摘要展示
- **THEN** 系统 MUST NOT 自动执行归档

#### Scenario: 状态证据互相冲突

- **WHEN** 文件结构、元数据或检查结果之间存在无法自动消解的冲突
- **THEN** 系统 MUST 把冲突列为阻塞原因并建议人工检查
- **THEN** 系统 MUST NOT 任意选择一个成功状态覆盖冲突

### Requirement: 严格验证必须可主动执行且结果可追溯

系统 MUST 允许用户为当前 Change 主动运行等价于 OpenSpec 严格验证的只读检查，并展示运行中、通过、失败、不可用与已过期状态；结果 MUST 包含检查时间、目标 Change 和经安全处理的诊断信息。

#### Scenario: 严格验证通过

- **WHEN** 用户触发严格验证且本机 OpenSpec 对当前 Change 返回成功
- **THEN** 系统 MUST 显示验证通过及完成时间
- **THEN** 该结果 MUST 只归属于本次验证所针对的内容版本

#### Scenario: 严格验证失败

- **WHEN** OpenSpec 返回一个或多个验证错误
- **THEN** 系统 MUST 显示失败状态和可操作的错误摘要
- **THEN** 用户 MUST 能定位到相关能力、需求或工件，而无需阅读未受限的原始进程输出

#### Scenario: OpenSpec CLI 不可用

- **WHEN** 系统找不到兼容的本机 OpenSpec CLI、命令超时或进程无法启动
- **THEN** 验证状态 MUST 显示不可用并说明恢复方式
- **THEN** 项目扫描、文档查看、任务进度与历史浏览 MUST 继续可用

#### Scenario: 验证后相关文件发生变化

- **WHEN** 已取得验证结果后，当前 Change、相关 delta spec、主规格或 OpenSpec 配置发生变化
- **THEN** 既有验证结果 MUST 立即标记为已过期
- **THEN** 归档就绪判断 MUST NOT 把已过期结果当作通过

### Requirement: 归档影响预览必须反映可能执行的 delta 操作

系统 MUST 在归档详情中只读比较 Change 的 delta specs 与对应主规格，并按能力展示 ADDED、MODIFIED、REMOVED 和 RENAMED 操作的数量、目标与匹配结果；总体状态 MUST 区分无需更新、归档时将更新、已反映和预览不可用。该预览 MUST 被描述为参考信息，而不是生命周期节点、归档门槛或要求用户先执行的写入步骤。

#### Scenario: 新能力尚未进入主规格

- **WHEN** delta spec 声明新增能力或需求，而对应主规格尚不存在或缺少这些内容
- **THEN** 归档影响 MUST 显示归档时将更新主规格
- **THEN** 预览 MUST 显示将新增的能力、需求和场景摘要

#### Scenario: delta 内容已经反映在主规格

- **WHEN** 每个 delta 操作均能在主规格中验证为已应用
- **THEN** 归档影响 MUST 显示已反映
- **THEN** 系统 MUST 展示完成匹配的能力数量和最近检查时间

#### Scenario: Change 不需要 delta specs

- **WHEN** OpenSpec 元数据明确声明跳过规格且不存在 delta spec
- **THEN** 归档影响 MUST 显示无需更新主规格
- **THEN** 归档就绪 MUST 继续由其他权威门槛决定

#### Scenario: delta spec 无法安全比较

- **WHEN** delta 操作格式无效、目标主规格不可读或存在无法消解的重命名与修改冲突
- **THEN** 归档影响 MUST 显示预览不可用并列出受影响能力
- **THEN** 系统 MUST 把该结果显示为警告，但 MUST NOT 仅凭本地预览覆盖已经通过的 OpenSpec 严格验证或阻止显示“可归档”

### Requirement: 归档就绪必须只使用权威门槛

系统 MUST 将未归档 Change 的归档结论区分为不可归档和可归档；判断 MUST 使用当前工件、任务和有效的 OpenSpec 严格验证，且归档动作 MUST 始终保留给用户明确确认。系统 MUST NOT 从本地规格影响预览派生额外门槛或“先同步、再归档”的流程。

#### Scenario: 所有权威门槛均满足

- **WHEN** 所需工件均完成或明确跳过、任务无未完成项，并且严格验证通过且未过期
- **THEN** 系统 MUST 显示可归档
- **THEN** 系统 MUST 展示每项门槛的通过证据

#### Scenario: 归档将应用可安全比较的 delta

- **WHEN** 工件、任务和严格验证均满足，且 delta specs 尚未反映到主规格但全部操作可安全比较和应用
- **THEN** 系统 MUST 显示可归档
- **THEN** 归档详情 MUST 说明归档时将更新主规格
- **THEN** 主要建议 MUST 指向用户确认归档，而不是要求先独立同步主规格

#### Scenario: 规格影响预览不可用但严格验证通过

- **WHEN** 工件与任务均完成、严格验证通过且未过期，但本地规格影响预览无法判断
- **THEN** 系统 MUST 继续显示可归档
- **THEN** 系统 MUST 在归档详情中显示预览不可用警告，并保留 OpenSpec CLI 为权威来源的说明

#### Scenario: 仍有未完成任务

- **WHEN** 至少一个任务未勾选
- **THEN** 系统 MUST 显示不可归档并列出剩余任务数量
- **THEN** 即使元数据声明 completed，系统也 MUST NOT 显示可归档

#### Scenario: 用户查看已归档 Change

- **WHEN** Change 已位于归档目录
- **THEN** 系统 MUST 显示已归档而不是再次计算可归档操作
- **THEN** 系统 MUST 提供归档路径或归档日期等可用证据

### Requirement: 当前变更与已归档必须采用准确导航语义

系统 MUST 使用“当前变更”表示尚未进入归档目录的 Change，使用“已归档”表示归档目录中的 Change；当前变更内部 MUST 继续展示草稿、实施中、任务已完成、待验证和可归档等阶段，且 MUST NOT 使用“同步后可归档”作为阶段。

#### Scenario: 已完成任务的当前 Change

- **WHEN** Change 的任务全部完成但目录仍位于当前 changes 下
- **THEN** 它 MUST 出现在“当前变更”中并显示任务已完成或更具体的就绪阶段
- **THEN** 它 MUST NOT 出现在“已归档”中

#### Scenario: Change 被外部 OpenSpec 流程归档

- **WHEN** Codex、OpenSpec CLI 或用户把 Change 移入归档目录
- **THEN** 应用 MUST 在下一次稳定扫描后把它移入“已归档”视图
- **THEN** 当前选择失效时系统 MUST 选择可预测的相邻项或显示明确空状态

### Requirement: Change 列表必须按最近活动倒序并支持分页

系统 MUST 在“当前变更”和“已归档”范围内分别按最近活动时间倒序排列 Change，并 MUST 在单个范围超过 10 条时分页。已知时间相同时 MUST 按 Change ID 升序稳定排序，缺少时间的 Change MUST 排在所有具有时间的 Change 之后。

#### Scenario: 当前变更具有不同活动时间

- **WHEN** 当前变更列表包含多个具有不同最近活动时间的 Change
- **THEN** 第一页第一项 MUST 是最近活动时间最新的 Change
- **THEN** 后续项目 MUST 按时间从新到旧排列

#### Scenario: 多个 Change 活动时间相同或缺失

- **WHEN** 多个 Change 具有相同最近活动时间，或部分 Change 缺少最近活动时间
- **THEN** 相同时间的 Change MUST 按 Change ID 升序排列
- **THEN** 缺少时间的 Change MUST 排在已知时间之后并同样按 Change ID 升序排列

#### Scenario: Change 数量超过一页

- **WHEN** 当前范围内的 Change 数量超过 10 条
- **THEN** 系统 MUST 每页显示最多 10 条并显示当前页、总页数、上一页和下一页控件
- **THEN** 第一页的上一页与最后一页的下一页 MUST 禁用

#### Scenario: Change 数量不超过一页

- **WHEN** 当前范围内的 Change 数量不超过 10 条
- **THEN** 系统 MUST 显示全部 Change
- **THEN** 系统 MUST NOT 显示无意义的分页控件

#### Scenario: 用户切换项目或 Change 范围

- **WHEN** 用户切换项目，或在“当前变更”和“已归档”之间切换
- **THEN** 新范围 MUST 从第一页显示
- **THEN** 列表重新排序或分页时 MUST 通过 Change ID 保留仍然有效的当前选择，而不是按旧索引选择其他 Change

### Requirement: 生命周期结论必须展示来源与新鲜度

系统 MUST 为验证、归档影响与归档就绪等派生结论展示检查来源和最近检查时间，并在依赖文件改变后使受影响结果失效；用户 MUST 能查看形成结论的文件或诊断证据。

#### Scenario: 用户查看阻塞原因

- **WHEN** 用户展开一个阻塞或未知节点
- **THEN** 系统 MUST 显示导致该结论的文件、任务计数或验证诊断，并把规格差异作为归档影响证据单独展示
- **THEN** 每条证据 MUST 标明来自结构扫描、OpenSpec CLI 或本地比较中的哪一种来源

#### Scenario: 实时监控发现任务变化

- **WHEN** tasks.md 的勾选状态在监控期间发生变化
- **THEN** 任务节点、建议下一步和归档就绪 MUST 在稳定扫描后重新计算
- **THEN** 不依赖该文件的历史验证详情 MAY 保留，但其可用性 MUST 按失效规则更新

#### Scenario: 用户手动重新扫描

- **WHEN** 用户触发项目重新扫描
- **THEN** 系统 MUST 重新计算结构状态和归档影响预览
- **THEN** 界面 MUST 保持当前 Change 与已打开检查节点，只更新其状态和证据

### Requirement: 生命周期检查必须保持本地只读边界

系统 MUST 仅在本机主进程中执行生命周期检查，不得因查看、验证或归档影响预览而修改项目文件、Git、OpenSpec 工件或 Codex 数据，也不得上传路径、内容或诊断信息。

#### Scenario: 用户运行严格验证

- **WHEN** 渲染进程请求验证当前 Change
- **THEN** 请求 MUST 通过受校验的受限接口交给主进程
- **THEN** 主进程 MUST 使用参数化、无 shell、有超时和输出上限的方式执行允许的 OpenSpec 命令

#### Scenario: 用户查看归档影响

- **WHEN** 系统比较 delta specs 与主规格
- **THEN** 比较 MUST 只读取已验证项目根目录内允许的 OpenSpec 文件
- **THEN** 系统 MUST NOT 自动写入主规格或移动 Change

#### Scenario: 工具返回敏感或超量输出

- **WHEN** 外部工具输出包含超出诊断需要的内容或超过配置上限
- **THEN** 系统 MUST 截断并安全归一化结果
- **THEN** 原始输出 MUST NOT 被记录到遥测、活动历史或渲染进程日志

### Requirement: 生命周期视图必须保持高密度与可访问性

生命周期轨道、建议区域、归档影响、Change 分页和检查详情 MUST 在支持的最小窗口与宽屏布局中保持可读、可滚动且不遮挡现有文档工作区；状态不得仅依赖颜色或动画表达，并 MUST 支持键盘与减少动态效果偏好。

#### Scenario: 最小支持窗口显示完整流程

- **WHEN** 应用处于声明的最小窗口尺寸
- **THEN** 生命周期轨道 MUST 使用可滚动、折叠或紧凑布局保留全部节点
- **THEN** 长 Change 名称、诊断和能力名称 MUST NOT 覆盖操作控件

#### Scenario: 用户仅使用键盘检查生命周期

- **WHEN** 用户通过键盘遍历轨道、打开证据并返回文档
- **THEN** 焦点顺序、可见焦点和返回位置 MUST 保持正确
- **THEN** 每个状态 MUST 具有包含名称与结果的可访问文本

#### Scenario: 用户启用减少动态效果

- **WHEN** 操作系统要求减少动态效果
- **THEN** 节点状态切换 MUST 立即完成且不得依赖位移或缩放表达进度
- **THEN** 文本、图标和边框 MUST 继续明确表达状态变化
