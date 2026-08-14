## Why

Change 详情已经能识别“待验证”和验证失败，但用户必须再切换到就绪区域才能找到验证入口。把主要动作放在当前状态旁边，可以让用户看到缺口后立即运行严格验证，减少一次导航并降低把任务完成误认为验证通过的风险。

## What Changes

- 在未归档 Change 的状态区域和生命周期验证节点附近提供明确的“运行严格验证”主操作。
- 对未运行、已过期、失败和不可用的验证分别提供首次运行或重试语义；验证中禁止重复提交，验证通过时不显示重复的主操作。
- 复用现有受限 `lifecycle:run-validation` IPC 和 `openspec validate <change-id> --strict --json --no-interactive` 执行链路，不新增命令执行接口。
- 验证完成后刷新当前 Change 的生命周期评估、阻塞原因和归档就绪状态，并保留已有诊断与来源信息。
- 保持项目文件、Git、Change 工件和远程网络完全只读/不写入；不增加自动验证或远程同步。

## Capabilities

### New Capabilities

- `change-validation-action`: 在 Change 当前状态附近直接启动、查看和重试严格验证的用户操作。

### Modified Capabilities

无。现有生命周期 Change 尚未进入 `openspec/specs` 主规格，本 Change 只新增一个窄的操作能力，不改写既有生命周期要求。

## Impact

- renderer：Change 详情状态区、生命周期/就绪视图、加载与错误状态、键盘焦点和最小窗口布局。
- main/preload：复用现有生命周期验证路由和查询失效，不扩展权限边界。
- 测试：补充组件、IPC/控制器集成和 Electron 场景，覆盖待验证、失败、过期、运行中、通过和归档 Change。
- 文档：说明按钮执行的是本机 OpenSpec 严格验证，不代表需求或实现本身正确。
