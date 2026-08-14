## 1. 生命周期契约与评估规则

- [x] 1.1 在共享契约中定义生命周期节点、工件来源、验证状态、同步状态、归档就绪、下一步和阻塞证据的严格 schema
- [x] 1.2 为 `ChangeLifecycleAssessment` 增加包含项目、Change、归档身份、内容指纹、评估时间和全部独立维度的版本化响应契约
- [x] 1.3 实现无 I/O 的生命周期评估器，按项目不可用、工件、任务、验证和归档的固定优先级生成唯一主要建议
- [x] 1.4 实现 `not-ready`、`ready` 与 `archived` 归档结论，把可安全应用的 delta 纳入归档计划，并禁止 metadata completed 覆盖未完成门槛
- [x] 1.5 为任务完成但未验证、验证过期、归档时将更新、影响预览未知、无 tasks schema、条件跳过和已归档等组合增加表驱动测试
- [x] 1.6 更新既有 Change 契约夹具，保证旧 `stage` 与结构 `readiness` 消费者继续兼容

## 2. OpenSpec CLI 状态与受限执行

- [x] 2.1 新建只允许 OpenSpec status/validate 子命令的主进程执行适配器，统一无 shell、隐藏窗口、超时、输出上限和安全环境策略
- [x] 2.2 实现 `status --change <id> --json` 输出解析，提取 schema、工件状态、依赖边、done/skipped/blocked 与 apply 依赖闭包
- [x] 2.3 在 CLI 缺失、超时或 JSON 不兼容时，从现有扫描投影生成标记为 structural 的保守工件图，并让无法证明的状态保持 unknown
- [x] 2.4 实现 `validate <id> --strict --json --no-interactive` 运行器，把结果归一化为通过、失败或不可用及有限诊断
- [x] 2.5 验证 Change ID 必须来自当前项目投影，拒绝归档目标、路径穿越、任意参数和重复并发请求
- [x] 2.6 为 status 成功、自定义依赖、skipped 工件、CLI 缺失、超时、超量输出、恶意 Change ID 和验证诊断清洗增加单元测试

## 3. 内容指纹与验证缓存

- [x] 3.1 根据 Change 工件、delta specs、对应主规格和 OpenSpec 配置的内容哈希生成确定性验证指纹
- [x] 3.2 在 user-data 下实现版本化验证缓存，使用包含 archive 前缀的 Change 键与现有原子写入模式
- [x] 3.3 实现缓存损坏备份与 not-run 恢复，确保损坏验证缓存不影响 catalog、扫描投影和历史
- [x] 3.4 实现验证协调器的按 project/change 串行去重，并在验证开始与结束指纹不一致时直接保存 stale 结果
- [x] 3.5 在相关文件变化后保留旧诊断但把结果标记 stale，确保过期通过结果不参与归档就绪
- [x] 3.6 为指纹稳定性、主规格变化、配置变化、运行中变化、缓存恢复和不同归档身份增加测试

## 4. Delta Spec 结构解析与同步预览

- [x] 4.1 基于现有 unified/remark 依赖实现 delta spec AST 解析，识别 Purpose、四类操作、Requirement、Scenario 与来源范围
- [x] 4.2 实现主规格结构解析和保守规范化，只忽略换行、标题空白等无语义格式差异
- [x] 4.3 从 delta 相对路径安全解析 capability path，并将目标限制在已验证项目的 `openspec/specs` 根目录
- [x] 4.4 实现 ADDED 与新 capability 对比，区分已应用、待应用和目标冲突
- [x] 4.5 实现 MODIFIED 完整块、REMOVED 缺失目标和 RENAMED 新旧名称组合的确定性对比
- [x] 4.6 聚合 capability 级 operation 数量、Requirement/Scenario 摘要和总体 not-applicable/pending/synced/unknown 状态
- [x] 4.7 为新增能力、已同步内容、部分同步、完整修改、删除、重命名冲突、skip_specs、不可读文件和大小上限增加夹具测试

## 5. 生命周期服务、Watcher 与 IPC

- [x] 5.1 实现 `LifecycleService`，组合当前扫描投影、CLI 工件图、任务门槛、验证缓存、同步预览和纯评估器
- [x] 5.2 为同一 project/change 的工件图与同步计算增加共享 Promise 和短缓存，并按内容摘要只重算受影响 Change
- [x] 5.3 在 AppController 中根据 catalog 与当前投影解析真实项目及 Change 身份，提供获取评估和主动验证方法
- [x] 5.4 将 Watcher 稳定投影、重新扫描、项目重定位和移除事件接入生命周期查询失效与验证过期逻辑
- [x] 5.5 扩展 IPC、preload 与 DesktopApi，加入 `getChangeLifecycle` 和 `runChangeValidation` 的严格请求/响应校验
- [x] 5.6 更新渲染进程实时事件后的 React Query 失效范围，保证 snapshot、lifecycle、验证和同步证据一致
- [x] 5.7 为不存在项目、同名当前/归档 Change、跨项目请求、文件连续保存、项目切换和 IPC 非法输入增加集成测试

## 6. Change 生命周期界面

- [x] 6.1 将 Change 分段导航文案改为“当前变更 / 已归档”，同步空状态和可访问名称但保持目录筛选语义不变
- [x] 6.2 在 Change 详情标题下实现固定尺寸的生命周期轨道，完整展示完成、当前、阻塞、待处理、不可用和归档状态
- [x] 6.3 让 proposal/specs/design/tasks 节点导航到对应工件，让 validation/archive 节点打开新增“就绪”标签的对应证据区
- [x] 6.4 新增“就绪”视图，以无嵌套卡片的分区布局显示唯一建议、阻塞原因、工件依赖、验证和归档门槛
- [x] 6.5 实现主动严格验证控件及运行中、通过、失败、不可用和 stale 反馈，并支持从诊断定位到允许的工件
- [x] 6.6 实现按 capability 展开的归档影响预览，显示四类操作数量、Requirement/Scenario 摘要、冲突和检查时间
- [x] 6.7 在 Change 行保留任务进度并增加待验证、可归档等短阶段，禁止未知权威状态使用成功色
- [x] 6.8 为加载、CLI 降级、解析冲突、没有 delta、已归档和实时状态变化提供中文空状态与可感知通知
- [x] 6.9 增加渲染测试，覆盖轨道导航、主要建议优先级、验证交互、归档影响展开、当前/归档命名和焦点返回

## 7. 视觉、动效与响应式精修

- [x] 7.1 为六节点生命周期轨道定义稳定节点宽度、连接线、图标与文本层级，确保状态变化不改变详情布局高度
- [x] 7.2 复用现有短时动效令牌完成节点与证据状态过渡，不增加循环装饰动画或新的运行时动效依赖
- [x] 7.3 在最小支持窗口使用可键盘滚动的紧凑轨道，在宽屏保持内容上限并防止长 Change、能力和诊断文本遮挡控件
- [x] 7.4 完成 reduced-motion、reduced-transparency、prefers-contrast 与无 backdrop-filter 环境下的集中降级
- [x] 7.5 校验状态不只依赖颜色，补齐 aria-current、aria-live、焦点环、键盘顺序和完整可访问名称

## 8. 文档、验证与交付

- [x] 8.1 更新中文 README，说明多维生命周期、CLI 可选依赖、验证过期、归档影响、归档门槛和应用不会自动写入项目
- [x] 8.2 使用真实完整、未完成、验证失败、新能力归档时将更新、已反映和归档 Change 夹具逐项核对能力规格
- [x] 8.3 运行类型检查、Lint、单元测试、渲染测试与渲染边界检查，修复全部回归
- [x] 8.4 在常用桌面尺寸和最小支持窗口检查轨道、就绪视图、长文本、键盘焦点和减少动态效果，不运行额外打包冒烟流程
- [x] 8.5 严格校验 `visualize-change-lifecycle-and-readiness` OpenSpec 变更，并确认 proposal、spec、design 与 tasks 保持一致

## 9. 修正归档同步语义

- [x] 9.1 调整共享契约与生命周期评估器，使可安全应用的 pending delta 得出 `ready` 和归档建议，不再生成同步 blocker 或 `ready-after-sync`
- [x] 9.2 调整列表阶段和就绪视图，将 pending 表达为归档影响，并让归档节点成为当前可执行阶段
- [x] 9.3 增加评估器与渲染测试，覆盖 pending delta 可归档以及归档建议包含影响摘要
- [x] 9.4 更新中文 README，把规格比较说明为归档影响并说明 OpenSpec archive 默认更新主规格
- [x] 9.5 运行类型检查、Lint、单元测试和相关渲染测试，修复回归
- [x] 9.6 严格校验 `visualize-change-lifecycle-and-readiness`，确认修正后的 proposal、spec、design 与 tasks 一致

## 10. 精简生命周期并扩展 Change 浏览

- [x] 10.1 调整共享契约与生命周期评估器，删除 sync 节点、同步 gate、同步 next action 和同步 blocker，使规格比较结果仅作为归档影响证据
- [x] 10.2 将生命周期轨道精简为六节点，把 capability 级规格影响折叠进归档详情，并统一列表阶段为“可归档”
- [x] 10.3 为当前与已归档 Change 实现按 `lastActivityAt` 倒序、Change ID 稳定兜底和每页 10 条的独立分页
- [x] 10.4 增加领域与渲染测试，覆盖影响预览未知不阻塞、六节点轨道、时间排序、缺失时间、分页边界、范围切换和选择保持
- [x] 10.5 更新中文 README，说明六节点流程、归档影响的非阻塞语义以及 Change 排序分页规则
- [x] 10.6 运行类型检查、Lint、全量测试、格式检查与渲染边界检查，修复回归
- [x] 10.7 严格校验 `visualize-change-lifecycle-and-readiness`，确认全部制品与实现一致
