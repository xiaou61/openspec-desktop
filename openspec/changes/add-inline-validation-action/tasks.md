## 1. 现状与契约回归

- [x] 1.1 复核 `LifecycleService`、`ValidationCoordinator`、`lifecycle:run-validation` 和 Change 详情现有调用链，确认不新增 CLI 或 IPC 通道
- [x] 1.2 为未归档 Change 的 `not-run`、`stale`、`failed`、`unavailable`、`running`、`passed` 和 archived 状态建立状态到按钮文案/可用性映射测试
- [x] 1.3 补充 IPC/控制器测试，确认按钮请求只能使用 projectId/changeId，归档 Change 被拒绝，重复运行不会启动第二个验证进程

## 2. 就地验证入口

- [x] 2.1 在 Change 详情标题状态区域和验证节点附近接入单一主操作，显示“运行严格验证”或对应重试语义
- [x] 2.2 接入运行中状态、稳定尺寸、错误摘要、重试入口和成功后的检查时间/诊断刷新，不在 renderer 自行推断归档就绪
- [x] 2.3 保持验证详情、来源、stale 原因和归档门槛的现有展示，确保标题入口与深层就绪视图使用同一状态
- [x] 2.4 增加键盘焦点、Enter/Space 激活、aria-label、禁用态和 reduced-motion 处理，并处理最小窗口换行/滚动

## 3. 验收与审查

- [x] 3.1 补充 renderer 组件测试，覆盖首次运行、重试、运行中、防重复提交、失败恢复、通过和归档隐藏
- [x] 3.2 补充 Playwright/Electron 场景，验证真实 CLI 调用、文件变化导致 stale、项目切换、刷新、最小窗口和项目目录无写入
- [x] 3.3 运行 typecheck、lint、unit、renderer boundary、build 及相关 E2E，并执行 `openspec validate add-inline-validation-action --strict --no-interactive`
- [x] 3.4 由未参与实现的低成本模型执行只读审查；只有确认可复现的 bug 才交给高能力模型修复并补回归测试，不自动归档 Change
