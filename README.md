# OpenSpec Desktop

OpenSpec Desktop 是一个 Windows 优先的本地 Electron 应用。它只读监控你选择的项目中的 `openspec/` 文档，把 Changes、任务、阶段、解析状态和本地修订历史显示在桌面工作区里。项目文件仍然是唯一事实来源，应用不会把 catalog、快照或锁文件写回项目目录。

## 使用

1. 启动应用后选择一个包含可读 `openspec/` 目录的项目根目录。
2. 在左侧项目目录中选择自动识别或手动设置版本上下文，再设置显示名称和个人分组。
3. 选择进行中的或已归档的 Change，在文档、任务、活动和修订页之间切换。
4. Codex 保存 OpenSpec Markdown 后，应用会等待稳定写入，再批量扫描并更新当前投影。

也可以在“添加项目”菜单中选择“从 Codex 导入”。应用只读取 Codex 本机项目索引中的目录，过滤掉不存在或没有 `openspec/` 结构的候选项；导入成功后会按自动模式解析版本。对话正文、凭据、历史消息和附件不会被读取或保存。

支持的文件包括 `openspec/config.yaml`、`specs/**/*.md`、`changes/**/proposal.md`、`design.md`、`tasks.md`、`specs/**/*.md` 和 `changes/**/.openspec.yaml`。应用只派生结构状态，不代替 `openspec validate --strict`。

## 监控状态

- `扫描中`：正在读取初始内容或执行重新扫描。
- `实时监控`：文件监听已建立，稳定保存会自动更新。
- `已暂停`：项目仍登记，但监控开关关闭。
- `路径不可用`：磁盘或目录暂时不可读；恢复后会自动重试。
- `监听异常`：发生监听错误；可以手动重新扫描。

解析异常会保留原始 Markdown，同时单独标出最后一次有效的结构投影。渲染 Markdown 不执行原始 HTML，外部链接只允许通过操作系统打开 `https:` 地址。

## 版本上下文与历史关联

版本上下文有两种模式：

- `自动识别` 按“当前 Git HEAD 的精确标签 → 根目录 `package.json` 的 `version` → 当前工作区”的顺序读取本地线索。识别过程只读、不联网，也不会修改 Git 或项目文件。
- `手动设置` 用于没有发布标签、需要按里程碑标记，或希望暂时固定上下文的场景。手动标签去除首尾空白后必须为 1-120 个字符，重新选择自动识别即可恢复本地解析。

“当前工作区”表示当前没有可识别的发布版本，不是异常状态。它会作为稳定的内部历史键保存，因此在后来切换到 `v1.0.0` 后，切换前的活动和修订仍会留在“当前工作区”，不会被改写。项目标题区的版本菜单可以查看历史版本、刷新自动识别或进入设置；活动和修订页可以按版本筛选。

Change 的关联版本来自它实际产生的活动和修订记录：只涉及一个版本时显示该版本，跨越多个版本时显示最近版本并标出“跨 N 个版本”，没有历史记录时显示“尚无版本活动”。这让版本标签从一段备注变成可追溯的开发进度上下文。

## 本地数据与隐私

Electron 的 user-data 目录由系统决定，设置窗口会显示实际绝对路径并提供打开命令。目录通常位于 Windows 的 `%APPDATA%` 下，应用数据包括：

- `catalog.json`：项目登记、版本模式/来源、分组、窗口和选择偏好。
- `history/<project-id>/index.json`：活动与修订索引。
- `history/<project-id>/snapshots/`：按 SHA-256 内容寻址的本地 Markdown 快照。

默认每个文档保留 50 个修订、每个项目保留 1,000 条活动。设置窗口可以独立保存保留策略，也可以清除本地历史。清除历史和取消登记都不会删除或修改项目源文件。应用初始版本不发送项目路径或内容，也不需要网络、Node.js、OpenSpec CLI、MCP 服务或数据库。

建议把 user-data 目录纳入个人备份；备份前先退出应用以确保索引已落盘。卸载应用不会替你删除项目目录，卸载前可在设置中确认并备份本地历史。重新定位项目只会更新本地登记并重启监听。

## 开发与打包

```powershell
pnpm install
pnpm dev
pnpm build
pnpm build:unpacked
pnpm package:nsis
pnpm package:portable
```

构建产物位于 `release/`，名称固定为 `OpenSpec-Desktop-<version>-Setup.exe` 和 `OpenSpec-Desktop-<version>-Portable.exe`。首版没有代码签名证书，Windows SmartScreen 可能显示“未知发布者”；这不代表本地构建无效。发布前应核对 SHA-256，并只从可信构建机分发。

手动桌面验收可以使用：

```powershell
pnpm build
pnpm start
```

也可以通过环境变量把应用数据放到一次性的目录，便于验收或排查：

```powershell
$env:OPENSPEC_DESKTOP_USER_DATA = 'C:\Temp\openspec-desktop-check'
pnpm start
```

## CodeGraph 与 OpenSpec

日常修改后使用增量同步；替换模块、增加或重命名跨文件导出后强制重建：

```powershell
codegraph index .
codegraph index --force .
```

本地变更的规划资料保存在 `openspec/changes/build-local-openspec-desktop/`。完成实现并人工验收后运行严格校验，再归档该变更：

```powershell
openspec validate "build-local-openspec-desktop" --strict
openspec archive "build-local-openspec-desktop"
```
