## Context

当前 `LifecycleService` 已通过 `ValidationCoordinator` 读取缓存并调用受限 OpenSpec CLI，IPC 也已有 `lifecycle:run-validation` 路由。Change 详情已经展示生命周期验证节点，但用户需要进入更深层的就绪区域才能触发操作；本 Change 只补齐入口和状态反馈，不重新设计验证领域模型。

## Goals / Non-Goals

**Goals:**

- 在用户看到验证缺口的位置提供单一、明确的主操作。
- 复用现有验证协调、指纹、缓存、stale 和查询失效语义。
- 让运行中、失败、不可用和通过状态在桌面端与键盘流程中可理解、可测试。

**Non-Goals:**

- 不新增 CLI 命令、通用 shell API、自动验证、远程同步或验证结果上传。
- 不改变严格验证命令、缓存格式、归档门槛或 OpenSpec 权威结论。
- 不让验证按钮替代任务完成、规格同步预览或用户确认归档。

## Decisions

### 1. 复用现有生命周期 IPC

按钮只调用现有 `runChangeValidation({ projectId, changeId })` 能力。主进程继续从 catalog 和当前扫描重新解析项目根目录与 Change 身份，保持 renderer 不能提交路径或命令。新增第二个验证路由会造成并发、缓存和安全边界分叉，因此不采用。

### 2. 状态到操作的映射由纯函数统一

renderer model 提供一个小的状态映射：`not-run` 显示首次运行，`stale`/`failed`/`unavailable` 显示重试，`running` 禁用，`passed` 隐藏主按钮，归档 Change 始终隐藏。文案和 disabled 状态由同一映射驱动，避免标题区、轨道和就绪面板出现不同条件。

### 3. 成功与失败都刷新同一查询

点击后立即把当前 Change 标记为运行中；请求完成或失败后让生命周期查询重新获取，让现有 `ValidationCoordinator` 决定 fingerprint、stale 和诊断。UI 不自行推断“任务完成即通过”，也不把按钮成功视作可归档。

### 4. 入口放在状态附近，保留深层详情

标题状态摘要旁放置主按钮，验证节点/就绪详情保留诊断和来源。这样首屏可执行，但不会把诊断塞进紧凑标题区；小窗口通过现有响应式滚动规则处理，不改变字体缩放。

### 5. 采用可访问的文本+图标表达

按钮使用现有 Lucide 图标和明确文本，状态同时提供文字、图标和 `aria` 名称。运行中使用稳定尺寸，减少动态效果时仅更新文本、颜色和边框，不依赖动画。

## Risks / Trade-offs

- **重复点击可能启动多个 CLI** → 复用 coordinator 的 running 状态，UI 禁用并在主进程拒绝并发。
- **验证期间文件发生变化** → 保持现有起止 fingerprint 比较，结果标记 stale，不显示短暂通过。
- **标题区空间不足** → 使用固定按钮尺寸和可换行状态摘要，在最小窗口做 Playwright/Electron 验收。
- **用户误解“验证通过”为需求正确** → 按钮旁和文档明确它只表示 OpenSpec 严格检查通过，归档仍需其他门槛和用户确认。

## Migration Plan

1. 先补状态映射和现有 IPC 的组件/控制器回归测试。
2. 接入标题区按钮、运行中/失败反馈和查询刷新。
3. 验证最小窗口、键盘操作、归档 Change 禁用和项目文件只读。
4. 运行 typecheck、lint、单元测试、renderer boundary、build、Playwright 与 Electron 相关场景；失败时只回滚 renderer 入口，不动验证缓存或 CLI 适配器。
