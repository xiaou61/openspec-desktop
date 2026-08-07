## Purpose

Keep the desktop projection synchronized with local OpenSpec files by detecting stable filesystem changes quickly and recovering accurately from missed or noisy events.

## ADDED Requirements

### Requirement: Initial OpenSpec scan

The application SHALL scan all supported OpenSpec artifacts and metadata in a registered project before declaring its watcher ready.

#### Scenario: Existing project is opened

- **WHEN** a registered project becomes available
- **THEN** the application discovers active and archived Changes, classifies their artifacts, parses task progress, and reports the initial snapshot before live monitoring begins

### Requirement: Relevant file event monitoring

The application SHALL monitor supported files under `openspec/` for add, content change, rename, and delete behavior while ignoring unrelated repository files and temporary editor artifacts.

#### Scenario: Codex updates tasks Markdown

- **WHEN** Codex saves a supported `tasks.md` file
- **THEN** the application reparses the affected Change and emits an updated projection without requiring a manual refresh

#### Scenario: Unrelated source file changes

- **WHEN** a file outside the supported OpenSpec paths changes
- **THEN** the application does not create an OpenSpec activity entry or rescan unrelated Changes

#### Scenario: Artifact is removed

- **WHEN** a supported artifact is deleted or renamed away
- **THEN** the application removes the old artifact from the current projection and recalculates workflow readiness

### Requirement: Stable-write and duplicate handling

The application SHALL wait for a short stable-write window before reading changed files and SHALL use exact content hashes to suppress duplicate revisions and UI events.

#### Scenario: Editor writes through a temporary file

- **WHEN** an editor replaces a Markdown file through multiple rapid filesystem operations
- **THEN** the application produces one settled projection for the final readable content

#### Scenario: Content hash is unchanged

- **WHEN** the watcher receives another event for content identical to the current snapshot
- **THEN** the application records no new revision or user-visible change event

### Requirement: Bounded targeted rescanning

The application SHALL batch bursts of events and SHALL rescan only the affected project or Change unless event ambiguity requires a full project reconciliation.

#### Scenario: Multiple specs change together

- **WHEN** several spec files in one Change are saved during the batching window
- **THEN** the application emits one coherent Change projection containing all settled updates

#### Scenario: Watcher overflow or ambiguous rename occurs

- **WHEN** the application cannot determine the affected artifact reliably
- **THEN** it performs a full reconciliation for that project and reports the recovery in local activity

### Requirement: Watch health and recovery

The application SHALL expose watcher states for scanning, watching, paused, unavailable, and error, and SHALL retry or allow manual rescan without discarding the last confirmed snapshot.

#### Scenario: Directory becomes temporarily unavailable

- **WHEN** a watched drive or directory cannot be read
- **THEN** the application retains the last snapshot, marks the project unavailable, and attempts recovery when the path returns

#### Scenario: User requests a rescan

- **WHEN** the user invokes rescan for a registered project
- **THEN** the application reconciles current files and restarts monitoring if necessary

### Requirement: Read-only project observation

The monitoring subsystem MUST NOT write application metadata, snapshots, lock files, or indexes into registered project directories.

#### Scenario: Project is monitored

- **WHEN** scanning and file events occur
- **THEN** all application-owned persistence remains outside the project path
