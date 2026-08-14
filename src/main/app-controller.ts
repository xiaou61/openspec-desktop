import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { clipboard, dialog, shell } from 'electron';
import {
  appSnapshotSchema,
  type ActionCenterSnapshot,
  changeLifecycleAssessmentSchema,
  codexImportResultSchema,
  projectionEventSchema,
  type AppSnapshot,
  type CodexImportResult,
  type CodexDirectProject,
  type CodexOpenSpecWorkspaceMember,
  type CodexProjectList,
  type CodexWorkspaceReference,
  type ChangeLifecycleAssessment,
  type CodexHandoff,
  type ProjectionEvent,
  type ProjectionUpdateDomain,
  type ProjectRecord,
  type VersionSource,
  type WatcherState,
} from '@shared/contracts';
import type {
  ActionCenterRequest,
  BuildCodexHandoffRequest,
  ClearHistoryRequest,
  ChangeLifecycleRequest,
  CodexImportProjectsRequest,
  CompareRevisionsRequest,
  CreateGroupRequest,
  GroupMutationRequest,
  HistoryListRequest,
  HistoryRevisionListRequest,
  RefreshVersionRequest,
  RegisterProjectRequest,
  RunChangeValidationRequest,
  RelocateProjectRequest,
  SelectRelocationRequest,
  RevealArtifactRequest,
  SetRetentionRequest,
  UpdatePreferencesRequest,
  UpdateProjectRequest,
  VersionSummaryListRequest,
} from '@shared/ipc-contracts';
import {
  resolveRegisteredArtifactPath,
  isPathWithin,
  normalizeProjectRoot,
  validateOpenSpecProject,
} from './domain/paths';
import type { ProjectScanResult } from './domain/scanner';
import { assertAllowedExternalUrl } from './security/url';
import type { CatalogService } from './catalog/catalog-service';
import { selectOpenSpecProjectDirectory, type DirectoryDialog } from './catalog/directory-picker';
import { HistoryStore } from './history/history-store';
import { toProjectSnapshot } from './projection';
import type { WatcherProjection } from './watcher/project-watcher';
import type { WatcherManager } from './watcher/watcher-manager';
import {
  canonicalizeCodexProjectPath,
  codexProjectPathKey,
  discoverCodexProjects,
  type DiscoverCodexProjectsOptions,
} from './codex/codex-project-discovery';
import { LifecycleService, type LifecycleContext } from './lifecycle/lifecycle-service';
import { RestrictedOpenSpecCli } from './lifecycle/openspec-cli';
import { ActionCenterService } from './action-center/action-center-service';
import { ChangeWorkStateService } from './work-state/change-work-state-service';
import { ChangeWorkStateStore } from './work-state/change-work-state-store';

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
  clipboardWriter?: Pick<typeof clipboard, 'writeText'>;
  codexDiscovery?: (options: DiscoverCodexProjectsOptions) => Promise<CodexProjectList>;
  lifecycle?: LifecycleService;
  workStateStore?: ChangeWorkStateStore;
  actionCenter?: ActionCenterService;
  openSpecCli?: RestrictedOpenSpecCli;
  now?: () => Date;
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
  private readonly clipboardWriter: Pick<typeof clipboard, 'writeText'>;
  private readonly codexDiscovery: (
    options: DiscoverCodexProjectsOptions,
  ) => Promise<CodexProjectList>;
  private readonly lifecycle: LifecycleService;
  private readonly workStateStore: ChangeWorkStateStore;
  private readonly workStates: ChangeWorkStateService;
  private readonly actionCenter: ActionCenterService;
  private readonly now: () => Date;

  constructor(private readonly options: AppControllerOptions) {
    this.directoryDialog = options.directoryDialog ?? dialog;
    this.fileShell = options.fileShell ?? shell;
    this.clipboardWriter = options.clipboardWriter ?? clipboard;
    this.codexDiscovery = options.codexDiscovery ?? discoverCodexProjects;
    this.now = options.now ?? (() => new Date());
    const openSpecCli = options.openSpecCli ?? new RestrictedOpenSpecCli();
    this.lifecycle =
      options.lifecycle ??
      new LifecycleService({
        userDataPath: options.userDataPath,
        cli: openSpecCli,
      });
    this.workStateStore = options.workStateStore ?? new ChangeWorkStateStore(options.userDataPath);
    this.workStates = new ChangeWorkStateService({
      store: this.workStateStore,
      lifecycle: this.lifecycle,
      historyForProject: (projectId) => this.ensureHistory(projectId),
    });
    this.actionCenter =
      options.actionCenter ??
      new ActionCenterService({
        catalog: options.catalog,
        getScan: (projectId) =>
          this.scans.get(projectId) ?? options.watchers.getSnapshot?.(projectId) ?? null,
        lifecycle: this.lifecycle,
        cli: openSpecCli,
        workStateStore: this.workStateStore,
      });
  }

  async initialize(): Promise<void> {
    await this.options.catalog.init();
    const projects = this.options.catalog.snapshot().projects;
    await Promise.all(projects.map((project) => this.workStateStore.initProject(project.id)));
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
    const projects = catalog.projects.map((project) => {
      const snapshot = toProjectSnapshot(
        project,
        catalog,
        this.withWorkState(project.id, this.scans.get(project.id) ?? emptyProjectScan(project)),
      );
      try {
        const diagnostic = this.workStateStore.snapshot(project.id).diagnostic;
        return { ...snapshot, ...(diagnostic ? { workStateDiagnostic: diagnostic } : {}) };
      } catch {
        return snapshot;
      }
    });
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
    type ImportCandidate = (CodexDirectProject | CodexOpenSpecWorkspaceMember) & {
      workspace?: CodexWorkspaceReference;
    };
    const candidates = new Map<string, ImportCandidate>();
    for (const entry of discovered.entries) {
      if (entry.kind === 'direct-project') {
        candidates.set(codexProjectPathKey(entry.rootPath), entry);
        continue;
      }
      const workspace: CodexWorkspaceReference = {
        id: entry.id,
        rootPath: entry.rootPath,
        displayName: entry.displayName,
      };
      for (const member of entry.members) {
        if (member.kind !== 'openspec-project') continue;
        candidates.set(codexProjectPathKey(member.rootPath), { ...member, workspace });
      }
    }
    const items: CodexImportResult['items'] = [];

    for (const requestedProject of request.projects) {
      const requestedRootPath = await canonicalizeCodexProjectPath(requestedProject.rootPath);
      const candidate = candidates.get(codexProjectPathKey(requestedRootPath));
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
      const candidateWorkspace = candidate.workspace;
      const requestedWorkspace = requestedProject.workspace;
      const requestedWorkspaceRootPath = requestedWorkspace
        ? await canonicalizeCodexProjectPath(requestedWorkspace.rootPath)
        : undefined;
      const workspaceMatches =
        (!candidateWorkspace && !requestedWorkspace) ||
        (candidateWorkspace !== undefined &&
          requestedWorkspace !== undefined &&
          requestedWorkspaceRootPath !== undefined &&
          candidateWorkspace.id === requestedWorkspace.id &&
          codexProjectPathKey(candidateWorkspace.rootPath) ===
            codexProjectPathKey(requestedWorkspaceRootPath));
      if (!workspaceMatches) {
        items.push({
          rootPath: candidate.rootPath,
          displayName,
          status: 'failed',
          ...(candidateWorkspace ? { workspace: candidateWorkspace } : {}),
          error: '工作区来源与当前发现结果不一致',
        });
        continue;
      }
      const normalizedRootPath = normalizeProjectRoot(candidate.rootPath);
      if (
        candidateWorkspace &&
        (codexProjectPathKey(candidateWorkspace.rootPath) ===
          codexProjectPathKey(normalizedRootPath) ||
          !isPathWithin(candidateWorkspace.rootPath, normalizedRootPath))
      ) {
        items.push({
          rootPath: normalizedRootPath,
          displayName,
          status: 'failed',
          workspace: candidateWorkspace,
          error: '子项目不在声明的工作区内',
        });
        continue;
      }
      if (candidate.status === 'already-added') {
        const catalog = this.options.catalog.snapshot();
        const existing = catalog.projects.find(
          (project) =>
            codexProjectPathKey(project.rootPath) === codexProjectPathKey(candidate.rootPath),
        );
        const associatedWorkspaceGroup =
          candidateWorkspace && existing?.groupId
            ? catalog.groups.find(
                (group) =>
                  group.id === existing.groupId &&
                  group.kind === 'codex-workspace' &&
                  codexProjectPathKey(group.sourceRootPath) ===
                    codexProjectPathKey(candidateWorkspace.rootPath),
              )
            : undefined;
        items.push({
          rootPath: candidate.rootPath,
          displayName,
          status: 'already-added',
          ...(candidateWorkspace ? { workspace: candidateWorkspace } : {}),
          ...(associatedWorkspaceGroup ? { workspaceGroupId: associatedWorkspaceGroup.id } : {}),
          ...(existing ? { projectId: existing.id } : {}),
        });
        continue;
      }
      if (candidate.status !== 'available') {
        items.push({
          rootPath: candidate.rootPath,
          displayName,
          status: 'failed',
          ...(candidateWorkspace ? { workspace: candidateWorkspace } : {}),
          error: candidate.reason ?? '该项目当前不可导入',
        });
        continue;
      }
      const validation = await validateOpenSpecProject(normalizedRootPath);
      if (!validation.valid) {
        items.push({
          rootPath: normalizedRootPath,
          displayName,
          status: 'failed',
          ...(candidateWorkspace ? { workspace: candidateWorkspace } : {}),
          error: validation.reason ?? '确认导入时 OpenSpec 项目已失效',
        });
        continue;
      }
      try {
        const workspaceRegistration = candidateWorkspace
          ? await this.options.catalog.registerProjectInWorkspace(normalizedRootPath, {
              sourceRootPath: candidateWorkspace.rootPath,
              displayName: candidateWorkspace.displayName,
            })
          : null;
        const project = workspaceRegistration
          ? workspaceRegistration.project
          : await this.options.catalog.registerProject(normalizedRootPath, {
              displayName,
              versionMode: 'automatic',
            });
        items.push({
          rootPath: project.rootPath,
          displayName: project.displayName,
          status: 'imported',
          projectId: project.id,
          ...(candidateWorkspace ? { workspace: candidateWorkspace } : {}),
          ...(workspaceRegistration ? { workspaceGroupId: workspaceRegistration.group.id } : {}),
        });
      } catch (error) {
        const catalog = this.options.catalog.snapshot();
        const existing = catalog.projects.find(
          (project) =>
            codexProjectPathKey(project.rootPath) === codexProjectPathKey(candidate.rootPath),
        );
        if (existing) {
          const associatedWorkspaceGroup =
            candidateWorkspace && existing.groupId
              ? catalog.groups.find(
                  (group) =>
                    group.id === existing.groupId &&
                    group.kind === 'codex-workspace' &&
                    codexProjectPathKey(group.sourceRootPath) ===
                      codexProjectPathKey(candidateWorkspace.rootPath),
                )
              : undefined;
          items.push({
            rootPath: existing.rootPath,
            displayName: existing.displayName,
            status: 'already-added',
            projectId: existing.id,
            ...(candidateWorkspace ? { workspace: candidateWorkspace } : {}),
            ...(associatedWorkspaceGroup ? { workspaceGroupId: associatedWorkspaceGroup.id } : {}),
          });
        } else {
          items.push({
            rootPath: candidate.rootPath,
            displayName,
            status: 'failed',
            ...(candidateWorkspace ? { workspace: candidateWorkspace } : {}),
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
    this.actionCenter.invalidate(request.projectId);
    return this.getAppSnapshot();
  }

  async relocateProject(request: RelocateProjectRequest): Promise<AppSnapshot> {
    const before = structuredClone(this.options.catalog.getProject(request.projectId));
    await this.options.catalog.relocateProject(request.projectId, request.rootPath);
    this.scans.delete(request.projectId);
    this.lifecycle.invalidate(request.projectId);
    this.actionCenter.invalidate();
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
    this.lifecycle.invalidate(request.projectId);
    this.actionCenter.invalidate();
    const after = this.options.catalog.getProject(request.projectId);
    this.options.watchers.updateProjectContext(after);
    if (this.versionContextChanged(before, after)) await this.recordVersionContextActivity(after);
    return this.getAppSnapshot();
  }

  async unregisterProject(projectId: string): Promise<AppSnapshot> {
    await this.options.catalog.unregisterProject(projectId);
    this.scans.delete(projectId);
    this.lifecycle.invalidate(projectId);
    this.actionCenter.invalidate();
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
    this.lifecycle.invalidate(projectId);
    this.actionCenter.invalidate(projectId);
    await this.options.watchers.rescanProject(projectId);
    return this.getAppSnapshot();
  }

  async refreshVersion(request: RefreshVersionRequest): Promise<AppSnapshot> {
    const before = structuredClone(this.options.catalog.getProject(request.projectId));
    const after = await this.options.catalog.refreshVersion(request.projectId);
    this.options.watchers.updateProjectContext(after);
    if (this.versionContextChanged(before, after)) await this.recordVersionContextActivity(after);
    this.actionCenter.invalidate(request.projectId);
    return this.getAppSnapshot();
  }

  async getChangeLifecycle(request: ChangeLifecycleRequest): Promise<ChangeLifecycleAssessment> {
    const assessment = await this.lifecycle.getAssessment(
      this.resolveLifecycleContext(request.projectId, request.changeId, request.archived),
    );
    return this.withLifecycleWorkState(
      request.projectId,
      request.changeId,
      request.archived,
      assessment,
    );
  }

  async runChangeValidation(
    request: RunChangeValidationRequest,
  ): Promise<ChangeLifecycleAssessment> {
    const context = this.resolveLifecycleContext(request.projectId, request.changeId, false);
    const assessment = await this.lifecycle.runValidation({
      ...context,
      getCurrent: () => {
        try {
          return this.resolveLifecycleContext(request.projectId, request.changeId, false);
        } catch {
          return this.resolveLifecycleContext(request.projectId, request.changeId, true);
        }
      },
    });
    const result = this.withLifecycleWorkState(
      request.projectId,
      request.changeId,
      false,
      assessment,
    );
    this.actionCenter.invalidate(request.projectId);
    this.publish(
      this.makeProjectionEvent(
        'project-updated',
        request.projectId,
        [request.changeId],
        ['lifecycle', 'action-center'],
      ),
    );
    return result;
  }

  async getActionCenter(request: ActionCenterRequest): Promise<ActionCenterSnapshot> {
    return this.actionCenter.getActionCenter({
      ...(request.projectId ? { projectId: request.projectId } : {}),
    });
  }

  async refreshActionCenter(request: ActionCenterRequest): Promise<ActionCenterSnapshot> {
    return this.actionCenter.getActionCenter({
      ...(request.projectId ? { projectId: request.projectId } : {}),
      refresh: true,
    });
  }

  async buildCodexHandoff(request: BuildCodexHandoffRequest): Promise<CodexHandoff> {
    return this.actionCenter.buildCodexHandoff(request);
  }

  async copyCodexHandoff(request: BuildCodexHandoffRequest): Promise<CodexHandoff> {
    const handoff = await this.actionCenter.buildCodexHandoff(request);
    if (!handoff.stale) this.clipboardWriter.writeText(handoff.markdown);
    return handoff;
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
    await this.workStateStore.initProject(request.projectId);
    await this.workStateStore.clearProject(request.projectId);
    this.actionCenter.invalidate(request.projectId);
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
    this.lifecycle.invalidate(
      event.projectId,
      event.affectedChangeIds.length > 0 ? event.affectedChangeIds : undefined,
    );
    const project = this.options.catalog.getProject(event.projectId);
    const workState = await this.workStates.reconcile({ project, scan: event.snapshot });
    this.actionCenter.invalidate(event.projectId);
    const eventPayload = this.makeProjectionEvent(
      'project-updated',
      event.projectId,
      [...new Set([...event.affectedChangeIds, ...workState.changedChangeIds])],
      ['snapshot', 'history', 'lifecycle', 'action-center'],
    );
    this.publish(eventPayload);
  }

  async handleWatcherState(projectId: string, state: WatcherState, error?: string): Promise<void> {
    const project = await this.options.catalog.setWatcherState(projectId, state, error);
    if (state === 'unavailable') {
      this.scans.delete(projectId);
      this.lifecycle.invalidate(projectId);
      this.actionCenter.invalidate(projectId);
    }
    if (state !== 'unavailable') this.actionCenter.invalidate(projectId);
    const eventPayload = this.makeProjectionEvent(
      'watcher-state',
      project.id,
      [],
      ['snapshot', 'lifecycle', 'action-center'],
    );
    this.publish(eventPayload);
  }

  private makeProjectionEvent(
    type: ProjectionEvent['type'],
    projectId: string,
    changeIds: string[],
    domains?: ProjectionUpdateDomain[],
  ): ProjectionEvent {
    const snapshot = this.getAppSnapshot().projects.find(
      (project) => project.project.id === projectId,
    );
    const payload: ProjectionEvent = {
      type,
      projectId,
      changeIds: [...new Set(changeIds)],
      ...(domains ? { domains: [...new Set(domains)] } : {}),
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

  private withWorkState(projectId: string, scan: ProjectScanResult): ProjectScanResult {
    let state;
    try {
      state = this.workStateStore.snapshot(projectId);
    } catch {
      return scan;
    }
    return {
      ...scan,
      changes: scan.changes.map((change) => {
        const workState = change.archived ? state.archived[change.id] : state.active[change.id];
        return {
          ...change,
          ...(workState ? { workState } : {}),
          ...(workState?.evolution ? { evolution: workState.evolution } : {}),
        };
      }),
    };
  }

  private withLifecycleWorkState(
    projectId: string,
    changeId: string,
    archived: boolean,
    assessment: ChangeLifecycleAssessment,
  ): ChangeLifecycleAssessment {
    let project;
    try {
      project = this.workStateStore.snapshot(projectId);
    } catch {
      return assessment;
    }
    const workState = archived ? project.archived[changeId] : project.active[changeId];
    return changeLifecycleAssessmentSchema.parse({
      ...assessment,
      ...(workState ? { workState } : {}),
      ...(workState?.evolution ? { evolution: workState.evolution } : {}),
    });
  }

  private resolveLifecycleContext(
    projectId: string,
    changeId: string,
    archived: boolean,
  ): LifecycleContext {
    const project = this.options.catalog.getProject(projectId);
    const watcherSnapshot = this.options.watchers.getSnapshot?.(projectId) ?? null;
    const scan = this.scans.get(projectId) ?? watcherSnapshot ?? emptyProjectScan(project);
    const change = scan.changes.find(
      (entry) => entry.id === changeId && entry.archived === archived,
    );
    if (!change) throw new Error(archived ? '已归档 Change 不存在' : '当前 Change 不存在');
    return {
      projectId,
      projectRoot: project.rootPath,
      projectAvailable: project.available,
      scan,
      change,
    };
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
