## 1. 基线与保留能力回归

- [x] 1.1 使用 CodeGraph 和定向搜索盘点 ProjectInsightsService、ProjectInsightsView、`insights:*`、共享契约、AppController wiring、query invalidation、测试和样式的完整依赖图
- [x] 1.2 补充无项目洞察时 Change 详情、生命周期验证、任务再次实施、历史活动/修订、文件监视和行动中心仍可用的回归测试
- [x] 1.3 固定项目洞察删除不影响 `lifecycle:run-validation`、ValidationCache/Coordinator、spec-sync 归档影响预览和普通 Change 文档渲染

## 2. 删除 main/shared/IPC 依赖

- [x] 2.1 从 shared project-insights contracts、DesktopApi、IPC request/response schema、公共 exports 和 query key 中删除洞察类型与方法
- [x] 2.2 从 IPC router、preload bridge、AppController 构造/服务 wiring 和 controller 方法中删除全部 `insights:*` 路由及洞察聚合调用
- [x] 2.3 从 watcher 投影、历史/任务/生命周期失效链路和 workspace summary 中删除仅为洞察服务的刷新、缓存和并发聚合逻辑，保留其他消费者
- [x] 2.4 增加边界测试，确认旧洞察通道返回未知 IPC 通道，preload 不再暴露洞察 API，且 renderer 不能提交路径、正文或命令来触发替代扫描

## 3. 删除 renderer 产品面

- [x] 3.1 从 App/Workspace 导航、项目入口、快捷键和深链状态中移除“项目洞察”入口及默认视图分支
- [x] 3.2 删除 `project-insights-view.tsx`、`project-insights-model.ts`、能力/冲突/简报组件和洞察专用 renderer 状态、测试选择器与样式
- [x] 3.3 清理项目洞察相关图标、文案、导出/复制对话框和 README 说明，确保 Change 详情、任务、验证、历史和行动中心导航不受影响
- [x] 3.4 补充组件、Playwright 和 Electron 测试，覆盖刷新、项目切换、不可用项目、最小窗口、键盘导航和无横向溢出，确认没有空白洞察标签或失败深链

## 4. 物理清理与 Change 收口

- [x] 4.1 删除 `src/main/project-insights/`、`src/shared/project-insights-contracts.ts`、洞察专用测试/fixture/style，并清理 tsconfig、lint、test 和构建配置中的孤立引用
- [x] 4.2 对生产 `src/`、README、preload exports 和活跃产品测试执行负向扫描，确认没有 ProjectInsights、`insights:*`、能力地图、关系图、简报生成/导出等残留产品能力
- [x] 4.3 更新 `remove-spec-assurance-workflow` 相关实施说明中的范围交叉点，明确本 Change 覆盖此前“保留项目洞察及其 Change 冲突评估”的决定，严格验证和基础生命周期能力仍保留
- [x] 4.4 在代码和回归测试通过后删除未归档的 `openspec/changes/add-project-insights-and-review-workbench/`，不得归档、同步或写入主规格，并验证应用扫描不再显示它
- [x] 4.5 运行 `codegraph index --force .`，再定向确认无生产调用者、动态路由或 preload 暴露残留

## 5. 最终验证与审查

- [x] 5.1 运行 typecheck、lint、全量单元测试、renderer boundary 和 build，修复契约删除引起的编译与导出问题
- [x] 5.2 运行 Playwright/Electron E2E，验证 Change 列表/详情、严格验证、任务、历史、行动中心、文件监视、项目切换、刷新和最小窗口
- [x] 5.3 运行 `openspec validate remove-project-insights-workbench --strict --no-interactive`，并重新验证仍受影响的 `remove-spec-assurance-workflow` 与生命周期相关 Change
- [x] 5.4 由当前实施模型执行最终只读自查；只有确认可复现的 bug 才修复并补针对性测试，不自动归档任何 Change
