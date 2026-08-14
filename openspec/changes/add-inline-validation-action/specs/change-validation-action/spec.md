## Purpose

让用户在看到 Change 尚未验证或验证结果已失效时，能够从当前状态位置直接执行并追踪一次本机 OpenSpec 严格验证。

## ADDED Requirements

### Requirement: 验证缺口必须提供就地主操作

系统 MUST 在未归档 Change 的验证状态为 `not-run`、`stale`、`failed` 或 `unavailable` 时，在当前状态区域或验证节点附近显示可操作的主要按钮。首次缺口 MUST 使用“运行严格验证”语义，已有结果失效或失败时 MUST 使用等价的重试语义。

#### Scenario: Change 尚未验证

- **WHEN** 当前 Change 的生命周期验证状态为 `not-run`
- **THEN** 用户 MUST 能在不切换到其他一级页面的情况下看到并激活“运行严格验证”
- **THEN** 页面 MUST 保留任务完成与验证未运行是两个独立事实

#### Scenario: 验证结果已过期

- **WHEN** 当前 Change、相关规格或配置变化使已有验证结果变为 `stale`
- **THEN** 页面 MUST 显示重新验证操作和过期原因
- **THEN** 旧诊断 MAY 被查看，但 MUST NOT 被当作当前通过结论

### Requirement: 就地操作必须调用受限严格验证流程

系统 MUST 通过现有受校验的生命周期验证接口运行等价于 `openspec validate <change-id> --strict --json --no-interactive` 的检查。渲染进程 MUST NOT 接收项目根目录、任意命令、任意路径或原始进程输出作为调用参数。

#### Scenario: 用户激活验证按钮

- **WHEN** 用户激活当前 Change 的验证按钮
- **THEN** 系统 MUST 使用当前已选项目和 Change 身份启动一次受限严格验证
- **THEN** 系统 MUST 不修改项目文件、Git、Change 工件或远程数据

#### Scenario: 归档 Change 不可重新验证

- **WHEN** 用户查看已归档 Change
- **THEN** 页面 MUST 不提供可执行的重新验证按钮
- **THEN** 已有验证事实仍 MUST 作为只读历史结果展示

### Requirement: 运行状态和结果必须即时可解释

系统 MUST 在验证执行期间显示运行中状态并禁用同一 Change 的重复提交；验证结束后 MUST 更新生命周期评估、诊断、检查时间和归档就绪结论。失败、不可用和通过状态 MUST 使用文字和可访问名称表达，不得只依赖颜色。

#### Scenario: 验证正在运行

- **WHEN** 严格验证进程尚未返回结果
- **THEN** 按钮 MUST 进入运行中状态且同一 Change 的重复激活 MUST 不会启动第二个进程
- **THEN** 文档、任务和历史查看 MUST 继续可用

#### Scenario: 验证失败

- **WHEN** OpenSpec 返回失败、超时或不兼容结果
- **THEN** 页面 MUST 显示失败或不可用摘要、检查时间和可再次尝试的操作
- **THEN** 原始未受限 stdout/stderr MUST NOT 直接展示给渲染进程

#### Scenario: 验证通过

- **WHEN** 严格验证针对当前内容指纹返回通过
- **THEN** 页面 MUST 显示通过状态和检查时间
- **THEN** 归档就绪 MUST 只在其他权威门槛也满足时更新为可归档

### Requirement: 操作必须适配高密度和键盘工作流

系统 MUST 在声明的最小窗口中保持按钮、状态文本和生命周期节点不重叠，并 MUST 支持键盘聚焦、激活和可见焦点。状态更新 MUST 遵循减少动态效果偏好。

#### Scenario: 用户仅使用键盘运行验证

- **WHEN** 用户通过键盘从 Change 状态移动到验证操作并按下 Enter 或 Space
- **THEN** 系统 MUST 启动与鼠标激活相同的验证流程
- **THEN** 焦点 MUST 保持在可追踪的状态或操作位置，并暴露包含 Change 名称和验证状态的可访问文本

#### Scenario: 最小窗口布局

- **WHEN** 应用处于支持的最小窗口尺寸
- **THEN** 验证按钮和状态摘要 MUST 保持可读、可滚动且不遮挡文档内容
- **THEN** 启用减少动态效果时状态变化 MUST 不依赖位移或缩放动画
