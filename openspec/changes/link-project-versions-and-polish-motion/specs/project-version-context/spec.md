## Purpose

把项目版本从可选备注提升为贯穿项目、Change、活动与修订的可追溯上下文，让用户能够知道一次变更发生在哪个版本阶段，并可靠查看跨版本演进。

## ADDED Requirements

### Requirement: 项目具有明确的版本上下文

系统 MUST 为每个项目维护当前版本上下文，至少包含有效标签、模式和来源；模式 MUST 区分自动与手动，来源 MUST 区分 Git 标签、`package.json`、手动输入和当前工作区。

#### Scenario: 自动上下文具有可识别版本

- **WHEN** 系统为项目自动识别到版本标签
- **THEN** 项目 MUST 显示该标签、自动模式和实际来源

#### Scenario: 项目没有可识别版本

- **WHEN** Git 标签和 `package.json` 均不能提供有效版本
- **THEN** 系统 MUST 将有效标签保留为空并以“当前工作区”作为展示语义
- **THEN** 系统 MUST NOT 把“未设置版本”写入项目数据或逐条活动文案

### Requirement: 自动版本识别具有稳定优先级

系统 MUST 仅从已注册项目根目录读取本地版本线索，并按“当前 Git HEAD 的精确标签、根目录 `package.json` 的有效 `version`、当前工作区”顺序确定自动版本。

#### Scenario: HEAD 同时具有 Git 标签和包版本

- **WHEN** 当前 Git HEAD 至少有一个有效精确标签且根目录也有有效包版本
- **THEN** 系统 MUST 使用 Git 标签并将来源标记为 Git 标签

#### Scenario: HEAD 没有精确标签

- **WHEN** 项目是 Git 仓库但当前 HEAD 没有精确标签且根目录存在有效包版本
- **THEN** 系统 MUST 使用包版本并将来源标记为 `package.json`

#### Scenario: HEAD 具有多个精确标签

- **WHEN** 当前 Git HEAD 指向多个有效标签
- **THEN** 系统 MUST 使用确定性的版本排序选择同一个首选标签

#### Scenario: Git 不可用或探测失败

- **WHEN** Git 程序不存在、命令超时、目录不是 Git 仓库或输出无效
- **THEN** 系统 MUST 在有界时间内继续尝试 `package.json` 来源
- **THEN** 项目注册、导入和界面渲染 MUST NOT 因 Git 探测失败而失败

#### Scenario: 包版本无效

- **WHEN** `package.json` 缺失、不可读、不是合法 JSON 或 `version` 不是非空短字符串
- **THEN** 系统 MUST 忽略该来源并使用“当前工作区”上下文

### Requirement: 自动上下文在明确时机刷新

系统 MUST 在项目注册、Codex 导入、应用加载已有自动项目、项目重新定位、用户重新扫描和用户主动刷新版本时重新识别自动上下文；手动上下文 MUST NOT 被自动刷新覆盖。

#### Scenario: Codex 项目导入成功

- **WHEN** 用户从本机 Codex 导入一个有效 OpenSpec 项目
- **THEN** 系统 MUST 在项目进入工作区时为其解析自动版本上下文

#### Scenario: 自动项目重新扫描

- **WHEN** 用户重新扫描一个处于自动模式的项目且本地版本线索已经变化
- **THEN** 系统 MUST 更新当前上下文并让界面展示新来源与标签

#### Scenario: 手动项目重新扫描

- **WHEN** 用户重新扫描一个处于手动模式的项目
- **THEN** 系统 MUST 保留手动标签不变

### Requirement: 用户可以手动控制版本上下文

系统 MUST 提供自动与手动模式切换；手动模式 MUST 要求一个去除首尾空白后仍非空且不超过 120 个字符的标签，并允许用户恢复自动识别。

#### Scenario: 保存手动版本

- **WHEN** 用户选择手动模式并保存有效标签
- **THEN** 系统 MUST 将该标签设为当前有效版本并将来源标记为手动

#### Scenario: 手动标签无效

- **WHEN** 用户提交空白或超长的手动标签
- **THEN** 系统 MUST 拒绝保存、保留原上下文并在对应字段附近显示中文错误

#### Scenario: 恢复自动识别

- **WHEN** 用户从手动模式切换回自动模式
- **THEN** 系统 MUST 立即重新读取本地版本线索并保存解析后的自动上下文

### Requirement: 最新版本即时传递给监控记录

版本设置请求成功返回后产生的每条新活动与新修订 MUST 使用最新有效版本标签，监听器 MUST NOT 继续使用启动时捕获的旧标签。

#### Scenario: 监听期间切换版本

- **WHEN** 项目监听器正在运行且用户把版本从 `v1.0.0` 切换为 `v1.1.0`
- **THEN** 设置完成后的下一条活动和修订 MUST 归属于 `v1.1.0`
- **THEN** 监听器 MUST 继续工作且不得因上下文更新重复记录未改变的文档

#### Scenario: 版本设置请求尚未完成

- **WHEN** 文档事件发生在版本设置请求完成之前
- **THEN** 系统 MAY 按事件处理时可见的旧上下文记录该事件
- **THEN** 设置请求完成后 MUST 建立清晰的版本切换边界

### Requirement: 历史版本归属保持不可变

活动和修订 MUST 保存创建时的有效版本标签；后续修改当前版本 MUST NOT 重写既有记录，空标签的既有记录 MUST 归入稳定的“当前工作区”历史分组。

#### Scenario: 项目从无版本切换到发布版本

- **WHEN** 既有活动属于空标签且用户随后设置 `v1.0.0`
- **THEN** 既有活动 MUST 继续显示在“当前工作区”分组
- **THEN** 后续活动 MUST 显示在 `v1.0.0` 分组

#### Scenario: 用户再次使用旧标签

- **WHEN** 用户把当前版本切回历史上使用过的同名标签
- **THEN** 新记录 MUST 与该同名版本汇总关联，同时保留各记录原始时间顺序

### Requirement: 版本切换形成可见活动边界

当有效版本标签或模式发生变化时，系统 MUST 创建一条项目设置活动，说明新版本和来源；仅刷新时间而标签与模式均未变化时 MUST NOT 制造活动噪声。

#### Scenario: 版本标签改变

- **WHEN** 当前有效标签从 `v1.0.0` 变为 `v1.1.0`
- **THEN** 活动时间线 MUST 包含一条归属于 `v1.1.0` 的版本切换记录

#### Scenario: 自动刷新结果不变

- **WHEN** 自动识别再次得到相同标签和来源
- **THEN** 系统 MUST NOT 新增版本切换活动

### Requirement: 版本摘要关联 Change、活动和修订

系统 MUST 为每个历史版本提供活动数量、修订数量、首次与最近活动时间及关联 Change 集合；关联 MUST 从记录中的版本快照和 `changeId` 推导，不得虚构没有历史依据的关系。

#### Scenario: 单个 Change 只出现在一个版本

- **WHEN** 某 Change 的全部活动和修订都归属于 `v1.0.0`
- **THEN** Change 界面 MUST 将 `v1.0.0` 显示为其关联版本

#### Scenario: Change 跨越多个版本

- **WHEN** 某 Change 的活动或修订分布在两个及以上版本上下文
- **THEN** 界面 MUST 明确显示其最近版本并提示“跨 N 个版本”
- **THEN** 用户 MUST 能查看该 Change 的全部关联版本

#### Scenario: Change 尚无历史记录

- **WHEN** Change 没有带 `changeId` 的活动或修订
- **THEN** 系统 MUST 显示“尚无版本活动”而不是把当前项目版本强行关联给它

### Requirement: 用户可以按版本浏览历史

活动与修订视图 MUST 提供“全部版本”和具体版本筛选，并在筛选前完成版本过滤与分页；切换筛选 MUST NOT 改变项目当前版本上下文。

#### Scenario: 筛选某个版本的活动

- **WHEN** 用户在活动视图选择 `v1.0.0`
- **THEN** 列表 MUST 只显示创建时归属于 `v1.0.0` 的活动
- **THEN** 当前 Change 过滤条件 MUST 继续生效

#### Scenario: 筛选当前工作区修订

- **WHEN** 用户在修订视图选择“当前工作区”
- **THEN** 列表 MUST 只显示版本快照为空的修订

#### Scenario: 版本没有匹配记录

- **WHEN** 所选版本在当前 Change 或文档中没有记录
- **THEN** 界面 MUST 显示带当前筛选语境的空状态并允许一键返回全部版本

### Requirement: 版本信息采用低噪声展示

项目导航 MUST 使用有效版本或“当前工作区”；项目与 Change 详情 MUST 提供可操作的当前版本控件和来源说明；活动列表 MUST 以版本分组标题表达上下文，而不是在每一行重复相同版本。

#### Scenario: 连续活动属于同一版本

- **WHEN** 多条相邻活动属于同一版本上下文
- **THEN** 界面 MUST 只显示一次清晰的版本分组标题
- **THEN** 每条活动仍 MUST 保留自己的时间、摘要和文档信息

#### Scenario: 用户需要修改版本

- **WHEN** 用户激活项目标题区的版本控件
- **THEN** 界面 MUST 提供来源、自动刷新、自动/手动切换与进入完整项目设置的操作

### Requirement: 版本探测保持只读和本地

版本探测 MUST 仅在主进程内执行，MUST NOT 使用 shell 拼接项目内容，MUST NOT 访问网络，MUST NOT 修改 Git、`package.json`、OpenSpec 文档或 Codex 数据。

#### Scenario: 项目路径或标签包含特殊字符

- **WHEN** 项目路径或本地标签含空格、引号或其他命令敏感字符
- **THEN** 系统 MUST 把路径作为独立参数处理且不得执行其中内容

#### Scenario: 渲染进程请求版本刷新

- **WHEN** 用户从界面刷新版本
- **THEN** 渲染进程 MUST 通过受校验的受限 API 请求主进程执行探测
- **THEN** 渲染进程 MUST NOT 获得任意文件系统或命令执行能力

### Requirement: 既有项目数据平滑迁移

升级后的系统 MUST 保留现有项目、分组、偏好与历史；已有非空 `versionLabel` MUST 迁移为手动上下文，已有空标签 MUST 迁移为自动模式并在探测失败时使用“当前工作区”。

#### Scenario: 读取旧目录中的手动版本

- **WHEN** 旧目录项目具有非空 `versionLabel`
- **THEN** 升级后 MUST 保留原标签且 MUST NOT 被首次自动探测覆盖

#### Scenario: 迁移失败

- **WHEN** 旧目录结构可识别但某个新增版本字段无法生成
- **THEN** 系统 MUST 保留可恢复备份并给出中文恢复信息
- **THEN** 系统 MUST NOT 把整个有效目录静默当作损坏数据清空
