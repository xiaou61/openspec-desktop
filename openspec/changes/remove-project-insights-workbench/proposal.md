## Why

“项目洞察”当前占用较大的工作区区域，却把能力列表、冲突关系和简报重复聚合在 Change、任务、活动和生命周期页面已经存在的事实之上。实际使用中信息密度和维护成本高于价值，产品决定先完整撤回这套功能，让主界面回到更直接的 Change 实施与验证流程。

## What Changes

- **BREAKING** 删除“项目洞察”一级入口及其“能力”“简报”两个视图。
- **BREAKING** 删除能力基线列表、Requirement/operation 展开、Change 冲突地图、关系图、项目简报生成/复制/导出和工作区项目摘要。
- 删除 `insights:*` IPC、preload/Desktop API、项目洞察共享契约、主进程聚合服务、renderer model/view、专用样式、缓存和测试夹具。
- 从 AppController、watcher 投影和 React Query 失效链路中移除仅服务于洞察的聚合与刷新逻辑。
- 保留 Change 列表与详情、生命周期轨道、严格验证、任务再次实施、历史活动/修订、文件监视、行动中心和基础归档影响预览。
- 保留历史与生命周期验证缓存；本 Change 不删除 `HistoryStore`、`ValidationCache` 或 scanner，只删除洞察对它们的消费。
- 远程同步、服务器 API、登录和云端数据不属于本 Change，也不创建兼容占位入口。
- 在实现和回归验证通过后移除未归档的 `add-project-insights-and-review-workbench` 活跃 Change 目录；不得归档或同步它，以免继续把已撤回功能展示为待实施能力。

## Capabilities

### New Capabilities

无。本 Change 是对尚未进入主规格的本地产品功能的撤回。

### Modified Capabilities

无。`openspec/specs` 中没有项目洞察主规格，因此本 Change 使用 `skip_specs: true`，不把已撤回功能写入长期基线，也不伪造 REMOVED delta。

## Impact

- main：`src/main/project-insights/`、AppController 聚合/失效、洞察 IPC handler 和共享投影引用。
- preload/shared：洞察 API、请求/响应 schema、query key 和 exports。
- renderer：App 导航、项目洞察页面、能力/冲突/简报组件、样式和测试。
- tests/docs：真实多项目夹具、洞察 E2E、README 和 Change 展示文案。
- 保留边界：lifecycle validation、action center、watcher、history、work-state、catalog、spec-sync 和普通 Change 详情必须继续工作。
