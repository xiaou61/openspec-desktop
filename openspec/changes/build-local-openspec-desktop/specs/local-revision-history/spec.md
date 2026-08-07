## Purpose

Retain a private, bounded local record of recent OpenSpec content changes so the user can understand what changed without introducing a remote service.

## ADDED Requirements

### Requirement: Content-addressed local snapshots

The application SHALL create a local snapshot only when a supported artifact's exact content hash differs from its current stored hash.

#### Scenario: Artifact content changes

- **WHEN** a settled supported artifact has new content
- **THEN** the application stores the content and metadata as a new local revision associated with the project and artifact path

#### Scenario: Duplicate filesystem event occurs

- **WHEN** another event reports the same content hash
- **THEN** the application reuses the existing revision and creates no duplicate snapshot

### Requirement: Activity timeline

The application SHALL record bounded activity entries for meaningful artifact, Change, watcher, and recovery events with local timestamps and project version context.

#### Scenario: Tasks file updates

- **WHEN** a new tasks revision changes completion state
- **THEN** the timeline records the affected Change, artifact, time, and task-count delta

### Requirement: Revision comparison

The application SHALL let the user choose two retained revisions of the same artifact and view a line-level comparison.

#### Scenario: User compares two revisions

- **WHEN** the user selects two available revisions for an artifact
- **THEN** the application shows their timestamps, hashes, and added, removed, and unchanged lines

### Requirement: Bounded retention

The application SHALL enforce configurable per-project limits for activity entries and artifact snapshots and SHALL remove only application-owned history beyond those limits.

#### Scenario: Retention limit is exceeded

- **WHEN** a new revision causes the configured snapshot limit to be exceeded
- **THEN** the oldest unreferenced application snapshot is removed while current project files remain untouched

### Requirement: Local privacy

The application MUST keep catalog data, history, and snapshots on the local machine and MUST NOT transmit project paths or content over the network in the initial release.

#### Scenario: Application monitors a project

- **WHEN** project files are scanned or changed
- **THEN** no network request containing project metadata or content is initiated

### Requirement: History removal control

The application SHALL let the user remove local history separately from unregistering a project and SHALL clearly state that repository files are unaffected.

#### Scenario: User clears local history

- **WHEN** the user confirms history removal for a project
- **THEN** application-owned snapshots and activity entries are removed while project registration and source files remain intact
