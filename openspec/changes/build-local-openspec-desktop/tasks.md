## 1. Replace the Superseded Scaffold

- [x] 1.1 Remove the generated remote server, web workspace, shared server contracts, SQLite/MCP dependencies, and remote-architecture tests while preserving OpenSpec history, `.agents`, and `.codegraph`.
- [x] 1.2 Scaffold one strict TypeScript electron-vite project with main, preload, renderer, shared, resources, and build directories.
- [x] 1.3 Configure development, type-check, unit-test, coverage, production-build, unpacked-run, and Windows packaging scripts with a reproducible lockfile.
- [x] 1.4 Launch a minimal secure Electron window with an isolated preload, React renderer, graceful app lifecycle, and a smoke test for all three build targets.

## 2. Shared Contracts and OpenSpec Projection

- [x] 2.1 Define strict Zod contracts and serializable types for projects, groups, watcher states, Changes, artifacts, tasks, revisions, activity, IPC requests, and projection events.
- [x] 2.2 Implement registered-root path normalization, OpenSpec artifact classification, temporary-file filtering, symlink avoidance, and file-size limits with traversal tests.
- [x] 2.3 Implement Markdown AST parsing for titles, headings, GFM task items, completion totals, and raw-content preservation with representative OpenSpec fixtures.
- [x] 2.4 Implement safe OpenSpec YAML metadata parsing and the versioned `spec-driven` stage/readiness adapter without claiming CLI strict validation.
- [x] 2.5 Implement deterministic project and Change scanning for active specs, active Changes, and archived Changes with unavailable, unreadable, and malformed-file tests.

## 3. Local Catalog and Persistence

- [x] 3.1 Implement versioned, schema-validated catalog loading and atomic writes under an injected user-data directory, including corrupt-state recovery tests.
- [x] 3.2 Implement native directory selection and OpenSpec project validation without writing into the selected repository.
- [x] 3.3 Implement project registration, stable ids, display names, version labels, grouping, ordering, relocation, and unavailable-path state.
- [x] 3.4 Implement group create, rename, reorder, and removal with non-empty groups moving projects to the ungrouped section.
- [x] 3.5 Implement unregister behavior that stops monitoring and removes only local catalog membership, with source-preservation integration tests.

## 4. Local Revision and Activity History

- [x] 4.1 Implement content-addressed Markdown snapshot storage under user data with exact SHA-256 deduplication and opaque local paths.
- [x] 4.2 Implement the versioned history index for revisions and meaningful activity entries with project version and task-count delta metadata.
- [x] 4.3 Implement configurable per-artifact revision and per-project activity retention with safe unreferenced-snapshot cleanup tests.
- [x] 4.4 Implement bounded line-level revision comparison and revision/activity query pagination.
- [x] 4.5 Implement separate clear-history behavior that preserves project registration and all repository files.

## 5. Filesystem Monitoring

- [x] 5.1 Implement one Chokidar watcher per available project with ignored temporary files, atomic handling, stable-write waiting, and clean shutdown.
- [x] 5.2 Implement per-project event batching, affected-Change targeting, exact-hash duplicate suppression, and coherent projection publication.
- [x] 5.3 Implement add, change, unlink, and rename reconciliation so artifact removal and archive movement recalculate current state.
- [x] 5.4 Implement watcher health, unavailable-path handling, retry, manual rescan, error recovery, and full reconciliation for ambiguous events.
- [x] 5.5 Add temporary-directory integration tests covering Codex-like rapid saves, replacement writes, duplicate events, multi-file bursts, deletion, archive movement, and watcher closure.

## 6. Secure Electron IPC

- [x] 6.1 Implement main-process IPC handlers for catalog snapshots, project/group mutations, scan/rescan, history queries, comparison, and clear-history using shared schema validation.
- [x] 6.2 Implement a narrow typed preload bridge that exposes only approved methods and projection subscriptions, never raw `ipcRenderer`, filesystem, or shell APIs.
- [x] 6.3 Implement registered-id-based reveal-in-folder, reveal-user-data, and HTTPS external-link operations with root containment and scheme tests.
- [x] 6.4 Connect watcher projections to subscribed renderer windows with unsubscribe cleanup and serializable payload validation.
- [x] 6.5 Add IPC authorization-boundary tests for unknown ids, traversal paths, malformed payloads, unknown channels, and closed windows.

## 7. Desktop Progress Workspace

- [x] 7.1 Build the quiet three-region React shell with grouped project navigation, Change list, detail workspace, empty/loading/error states, and stable desktop dimensions.
- [x] 7.2 Build project onboarding and management flows for folder selection, grouping, display name, version label, relocation, rescan, unregister, and local-storage information.
- [x] 7.3 Build active/archive Change overviews with structural stage, task progress, missing artifacts, parse health, last activity, and watcher state.
- [x] 7.4 Build the Change detail workspace with artifact tabs, safe rendered Markdown, exact raw source, tasks, timestamps, and reveal-in-folder commands.
- [x] 7.5 Build bounded revision selection, line-diff presentation, activity timeline, retention settings, and clear-history confirmation.
- [x] 7.6 Connect projection subscriptions to targeted query updates while preserving the selected project, Change, artifact, and scroll context.
- [x] 7.7 Add keyboard, focus, live-status announcement, long-content, minimum-window, and responsive interaction tests aligned with WCAG 2.2 AA.

## 8. Window Security and Desktop Lifecycle

- [x] 8.1 Enforce sandboxed context isolation, disabled Node integration, restrictive CSP, denied permissions, denied unexpected windows, and denied application-window navigation.
- [x] 8.2 Implement approved HTTPS link handoff, single-instance focus/restore behavior, minimum window sizing, persisted window bounds, and development-only developer tools.
- [x] 8.3 Ensure quit, project removal, relocation, and renderer disposal close watchers, subscriptions, timers, and pending persistence operations.
- [x] 8.4 Add Electron-level security and lifecycle tests plus an automated check that no renderer bundle imports privileged Node or Electron modules.

## 9. Windows Packaging and End-to-End Verification

- [x] 9.1 Add application bitmap/icon resources and electron-builder metadata with ASAR packaging, per-user NSIS, portable target, and deterministic artifact names.
- [x] 9.2 Add user documentation for local data location, project registration, watcher states, history retention, unsigned-build warnings, backup, uninstall, and source-file safety.
- [x] 9.3 Run the application against this repository as a monitored project and verify initial scan plus live updates through a disposable OpenSpec artifact.
- [x] 9.4 Force-rebuild CodeGraph for the replacement architecture and document normal sync versus forced reindex checkpoints.
- [x] 9.5 Run type checking, lint, unit tests, watcher integration tests, IPC tests, renderer tests, production build, dependency audit, and strict OpenSpec validation.
- [x] 9.6 Visually verify primary desktop and minimum-width layouts, keyboard focus, long Markdown, watcher/error states, and non-overlap using automated Electron screenshots.
- [x] 9.7 Build and smoke-test both the Windows installer and portable EXE, then record output paths, hashes, and any unsigned-package limitation.

## Verification Record (2026-08-07)

- Repository monitoring: Electron E2E registered this repository, completed its initial scan, changed a disposable `tasks.md`, observed `0/1` become `1/1`, and removed the disposable Change afterward.
- Automated checks: `pnpm run ci` passed 19 test files and 42 tests plus type checking, lint, production build, and renderer-boundary validation; Chromium E2E passed 2 tests; Electron E2E passed 3 tests; the installed executable passed the same 3 Electron tests.
- Supply chain and specification: the official npm registry audit reported no known vulnerabilities; strict OpenSpec validation passed.
- Visual evidence: `release/verification/electron-primary.png` and `release/verification/electron-minimum.png` cover long content, escaped HTML, visible keyboard focus, live watcher and parse-error states, and the settled 920 px layout without horizontal overflow or drawer overlap.
- Installer: `release/OpenSpec-Desktop-0.1.0-Setup.exe`, SHA-256 `94B92D7FB80DE04DB28062836D0650862AC859D3F2A24F00C6B87CE1610B206D`; silent install and uninstall both exited with code 0.
- Portable: `release/OpenSpec-Desktop-0.1.0-Portable.exe`, SHA-256 `1134EAA60179E0F76826F56BAB9BD6B95FB2FB8266EF983E1B18B2351D57A72F`; it created an `OpenSpec Desktop` main window with an isolated user-data directory and closed normally.
- Signing limitation: both executables are intentionally unsigned (`NotSigned`), so Windows SmartScreen may warn until a code-signing certificate is added.
