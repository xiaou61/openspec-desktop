import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import {
  changeWorkStateProjectSchema,
  changeWorkStateSchema,
  localIdSchema,
  type ArchiveIntegrityState,
  type ChangeWorkState,
  type ChangeWorkStateDiagnostic,
  type ChangeWorkStateProject,
} from '@shared/contracts';

export interface ChangeWorkStateStoreOptions {
  now?: () => Date;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export class ChangeWorkStateStore {
  private readonly projects = new Map<string, ChangeWorkStateProject>();
  private readonly queues = new Map<string, Promise<void>>();
  private readonly now: () => Date;

  constructor(
    private readonly userDataPath: string,
    options: ChangeWorkStateStoreOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }

  pathFor(projectId: string): string {
    localIdSchema.parse(projectId);
    return join(this.userDataPath, 'change-work-state', projectId, 'index.json');
  }

  async initProject(projectId: string): Promise<void> {
    return this.enqueue(projectId, async () => {
      if (this.projects.has(projectId)) return;
      const path = this.pathFor(projectId);
      try {
        const raw = await fs.readFile(path, 'utf8');
        const parsed = changeWorkStateProjectSchema.parse(JSON.parse(raw) as unknown);
        if (parsed.projectId !== projectId) throw new Error('work-state 项目身份不匹配');
        this.projects.set(projectId, parsed);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          const initial = this.emptyProject(projectId);
          this.projects.set(projectId, initial);
          await this.writeProject(initial);
          return;
        }
        const diagnostic = await this.recoverCorrupt(projectId, path, error);
        const initial = this.emptyProject(projectId, diagnostic);
        this.projects.set(projectId, initial);
        await this.writeProject(initial);
      }
    });
  }

  snapshot(projectId: string): ChangeWorkStateProject {
    const state = this.projects.get(projectId);
    if (!state) throw new Error(`work-state 项目尚未初始化：${projectId}`);
    return structuredClone(state);
  }

  async updateActive(projectId: string, rawState: ChangeWorkState): Promise<boolean> {
    return this.enqueue(projectId, async () => {
      const project = this.requireProject(projectId);
      const state = changeWorkStateSchema.parse(rawState);
      if (state.archivedAt) throw new Error('active work-state 不能包含 archivedAt');
      if (sameValue(project.active[state.changeId], state)) return false;
      const next = changeWorkStateProjectSchema.parse({
        ...project,
        active: { ...project.active, [state.changeId]: state },
        updatedAt: state.updatedAt,
      });
      this.projects.set(projectId, next);
      await this.writeProject(next);
      return true;
    });
  }

  async updateArchived(projectId: string, rawState: ChangeWorkState): Promise<boolean> {
    return this.enqueue(projectId, async () => {
      const project = this.requireProject(projectId);
      const state = changeWorkStateSchema.parse(rawState);
      if (!state.archivedAt) throw new Error('archived work-state 缺少 archivedAt');
      if (sameValue(project.archived[state.changeId], state)) return false;
      const next = changeWorkStateProjectSchema.parse({
        ...project,
        archived: { ...project.archived, [state.changeId]: state },
        updatedAt: state.updatedAt,
      });
      this.projects.set(projectId, next);
      await this.writeProject(next);
      return true;
    });
  }

  async freezeActive(
    projectId: string,
    activeChangeId: string,
    archivedChangeId: string,
    archivedAt: string,
    archiveIntegrity?: ArchiveIntegrityState,
  ): Promise<ChangeWorkState | undefined> {
    return this.enqueue(projectId, async () => {
      localIdSchema.parse(activeChangeId);
      localIdSchema.parse(archivedChangeId);
      const project = this.requireProject(projectId);
      const active = project.active[activeChangeId];
      if (!active) return project.archived[archivedChangeId];
      const frozen = changeWorkStateSchema.parse({
        ...active,
        changeId: archivedChangeId,
        archivedAt,
        updatedAt: archivedAt,
        ...(archiveIntegrity ? { archiveIntegrity } : {}),
      });
      const nextActive = { ...project.active };
      delete nextActive[activeChangeId];
      const next = changeWorkStateProjectSchema.parse({
        ...project,
        active: nextActive,
        archived: { ...project.archived, [archivedChangeId]: frozen },
        updatedAt: archivedAt,
      });
      this.projects.set(projectId, next);
      await this.writeProject(next);
      return structuredClone(frozen);
    });
  }

  async removeActive(projectId: string, changeId: string, updatedAt: string): Promise<boolean> {
    return this.enqueue(projectId, async () => {
      localIdSchema.parse(changeId);
      const project = this.requireProject(projectId);
      if (!project.active[changeId]) return false;
      const active = { ...project.active };
      delete active[changeId];
      const next = changeWorkStateProjectSchema.parse({
        ...project,
        active,
        updatedAt,
      });
      this.projects.set(projectId, next);
      await this.writeProject(next);
      return true;
    });
  }

  async clearProject(projectId: string): Promise<void> {
    return this.enqueue(projectId, async () => {
      const projectDirectory = dirname(this.pathFor(projectId));
      await fs.rm(projectDirectory, { recursive: true, force: true });
      const initial = this.emptyProject(projectId);
      this.projects.set(projectId, initial);
      await this.writeProject(initial);
    });
  }

  async flush(projectId?: string): Promise<void> {
    if (projectId) {
      await this.queues.get(projectId);
      return;
    }
    await Promise.all(this.queues.values());
  }

  private requireProject(projectId: string): ChangeWorkStateProject {
    const project = this.projects.get(projectId);
    if (!project) throw new Error(`work-state 项目尚未初始化：${projectId}`);
    return project;
  }

  private emptyProject(
    projectId: string,
    diagnostic?: ChangeWorkStateDiagnostic,
  ): ChangeWorkStateProject {
    return changeWorkStateProjectSchema.parse({
      schemaVersion: 1,
      projectId,
      updatedAt: this.now().toISOString(),
      active: {},
      archived: {},
      ...(diagnostic ? { diagnostic } : {}),
    });
  }

  private async recoverCorrupt(
    projectId: string,
    path: string,
    error: unknown,
  ): Promise<ChangeWorkStateDiagnostic> {
    const detectedAt = this.now().toISOString();
    const stamp = detectedAt.replace(/[:.]/g, '-');
    const backupPath = join(dirname(path), `index.corrupt-${stamp}-${randomUUID()}.json`);
    let backupFile: string | undefined;
    try {
      await fs.mkdir(dirname(path), { recursive: true });
      await fs.rename(path, backupPath);
      backupFile = basename(backupPath);
    } catch {
      // Recovery still proceeds when the corrupt file disappeared during initialization.
    }
    return {
      status: 'unavailable',
      message: `本地轮次证据损坏或不兼容，已为 ${projectId} 建立保守空基线：${
        error instanceof Error ? error.message : '无法解析 work-state'
      }`.slice(0, 1000),
      detectedAt,
      ...(backupFile ? { backupFile } : {}),
    };
  }

  private async writeProject(project: ChangeWorkStateProject): Promise<void> {
    const path = this.pathFor(project.projectId);
    await fs.mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.tmp-${randomUUID()}`;
    const handle = await fs.open(temporary, 'w');
    try {
      await handle.writeFile(`${JSON.stringify(project, null, 2)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await fs.rename(temporary, path);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST' && code !== 'EPERM') throw error;
      await fs.rm(path, { force: true });
      await fs.rename(temporary, path);
    }
  }

  private enqueue<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
    localIdSchema.parse(projectId);
    const previous = this.queues.get(projectId) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(operation);
    const settled = result.then(
      () => undefined,
      () => undefined,
    );
    this.queues.set(projectId, settled);
    void settled.finally(() => {
      if (this.queues.get(projectId) === settled) this.queues.delete(projectId);
    });
    return result;
  }
}
