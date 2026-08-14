# OpenSpec Desktop

OpenSpec Desktop 是一个 Windows 优先的本地 Electron 应用。它只读监控你选择的项目中的 `openspec/` 文档，把 Changes、任务、阶段、解析状态和本地修订历史显示在桌面工作区里。项目文件仍然是唯一事实来源，应用不会把 catalog、快照或锁文件写回项目目录。

[完整中文操作手册](docs/user-manual.md)覆盖项目接入、Change 生命周期、任务再次实施、严格验证、归档、历史、设置、备份和故障处理。

## 快速开始

当前仓库只提供源码，不提供 GitHub Release、版本标签或安装包。请准备 Windows 10/11、Node.js 24、pnpm 11 和 Git；运行严格验证时还需要 OpenSpec CLI。

```powershell
git clone https://github.com/xiaou61/openspec-desktop.git
Set-Location .\openspec-desktop
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

窗口打开后，选择左上角加号 → **选择文件夹**，添加一个自身包含可读 `openspec/` 的项目根。也可选择 **从 Codex 导入**，一次接入单项目或多项目工作区。随后在 **当前变更** 中选择 Change，通过右侧 **文档**、**任务**、**就绪**、**活动** 和 **修订** 查看只读证据；需要验证时选择 **运行严格验证**。

开发模式使用 `pnpm dev`。应用不会修改项目文件、勾选任务、归档 Change 或执行 Git 写操作；完整前置条件和操作结果请以[中文操作手册](docs/user-manual.md)为准。

## 当前能力与边界

- 接入单个 OpenSpec 项目，或从 Codex 本机索引导入单项目和多项目工作区；每个项目独立扫描、监控和保存本地历史。
- 在三栏工作区浏览当前/已归档 Change、Markdown 文档、任务进度、六节点生命周期、行动中心、版本活动和本地修订。
- 识别已完成任务再次打开的实施轮次，并在当前内容变化后使旧验证结果过期。
- 通过本机 OpenSpec CLI 运行严格验证，展示诊断、归档门槛和 delta spec 对主规格的影响。

OpenSpec CLI 对浏览项目不是必需项，但没有兼容 CLI 时不能运行严格验证，权威工件状态会明确降级。应用内的 **可归档** 只是 OpenSpec 文档门槛的只读预检，不证明代码已经实现、测试或发布；归档仍需在项目根通过 OpenSpec CLI 明确执行。

应用不会修改项目中的 `openspec/` 文件、勾选任务、同步主规格、归档 Change，或执行 Git 提交与推送。操作流程和状态含义以[中文操作手册](docs/user-manual.md)为准。

## 本地数据与隐私

Electron 的 user-data 目录由系统决定。**项目设置** 中的 **本地存储** 会在按钮下方显示实际路径，但不会自动打开资源管理器。主要数据包括：

- `catalog.json`：项目登记、版本模式/来源、分组、窗口和选择偏好。
- `history/<project-id>/index.json`：活动与修订索引。
- `history/<project-id>/snapshots/`：按 SHA-256 内容寻址的本地 Markdown 快照。
- `lifecycle-validation/<project-id>/`：按当前/归档身份隔离的严格验证结果与内容指纹。
- `change-work-state/<project-id>/index.json`：从本机观察开始记录的实施轮次、完成里程碑、能力演进和归档完整性基线。

应用不上传项目路径、Markdown、历史、验证输出或 Codex 交接内容，也不会读取 Codex 对话、账号、令牌、提示历史或附件。本地数据没有应用级加密，应使用 Windows 账号权限保护并在迁移或卸载前备份；清除历史和移除项目登记都不会删除项目源文件。

## 开发与验证

```powershell
pnpm install --frozen-lockfile
pnpm dev
pnpm typecheck
pnpm lint
pnpm test
pnpm check:renderer-boundary
pnpm build
pnpm test:e2e
pnpm test:e2e:electron
```

`pnpm build` 会执行类型检查、Electron 生产构建和 renderer 边界检查，输出可由下列命令本地预览：

```powershell
pnpm build
pnpm start
```

这些命令只构建和验证当前源码，不创建或上传 GitHub Release、版本标签或安装包。完整源码启动条件见[操作手册第 1 章](docs/user-manual.md#1-适用范围与启动)。
