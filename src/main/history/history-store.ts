import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { diffLines } from 'diff';
import {
  historyIndexSchema,
  localIdSchema,
  revisionComparisonSchema,
  safeRelativePathSchema,
  type ActivityEntry,
  type ArtifactType,
  type DiffHunk,
  type HistoryIndex,
  type Revision,
  type RevisionComparison,
  type RetentionSettings,
} from '@shared/contracts';

export const DEFAULT_RETENTION: RetentionSettings = {
  revisionsPerArtifact: 50,
  activityPerProject: 1000,
};

export interface RecordRevisionInput {
  relativePath: string;
  artifactType: ArtifactType;
  content: string;
  changeId?: string;
  projectVersion: string;
  taskDelta?: { completed: number; total: number };
  createdAt?: string;
}

export interface RecordRevisionResult {
  created: boolean;
  revision: Revision;
  activities: ActivityEntry[];
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function defaultIndex(retention: RetentionSettings): HistoryIndex {
  return { schemaVersion: 1, revisions: [], activity: [], retention: { ...retention } };
}

function isSameTaskDelta(delta: { completed: number; total: number } | undefined): boolean {
  return Boolean(delta && (delta.completed !== 0 || delta.total !== 0));
}

function cursorOffset(cursor: string | undefined): number {
  if (!cursor) return 0;
  const value = Number.parseInt(cursor, 10);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

export class HistoryStore {
  readonly historyDirectory: string;
  readonly snapshotDirectory: string;
  readonly indexPath: string;
  private index: HistoryIndex;
  private initialized = false;
  private operation: Promise<unknown> = Promise.resolve();

  constructor(
    userDataPath: string,
    readonly projectId: string,
    retention: RetentionSettings = DEFAULT_RETENTION,
  ) {
    localIdSchema.parse(projectId);
    this.historyDirectory = join(userDataPath, 'history', projectId);
    this.snapshotDirectory = join(this.historyDirectory, 'snapshots');
    this.indexPath = join(this.historyDirectory, 'index.json');
    this.index = defaultIndex(retention);
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    await fs.mkdir(this.snapshotDirectory, { recursive: true });
    try {
      const raw = await fs.readFile(this.indexPath, 'utf8');
      this.index = historyIndexSchema.parse(JSON.parse(raw) as unknown);
    } catch {
      try {
        await fs.rename(
          this.indexPath,
          `${this.indexPath}.corrupt-${Date.now()}-${randomUUID()}.json`,
        );
      } catch {
        // Missing index is the normal first-run path.
      }
      await this.saveIndex();
    }
    this.initialized = true;
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

  private async saveIndex(): Promise<void> {
    await fs.mkdir(dirname(this.indexPath), { recursive: true });
    const tempPath = `${this.indexPath}.tmp-${randomUUID()}`;
    const handle = await fs.open(tempPath, 'w');
    try {
      await handle.writeFile(`${JSON.stringify(this.index, null, 2)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await fs.rename(tempPath, this.indexPath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST' && code !== 'EPERM') throw error;
      await fs.rm(this.indexPath, { force: true });
      await fs.rename(tempPath, this.indexPath);
    }
  }

  private snapshotPath(contentHash: string): string {
    if (!/^[a-f0-9]{64}$/.test(contentHash)) throw new Error('非法快照哈希');
    return join(this.snapshotDirectory, `${contentHash}.md`);
  }

  private currentRevision(relativePath: string): Revision | undefined {
    return [...this.index.revisions]
      .filter((revision) => revision.relativePath === relativePath)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  }

  private async writeSnapshot(contentHash: string, content: string): Promise<void> {
    const path = this.snapshotPath(contentHash);
    try {
      await fs.writeFile(path, content, { encoding: 'utf8', flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }

  async recordRevision(input: RecordRevisionInput): Promise<RecordRevisionResult> {
    return this.enqueue(async () => {
      const relativePath = safeRelativePathSchema.parse(input.relativePath);
      const contentHash = hashContent(input.content);
      const current = this.currentRevision(relativePath);
      if (current?.contentHash === contentHash)
        return { created: false, revision: structuredClone(current), activities: [] };

      await this.writeSnapshot(contentHash, input.content);
      const now = input.createdAt ?? new Date().toISOString();
      const revision: Revision = {
        id: randomUUID(),
        projectId: this.projectId,
        relativePath,
        artifactType: input.artifactType,
        contentHash,
        snapshotPath: `snapshots/${contentHash}.md`,
        createdAt: now,
        size: Buffer.byteLength(input.content, 'utf8'),
        projectVersion: input.projectVersion,
        priorRevisionId: current?.id ?? null,
      };
      if (input.changeId) revision.changeId = input.changeId;
      if (input.taskDelta) revision.taskDelta = { ...input.taskDelta };
      this.index.revisions.push(revision);

      const activities: ActivityEntry[] = [];
      const artifactActivity: ActivityEntry = {
        id: randomUUID(),
        projectId: this.projectId,
        kind: 'artifact-change',
        createdAt: now,
        relativePath,
        artifactType: input.artifactType,
        projectVersion: input.projectVersion,
        summary: `${relativePath} 已更新`,
      };
      if (input.changeId) artifactActivity.changeId = input.changeId;
      activities.push(artifactActivity);
      if (isSameTaskDelta(input.taskDelta)) {
        const taskActivity: ActivityEntry = {
          id: randomUUID(),
          projectId: this.projectId,
          kind: 'task-progress',
          createdAt: now,
          relativePath,
          artifactType: input.artifactType,
          projectVersion: input.projectVersion,
          summary: `${relativePath} 的任务进度发生变化`,
          taskDelta: { ...input.taskDelta! },
        };
        if (input.changeId) taskActivity.changeId = input.changeId;
        activities.push(taskActivity);
      }
      this.index.activity.push(...activities);
      await this.prune();
      await this.saveIndex();
      return {
        created: true,
        revision: structuredClone(revision),
        activities: structuredClone(activities),
      };
    });
  }

  async recordActivity(entry: Omit<ActivityEntry, 'id' | 'projectId'>): Promise<ActivityEntry> {
    return this.enqueue(async () => {
      const activity: ActivityEntry = { ...entry, id: randomUUID(), projectId: this.projectId };
      this.index.activity.push(activity);
      await this.prune();
      await this.saveIndex();
      return structuredClone(activity);
    });
  }

  async listRevisions(
    relativePath: string,
    options: { cursor?: string; limit?: number } = {},
  ): Promise<Page<Revision>> {
    await this.ready();
    const safePath = safeRelativePathSchema.parse(relativePath);
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const items = [...this.index.revisions]
      .filter((revision) => revision.relativePath === safePath)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const offset = cursorOffset(options.cursor);
    const page = items.slice(offset, offset + limit).map((revision) => structuredClone(revision));
    return {
      items: page,
      nextCursor: offset + page.length < items.length ? String(offset + page.length) : null,
    };
  }

  async listActivity(
    options: { cursor?: string; limit?: number; changeId?: string } = {},
  ): Promise<Page<ActivityEntry>> {
    await this.ready();
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const items = [...this.index.activity]
      .filter((activity) => !options.changeId || activity.changeId === options.changeId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const offset = cursorOffset(options.cursor);
    const page = items.slice(offset, offset + limit).map((activity) => structuredClone(activity));
    return {
      items: page,
      nextCursor: offset + page.length < items.length ? String(offset + page.length) : null,
    };
  }

  async compareRevisions(
    leftRevisionId: string,
    rightRevisionId: string,
    maxLines = 1000,
  ): Promise<RevisionComparison> {
    await this.ready();
    const left = this.index.revisions.find((revision) => revision.id === leftRevisionId);
    const right = this.index.revisions.find((revision) => revision.id === rightRevisionId);
    if (!left || !right) throw new Error('找不到要比较的修订');
    if (left.relativePath !== right.relativePath) throw new Error('只能比较同一文件的修订');
    const [leftContent, rightContent] = await Promise.all([
      fs.readFile(this.snapshotPath(left.contentHash), 'utf8'),
      fs.readFile(this.snapshotPath(right.contentHash), 'utf8'),
    ]);
    const hunks: DiffHunk[] = [];
    let remaining = Math.max(1, Math.min(maxLines, 2000));
    let truncated = false;
    for (const part of diffLines(leftContent, rightContent)) {
      const lines = part.value.split(/\r?\n/);
      if (lines.at(-1) === '') lines.pop();
      if (lines.length === 0) continue;
      if (remaining <= 0) {
        truncated = true;
        break;
      }
      const kept = lines.slice(0, remaining);
      if (kept.length < lines.length) truncated = true;
      remaining -= kept.length;
      hunks.push({
        kind: part.added ? 'added' : part.removed ? 'removed' : 'unchanged',
        value: kept.join('\n'),
        lineCount: kept.length,
      });
    }
    const result: RevisionComparison = { left, right, hunks, truncated };
    return revisionComparisonSchema.parse(result);
  }

  async setRetention(retention: RetentionSettings): Promise<void> {
    return this.enqueue(async () => {
      this.index.retention = { ...retention };
      await this.prune();
      await this.saveIndex();
    });
  }

  async clearHistory(): Promise<void> {
    return this.enqueue(async () => {
      await fs.rm(this.historyDirectory, { recursive: true, force: true });
      await fs.mkdir(this.snapshotDirectory, { recursive: true });
      this.index = defaultIndex(this.index.retention);
      await this.saveIndex();
    });
  }

  getRetention(): RetentionSettings {
    return { ...this.index.retention };
  }

  async flush(): Promise<void> {
    await this.operation;
  }

  getStorageDirectory(): string {
    return this.historyDirectory;
  }

  private async prune(): Promise<void> {
    const revisionsByPath = new Map<string, Revision[]>();
    for (const revision of this.index.revisions) {
      const list = revisionsByPath.get(revision.relativePath) ?? [];
      list.push(revision);
      revisionsByPath.set(revision.relativePath, list);
    }
    const keepIds = new Set<string>();
    for (const revisions of revisionsByPath.values()) {
      revisions.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
      for (const revision of revisions.slice(0, this.index.retention.revisionsPerArtifact))
        keepIds.add(revision.id);
    }
    this.index.revisions = this.index.revisions.filter((revision) => keepIds.has(revision.id));
    this.index.activity = this.index.activity
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .slice(-this.index.retention.activityPerProject);

    const referencedHashes = new Set(this.index.revisions.map((revision) => revision.contentHash));
    let snapshotFiles: string[];
    try {
      snapshotFiles = await fs.readdir(this.snapshotDirectory);
    } catch {
      return;
    }
    for (const file of snapshotFiles) {
      const match = /^([a-f0-9]{64})\.md$/.exec(file);
      if (!match || referencedHashes.has(match[1]!)) continue;
      await fs.rm(join(this.snapshotDirectory, file), { force: true });
    }
  }
}
