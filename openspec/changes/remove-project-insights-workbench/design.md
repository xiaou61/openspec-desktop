## Context

现有项目洞察由 scanner、LifecycleService、HistoryStore、ChangeWorkStateStore 和 catalog 聚合成 snapshot，再通过 `insights:*` IPC 提供能力和简报视图。CodeGraph 显示它的主要入口是 `ProjectInsightsView`、`ProjectInsightsService`、`project-insights-contracts` 和 AppController/IPC wiring；文件监视器、生命周期验证和行动中心也会触发部分洞察失效，但这些基础能力有独立消费者。

当前工作区包含多个未提交 Change 的实现，删除必须基于现有文件状态进行，不能 reset/revert 无关改动。此前的 `remove-spec-assurance-workflow` 设计要求保留项目洞察及其 Change 冲突评估；本 Change 是后续产品决定，实施时以本 Change 的删除范围覆盖该保留决定，连同 `CollisionEvaluator` 和关系图一起删除，但继续保留严格验证及其他基础生命周期能力。

## Goals / Non-Goals

**Goals:**

- 物理删除项目洞察的产品表面和运行时依赖，而不是仅隐藏导航标签。
- 让应用启动、Change 详情、任务、验证、历史、watcher 和行动中心在无洞察模块时仍可用。
- 删除洞察专用 IPC/API 和缓存失效，避免留下不可调用的兼容壳或未知请求。
- 清理相关测试、夹具、样式、README 和活跃 Change 展示，保持 OpenSpec 目录状态诚实。

**Non-Goals:**

- 不删除严格验证、ValidationCache/Coordinator、生命周期轨道、任务再次实施、历史记录、文件监视或 action center。
- 不删除 scanner、spec-sync 或普通 Change 的文档渲染和归档影响预览；项目洞察专用的 `CollisionEvaluator` 不在保留范围内。
- 不实现远程同步、云端备份、登录、团队协作或任何替代性的在线洞察产品。
- 不自动清理用户历史目录或其他本地数据；没有洞察专用持久化目录时也不新增迁移脚本。

## Decisions

### 1. 按产品面整体删除

删除入口、路由、服务、契约和测试的整条依赖链。保留一个空页面或“暂不可用”标签会继续占用导航并让 renderer 误以为能力存在，因此不采用隐藏式删除。

### 2. 以消费者为边界拆除共享依赖

先确认每个 scanner/history/work-state/lifecycle 调用者，再只移除由 ProjectInsightsService 使用的聚合、digest 和 query invalidation。若某个模块同时服务 Change 详情或行动中心，保留模块并删除洞察专用调用，避免大范围重写。

### 3. 删除全部 insights IPC，不保留空响应

从 channel schema、router、AppController、preload、DesktopApi 和 renderer query 中同步删除 `insights:*`。旧 renderer 调用未知通道应失败而不是得到空快照，防止新旧 main/preload 混用时静默显示过期数据。

### 4. 保留本地事实源和基础失效链路

HistoryStore 仍记录活动/修订，ProjectWatcher 仍扫描和通知，LifecycleService 仍计算验证/归档就绪，ActionCenter 仍读取生命周期。这些是用户直接使用的核心功能，不因洞察页面删除而改变其数据格式或权限。

### 5. 清理活跃 Change，但不归档撤回功能

完成代码删除和全套回归后，删除 `add-project-insights-and-review-workbench` 活跃目录，使应用不再把已撤回工作台列为当前 Change。保留本次 `remove-project-insights-workbench` 作为撤回决策记录；不运行 archive 或 sync，不写入 `openspec/specs`。

### 6. 以负向扫描和启动回归证明无残留

除本 Change 的历史说明外，生产代码、README、活跃产品测试和 preload exports 不得再出现项目洞察入口、`insights:*`、ProjectInsightsService、digest/能力地图 UI 等标识。启动时不应尝试读取不存在的洞察缓存或旧快照。

## Risks / Trade-offs

- **删除共享导出造成编译面扩大** → 先删除消费者和契约引用，再物理删除模块，每组任务后运行定向 typecheck/test。
- **误删生命周期或历史能力** → 先建立保留回归测试，并用 CodeGraph/定向搜索确认仍有 Change 详情和 action center 调用者。
- **旧 renderer 仍请求洞察通道** → 同步更新 main/preload/renderer，增加未知通道边界测试和完整 Electron 刷新场景。
- **活跃 Change 删除影响历史追溯** → 保留本撤回 Change 的 proposal/design/tasks，并在 README/验证报告记录删除原因；不删除项目历史索引。
- **用户仍想查看日报** → 明确日报属于本次一起撤回的简报视图，未来若需要应另建窄 Change，不在删除任务中留下半成品替代品。

## Migration Plan

1. 增加 Change 详情、验证、任务、历史、watcher 和 action center 的无洞察回归夹具。
2. 删除共享契约、IPC/preload、AppController 服务 wiring 和洞察 query invalidation。
3. 删除 renderer 导航、ProjectInsightsView/model、样式、测试和夹具，更新 README。
4. 运行负向扫描；确认应用在普通项目、多项目、不可用项目和最小窗口中启动并可浏览。
5. 删除未归档的 `add-project-insights-and-review-workbench`，重建 CodeGraph 并确认无生产调用者。
6. 运行完整静态、单元、Playwright、Electron 和 OpenSpec 严格验证；失败时只恢复必要的基础引用，不恢复项目洞察产品面。
