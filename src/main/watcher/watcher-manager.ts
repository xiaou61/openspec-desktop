import type { HistoryStore } from '../history/history-store';
import { HistoryStore as HistoryStoreImpl } from '../history/history-store';
import type { ProjectRecord, WatcherState } from '@shared/contracts';
import {
  ProjectWatcher,
  type ProjectWatcherOptions,
  type WatcherProjection,
} from './project-watcher';

export interface WatcherManagerOptions {
  userDataPath?: string;
  settleMs?: number;
  batchMs?: number;
  retryMs?: number;
  historyFactory?: (project: ProjectRecord) => HistoryStore;
  onProjection?: (event: WatcherProjection) => Promise<void> | void;
  onState?: (projectId: string, state: WatcherState, error?: string) => Promise<void> | void;
}

export class WatcherManager {
  private readonly watchers = new Map<string, ProjectWatcher>();
  private readonly history = new Map<string, HistoryStore>();
  private readonly projectContexts = new Map<string, ProjectRecord>();
  private closed = false;

  constructor(private readonly options: WatcherManagerOptions = {}) {}

  async startProject(project: ProjectRecord): Promise<void> {
    if (this.closed) return;
    await this.stopProject(project.id);
    if (this.closed) return;
    this.projectContexts.set(project.id, structuredClone(project));
    const history =
      this.options.historyFactory?.(project) ??
      (this.options.userDataPath
        ? new HistoryStoreImpl(this.options.userDataPath, project.id)
        : undefined);
    if (history) this.history.set(project.id, history);
    const watcherOptions: ProjectWatcherOptions = {
      project,
      onState: (state, error) => this.options.onState?.(project.id, state, error),
      onProjection: (event) => this.handleProjection(event, history),
    };
    if (this.options.settleMs !== undefined) watcherOptions.settleMs = this.options.settleMs;
    if (this.options.batchMs !== undefined) watcherOptions.batchMs = this.options.batchMs;
    if (this.options.retryMs !== undefined) watcherOptions.retryMs = this.options.retryMs;
    const watcher = new ProjectWatcher(watcherOptions);
    this.watchers.set(project.id, watcher);
    await watcher.start();
  }

  async stopProject(projectId: string): Promise<void> {
    const watcher = this.watchers.get(projectId);
    this.watchers.delete(projectId);
    if (watcher) await watcher.close();
    const history = this.history.get(projectId);
    if (history) await history.flush();
    this.history.delete(projectId);
    this.projectContexts.delete(projectId);
  }

  updateProjectContext(project: ProjectRecord): void {
    if (this.closed) return;
    this.projectContexts.set(project.id, structuredClone(project));
  }

  async rescanProject(projectId: string): Promise<void> {
    const watcher = this.watchers.get(projectId);
    if (!watcher) throw new Error('项目没有活动监听器');
    await watcher.rescan();
  }

  getSnapshot(projectId: string) {
    return this.watchers.get(projectId)?.getSnapshot() ?? null;
  }

  getHistory(projectId: string): HistoryStore | undefined {
    return this.history.get(projectId);
  }

  async closeAll(): Promise<void> {
    this.closed = true;
    const projectIds = [...this.watchers.keys()];
    await Promise.all(projectIds.map((projectId) => this.stopProject(projectId)));
    await Promise.all([...this.history.values()].map((history) => history.flush()));
    this.history.clear();
    this.projectContexts.clear();
  }

  async flush(): Promise<void> {
    await Promise.all([...this.history.values()].map((history) => history.flush()));
  }

  private async handleProjection(
    event: WatcherProjection,
    history: HistoryStore | undefined,
  ): Promise<void> {
    const projectVersion = this.projectContexts.get(event.projectId)?.versionLabel ?? '';
    if (history) {
      const previousFiles = new Map(
        event.previousSnapshot?.files.map((file) => [file.relativePath, file]),
      );
      for (const artifact of event.snapshot.files) {
        if (!artifact.rawContent || !artifact.contentHash || artifact.parseHealth === 'unreadable')
          continue;
        const previous = previousFiles.get(artifact.relativePath);
        const taskDelta =
          artifact.type === 'tasks' && previous
            ? {
                completed: artifact.taskTotals.completed - previous.taskTotals.completed,
                total: artifact.taskTotals.total - previous.taskTotals.total,
              }
            : undefined;
        const input = {
          relativePath: artifact.relativePath,
          artifactType: artifact.type,
          content: artifact.rawContent,
          projectVersion,
          ...(artifact.changeId ? { changeId: artifact.changeId } : {}),
          ...(taskDelta ? { taskDelta } : {}),
        };
        await history.recordRevision(input);
      }
    }
    await this.options.onProjection?.(event);
  }
}
