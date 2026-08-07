## Purpose

Deliver the project monitor as a secure, self-contained Windows desktop application that can be installed or run portably without a separate Node.js or OpenSpec service.

## ADDED Requirements

### Requirement: Windows executable outputs

The release build SHALL produce a Windows installer and a portable executable with product name, application version, and deterministic artifact naming.

#### Scenario: Windows packaging completes

- **WHEN** the release packaging command succeeds
- **THEN** the distribution directory contains both the configured installer and portable executable

### Requirement: Self-contained local operation

The packaged application SHALL scan and monitor registered OpenSpec projects without requiring a separately installed Node.js runtime, web server, MCP server, or OpenSpec CLI.

#### Scenario: Application runs on a clean supported Windows account

- **WHEN** the user starts the packaged executable on a supported Windows system
- **THEN** the desktop workspace opens and can register and monitor a valid local OpenSpec project

### Requirement: Secure renderer boundary

The application MUST keep Node.js and unrestricted Electron APIs unavailable to renderer content and SHALL expose only typed, allow-listed desktop operations through an isolated preload bridge.

#### Scenario: Renderer requests a project scan

- **WHEN** the renderer invokes the documented scan operation
- **THEN** the main process validates the registered project identifier and performs filesystem access without exposing arbitrary filesystem APIs

#### Scenario: Renderer attempts an unknown IPC channel

- **WHEN** renderer code tries to invoke an operation outside the allow-listed bridge
- **THEN** no privileged operation is available

### Requirement: Safe window and navigation behavior

The application SHALL deny unexpected new windows, external navigation, and permission requests by default and SHALL open explicitly supported external destinations through the operating system.

#### Scenario: Markdown contains an external link

- **WHEN** the user activates an allowed HTTPS link from rendered Markdown
- **THEN** the application asks the operating system to open it instead of navigating the privileged application window

### Requirement: Desktop lifecycle cleanup

The application SHALL use a single application instance, restore or focus its window when launched again, and close all watchers and pending persistence work during shutdown.

#### Scenario: User launches a second instance

- **WHEN** another process starts while the application is already running
- **THEN** the existing window is restored and focused instead of creating a competing watcher process

#### Scenario: Application exits

- **WHEN** the user closes the application or Windows ends the session
- **THEN** active file watchers are closed and committed local state remains readable on the next launch

### Requirement: User-data portability boundaries

The installer and portable executable SHALL store application-owned mutable data in the resolved Electron user-data location and SHALL display that location in settings.

#### Scenario: User opens storage settings

- **WHEN** the user views local storage information
- **THEN** the application shows the exact catalog and snapshot location and provides a command to reveal it
