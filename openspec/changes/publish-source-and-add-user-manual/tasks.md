## 1. 建立发布边界

- [x] 1.1 记录当前分支、HEAD、`origin`、远端可见性、GitHub 登录状态和完整 `git status --short`，确认目标仍是既有公开仓库的 `main`，且不创建分支、worktree、标签或 Release。
- [x] 1.2 逐项审阅已跟踪差异、未跟踪源码、测试夹具和所有活跃 OpenSpec Change，形成拟发布允许清单；明确哪些文件用于解释当前产品实现，禁止用 `git add -A` 代替审阅。
- [x] 1.3 审计 `.tmp-wmi-diagnosis/`、`output/` 及验证生成目录，为稳定可再生的根目录补充精确 `.gitignore` 规则，并确认这些内容未进入 Git 索引。
- [x] 1.4 对拟发布清单检查令牌/凭据模式、`.env`、密钥证书、真实私有项目名、Windows 绝对用户路径和异常大文件，移除或脱敏所有不应进入公开仓库的内容。

## 2. 编写中文操作手册

- [x] 2.1 创建 `docs/user-manual.md`，写明适用版本、系统/CLI 前置条件、源码构建或当前可用启动方式，并避免暗示本次未提供的安装包或 GitHub Release 已经存在。
- [x] 2.2 编写首次使用与项目接入流程，覆盖添加/移除项目、OpenSpec 根识别、单项目与多项目工作区、扫描刷新和无法识别项目时的处理。
- [x] 2.3 编写 Change 日常流程，覆盖列表与详情、状态和生命周期、任务进度、行动中心、已完成需求再次实施/修订以及对应成功标记。
- [x] 2.4 编写验证与归档流程，覆盖界面内运行严格验证、实际 CLI 命令、成功/失败/执行中状态、错误查看、归档影响和长期规格基线的准确含义。
- [x] 2.5 编写历史活动、版本关联、设置、本地数据与隐私、备份/迁移/卸载和常见故障章节；每个关键流程包含入口、前置条件、步骤、成功结果和失败处理。
- [x] 2.6 启动最终待发布版本，逐条实测手册中的按钮名、状态名、命令、路径约束和操作结果，修正任何与当前产品不一致或已删除功能的描述。

## 3. 补充真实界面截图

- [x] 3.1 使用脱敏演示项目和统一窗口尺寸采集最终界面，至少覆盖工作区总览、Change 详情/生命周期、就地严格验证、任务再次实施或历史查看。
- [x] 3.2 将必要截图以清晰且适度压缩的格式放入 `docs/assets/user-manual/`，移除账号、令牌、私有项目名和本机绝对路径，并为每张图添加准确替代文本与说明。
- [x] 3.3 在本地 Markdown 预览和 GitHub 相对路径规则下检查全部图片引用，确认无断图、关键控件未被裁切、文字可辨认，且截图没有重复正文即可说明的信息。

## 4. 调整 README 导航

- [x] 4.1 将 `README.md` 的“使用”部分收敛为真实可执行的快速开始，并在首屏可发现位置链接 `docs/user-manual.md`。
- [x] 4.2 核对 README 的产品状态、功能边界、开发/构建命令、本地数据与隐私说明，删除与手册冲突、已移除或重复维护的内容。
- [x] 4.3 从 README 逐条打开手册及其截图，并检查仓库内 Markdown 链接、标题锚点和命令代码块在 GitHub 上可正确阅读。

## 5. 发布前验证

- [x] 5.1 运行 `git diff --check`，检查拟提交 Markdown 的结构、相对链接、图片文件存在性、拼写和残留绝对本机路径，并再次执行敏感信息与大文件审计。
- [x] 5.2 依次运行 `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm check:renderer-boundary` 和 `pnpm build`，修复本次待发布版本中的失败并记录结果。
- [x] 5.3 运行 `pnpm test:e2e` 与 `pnpm test:e2e:electron`，确认手册涉及的项目接入、Change 浏览、验证、再次实施和历史流程仍可用；环境阻塞必须如实记录，不得标记为通过。
- [x] 5.4 运行 `openspec validate publish-source-and-add-user-manual --strict --no-interactive`，确认本 Change 使用 `skip_specs: true` 且 proposal、design、tasks 相互一致。

## 6. 提交并推送 GitHub

- [x] 6.1 执行 `git fetch origin` 并比较本地 `main` 与 `origin/main`；如远端新增提交或发生分叉则停止并先解决，不得 force push。
- [x] 6.2 按允许清单显式暂存源码、测试、OpenSpec 记录、README、用户手册、截图和仓库卫生规则，复核 `git diff --cached --stat`、缓存完整差异与剩余 `git status --short`，确认没有生成产物或敏感内容。
- [x] 6.3 按可审阅的逻辑边界创建一个或少量 Conventional Commits 提交，记录每个提交 SHA，并确认提交后没有遗漏应发布的相关文件。
- [x] 6.4 将本地 `main` 正常推送到 `origin/main`，通过 GitHub CLI/API 核对远端 HEAD 与本地提交一致，并确认仓库 URL、README 手册入口、`docs/user-manual.md` 和全部截图可访问。
- [x] 6.5 汇总实际推送的提交 SHA、远端 URL、验证结果、明确排除项和任何未运行项；不归档本 Change，也不把未执行的 Release/安装包工作描述为已完成。
