import { realpath } from 'node:fs/promises';
import { relative, join } from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import type { ProjectRecord, WatcherState } from '@shared/contracts';
import { classifyOpenSpecPath, isTemporaryOpenSpecPath, normalizeSlash } from '../domain/paths';
import { scanOpenSpecProject, type ProjectScanResult } from '../domain/scanner';

export type WatcherProjectionReason = 'initial' | 'events' | 'manual-rescan' | 'recovery';

export interface WatcherProjection {
  projectId: string;
  snapshot: ProjectScanResult;
  previousSnapshot?: ProjectScanResult;
  affectedChangeIds: string[];
  reason: WatcherProjectionReason;
  emittedAt: string;
}

export interface ProjectWatcherOptions {
  project: Pick<ProjectRecord, 'id' | 'rootPath' | 'watcherEnabled'>;
  settleMs?: number;
  batchMs?: number;
  retryMs?: number;
  maxFileBytes?: number;
  scan?: typeof scanOpenSpecProject;
  watchFactory?: typeof watch;
  canonicalizeWatchPath?: (path: string) => Promise<string>;
  onProjection?: (event: WatcherProjection) => Promise<void> | void;
  onState?: (state: WatcherState, error?: string) => Promise<void> | void;
}

type FsEvent = 'add' | 'change' | 'unlink';

export class ProjectWatcher {
  private readonly project: ProjectWatcherOptions['project'];
  private readonly settleMs: number;
  private readonly batchMs: number;
  private readonly retryMs: number;
  private readonly maxFileBytes: number | undefined;
  private readonly scan: typeof scanOpenSpecProject;
  private readonly watchFactory: typeof watch;
  private readonly canonicalizeWatchPath: (path: string) => Promise<string>;
  private readonly onProjection?: ProjectWatcherOptions['onProjection'];
  private readonly onState?: ProjectWatcherOptions['onState'];
  private watcher: FSWatcher | null = null;
  private watchedRoot: string | null = null;
  private finishWatcherReady: (() => void) | undefined;
  private pendingPaths = new Set<string>();
  private pendingUnlink = false;
  private batchTimer: ReturnType<typeof setTimeout> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private reconciling = false;
  private queuedFullReconciliation = false;
  private closed = false;
  private started = false;
  private snapshot: ProjectScanResult | null = null;
  private fingerprint = new Map<string, string>();
  private reconcileDone: Promise<void> = Promise.resolve();

  constructor(options: ProjectWatcherOptions) {
    this.project = options.project;
    this.settleMs = options.settleMs ?? 120;
    this.batchMs = options.batchMs ?? 90;
    this.retryMs = options.retryMs ?? 2_000;
    this.maxFileBytes = options.maxFileBytes;
    this.scan = options.scan ?? scanOpenSpecProject;
    this.watchFactory = options.watchFactory ?? watch;
    this.canonicalizeWatchPath = options.canonicalizeWatchPath ?? realpath;
    this.onProjection = options.onProjection;
    this.onState = options.onState;
  }

  async start(): Promise<void> {
    if (this.closed || this.started) return;
    this.started = true;
    await this.reconcile('initial', [], true);
  }

  async rescan(): Promise<void> {
    if (this.closed) return;
    this.clearRetryTimer();
    await this.reconcile('manual-rescan', [], true);
  }

  async close(): Promise<void> {
    this.closed = true;
    const inFlight = this.reconcileDone;
    this.clearBatchTimer();
    this.clearRetryTimer();
    this.finishWatcherReady?.();
    const watcher = this.watcher;
    this.watcher = null;
    this.watchedRoot = null;
    if (watcher) await watcher.close();
    await inFlight;
  }

  getSnapshot(): ProjectScanResult | null {
    return this.snapshot ? structuredClone(this.snapshot) : null;
  }

  private async setState(state: WatcherState, error?: string): Promise<void> {
    if (this.closed) return;
    await this.onState?.(state, error);
  }

  private clearBatchTimer(): void {
    if (this.batchTimer) clearTimeout(this.batchTimer);
    this.batchTimer = undefined;
  }

  private clearRetryTimer(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
  }

  private scheduleRetry(): void {
    if (this.closed || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      void this.reconcile('recovery', [], true);
    }, this.retryMs);
  }

  private snapshotFingerprint(snapshot: ProjectScanResult): Map<string, string> {
    return new Map(
      snapshot.files.map((file) => [
        file.relativePath,
        `${file.contentHash ?? ''}:${file.parseHealth}:${file.error ?? ''}`,
      ]),
    );
  }

  private async reconcile(
    reason: WatcherProjectionReason,
    affectedChangeIds: string[],
    forcePublish: boolean,
  ): Promise<void> {
    if (this.closed) return;
    if (this.reconciling) {
      this.queuedFullReconciliation = true;
      return;
    }
    this.reconciling = true;
    let resolveReconcile!: () => void;
    this.reconcileDone = new Promise<void>((resolve) => {
      resolveReconcile = resolve;
    });
    await this.setState('scanning');
    try {
      const scanOptions: { maxFileBytes?: number } = {};
      if (this.maxFileBytes !== undefined) scanOptions.maxFileBytes = this.maxFileBytes;
      const nextSnapshot = await this.scan(this.project.rootPath, scanOptions);
      if (this.closed) return;
      if (!nextSnapshot.available) {
        await this.setState('unavailable', nextSnapshot.issues[0]?.message ?? '项目目录不可用');
        this.scheduleRetry();
        return;
      }

      const previousSnapshot = this.snapshot;
      const nextFingerprint = this.snapshotFingerprint(nextSnapshot);
      const changed =
        nextFingerprint.size !== this.fingerprint.size ||
        [...nextFingerprint].some(([path, value]) => this.fingerprint.get(path) !== value);
      this.snapshot = nextSnapshot;
      this.fingerprint = nextFingerprint;
      this.clearRetryTimer();
      await this.ensureWatcher();
      await this.setState(this.project.watcherEnabled ? 'watching' : 'paused');
      if (forcePublish || changed) {
        if (this.closed) return;
        await this.onProjection?.({
          projectId: this.project.id,
          snapshot: structuredClone(nextSnapshot),
          ...(previousSnapshot ? { previousSnapshot: structuredClone(previousSnapshot) } : {}),
          affectedChangeIds: [...new Set(affectedChangeIds)].sort(),
          reason,
          emittedAt: new Date().toISOString(),
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '监听器扫描失败';
      await this.setState('error', message);
      this.scheduleRetry();
    } finally {
      this.reconciling = false;
      resolveReconcile();
      if (this.queuedFullReconciliation && !this.closed) {
        this.queuedFullReconciliation = false;
        void this.reconcile('recovery', [], true);
      }
    }
  }

  private async ensureWatcher(): Promise<void> {
    if (this.closed || this.watcher || !this.project.watcherEnabled) return;
    const openspecRoot = await this.canonicalizeWatchPath(join(this.project.rootPath, 'openspec'));
    if (this.closed || this.watcher || !this.project.watcherEnabled) return;
    const instance = this.watchFactory(openspecRoot, {
      ignoreInitial: true,
      followSymlinks: false,
      atomic: true,
      awaitWriteFinish: {
        stabilityThreshold: this.settleMs,
        pollInterval: Math.max(20, Math.floor(this.settleMs / 3)),
      },
      ignored: (path) => {
        const rel = normalizeSlash(relative(openspecRoot, path));
        return Boolean(
          rel && (isTemporaryOpenSpecPath(rel) || rel.split('/').includes('node_modules')),
        );
      },
    });
    this.watcher = instance;
    this.watchedRoot = openspecRoot;
    instance.on('add', (path) => this.handleFsEvent('add', path));
    instance.on('change', (path) => this.handleFsEvent('change', path));
    instance.on('unlink', (path) => this.handleFsEvent('unlink', path));
    instance.on('unlinkDir', (path) => this.handleFsEvent('unlink', path));
    instance.on('error', (error) => {
      void this.setState('error', error instanceof Error ? error.message : String(error));
      this.scheduleRetry();
    });
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        instance.off('ready', onReady);
        instance.off('error', onError);
        if (this.finishWatcherReady === finish) this.finishWatcherReady = undefined;
        resolve();
      };
      const onReady = () => finish();
      const onError = () => finish();
      this.finishWatcherReady = finish;
      instance.once('ready', onReady);
      instance.once('error', onError);
    });
  }

  private handleFsEvent(event: FsEvent, absolutePath: string): void {
    if (this.closed) return;
    const openspecRoot = this.watchedRoot;
    if (!openspecRoot) return;
    const relativePath = normalizeSlash(relative(openspecRoot, absolutePath));
    if (!relativePath || relativePath.startsWith('../') || relativePath === '..') return;
    if (!classifyOpenSpecPath(relativePath)) return;
    this.pendingPaths.add(relativePath);
    if (event === 'unlink') this.pendingUnlink = true;
    if (this.batchTimer) clearTimeout(this.batchTimer);
    this.batchTimer = setTimeout(() => {
      this.batchTimer = undefined;
      void this.flushEvents();
    }, this.batchMs);
  }

  private async flushEvents(): Promise<void> {
    if (this.closed || this.pendingPaths.size === 0) return;
    const paths = [...this.pendingPaths];
    const fullReconciliation = this.pendingUnlink;
    this.pendingPaths.clear();
    this.pendingUnlink = false;
    const affected = new Set<string>();
    for (const path of paths) {
      const classified = classifyOpenSpecPath(path);
      if (classified?.changeId) affected.add(classified.changeId);
    }
    await this.reconcile('events', [...affected], fullReconciliation);
  }
}
