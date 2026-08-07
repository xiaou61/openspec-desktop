## Why

Codex already edits OpenSpec Markdown inside each local project, so routing every update through a remote MCP server adds latency, setup, authentication, and synchronization failure modes without improving the personal workflow. A local Electron application can watch those files directly and present project progress as soon as the filesystem settles.

## What Changes

- **BREAKING** Replace the previously planned remote web/server architecture with a TypeScript Electron desktop application for Windows.
- Let the user register multiple local OpenSpec project directories, organize them into personal groups, and assign a current version label.
- Watch each registered project's `openspec/` Markdown and relevant OpenSpec metadata files for add, change, rename, and delete events.
- Rescan and parse affected changes after stable writes, then update workflow stage, artifact availability, task completion, validation indicators, and timestamps without manual refresh.
- Add a React desktop workspace for project navigation, Change progress, rendered and raw Markdown, task checklists, file activity, and revision comparison.
- Keep project files as the only authoritative source. Store application preferences, project grouping, bounded activity history, and content snapshots under Electron's local user-data directory rather than modifying managed repositories.
- Package the application as a Windows installer and a portable EXE.
- Remove remote MCP synchronization, owner authentication, HTTP APIs, browser SSE, and server deployment from the initial product scope. Codex only needs to keep writing valid OpenSpec files locally.

## Capabilities

### New Capabilities

- `local-project-catalog`: Register, group, configure, reopen, and remove local OpenSpec projects without altering their repositories.
- `openspec-file-monitoring`: Detect stable OpenSpec file changes across registered projects and maintain accurate current projections.
- `desktop-progress-workspace`: Visualize project versions, Changes, workflow status, tasks, artifacts, validation health, and file activity in a responsive Electron renderer.
- `local-revision-history`: Preserve bounded local snapshots and activity events so the user can inspect and compare recent Markdown revisions.
- `windows-desktop-distribution`: Run securely as a local Electron application and produce installable and portable Windows executables.

### Modified Capabilities

None.

## Impact

- Supersedes the active `build-personal-ai-dev-platform` implementation direction; its remote Fastify, MCP, credential, REST, SSE, and server persistence scaffold will be removed during apply.
- Introduces a single Electron/electron-vite package with main, preload, renderer, shared contracts, watcher, parser, and local persistence modules.
- Adds filesystem access through the Electron main process, a narrow typed IPC bridge, Chokidar watchers, Markdown AST parsing, and local snapshot storage.
- Adds electron-builder configuration for Windows NSIS and portable targets.
- Keeps CodeGraph as local development tooling and rebuilds its index after the architecture replacement.
