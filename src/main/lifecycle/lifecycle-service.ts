import type {
  ArtifactGraph,
  ChangeLifecycleAssessment,
  ChangeProjection,
  LifecycleTaskGate,
  SpecSyncAssessment,
} from '@shared/contracts';
import type { ProjectScanResult } from '../domain/scanner';
import { parseOpenSpecMetadata } from '../domain/openspec-adapter';
import { evaluateLifecycle } from './evaluator';
import { createLifecycleFingerprint } from './fingerprint';
import { RestrictedOpenSpecCli, createStructuralArtifactGraph } from './openspec-cli';
import { assessSpecSync } from './spec-sync';
import { ValidationCache, ValidationCoordinator } from './validation';

export interface LifecycleContext {
  projectId: string;
  projectRoot: string;
  projectAvailable: boolean;
  scan: ProjectScanResult;
  change: ChangeProjection;
}

interface LifecycleCli {
  status(projectRoot: string, changeId: string): Promise<ArtifactGraph>;
  validate: RestrictedOpenSpecCli['validate'];
}

interface CachedValue<T> {
  fingerprint: string;
  expiresAt: number;
  promise?: Promise<T>;
  value?: T;
}

interface ResolvedLifecycleFacts {
  artifactGraph: ArtifactGraph;
  taskGate: LifecycleTaskGate;
  sync: SpecSyncAssessment;
}

export interface LifecycleServiceOptions {
  userDataPath: string;
  cli?: LifecycleCli;
  validationCache?: ValidationCache;
  cacheTtlMs?: number;
  now?: () => Date;
}

function metadataSkipSpecs(change: ChangeProjection): boolean {
  const metadata = change.artifacts.find((artifact) => artifact.type === 'metadata');
  if (!metadata?.rawContent || metadata.parseHealth !== 'ok') return false;
  const parsed = parseOpenSpecMetadata(metadata.rawContent);
  return parsed.ok && parsed.value['skip_specs'] === true;
}

function taskGate(change: ChangeProjection, graph: ArtifactGraph): LifecycleTaskGate {
  const applicable = graph.applyRequires.includes('tasks');
  if (!applicable) {
    return {
      applicable: false,
      status: 'not-applicable',
      completed: 0,
      total: 0,
      remaining: 0,
    };
  }
  const artifact = change.artifacts.find((entry) => entry.type === 'tasks');
  if (!artifact || artifact.parseHealth !== 'ok') {
    return {
      applicable: true,
      status: 'unknown',
      completed: artifact?.taskTotals.completed ?? 0,
      total: artifact?.taskTotals.total ?? 0,
      remaining: Math.max(
        0,
        (artifact?.taskTotals.total ?? 0) - (artifact?.taskTotals.completed ?? 0),
      ),
      ...(artifact ? { sourcePath: artifact.sourcePath } : {}),
      message: artifact?.error ?? '所需 tasks 工件缺失或不可读',
    };
  }
  const { completed, total } = artifact.taskTotals;
  return {
    applicable: true,
    status: total === 0 ? 'empty' : completed === total ? 'complete' : 'incomplete',
    completed,
    total,
    remaining: total - completed,
    sourcePath: artifact.sourcePath,
  };
}

export class LifecycleService {
  private readonly cli: LifecycleCli;
  private readonly validation: ValidationCoordinator;
  private readonly graphCache = new Map<string, CachedValue<ArtifactGraph>>();
  private readonly syncCache = new Map<string, CachedValue<SpecSyncAssessment>>();
  private readonly cacheTtlMs: number;
  private readonly now: () => Date;

  constructor(options: LifecycleServiceOptions) {
    this.cli = options.cli ?? new RestrictedOpenSpecCli();
    this.cacheTtlMs = options.cacheTtlMs ?? 3_000;
    this.now = options.now ?? (() => new Date());
    const cache = options.validationCache ?? new ValidationCache(options.userDataPath);
    this.validation = new ValidationCoordinator({
      cache,
      now: () => this.now().toISOString(),
      validate: (input) =>
        this.cli.validate(input.projectRoot, input.changeId, {
          checkedAt: input.checkedAt,
          fingerprint: input.fingerprint,
          allowedPaths: input.allowedPaths,
        }),
    });
  }

  async getAssessment(context: LifecycleContext): Promise<ChangeLifecycleAssessment> {
    return this.assess(context);
  }

  async refreshAssessment(context: LifecycleContext): Promise<ChangeLifecycleAssessment> {
    return this.assess(context);
  }

  private async assess(
    context: LifecycleContext,
  ): Promise<ChangeLifecycleAssessment> {
    const fingerprint = createLifecycleFingerprint(context.scan, context.change);
    const [resolved, validation] = await Promise.all([
      this.resolveLifecycleFacts(context),
      this.validation.current(context.projectId, context.scan, context.change),
    ]);
    return evaluateLifecycle({
      projectId: context.projectId,
      changeId: context.change.id,
      archived: context.change.archived,
      projectAvailable: context.projectAvailable && context.scan.available,
      contentFingerprint: fingerprint,
      evaluatedAt: this.now().toISOString(),
      artifactGraph: resolved.artifactGraph,
      taskGate: resolved.taskGate,
      validation,
      sync: resolved.sync,
    });
  }

  private async resolveLifecycleFacts(
    context: LifecycleContext,
  ): Promise<ResolvedLifecycleFacts> {
    const fingerprint = createLifecycleFingerprint(context.scan, context.change);
    const key = this.cacheKey(context.projectId, context.change);
    const skipSpecs = metadataSkipSpecs(context.change);
    const [artifactGraph, sync] = await Promise.all([
      this.cached(this.graphCache, key, fingerprint, () =>
        this.resolveGraph(context, skipSpecs),
      ),
      this.cached(this.syncCache, key, fingerprint, async () =>
        assessSpecSync({
          scan: context.scan,
          change: context.change,
          checkedAt: this.now().toISOString(),
          skipSpecs,
        }),
      ),
    ]);
    const currentTaskGate = taskGate(context.change, artifactGraph);
    return {
      artifactGraph,
      sync,
      taskGate: currentTaskGate,
    };
  }

  async runValidation(
    context: LifecycleContext & {
      getCurrent: () => LifecycleContext | Promise<LifecycleContext>;
    },
  ): Promise<ChangeLifecycleAssessment> {
    await this.validation.run({
      projectId: context.projectId,
      projectRoot: context.projectRoot,
      change: context.change,
      scan: context.scan,
      getCurrent: async () => {
        const current = await context.getCurrent();
        return { scan: current.scan, change: current.change };
      },
    });
    const current = await context.getCurrent();
    this.invalidate(context.projectId, [context.change.id]);
    return this.getAssessment(current);
  }

  invalidate(projectId: string, changeIds?: string[]): void {
    const selected = changeIds ? new Set(changeIds) : null;
    for (const cache of [this.graphCache, this.syncCache]) {
      for (const key of cache.keys()) {
        if (!key.startsWith(`${projectId}:`)) continue;
        const changeId = key.slice(key.lastIndexOf(':') + 1);
        if (!selected || selected.has(changeId)) cache.delete(key);
      }
    }
  }

  private async resolveGraph(
    context: LifecycleContext,
    skipSpecs: boolean,
  ): Promise<ArtifactGraph> {
    if (context.change.archived) {
      return createStructuralArtifactGraph(context.change, {
        skipSpecs,
        message: '已归档 Change 使用目录与可读工件生成历史工件图',
      });
    }
    try {
      return await this.cli.status(context.projectRoot, context.change.id);
    } catch (error) {
      return createStructuralArtifactGraph(context.change, {
        skipSpecs,
        message: error instanceof Error ? error.message.slice(0, 1000) : 'OpenSpec status 不可用',
      });
    }
  }

  private cacheKey(projectId: string, change: ChangeProjection): string {
    return `${projectId}:${change.archived ? 'archive' : 'active'}:${change.id}`;
  }

  private cached<T>(
    cache: Map<string, CachedValue<T>>,
    key: string,
    fingerprint: string,
    producer: () => Promise<T>,
  ): Promise<T> {
    const existing = cache.get(key);
    const now = this.now().getTime();
    if (existing?.fingerprint === fingerprint) {
      if (existing.promise) return existing.promise;
      if (existing.value !== undefined && existing.expiresAt > now)
        return Promise.resolve(existing.value);
    }
    const promise = producer().then(
      (value) => {
        const current = cache.get(key);
        if (current?.promise === promise) {
          cache.set(key, {
            fingerprint,
            value,
            expiresAt: this.now().getTime() + this.cacheTtlMs,
          });
        }
        return value;
      },
      (error: unknown) => {
        if (cache.get(key)?.promise === promise) cache.delete(key);
        throw error;
      },
    );
    cache.set(key, { fingerprint, promise, expiresAt: now + this.cacheTtlMs });
    return promise;
  }
}
