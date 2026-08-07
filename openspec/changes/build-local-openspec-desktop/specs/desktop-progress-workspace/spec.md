## Purpose

Provide a focused desktop workspace that turns current OpenSpec files into a scannable view of projects, Changes, tasks, artifacts, and recent local activity.

## ADDED Requirements

### Requirement: Project and Change overview

The application SHALL display registered project groups, projects, version labels, active and archived Changes, workflow stage, task completion, last file activity, and watcher health.

#### Scenario: User opens the desktop application

- **WHEN** one or more projects are registered
- **THEN** the workspace presents their current progress in a compact hierarchy suitable for repeated scanning

#### Scenario: User switches archive visibility

- **WHEN** the user selects active or archived work
- **THEN** the Change list updates without mixing archived entries into the default active view

### Requirement: Change detail workspace

The application SHALL provide a Change view with artifact navigation, workflow readiness, tasks, validation indicators, timestamps, and local activity.

#### Scenario: User opens a Change

- **WHEN** the user selects an active or archived Change
- **THEN** the application shows all recognized artifacts and derived progress from the latest settled snapshot

#### Scenario: Required artifact is absent

- **WHEN** the selected Change lacks an expected artifact
- **THEN** the workspace identifies the missing artifact rather than presenting the workflow as ready

### Requirement: Safe Markdown inspection

The application SHALL let the user switch between sanitized rendered Markdown and exact raw source, and SHALL provide a command to reveal the source file in the operating system.

#### Scenario: Artifact contains raw HTML

- **WHEN** the user opens Markdown containing embedded HTML or unsafe links
- **THEN** the renderer does not execute unsafe content and preserves access to the exact raw text

#### Scenario: User reveals an artifact

- **WHEN** the user chooses the reveal command for a current artifact
- **THEN** the operating system file manager opens at that artifact without the application editing it

### Requirement: Immediate projection updates

The workspace SHALL apply committed watcher projections without restarting or manually refreshing the window and SHALL preserve the user's current project, Change, artifact, and scroll context where possible.

#### Scenario: Current task becomes complete

- **WHEN** a settled file update marks the visible task complete
- **THEN** task status, totals, workflow stage, and activity update while the user remains in the current workspace

### Requirement: Clear desktop states

The interface SHALL distinguish scanning, watching, stale, unavailable, parse-error, and settled states using text or icons in addition to color.

#### Scenario: Markdown cannot be parsed

- **WHEN** a supported artifact is readable but invalid for its expected projection
- **THEN** the application shows the raw artifact, a parse-error state, and the last valid derived data separately

### Requirement: Accessible and stable layout

The interface SHALL support keyboard navigation, visible focus, semantic controls, at least 24 by 24 CSS pixel targets, sufficient contrast, long paths and headings, and reflow at supported narrow window sizes.

#### Scenario: User operates by keyboard

- **WHEN** the user navigates projects, Changes, artifact tabs, and commands without a pointer
- **THEN** all primary operations remain reachable with a visible focus indicator

#### Scenario: Window is narrowed

- **WHEN** the application window reaches its supported minimum width
- **THEN** navigation and content adapt without incoherent overlap or clipped commands
