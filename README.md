# OpenSpec Desktop

OpenSpec Desktop 是一个 Windows 优先的本地 Electron 应用。它只读监控你选择的项目中的 `openspec/` 文档，把 Changes、任务、阶段、解析状态和本地修订历史显示在桌面工作区里。项目文件仍然是唯一事实来源，应用不会把 catalog、快照或锁文件写回项目目录。

## 使用

1. 启动应用后选择一个包含可读 `openspec/` 目录的项目根目录。
2. 在左侧项目目录中设置显示名称、版本标签和个人分组。
3. 选择进行中的或已归档的 Change，在文档、任务、活动和修订页之间切换。
4. Codex 保存 OpenSpec Markdown 后，应用会等待稳定写入，再批量扫描并更新当前投影。

支持的文件包括 `openspec/config.yaml`、`specs/**/*.md`、`changes/**/proposal.md`、`design.md`、`tasks.md`、`specs/**/*.md` 和 `changes/**/.openspec.yaml`。应用只派生结构状态，不代替 `openspec validate --strict`。

## 监控状态

- `扫描中`：正在读取初始内容或执行重新扫描。
- `实时监控`：文件监听已建立，稳定保存会自动更新。
- `已暂停`：项目仍登记，但监控开关关闭。
- `路径不可用`：磁盘或目录暂时不可读；恢复后会自动重试。
- `监听异常`：发生监听错误；可以手动重新扫描。

解析异常会保留原始 Markdown，同时单独标出最后一次有效的结构投影。渲染 Markdown 不执行原始 HTML，外部链接只允许通过操作系统打开 `https:` 地址。

## 本地数据与隐私

Electron 的 user-data 目录由系统决定，设置窗口会显示实际绝对路径并提供打开命令。目录通常位于 Windows 的 `%APPDATA%` 下，应用数据包括：

- `catalog.json`：项目登记、分组、版本标签、窗口和选择偏好。
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
