import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { dialog, shell } from 'electron';
import {
  appSnapshotSchema,
  codexImportResultSchema,
  projectionEventSchema,
  type AppSnapshot,
  type CodexImportResult,
  type CodexProjectList,
  type ProjectionEvent,
  type ProjectRecord,
  type VersionSource,
  type WatcherState,
} from '@shared/contracts';
import type {
  ClearHistoryRequest,
  CodexImportProjectsRequest,
  CompareRevisionsRequest,
  CreateGroupRequest,
  GroupMutationRequest,
  HistoryListRequest,
  HistoryRevisionListRequest,
  RefreshVersionRequest,
  RegisterProjectRequest,
  RelocateProjectRequest,
  SelectRelocationRequest,
  RevealArtifactRequest,
  SetRetentionRequest,
  UpdatePreferencesRequest,
  UpdateProjectRequest,
  VersionSummaryListRequest,
} from '@shared/ipc-contracts';
import { resolveRegisteredArtifactPath, isPathWithin } from './domain/paths';
import type { ProjectScanResult } from './domain/scanner';
import { assertAllowedExternalUrl } from './security/url';
import type { CatalogService } from './catalog/catalog-service';
import { selectOpenSpecProjectDirectory, type DirectoryDialog } from './catalog/directory-picker';
import { HistoryStore } from './history/history-store';
import { toProjectSnapshot } from './projection';
import type { WatcherProjection } from './watcher/project-watcher';
import type { WatcherManager } from './watcher/watcher-manager';
import {
  codexProjectPathKey,
  discoverCodexProjects,
  type DiscoverCodexProjectsOptions,
} from './codex/codex-project-discovery';

export const PROJECTION_EVENT_CHANNEL = 'projection:updated';

export interface WindowSubscriber {
  webContents: {
    send(channel: string, payload: unknown): void;
    isDestroyed(): boolean;
  };
}

export interface AppControllerOptions {
  userDataPath: string;
  userHome?: string;
  codexHome?: string;
  catalog: CatalogService;
  watchers: WatcherManager;
  directoryDialog?: DirectoryDialog;
  fileShell?: Pick<typeof shell, 'showItemInFolder' | 'openPath' | 'openExternal'>;
  codexDiscovery?: (options: DiscoverCodexProjectsOptions) => Promise<CodexProjectList>;
}

function emptyProjectScan(project: ProjectRecord): ProjectScanResult {
  return {
    rootPath: project.rootPath,
    openspecPath: `${project.rootPath}/openspec`,
    available: project.available,
    scannedAt: project.lastScannedAt ?? new Date().toISOString(),
    specs: [],
    changes: [],
    files: [],
    issues: project.error ? [{ message: project.error, kind: 'unavailable' }] : [],
  };
}

export class AppController {
  private readonly subscribers = new Set<WindowSubscriber>();
  private readonly scans = new Map<string, ProjectScanResult>();
  private readonly directoryDialog: DirectoryDialog;
  private readonly fileShell: Pick<typeof shell, 'showItemInFolder' | 'openPath' | 'openExternal'>;
  private readonly codexDiscovery: (
    options: DiscoverCodexProjectsOptions,
  ) => Promise<CodexProjectList>;

  constructor(private readonly options: AppControllerOptions) {
    this.directoryDialog = options.directoryDialog ?? dialog;
    this.fileShell = options.fileShell ?? shell;
    this.codexDiscovery = options.codexDiscovery ?? discoverCodexProjects;
  }

  async initialize(): Promise<void> {
    await this.options.catalog.init();
    const projects = this.options.catalog.snapshot().projects;
    await Promise.all(
      projects
        .filter((project) => project.watcherEnabled)
        .map((project) => this.options.watchers.startProject(project)),
    );
  }

  subscribe(window: WindowSubscriber): () => void {
    this.subscribers.add(window);
    return () => this.subscribers.delete(window);
  }

  disposeSubscribers(): void {
    this.subscribers.clear();
  }

  getAppSnapshot(): AppSnapshot {
    const catalog = this.options.catalog.snapshot();
    const projects = catalog.projects.map((project) =>
      toProjectSnapshot(project, catalog, this.scans.get(project.id) ?? emptyProjectScan(project)),
    );
    return appSnapshotSchema.parse({ catalog, projects });
  }

  async selectProject(): Promise<AppSnapshot | null> {
    const rootPath = await selectOpenSpecProjectDirectory(this.directoryDialog);
    if (!rootPath) return null;
    await this.options.catalog.registerProject(rootPath);
    return this.getAppSnapshot();
  }

  async registerProject(request: RegisterProjectRequest): Promise<AppSnapshot> {
    await this.options.catalog.registerProject(request.rootPath, {
      ...(request.displayName !== undefined ? { displayName: request.displayName } : {}),
      ...(request.versionLabel !== undefined ? { versionLabel: request.versionLabel } : {}),
      ...(request.versionMode !== undefined ? { versionMode: request.versionMode } : {}),
      ...(request.groupId !== undefined ? { groupId: request.groupId } : {}),
    });
    return this.getAppSnapshot();
  }

  async listCodexProjects(): Promise<CodexProjectList> {
    const codexHome = this.options.codexHome ?? process.env['CODEX_HOME'];
    return this.codexDiscovery({
      userHome: this.options.userHome ?? homedir(),
      registeredRoots: this.options.catalog.snapshot().projects.map((project) => project.rootPath),
      ...(codexHome ? { codexHome } : {}),
    });
  }

  async importCodexProjects(request: CodexImportProjectsRequest): Promise<CodexImportResult> {
    const discovered = await this.listCodexProjects();
    const candidates = new Map(
      discovered.candidates.map((candidate) => [
        codexProjectPathKey(candidate.rootPath),
        candidate,
      ]),
    );
    const items: CodexImportResult['items'] = [];

    for (const requestedProject of request.projects) {
      const candidate = candidates.get(codexProjectPathKey(requestedProject.rootPath));
      const displayName = candidate?.displayName ?? requestedProject.displayName;
      if (!candidate) {
        items.push({
          rootPath: requestedProject.rootPath,
          displayName,
          status: 'failed',
          error: '该目录不在当前 Codex 项目索引中',
        });
        continue;
      }
      if (candidate.status === 'already-added') {
        const existing = this.options.catalog
          .snapshot()
          .projects.find(
            (project) =>
              codexProjectPathKey(project.rootPath) === codexProjectPathKey(candidate.rootPath),
          );
        items.push({
          rootPath: candidate.rootPath,
          displayName,
          status: 'already-added',
          ...(existing ? { projectId: existing.id } : {}),
        });
        continue;
      }
      if (candidate.status !== 'available') {
        items.push({
          rootPath: candidate.rootPath,
          displayName,
          status: 'failed',
          error: candidate.reason ?? '该项目当前不可导入',
        });
        continue;
      }
      try {
        const project = await this.options.catalog.registerProject(candidate.rootPath, {
          displayName,
          versionMode: 'automatic',
        });
        items.push({
          rootPath: project.rootPath,
          displayName: project.displayName,
          status: 'imported',
          projectId: project.id,
        });
      } catch (error) {
        const existing = this.options.catalog
          .snapshot()
          .projects.find(
            (project) =>
              codexProjectPathKey(project.rootPath) === codexProjectPathKey(candidate.rootPath),
          );
        if (existing) {
          items.push({
            rootPath: existing.rootPath,
            displayName: existing.displayName,
            status: 'already-added',
            projectId: existing.id,
          });
        } else {
          items.push({
            rootPath: candidate.rootPath,
            displayName,
            status: 'failed',
            error: error instanceof Error ? error.message.slice(0, 500) : '项目导入失败',
          });
        }
      }
    }

    return codexImportResultSchema.parse({ snapshot: this.getAppSnapshot(), items });
  }

  async updatePreferences(request: UpdatePreferencesRequest): Promise<AppSnapshot> {
    if (request.selectedProjectId !== undefined && request.selectedProjectId !== null) {
      this.options.catalog.getProject(request.selectedProjectId);
    }
    await this.options.catalog.setPreferences({
      ...(request.selectedProjectId !== undefined
        ? { selectedProjectId: request.selectedProjectId }
        : {}),
      ...(request.selectedChangeId !== undefined
        ? { selectedChangeId: request.selectedChangeId }
        : {}),
      ...(request.showArchived !== undefined ? { showArchived: request.showArchived } : {}),
    });
    return this.getAppSnapshot();
  }

  async updateProject(request: UpdateProjectRequest): Promise<AppSnapshot> {
    const before = structuredClone(this.options.catalog.getProject(request.projectId));
    await this.options.catalog.updateProject(request.projectId, {
      ...(request.displayName !== undefined ? { displayName: request.displayName } : {}),
      ...(request.versionLabel !== undefined ? { versionLabel: request.versionLabel } : {}),
      ...(request.versionMode !== undefined ? { versionMode: request.versionMode } : {}),
      ...(request.groupId !== undefined ? { groupId: request.groupId } : {}),
      ...(request.order !== undefined ? { order: request.order } : {}),
      ...(request.watcherEnabled !== undefined ? { watcherEnabled: request.watcherEnabled } : {}),
    });
    const after = this.options.catalog.getProject(request.projectId);
    if (before.watcherEnabled && !after.watcherEnabled)
      await this.options.watchers.stopProject(after.id);
    if (!before.watcherEnabled && after.watcherEnabled)
      await this.options.watchers.startProject(after);
    this.options.watchers.updateProjectContext(after);
    if (this.versionContextChanged(before, after)) await this.recordVersionContextActivity(after);
    return this.getAppSnapshot();
  }

  async relocateProject(request: RelocateProjectRequest): Promise<AppSnapshot> {
    const before = structuredClone(this.options.catalog.getProject(request.projectId));
    await this.options.catalog.relocateProject(request.projectId, request.rootPath);
    this.scans.delete(request.projectId);
    const after = this.options.catalog.getProject(request.projectId);
    this.options.watchers.updateProjectContext(after);
    if (this.versionContextChanged(before, after)) await this.recordVersionContextActivity(after);
    return this.getAppSnapshot();
  }

  async selectRelocation(request: SelectRelocationRequest): Promise<AppSnapshot | null> {
    const rootPath = await selectOpenSpecProjectDirectory(this.directoryDialog);
    if (!rootPath) return null;
    const before = structuredClone(this.options.catalog.getProject(request.projectId));
    await this.options.catalog.relocateProject(request.projectId, rootPath);
    this.scans.delete(request.projectId);
    const after = this.options.catalog.getProject(request.projectId);
    this.options.watchers.updateProjectContext(after);
    if (this.versionContextChanged(before, after)) await this.recordVersionContextActivity(after);
    return this.getAppSnapshot();
  }

  async unregisterProject(projectId: string): Promise<AppSnapshot> {
    await this.options.catalog.unregisterProject(projectId);
    this.scans.delete(projectId);
    return this.getAppSnapshot();
  }

  async createGroup(request: CreateGroupRequest): Promise<AppSnapshot> {
    await this.options.catalog.createGroup(request.name, request.order);
    return this.getAppSnapshot();
  }

  async updateGroup(request: GroupMutationRequest): Promise<AppSnapshot> {
    await this.options.catalog.updateGroup(request.groupId, {
      ...(request.name !== undefined ? { name: request.name } : {}),
      ...(request.order !== undefined ? { order: request.order } : {}),
    });
    return this.getAppSnapshot();
  }

  async removeGroup(groupId: string): Promise<AppSnapshot> {
    await this.options.catalog.removeGroup(groupId);
    return this.getAppSnapshot();
  }

  async rescanProject(projectId: string): Promise<AppSnapshot> {
    const before = structuredClone(this.options.catalog.getProject(projectId));
    const after = await this.options.catalog.refreshVersion(projectId);
    this.options.watchers.updateProjectContext(after);
    if (this.versionContextChanged(before, after)) await this.recordVersionContextActivity(after);
    await this.options.watchers.rescanProject(projectId);
    return this.getAppSnapshot();
  }

  async refreshVersion(request: RefreshVersionRequest): Promise<AppSnapshot> {
    const before = structuredClone(this.options.catalog.getProject(request.projectId));
    const after = await this.options.catalog.refreshVersion(request.projectId);
    this.options.watchers.updateProjectContext(after);
    if (this.versionContextChanged(before, after)) await this.recordVersionContextActivity(after);
    return this.getAppSnapshot();
  }

  async listRevisions(request: HistoryRevisionListRequest) {
    this.options.catalog.getProject(request.projectId);
    const history = await this.ensureHistory(request.projectId);
    const options = {
      limit: request.limit,
      ...(request.cursor !== undefined ? { cursor: request.cursor } : {}),
      ...(request.versionKey !== undefined ? { versionKey: request.versionKey } : {}),
    };
    return history.listRevisions(request.relativePath ?? '', options);
  }

  async listActivity(request: HistoryListRequest) {
    this.options.catalog.getProject(request.projectId);
    const history = await this.ensureHistory(request.projectId);
    const options = {
      limit: request.limit,
      ...(request.cursor !== undefined ? { cursor: request.cursor } : {}),
      ...(request.changeId !== undefined ? { changeId: request.changeId } : {}),
      ...(request.versionKey !== undefined ? { versionKey: request.versionKey } : {}),
    };
    return history.listActivity(options);
  }

  async listVersionSummaries(request: VersionSummaryListRequest) {
    const project = this.options.catalog.getProject(request.projectId);
    const history = await this.ensureHistory(request.projectId);
    return history.listVersionSummaries(project.versionLabel, project.versionSource);
  }

  async compareRevisions(request: CompareRevisionsRequest) {
    this.options.catalog.getProject(request.projectId);
    const history = await this.ensureHistory(request.projectId);
    return history.compareRevisions(
      request.leftRevisionId,
      request.rightRevisionId,
      request.maxLines,
    );
  }

  async clearHistory(request: ClearHistoryRequest): Promise<AppSnapshot> {
    this.options.catalog.getProject(request.projectId);
    const history = await this.ensureHistory(request.projectId);
    if (request.retention) await history.setRetention(request.retention);
    await history.clearHistory();
    return this.getAppSnapshot();
  }

  async getRetention(projectId: string) {
    this.options.catalog.getProject(projectId);
    const history = await this.ensureHistory(projectId);
    return history.getRetention();
  }

  async setRetention(request: SetRetentionRequest) {
    this.options.catalog.getProject(request.projectId);
    const history = await this.ensureHistory(request.projectId);
    await history.setRetention(request.retention);
    return history.getRetention();
  }

  getUserDataPath(): string {
    return this.options.userDataPath;
  }

  async flush(): Promise<void> {
    await this.options.watchers.flush();
    await this.options.catalog.flush();
  }

  async revealArtifact(request: RevealArtifactRequest): Promise<void> {
    const project = this.options.catalog.getProject(request.projectId);
    const artifactPath = resolveRegisteredArtifactPath(project.rootPath, request.sourcePath);
    const openspecRoot = resolveRegisteredArtifactPath(
      project.rootPath,
      'openspec/config.yaml',
    ).replace(/[\\/][^\\/]+$/, '');
    const [realRoot, realArtifact] = await Promise.all([
      fs.realpath(openspecRoot),
      fs.realpath(artifactPath),
    ]);
    if (!isPathWithin(realRoot, realArtifact))
      throw new Error('文件不在注册项目的 OpenSpec 根目录内');
    this.fileShell.showItemInFolder(realArtifact);
  }

  async revealUserData(): Promise<void> {
    const result = await this.fileShell.openPath(this.options.userDataPath);
    if (result) throw new Error(result);
  }

  async openExternal(url: string): Promise<void> {
    await this.fileShell.openExternal(assertAllowedExternalUrl(url));
  }

  async handleProjection(event: WatcherProjection): Promise<void> {
    this.scans.set(event.projectId, event.snapshot);
    const eventPayload = this.makeProjectionEvent(
      'project-updated',
      event.projectId,
      event.affectedChangeIds,
    );
    this.publish(eventPayload);
  }

  async handleWatcherState(projectId: string, state: WatcherState, error?: string): Promise<void> {
    const project = await this.options.catalog.setWatcherState(projectId, state, error);
    if (state === 'unavailable') this.scans.delete(projectId);
    const eventPayload = this.makeProjectionEvent('watcher-state', project.id, []);
    this.publish(eventPayload);
  }

  private makeProjectionEvent(
    type: ProjectionEvent['type'],
    projectId: string,
    changeIds: string[],
  ): ProjectionEvent {
    const snapshot = this.getAppSnapshot().projects.find(
      (project) => project.project.id === projectId,
    );
    const payload: ProjectionEvent = {
      type,
      projectId,
      changeIds: [...new Set(changeIds)],
      emittedAt: new Date().toISOString(),
      ...(snapshot ? { snapshot } : {}),
    };
    return projectionEventSchema.parse(payload);
  }

  private publish(event: ProjectionEvent): void {
    for (const subscriber of this.subscribers) {
      if (subscriber.webContents.isDestroyed()) {
        this.subscribers.delete(subscriber);
        continue;
      }
      try {
        subscriber.webContents.send(PROJECTION_EVENT_CHANNEL, event);
      } catch {
        this.subscribers.delete(subscriber);
      }
    }
  }

  private async ensureHistory(projectId: string): Promise<HistoryStore> {
    const existing = this.options.watchers.getHistory(projectId);
    if (existing) return existing;
    const history = new HistoryStore(this.options.userDataPath, projectId);
    await history.init();
    return history;
  }

  private versionContextChanged(before: ProjectRecord, after: ProjectRecord): boolean {
    return (
      before.versionLabel !== after.versionLabel ||
      before.versionMode !== after.versionMode ||
      before.versionSource !== after.versionSource
    );
  }

  private async recordVersionContextActivity(project: ProjectRecord): Promise<void> {
    const history = await this.ensureHistory(project.id);
    const sourceLabels: Record<VersionSource, string> = {
      'git-tag': 'Git 标签',
      'package-json': 'package.json',
      manual: '手动设置',
      workspace: '当前工作区',
    };
    const label = project.versionLabel || '当前工作区';
    await history.recordActivity({
      kind: 'project-settings',
      createdAt: new Date().toISOString(),
      projectVersion: project.versionLabel,
      summary: `版本上下文已更新为 ${label}（来源：${sourceLabels[project.versionSource]}）`,
    });
  }
}
