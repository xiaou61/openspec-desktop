## Purpose

Let one desktop user organize and reopen multiple local OpenSpec repositories while keeping all project source files under the user's direct control.

## ADDED Requirements

### Requirement: Register an OpenSpec project directory

The application SHALL let the user select a local directory and SHALL register it only when it contains a readable `openspec` directory with recognizable OpenSpec metadata or artifacts.

#### Scenario: Valid project is selected

- **WHEN** the user selects a directory containing a readable OpenSpec project
- **THEN** the application registers it with a stable local identifier and performs an initial scan

#### Scenario: Invalid directory is selected

- **WHEN** the selected directory does not contain a recognizable OpenSpec structure
- **THEN** the application rejects registration with a corrective message and does not modify the directory

### Requirement: Organize personal projects

The application SHALL let the user create, rename, reorder, and remove personal groups and SHALL let projects move between groups without losing their local settings or history.

#### Scenario: Project moves between groups

- **WHEN** the user assigns a registered project to another group
- **THEN** the project appears under the new group with the same identifier, path, version, and activity history

#### Scenario: Non-empty group is removed

- **WHEN** the user removes a group that contains projects
- **THEN** the application moves those projects to an ungrouped section instead of unregistering them

### Requirement: Configure project display metadata

The application SHALL let the user set a display name and current version label for each registered project without writing those values into the managed repository.

#### Scenario: Version label is updated

- **WHEN** the user changes a project's version label
- **THEN** the new label appears in the project overview and subsequent local activity entries

### Requirement: Persist and reopen the catalog

The application SHALL persist the project catalog and UI preferences in the operating system user-data location and SHALL restore them when the application starts again.

#### Scenario: Application restarts

- **WHEN** the user closes and reopens the application
- **THEN** registered projects, groups, version labels, and preferences are restored and available projects are rescanned

#### Scenario: Registered directory is unavailable

- **WHEN** a saved project path no longer exists or cannot be read at startup
- **THEN** the project remains registered but is marked unavailable with an option to locate or remove it

### Requirement: Unregister without deleting source

The application MUST treat unregistering as a local catalog operation and MUST NOT delete, rename, or edit any files in the project directory.

#### Scenario: User unregisters a project

- **WHEN** the user confirms removal of a registered project
- **THEN** the watcher stops and the project leaves the catalog while all repository files remain unchanged
