## Context

现有 Codex 发现服务从全局状态中读取 `local-projects`、`project-order` 和 `electron-saved-workspace-roots`，把每个 `rootPath` 规范化后直接交给 `validateOpenSpecProject`。该校验器有意只检查精确的 `<root>/openspec`，目录注册、扫描器和 watcher 都依赖这一严格语义，不能把它改成递归校验。

发现结果当前是一组扁平 `CodexProjectCandidate`，状态只有可导入、已添加、缺失和无效 OpenSpec；导入请求逐项传递根路径与显示名。目录使用严格 Zod 契约持久化为 `catalog.json` v2，已经存在 `ProjectGroup` 和 `ProjectRecord.groupId`，但分组只有名称和顺序，无法用来源路径稳定识别自动工作区。

本设计实现 `specs/multi-project-workspaces/spec.md`，并保持主进程文件权限边界、批量导入部分成功语义和项目级监控模型不变。

## Goals / Non-Goals

**Goals:**

- 在 Codex 专用发现层识别容器工作区，不放宽全局 OpenSpec 项目校验。
- 用有界、可测试的目录遍历发现直接或嵌套的项目成员，并返回局部诊断。
- 为渲染层提供明确的工作区与成员结构，支持准确计数和三态选择。
- 复用现有项目注册与分组模型，通过来源根路径稳定复用自动工作区分组。
- 迁移已有目录数据时保持项目、手工分组和用户选择不变。

**Non-Goals:**

- 不自动初始化未配置 OpenSpec 的仓库，也不读取其源代码判断项目含义。
- 不监控工作区父目录，不为父目录生成版本、历史、Change 或规格投影。
- 不持久化未配置 OpenSpec 的仓库为目录项目；它们只存在于最新发现结果中。
- 不实现跨项目 Change、任务依赖、规格合并或工作区级归档。
- 不支持用户任意配置扫描深度或排除规则；首版使用受测试的产品常量。

## Decisions

### 1. 保持精确 OpenSpec 校验，新增 Codex 工作区发现器

`validateOpenSpecProject(root)` 继续只回答“这个精确根路径是不是 OpenSpec 项目”。Codex 发现流程在直接校验失败且根目录可读时调用独立的 `discoverWorkspaceMembers(root, limits)`：

```text
Codex indexed root
        |
        v
 exact OpenSpec validation ---- valid ----> direct project candidate
        |
      readable but invalid
        |
        v
 bounded member discovery ----- found ----> workspace candidate + members
        |
      none found
        v
 unavailable/unrecognized candidate
```

这样目录选择器、目录注册、项目扫描器和 watcher 不会误把父容器当作项目。备选方案是让 `validateOpenSpecProject` 自动搜索子目录，但这会让所有调用者获得含糊根路径，并可能让父目录 watcher 监控错误的 `openspec/`，因此不采用。

### 2. 使用软截止时间和硬数量限制控制目录遍历

发现器以广度优先方式检查工作区后代，默认最大深度为 2；并发读取限制为 4，同时设置每个工作区的目录检查上限、成员上限以及整次 Codex 发现的全局候选上限。时间预算是软截止时间：到期后不再调度新的读取，但等待已经开始的文件系统调用收敛，避免伪造不可取消的硬超时。

遍历使用 `lstat` 和 `readdir({ withFileTypes: true })`，不跟随符号链接或 Windows 目录联接。默认排除 `.git` 内容、`node_modules`、`.next`、`dist`、`build`、`target`、`coverage`、`.cache`、`.venv`、`vendor` 和常见 IDE 输出；`.git` 本身仍可作为仓库标记。发现有效 OpenSpec 根后立即产出成员并停止进入其后代。

代码仓库通过 `.git` 文件或目录及受支持的清单标记识别，首版包含 `package.json`、`pom.xml`、`build.gradle`、`build.gradle.kts`、`pyproject.toml`、`Cargo.toml`、`go.mod` 和解决方案文件。标记只用于显示“尚未配置 OpenSpec”，不能绕过导入时的 OpenSpec 校验。普通资料目录不输出为项目成员，以免把 `src`、`docs` 等目录误报为项目。

扫描限制通过依赖注入选项暴露给测试，但不通过渲染 IPC 接受任意值。备选方案是无界递归或调用外部搜索命令；前者可能卡住导入界面，后者增加平台差异和命令执行面，因此不采用。

### 3. 发现契约使用顶层条目联合，而项目导入仍只接受叶子

共享契约将扁平候选扩展为可判别的顶层条目：

```text
CodexDiscoveryEntry
├─ direct-project      精确 OpenSpec 根或不可用直接候选
└─ workspace
   ├─ id / displayName / rootPath / diagnostics / truncated
   ├─ repositoryCount / openSpecProjectCount / availableCount
   └─ members[]
      ├─ openspec-project  available | already-added
      └─ repository        not-configured
```

每个可导入叶子保留稳定 ID、显示名、规范化根路径、最近使用时间和来源工作区身份。列表摘要分别返回索引根数、工作区数、代码仓库数、OpenSpec 项目数和可导入数，避免继续把“候选根目录数”和“可导入项目数”混为一谈。

导入请求只包含用户选中的 OpenSpec 叶子，并附带可选的工作区 ID、规范化工作区根路径和显示名。主进程不信任渲染层提供的关系：确认时重新规范化路径、验证子路径位于声明的工作区内、重新执行精确 OpenSpec 校验，并再次检查目录去重。

备选方案是在现有候选上增加 `parentId` 并保持完全扁平。该方案传输简单，但渲染层需要自行重建树、汇总诊断和计数，容易产生父子状态不一致，因此采用显式顶层联合。

### 4. 在收集完成后统一解析路径身份和工作区归属

直接索引项和嵌套发现先生成临时结果，再使用现有 Windows 路径规范化规则及可用时的 `realpath` 合并。项目 ID继续由规范化项目根路径哈希生成；工作区 ID由规范化工作区根路径哈希生成，不使用可变显示名。

同一项目既是直接索引项又是工作区成员时，只保留一个叶子身份，并保留最早 Codex 索引顺序和最近工作区上下文。重叠工作区同时覆盖同一项目时，选择路径层级最深的祖先；层级相同则选择 Codex 索引顺序更早者。已经注册的路径最终统一覆盖为 `already-added`。

这种收集后归并比“扫描到第一个就丢弃后续结果”多一次内存整理，但候选总数已有硬上限，并能避免遍历顺序改变 UI 归属。

### 5. 导入界面使用展开行和派生三态选择

工作区是无装饰容器行，不使用嵌套卡片。父行显示展开按钮、工作区名称、根路径、仓库数和 OpenSpec 数；子行沿用当前候选列表的名称、路径、状态徽标和复选框密度。直接项目仍按现有单层行展示。

选择状态只保存可导入叶子的 ID集合。父工作区复选框由其可导入成员派生为未选、部分选择或全选，点击时只增加或移除这些成员；展开、折叠和刷新期间使用路径身份协调仍存在的选择。已添加、未配置和不可用成员始终不可选。原“全选可用项目”继续跨所有直接项目和工作区叶子工作。

工作区展开按钮和复选框使用独立点击目标，提供 `aria-expanded`、明确标签和非颜色状态文本；长路径使用现有省略与 Tooltip。备选方案是只把子路径平铺到列表并在名称前拼接父目录，这会丢失容器含义和父级批量选择，因此不采用。

### 6. 将自动工作区建模为带来源身份的项目分组

不新增第二套主侧边栏容器。目录状态升级为 v3，并把 `ProjectGroup` 改为可判别联合：

```text
manual group
  id, name, order, kind: manual

Codex workspace group
  id, name, order, kind: codex-workspace, sourceRootPath
```

v2 到 v3 迁移把所有已有分组标记为 `manual`，保持 ID、名称、顺序、`ProjectRecord.groupId` 和偏好不变。自动工作区只以规范化 `sourceRootPath` 复用，绝不按显示名匹配手工分组。用户后续重命名自动工作区时保留来源身份，刷新不会覆盖自定义名称。

控制器在工作区第一个子项目成功注册后创建或复用分组，并把本次新注册项目的 `groupId` 指向它；若所有项目失败则不留下空分组。已注册项目不会因再次发现而自动移动，避免破坏用户已有手工组织。现有移除分组语义保持不变，只把项目移到未分组。

备选方案是新增持久 `WorkspaceRecord` 并同时维护成员列表。首版不需要监控未配置仓库或工作区级投影，这会与现有 `ProjectGroup` 重复，并引入双重成员关系，因此不采用。未来若需要跨项目编排，可再引入独立工作区领域对象，而不是扩张本次分组元数据。

### 7. 保留逐项目注册和部分成功事务边界

批量导入继续串行调用单项目注册，确保每个成功项目立即持久化并启动 watcher。工作区分组创建、项目注册和分组关联在目录服务的同一串行队列中完成，避免并发创建重复来源分组；返回结果增加工作区关联信息，但保留逐项 `imported`、`already-added` 和 `failed` 语义。

确认时若子项目已不在工作区、OpenSpec 结构失效或路径已经注册，则只拒绝该项。已成功项目和已经创建且含成员的工作区分组不回滚。主进程不会写入父目录或任何未配置仓库。

### 8. 主工作区只汇总组织关系，不合并 OpenSpec 状态

侧边栏继续从 `ProjectGroup` 和 `ProjectRecord.groupId` 派生分组。自动工作区分组增加“工作区”标识和来源路径 Tooltip，但每个子项目仍是唯一可选择和可监控单元。Change 列表、生命周期、二次开发、规格可信度、版本和归档都以选中 `projectId` 计算，不增加父级虚构状态。

未配置 OpenSpec 的仓库不进入 `catalog.json`，因此主侧边栏不会显示一个无法监控的项目壳；用户在仓库中自行初始化 OpenSpec 并刷新 Codex 导入后，它才成为可导入成员。

## Risks / Trade-offs

- **[大型或网络工作区仍可能出现慢文件系统调用]** -> 使用软时间预算、严格数量上限和有限并发；保留刷新及手工选择文件夹作为恢复路径。
- **[项目标记可能把非仓库目录识别为代码项目]** -> 该分类只产生不可导入提示，最终导入仍必须通过精确 OpenSpec 校验。
- **[重叠 Codex 根路径可能造成成员归属争议]** -> 使用最近祖先和 Codex 顺序的确定规则，并以规范化路径保证单一项目身份。
- **[目录 v3 使旧版应用无法直接读取新文件]** -> 迁移前创建 v2 备份，发布说明保留回滚步骤，迁移失败时不覆盖原文件。
- **[自动分组与用户手工组织可能冲突]** -> 仅为新导入项目自动分组，不移动已注册项目，不按名称复用手工分组。
- **[工作区概念可能被误认为跨项目 OpenSpec]** -> UI 明确区分“工作区”和“OpenSpec 项目”，父行不提供 Change、归档或监控操作。

## Migration Plan

1. 扩展共享发现和目录契约，新增 catalog v2 到 v3 的纯数据迁移及迁移备份测试。
2. 实现有界工作区发现、分类、诊断和全局去重，在不接入 UI 前用真实形态的临时目录 fixture 验证。
3. 扩展控制器、IPC 和 preload 导入载荷，加入工作区包含关系复核和自动分组复用。
4. 接入分层导入 UI、三态选择、摘要和侧边栏工作区标识，同时保留直接项目旧路径。
5. 运行类型、lint、单元、组件、浏览器和 Electron E2E 验证，并在脱敏只读演示工作区上进行人工发现检查。
6. 发布前保留 v2 目录备份；如需回滚应用版本，先恢复该备份。已经注册的项目目录及其 OpenSpec 文件无需回滚，因为本变更不写入项目内容。
