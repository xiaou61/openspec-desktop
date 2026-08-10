import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import type {
  CatalogState,
  ProjectGroup,
  ProjectRecord,
  VersionMode,
  VersionSource,
} from '@shared/contracts';
import { normalizeProjectRoot, validateOpenSpecProject } from '../domain/paths';
import { createDefaultCatalogState } from './catalog-store';
import type { CatalogStore } from './catalog-store';

export class CatalogValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CatalogValidationError';
  }
}

export interface CatalogServiceOptions {
  stopMonitoring?: (projectId: string) => Promise<void> | void;
  startMonitoring?: (project: ProjectRecord) => Promise<void> | void;
  resolveVersion?: (project: ProjectRecord) => Promise<{
    versionLabel: string;
    versionMode: Extract<VersionMode, 'automatic'>;
    versionSource: VersionSource;
    versionResolvedAt: string;
  }>;
}

export interface RegisterProjectOptions {
  displayName?: string;
  versionLabel?: string;
  versionMode?: VersionMode;
  versionSource?: VersionSource;
  versionResolvedAt?: string;
  groupId?: string | null;
}

export class CatalogService {
  private state: CatalogState = createDefaultCatalogState();
  private initialized = false;
  private operation: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly store: CatalogStore,
    private readonly options: CatalogServiceOptions = {},
  ) {}

  async init(): Promise<{
    state: CatalogState;
    recoveredFromCorruption: boolean;
    recoveryMessage?: string;
  }> {
    const result = await this.store.load();
    this.state = result.state;
    this.initialized = true;
    let changed = false;
    for (const project of this.state.projects) {
      if (project.versionMode === 'automatic' && this.options.resolveVersion) {
        const beforeContext = this.versionContext(project);
        const beforeResolvedAt = project.versionResolvedAt;
        await this.prepareAutomaticVersion(project);
        if (
          !this.sameVersionContext(beforeContext, this.versionContext(project)) ||
          beforeResolvedAt !== project.versionResolvedAt
        )
          changed = true;
      }
      const validation = await validateOpenSpecProject(project.rootPath);
      const available = validation.valid;
      const nextState = available
        ? project.watcherEnabled
          ? 'scanning'
          : 'paused'
        : 'unavailable';
      const error = available ? undefined : (validation.reason ?? '项目不可用');
      if (
        project.available !== available ||
        project.watcherState !== nextState ||
        project.error !== error
      ) {
        project.available = available;
        project.watcherState = nextState;
        if (error) project.error = error;
        else delete project.error;
        changed = true;
      }
    }
    if (changed) await this.store.save(this.state);
    return result;
  }

  private async ready(): Promise<void> {
    if (!this.initialized) await this.init();
  }

  private enqueue<T>(operation: () => Promise<T> | T): Promise<T> {
    const next = this.operation.then(async () => {
      await this.ready();
      return operation();
    });
    this.operation = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  snapshot(): CatalogState {
    return structuredClone(this.state);
  }

  async flush(): Promise<void> {
    await this.operation;
  }

  getProject(projectId: string): ProjectRecord {
    const project = this.state.projects.find((entry) => entry.id === projectId);
    if (!project) throw new CatalogValidationError('项目不存在');
    return project;
  }

  getGroup(groupId: string): ProjectGroup {
    const group = this.state.groups.find((entry) => entry.id === groupId);
    if (!group) throw new CatalogValidationError('分组不存在');
    return group;
  }

  async registerProject(
    rootPathInput: string,
    options: RegisterProjectOptions = {},
  ): Promise<ProjectRecord> {
    return this.enqueue(async () => {
      const rootPath = normalizeProjectRoot(rootPathInput);
      const validation = await validateOpenSpecProject(rootPath);
      if (!validation.valid)
        throw new CatalogValidationError(validation.reason ?? '不是有效的 OpenSpec 项目');
      if (
        this.state.projects.some(
          (project) => project.rootPath.toLowerCase() === rootPath.toLowerCase(),
        )
      ) {
        throw new CatalogValidationError('该项目已经注册');
      }
      if (options.groupId !== undefined && options.groupId !== null) this.getGroup(options.groupId);
      const now = new Date().toISOString();
      const versionLabel = options.versionLabel?.trim() ?? '';
      const versionMode = options.versionMode ?? (versionLabel ? 'manual' : 'automatic');
      if (versionMode === 'manual' && !versionLabel)
        throw new CatalogValidationError('手动版本标签不能为空');
      let project: ProjectRecord = {
        id: randomUUID(),
        rootPath,
        displayName: options.displayName?.trim() || basename(rootPath),
        versionLabel,
        versionMode,
        versionSource: versionMode === 'manual' ? 'manual' : (options.versionSource ?? 'workspace'),
        groupId: options.groupId ?? null,
        order: this.state.projects.length,
        watcherEnabled: true,
        watcherState: 'scanning',
        available: true,
        registeredAt: now,
      };
      if (options.versionResolvedAt !== undefined)
        project.versionResolvedAt = options.versionResolvedAt;
      if (versionMode === 'automatic') project = await this.prepareAutomaticVersion(project);
      this.state.projects.push(project);
      await this.store.save(this.state);
      const result = structuredClone(project);
      void Promise.resolve(this.options.startMonitoring?.(result)).catch(() => undefined);
      return result;
    });
  }

  async updateProject(
    projectId: string,
    patch: RegisterProjectOptions & { order?: number; watcherEnabled?: boolean },
  ): Promise<ProjectRecord> {
    return this.enqueue(async () => {
      let project = this.getProject(projectId);
      if (patch.groupId !== undefined && patch.groupId !== null) this.getGroup(patch.groupId);
      if (patch.displayName !== undefined) {
        const displayName = patch.displayName.trim();
        if (!displayName) throw new CatalogValidationError('项目名称不能为空');
        project.displayName = displayName;
      }
      const versionRequested =
        patch.versionLabel !== undefined ||
        patch.versionMode !== undefined ||
        patch.versionSource !== undefined ||
        patch.versionResolvedAt !== undefined;
      if (patch.versionLabel !== undefined) project.versionLabel = patch.versionLabel.trim();
      if (patch.versionLabel !== undefined && patch.versionMode === undefined)
        project.versionMode = 'manual';
      if (patch.versionMode !== undefined) project.versionMode = patch.versionMode;
      if (patch.versionSource !== undefined) project.versionSource = patch.versionSource;
      if (patch.versionResolvedAt !== undefined)
        project.versionResolvedAt = patch.versionResolvedAt;
      if (project.versionMode === 'manual') {
        if (!project.versionLabel) throw new CatalogValidationError('手动版本标签不能为空');
        project.versionSource = 'manual';
      } else if (versionRequested) {
        project = await this.prepareAutomaticVersion(project);
      }
      if (patch.groupId !== undefined) project.groupId = patch.groupId;
      if (patch.order !== undefined) project.order = patch.order;
      if (patch.watcherEnabled !== undefined) {
        project.watcherEnabled = patch.watcherEnabled;
        project.watcherState = patch.watcherEnabled
          ? project.available
            ? 'scanning'
            : 'unavailable'
          : 'paused';
      }
      await this.store.save(this.state);
      return structuredClone(project);
    });
  }

  async relocateProject(projectId: string, rootPathInput: string): Promise<ProjectRecord> {
    return this.enqueue(async () => {
      let project = this.getProject(projectId);
      const rootPath = normalizeProjectRoot(rootPathInput);
      if (
        this.state.projects.some(
          (entry) =>
            entry.id !== projectId && entry.rootPath.toLowerCase() === rootPath.toLowerCase(),
        )
      ) {
        throw new CatalogValidationError('该项目已经注册');
      }
      const validation = await validateOpenSpecProject(rootPath);
      if (!validation.valid)
        throw new CatalogValidationError(validation.reason ?? '不是有效的 OpenSpec 项目');
      await this.options.stopMonitoring?.(projectId);
      project.rootPath = rootPath;
      project.available = true;
      project.watcherState = project.watcherEnabled ? 'scanning' : 'paused';
      delete project.error;
      if (project.versionMode === 'automatic')
        project = await this.prepareAutomaticVersion(project);
      await this.store.save(this.state);
      const result = structuredClone(project);
      void Promise.resolve(this.options.startMonitoring?.(result)).catch(() => undefined);
      return result;
    });
  }

  async unregisterProject(projectId: string): Promise<void> {
    return this.enqueue(async () => {
      this.getProject(projectId);
      await this.options.stopMonitoring?.(projectId);
      this.state.projects = this.state.projects.filter((project) => project.id !== projectId);
      if (this.state.preferences.selectedProjectId === projectId)
        this.state.preferences.selectedProjectId = null;
      await this.store.save(this.state);
    });
  }

  async createGroup(nameInput: string, order?: number): Promise<ProjectGroup> {
    return this.enqueue(async () => {
      const name = nameInput.trim();
      if (!name) throw new CatalogValidationError('分组名称不能为空');
      const group: ProjectGroup = {
        id: randomUUID(),
        name,
        order: order ?? this.state.groups.length,
      };
      this.state.groups.push(group);
      await this.store.save(this.state);
      return structuredClone(group);
    });
  }

  async updateGroup(
    groupId: string,
    patch: { name?: string; order?: number },
  ): Promise<ProjectGroup> {
    return this.enqueue(async () => {
      const group = this.getGroup(groupId);
      if (patch.name !== undefined) {
        const name = patch.name.trim();
        if (!name) throw new CatalogValidationError('分组名称不能为空');
        group.name = name;
      }
      if (patch.order !== undefined) group.order = patch.order;
      await this.store.save(this.state);
      return structuredClone(group);
    });
  }

  async removeGroup(groupId: string): Promise<void> {
    return this.enqueue(async () => {
      this.getGroup(groupId);
      this.state.groups = this.state.groups.filter((group) => group.id !== groupId);
      for (const project of this.state.projects) {
        if (project.groupId === groupId) project.groupId = null;
      }
      await this.store.save(this.state);
    });
  }

  async setPreferences(
    patch: Partial<CatalogState['preferences']>,
  ): Promise<CatalogState['preferences']> {
    return this.enqueue(async () => {
      this.state.preferences = { ...this.state.preferences, ...patch };
      await this.store.save(this.state);
      return structuredClone(this.state.preferences);
    });
  }

  async setWatcherState(
    projectId: string,
    watcherState: ProjectRecord['watcherState'],
    error?: string,
  ): Promise<ProjectRecord> {
    return this.enqueue(async () => {
      const project = this.getProject(projectId);
      project.watcherState = watcherState;
      project.available = watcherState !== 'unavailable';
      if (watcherState === 'watching' || watcherState === 'scanning' || watcherState === 'paused') {
        project.lastScannedAt = new Date().toISOString();
      }
      if (error) project.error = error;
      else delete project.error;
      await this.store.save(this.state);
      return structuredClone(project);
    });
  }

  async refreshVersion(projectId: string): Promise<ProjectRecord> {
    return this.enqueue(async () => {
      let project = this.getProject(projectId);
      if (project.versionMode === 'automatic') {
        project = await this.prepareAutomaticVersion(project);
        await this.store.save(this.state);
      }
      return structuredClone(project);
    });
  }

  private versionContext(project: ProjectRecord): {
    versionLabel: string;
    versionMode: VersionMode;
    versionSource: VersionSource;
  } {
    return {
      versionLabel: project.versionLabel,
      versionMode: project.versionMode,
      versionSource: project.versionSource,
    };
  }

  private sameVersionContext(
    left: ReturnType<CatalogService['versionContext']>,
    right: ReturnType<CatalogService['versionContext']>,
  ): boolean {
    return (
      left.versionLabel === right.versionLabel &&
      left.versionMode === right.versionMode &&
      left.versionSource === right.versionSource
    );
  }

  private async prepareAutomaticVersion(project: ProjectRecord): Promise<ProjectRecord> {
    if (!this.options.resolveVersion) return project;
    try {
      const resolved = await this.options.resolveVersion(structuredClone(project));
      project.versionLabel = resolved.versionLabel.trim();
      project.versionMode = 'automatic';
      project.versionSource = resolved.versionSource;
      project.versionResolvedAt = resolved.versionResolvedAt;
    } catch {
      project.versionLabel = '';
      project.versionMode = 'automatic';
      project.versionSource = 'workspace';
      project.versionResolvedAt = new Date().toISOString();
    }
    return project;
  }
}
