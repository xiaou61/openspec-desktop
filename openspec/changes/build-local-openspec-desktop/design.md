## Context

The repository currently contains an incomplete remote TypeScript web/server scaffold created for the superseded change. The new product runs on the same Windows machine where Codex edits local projects. See `proposal.md` for the architectural correction and the capability specs for observable behavior.

The application must monitor arbitrary user-selected project directories without placing its own files in them. Project content can be malformed or change through editor rename sequences while the UI is open. The packaged executable must work without a separately installed Node.js runtime, OpenSpec CLI, database service, or network connection.

## Goals / Non-Goals

**Goals:**

- Produce a fast local feedback loop from a settled Markdown write to a visible Change projection.
- Keep all privileged filesystem behavior in the Electron main process behind a narrow typed bridge.
- Preserve exact source content and recent history without native database dependencies.
- Make watcher recovery, parse failure, and unavailable folders visible rather than silently stale.
- Keep development, tests, and Windows packaging in one TypeScript project.

**Non-Goals:**

- Remote MCP synchronization, HTTP APIs, server deployment, accounts, shared workspaces, or cross-device synchronization.
- Editing OpenSpec files from the desktop application in the first release.
- Replacing the OpenSpec CLI's strict validator; the desktop derives structural progress and labels it separately from authoritative CLI validation.
- Monitoring arbitrary source-code changes or uploading a CodeGraph database.
- Automatic application updates or mandatory code signing in the first release.

## Decisions

### 1. Replace the workspace with one electron-vite application

Use Electron, electron-vite, React, and TypeScript in a single package:

```text
src/main/              privileged lifecycle, IPC, projects, watching, scanning, history
src/preload/           allow-listed contextBridge API
src/renderer/src/      React desktop workspace
src/shared/            Zod IPC contracts and serializable domain types
resources/             application icons and packaged static resources
build/                 electron-builder resources
```

The package entry points to electron-vite's generated main output. `electron-builder` produces NSIS and portable Windows targets after the main, preload, and renderer builds.

This is preferred over keeping a Fastify server inside Electron because local IPC is lower latency, requires no port, avoids browser authentication and CSRF, and has a smaller failure surface. A local HTTP service would only be reconsidered if an external client must query the app later.

### 2. Use the main process as the sole filesystem authority

The renderer never receives Node.js integration or arbitrary path operations. The main window uses `contextIsolation: true`, `sandbox: true`, and `nodeIntegration: false`. The preload exposes typed functions for catalog operations, scanning, revision queries, reveal-in-folder, approved external links, and projection subscriptions.

Every IPC argument is parsed again in the main process. Project operations use registered project identifiers; a renderer-supplied artifact path must normalize beneath that registered project's `openspec` directory. The window denies new windows, navigation, and permissions by default. External navigation is restricted to explicit `https:` links opened by the operating system.

This follows Electron's recommended isolated preload pattern and avoids exposing `ipcRenderer`, `fs`, shell commands, or generic channel names to React.

### 3. Keep a local project catalog outside managed repositories

Store a versioned JSON catalog under `app.getPath('userData')` with project id, path, display name, group id, version label, ordering, watcher preference, and last known state. Use schema validation on load and atomic replace-on-write behavior. Corrupt state is moved aside and reported instead of being silently overwritten.

The native directory picker is the only initial source of a project root. Registration verifies a readable `openspec` directory and at least one of `config.yaml`, `specs/`, or `changes/`. Unregistering stops the watcher and removes catalog membership only. Local history removal is a separate explicit action.

JSON is preferred over SQLite because catalog data is small, one process owns it, and eliminating a native database module makes Electron packaging and upgrades more reliable. Artifact content is not embedded in the catalog.

### 4. Scan deterministically, then monitor with Chokidar

Initial scanning uses a bounded recursive enumeration under `openspec/` and accepts:

- `config.yaml`
- `specs/**/*.md`
- `changes/**/.openspec.yaml`
- `changes/**/*.md`

The scanner ignores symlink traversal, hidden editor temporary files, `node_modules`, and paths outside the registered root. It reads files as UTF-8 with a configurable size limit and records explicit read or parse failures.

After the initial snapshot, one Chokidar watcher per available project starts with `ignoreInitial: true`, atomic rename handling, and a short `awaitWriteFinish` window. Add, change, and unlink events enter a per-project batching queue. Events are mapped to a Change when unambiguous; a batch rescans that Change. Ambiguous rename/error recovery triggers a project reconciliation. Exact SHA-256 hashes suppress duplicate content events.

The watcher emits serializable projection events only after the rescan commits a coherent in-memory snapshot. It is closed on unregister, relocation, app shutdown, and watcher restart.

### 5. Parse Markdown through an AST and isolate OpenSpec projection rules

Use unified, remark-parse, and remark-gfm to parse Markdown. The adapter preserves raw content and derives headings, task list items, completion totals, and artifact titles from the AST rather than ad hoc line splitting. YAML metadata is parsed with a safe YAML parser.

A `spec-driven` adapter classifies proposal, specs, design, and tasks paths and derives a display stage from artifact presence, task state, archive location, and parse health. The renderer calls this a structural status. It must not claim that `openspec validate --strict` ran when the CLI is absent.

Parser output is immutable serializable data. On parse failure, the current raw content and error are published while the last valid derived projection remains separately identified. This prevents malformed intermediate saves from erasing useful state.

### 6. Store bounded content-addressed snapshots and activity locally

Snapshots live under the user-data directory, organized by opaque project and artifact identifiers rather than raw absolute paths. The SHA-256 content hash is the snapshot filename key, so duplicate events reuse the same content. A versioned history index records revision id, hash, relative path, Change, project version label, timestamp, size, and prior revision.

Activity entries are append-like records for meaningful content changes, task deltas, watcher state changes, recovery, and project registration. Default retention is 50 revisions per artifact and 1,000 activity entries per project. Cleanup deletes only unreferenced application-owned snapshot files.

Line comparison uses a deterministic text diff in the main or shared pure domain layer and returns bounded serializable hunks. The renderer never reads snapshot paths directly.

### 7. Drive React from snapshots plus projection events

On launch, React requests one catalog snapshot through IPC. The preload then subscribes to projection events and exposes an unsubscribe function. TanStack Query owns request state and targeted invalidation; transient UI selection remains in renderer state.

The desktop layout is a restrained three-region workspace: project catalog navigation, Change list/progress, and a detail area with artifact tabs, tasks, activity, and revisions. At narrow widths the catalog becomes a dismissible sheet and the Change/detail regions stack. The UI uses Tailwind CSS, Radix primitives where behavior needs focus management, and Lucide icons. Cards are reserved for repeated Change summaries and are not nested.

Markdown uses `react-markdown` with GFM and no raw HTML execution. Links are intercepted and routed to the approved external-link IPC operation. Raw text is displayed separately. Watcher and parse states always include text or icon labels, not color alone.

### 8. Package a secure, self-contained Windows application

Electron-builder packages ASAR application code and emits:

```text
OpenSpec-Desktop-<version>-Setup.exe
OpenSpec-Desktop-<version>-Portable.exe
```

The installer uses a per-user NSIS target so administrator access is not required. The application requests a single-instance lock; a second launch restores and focuses the first window. Main-process shutdown awaits watcher closure and final catalog/history writes.

No production URL is loaded, no remote content is embedded, and CSP limits renderer resources to the packaged application. Code signing remains optional because no certificate is available; documentation must distinguish a valid unsigned local build from a signed release.

### 9. Replace the superseded scaffold rather than carrying it forward

During apply, remove the generated `apps/server`, `apps/web`, and `packages/contracts` implementation, workspace-only configuration, server dependencies, and remote architecture tests. Preserve `.agents`, `.codegraph`, and all OpenSpec planning history. Replace the root package with the Electron project, install only desktop dependencies, then run `codegraph index --force .` because exports and cross-file links change completely.

Keeping the old service modules alongside Electron was considered and rejected: none of their authentication, HTTP, MCP, SQLite, or SSE behavior is required, and retaining them would create two conflicting application architectures.

## Risks / Trade-offs

- [Rapid editor writes produce noisy events] -> Use atomic handling, stable-write waiting, hash deduplication, and per-project event batching.
- [A filesystem event is missed] -> Reconcile at startup, after watcher errors, on explicit rescan, and when an ambiguous rename is detected.
- [A project is on a slow or removable drive] -> Keep the last confirmed snapshot, expose unavailable/scanning state, bound concurrency, and allow manual retry.
- [Malformed Markdown appears during a save] -> Preserve raw content and last valid projection separately, then replace the error state after a valid settled write.
- [Renderer compromise attempts privileged access] -> Use sandboxed context isolation, narrow preload methods, main-process Zod validation, registered ids, and root containment checks.
- [Local history grows] -> Apply per-artifact and per-project retention, content-address duplicate snapshots, and expose clear-history controls.
- [Unsigned EXE triggers Windows reputation warnings] -> Produce deterministic artifacts and document the limitation; add signing later without changing runtime architecture.
- [OpenSpec conventions evolve] -> Isolate path and projection rules in a versioned adapter while preserving exact file content.

## Migration Plan

1. Validate this replacement change, then remove only the generated remote implementation files identified in the proposal.
2. Scaffold and test the secure Electron main/preload/renderer shell before adding project access.
3. Add catalog, scanner, parser, watcher, and history as main-process modules with temporary-directory integration tests.
4. Build the React workspace against deterministic fixtures, then connect projection events through the preload bridge.
5. Run the application against this repository as the first monitored OpenSpec project and verify live task updates.
6. Force-rebuild CodeGraph, build both Windows targets, smoke-test the unpacked and packaged applications, and retain the new lockfile.

Rollback restores the previous source snapshot and lockfile. The old OpenSpec change remains available as planning history, while project repositories remain unaffected because the desktop application is read-only.
