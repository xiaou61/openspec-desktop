import {
  actionCenterActionKeySchema,
  actionCenterProjectHealthSchema,
  actionCenterSnapshotSchema,
  codexHandoffSchema,
  localIdSchema,
  sha256FingerprintSchema,
  type ActionCenterItem,
  type ActionCenterProjectHealth,
  type ActionCenterSnapshot,
  type CatalogState,
  type ChangeLifecycleAssessment,
  type CodexHandoff,
  type OpenSpecContextSummary,
  type OpenSpecDoctorSummary,
  type OpenSpecInstructionsSummary,
  type ProjectRecord,
} from '@shared/contracts';
import type { ProjectScanResult } from '../domain/scanner';
import type { LifecycleContext } from '../lifecycle/lifecycle-service';
import type { RestrictedOpenSpecCli } from '../lifecycle/openspec-cli';
import type { ChangeWorkStateStore } from '../work-state/change-work-state-store';
import {
  aggregateActionCenterItems,
  deriveChangeAction,
  deriveProjectHealthAction,
} from './action-aggregator';

interface ActionCenterCatalog {
  snapshot(): CatalogState;
}

interface ActionCenterLifecycle {
  getAssessment(context: LifecycleContext): Promise<ChangeLifecycleAssessment>;
  refreshAssessment?(context: LifecycleContext): Promise<ChangeLifecycleAssessment>;
}

interface ActionCenterCli {
  doctor: RestrictedOpenSpecCli['doctor'];
  context: RestrictedOpenSpecCli['context'];
  instructions: RestrictedOpenSpecCli['instructions'];
}

export interface ActionCenterServiceOptions {
  catalog: ActionCenterCatalog;
  getScan: (projectId: string) => ProjectScanResult | null;
  lifecycle: ActionCenterLifecycle;
  cli: ActionCenterCli;
  workStateStore: ChangeWorkStateStore;
  now?: () => Date;
  healthCacheTtlMs?: number;
}

export interface GetActionCenterOptions {
  projectId?: string;
  refresh?: boolean;
}

export interface BuildCodexHandoffInput {
  actionKey: string;
  evidenceFingerprint: string;
}

interface HealthProbe {
  checkedAt: string;
  doctor?: OpenSpecDoctorSummary;
  context?: OpenSpecContextSummary;
  errors: string[];
}

interface CachedProbe {
  value?: HealthProbe;
  promise?: Promise<HealthProbe>;
  expiresAt: number;
}

interface KnownActionIdentity {
  projectId: string;
  changeId?: string;
}

async function mapLimit<T, R>(
  values: T[],
  limit: number,
  operation: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await operation(values[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

function emptyScan(project: ProjectRecord, checkedAt: string): ProjectScanResult {
  return {
    rootPath: project.rootPath,
    openspecPath: `${project.rootPath}/openspec`,
    available: false,
    scannedAt: checkedAt,
    specs: [],
    changes: [],
    files: [],
    issues: [{ kind: 'unavailable', message: project.error ?? '项目扫描不可用' }],
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 1000) : 'OpenSpec 检查失败';
}

function identityMatches(item: ActionCenterItem, identity: KnownActionIdentity): boolean {
  return (
    item.projectId === identity.projectId &&
    (identity.changeId ? item.changeId === identity.changeId : item.changeId === undefined)
  );
}

export class ActionCenterService {
  private readonly now: () => Date;
  private readonly healthCacheTtlMs: number;
  private readonly healthCache = new Map<string, CachedProbe>();
  private readonly knownActions = new Map<string, KnownActionIdentity>();
  private invalidationVersion = 0;

  constructor(private readonly options: ActionCenterServiceOptions) {
    this.now = options.now ?? (() => new Date());
    this.healthCacheTtlMs = options.healthCacheTtlMs ?? 30_000;
  }

  async getActionCenter(options: GetActionCenterOptions): Promise<ActionCenterSnapshot> {
    for (;;) {
      const version = this.invalidationVersion;
      const snapshot = await this.buildActionCenter(options);
      if (version === this.invalidationVersion) return snapshot;
    }
  }

  private async buildActionCenter(options: GetActionCenterOptions): Promise<ActionCenterSnapshot> {
    const allProjects = this.options.catalog.snapshot().projects;
    let projects = allProjects;
    if (options.projectId) {
      localIdSchema.parse(options.projectId);
      const project = allProjects.find((entry) => entry.id === options.projectId);
      if (!project) throw new Error('项目不存在');
      projects = [project];
    }
    const generatedAt = this.now().toISOString();
    const scans = new Map<string, ProjectScanResult>();
    const workStateDiagnostics = new Map<string, string>();
    for (const project of projects) {
      await this.options.workStateStore.initProject(project.id);
      const stored = this.options.workStateStore.snapshot(project.id);
      if (stored.diagnostic) workStateDiagnostics.set(project.id, stored.diagnostic.message);
      const raw = this.options.getScan(project.id) ?? emptyScan(project, generatedAt);
      scans.set(project.id, {
        ...raw,
        changes: raw.changes.map((change) => {
          const workState = change.archived ? stored.archived[change.id] : stored.active[change.id];
          return {
            ...change,
            ...((workState ?? change.workState)
              ? { workState: workState ?? change.workState }
              : {}),
            ...((workState?.evolution ?? change.evolution)
              ? { evolution: workState?.evolution ?? change.evolution }
              : {}),
          };
        }),
      });
    }

    const healthResults = await mapLimit(projects, 4, async (project) =>
      this.resolveProjectHealth(
        project,
        scans.get(project.id)!,
        Boolean(options.refresh),
        workStateDiagnostics.get(project.id),
      ),
    );
    const health = new Map(healthResults.map((entry) => [entry.health.projectId, entry]));
    const jobs = projects.flatMap((project) =>
      (scans.get(project.id)?.changes ?? [])
        .filter((change) => !change.archived)
        .map((change) => ({ project, change, scan: scans.get(project.id)! })),
    );
    const assessmentResults = await mapLimit(jobs, 4, async (job) => {
      try {
        const context = {
          projectId: job.project.id,
          projectRoot: job.project.rootPath,
          projectAvailable: job.project.available,
          scan: job.scan,
          change: job.change,
        };
        const assessment =
          options.refresh && this.options.lifecycle.refreshAssessment
            ? await this.options.lifecycle.refreshAssessment(context)
            : await this.options.lifecycle.getAssessment(context);
        const workState = job.change.workState;
        return {
          key: `${job.project.id}:${job.change.id}`,
          assessment: {
            ...assessment,
            ...(workState ? { workState } : {}),
            ...(job.change.evolution ? { evolution: job.change.evolution } : {}),
          } as ChangeLifecycleAssessment,
          degraded: !assessment.artifactGraph.authoritative,
          message: assessment.artifactGraph.authoritative
            ? undefined
            : (assessment.artifactGraph.message ?? 'status 使用结构降级结果'),
        };
      } catch (error) {
        return {
          key: `${job.project.id}:${job.change.id}`,
          assessment: undefined,
          degraded: true,
          message: errorMessage(error),
        };
      }
    });
    const assessments = new Map(assessmentResults.map((entry) => [entry.key, entry.assessment]));
    for (const result of assessmentResults) {
      if (!result.degraded) continue;
      const projectId = result.key.slice(0, result.key.indexOf(':'));
      const current = health.get(projectId);
      if (!current) continue;
      const message = `Change ${result.key.slice(result.key.indexOf(':') + 1)}：${result.message ?? '生命周期证据降级'}`;
      current.partial = true;
      current.health = actionCenterProjectHealthSchema.parse({
        ...current.health,
        status: current.health.status === 'unavailable' ? 'unavailable' : 'degraded',
        source: 'structural',
        diagnostics: [...current.health.diagnostics, message].slice(0, 100),
      });
    }

    const items: ActionCenterItem[] = [];
    for (const project of projects) {
      const projectHealth = health.get(project.id)!.health;
      const healthAction = deriveProjectHealthAction(projectHealth);
      if (healthAction) items.push(healthAction);
      for (const change of scans.get(project.id)!.changes) {
        const assessment = change.archived
          ? undefined
          : assessments.get(`${project.id}:${change.id}`);
        const item = deriveChangeAction({
          project,
          change,
          ...(assessment ? { assessment } : {}),
          checkedAt: generatedAt,
        });
        if (item) items.push(item);
      }
    }
    const ordered = aggregateActionCenterItems(items).slice(0, 5_000);
    for (const item of ordered) {
      this.knownActions.set(item.actionKey, {
        projectId: item.projectId,
        ...(item.changeId ? { changeId: item.changeId } : {}),
      });
    }
    const projectHealth = projects.map((project) => health.get(project.id)!.health);
    const diagnostics = projectHealth
      .flatMap((entry) =>
        entry.diagnostics.map((message) => ({ projectId: entry.projectId, message })),
      )
      .slice(0, 500);
    const partial = [...health.values()].some((entry) => entry.partial);
    return actionCenterSnapshotSchema.parse({
      schemaVersion: 1,
      scope: options.projectId
        ? { kind: 'project', projectId: options.projectId }
        : { kind: 'all' },
      status: partial ? 'partial' : 'complete',
      generatedAt,
      projects: projectHealth,
      items: ordered,
      diagnostics,
      summary: {
        projectCount: projectHealth.length,
        actionCount: ordered.length,
        degradedProjectCount: projectHealth.filter((entry) => entry.status !== 'healthy').length,
      },
    });
  }

  async buildCodexHandoff(input: BuildCodexHandoffInput): Promise<CodexHandoff> {
    const actionKey = actionCenterActionKeySchema.parse(input.actionKey);
    sha256FingerprintSchema.parse(input.evidenceFingerprint);
    const known = this.knownActions.get(actionKey);
    const snapshot = await this.getActionCenter({
      ...(known ? { projectId: known.projectId } : {}),
      refresh: true,
    });
    const current =
      snapshot.items.find((item) => item.actionKey === actionKey) ??
      (known ? snapshot.items.find((item) => identityMatches(item, known)) : undefined);
    if (!current) throw new Error('行动不存在或已失效');
    if (
      current.actionKey !== actionKey ||
      current.evidenceFingerprint !== input.evidenceFingerprint
    ) {
      return codexHandoffSchema.parse({
        schemaVersion: 1,
        actionKey,
        evidenceFingerprint: current.evidenceFingerprint,
        generatedAt: this.now().toISOString(),
        stale: true,
        title: '行动证据已更新',
        markdown: '当前证据已变化，请审阅新的行动后再生成 Codex 交接。',
        currentAction: current,
      });
    }

    let instructions: OpenSpecInstructionsSummary | undefined;
    let instructionError: string | undefined;
    const target = this.instructionTarget(current);
    if (target && current.changeId) {
      try {
        instructions = await this.options.cli.instructions(
          current.projectRoot,
          current.changeId,
          target,
        );
      } catch (error) {
        instructionError = errorMessage(error);
      }
    }
    const markdown = this.handoffMarkdown(
      current,
      instructions,
      instructionError,
    );
    return codexHandoffSchema.parse({
      schemaVersion: 1,
      actionKey,
      evidenceFingerprint: current.evidenceFingerprint,
      generatedAt: this.now().toISOString(),
      stale: false,
      title: current.title,
      markdown,
      currentAction: current,
    });
  }

  invalidate(projectId?: string): void {
    this.invalidationVersion += 1;
    if (!projectId) {
      this.healthCache.clear();
      return;
    }
    const project = this.options.catalog
      .snapshot()
      .projects.find((entry) => entry.id === projectId);
    if (project) this.healthCache.delete(project.rootPath);
  }

  private async resolveProjectHealth(
    project: ProjectRecord,
    scan: ProjectScanResult,
    refresh: boolean,
    workStateDiagnostic?: string,
  ): Promise<{ health: ActionCenterProjectHealth; partial: boolean }> {
    const checkedAt = this.now().toISOString();
    if (!project.available || !scan.available) {
      const diagnostics = [project.error ?? scan.issues[0]?.message ?? '项目不可用'];
      if (workStateDiagnostic) diagnostics.push(workStateDiagnostic);
      return {
        health: actionCenterProjectHealthSchema.parse({
          projectId: project.id,
          projectName: project.displayName,
          projectRoot: project.rootPath,
          status: 'unavailable',
          source: 'structural',
          checkedAt,
          diagnostics,
        }),
        partial: true,
      };
    }
    const probe = await this.healthProbe(project.rootPath, refresh);
    const diagnostics = [
      ...probe.errors,
      ...(probe.doctor?.diagnostics.map((entry) => entry.message) ?? []),
      ...(probe.context?.diagnostics.map((entry) => entry.message) ?? []),
      ...(workStateDiagnostic ? [workStateDiagnostic] : []),
    ].slice(0, 100);
    const unhealthy = probe.doctor?.healthy === false || diagnostics.length > 0;
    const source = probe.doctor || probe.context ? 'openspec-cli' : 'structural';
    return {
      health: actionCenterProjectHealthSchema.parse({
        projectId: project.id,
        projectName: project.displayName,
        projectRoot: project.rootPath,
        status: unhealthy ? 'degraded' : 'healthy',
        source,
        checkedAt: probe.checkedAt,
        ...(probe.context ? { rootRole: probe.context.rootRole, context: probe.context } : {}),
        ...(probe.doctor ? { doctor: probe.doctor } : {}),
        diagnostics,
      }),
      partial: probe.errors.length > 0 || Boolean(workStateDiagnostic),
    };
  }

  private healthProbe(projectRoot: string, refresh: boolean): Promise<HealthProbe> {
    const now = this.now().getTime();
    const cached = this.healthCache.get(projectRoot);
    if (!refresh && cached) {
      if (cached.promise) return cached.promise;
      if (cached.value && cached.expiresAt > now) return Promise.resolve(cached.value);
    }
    const promise = Promise.allSettled([
      this.options.cli.doctor(projectRoot),
      this.options.cli.context(projectRoot),
    ]).then(([doctor, context]) => {
      const value: HealthProbe = {
        checkedAt: this.now().toISOString(),
        ...(doctor.status === 'fulfilled' ? { doctor: doctor.value } : {}),
        ...(context.status === 'fulfilled' ? { context: context.value } : {}),
        errors: [
          ...(doctor.status === 'rejected' ? [`doctor：${errorMessage(doctor.reason)}`] : []),
          ...(context.status === 'rejected' ? [`context：${errorMessage(context.reason)}`] : []),
        ],
      };
      const current = this.healthCache.get(projectRoot);
      if (current?.promise === promise) {
        this.healthCache.set(projectRoot, {
          value,
          expiresAt: this.now().getTime() + this.healthCacheTtlMs,
        });
      }
      return value;
    });
    this.healthCache.set(projectRoot, {
      promise,
      expiresAt: now + this.healthCacheTtlMs,
    });
    return promise;
  }

  private instructionTarget(item: ActionCenterItem): string | undefined {
    if (item.actionType === 'complete-artifact') return item.targetArtifactId;
    if (
      item.actionType === 'continue-implementation' ||
      item.actionType === 'run-validation' ||
      item.actionType === 'fix-validation'
    ) {
      return 'apply';
    }
    if (item.actionType === 'archive') return 'archive';
    return undefined;
  }

  private handoffMarkdown(
    item: ActionCenterItem,
    instructions: OpenSpecInstructionsSummary | undefined,
    instructionError: string | undefined,
  ): string {
    const inline = (value: string, max = 1_000): string =>
      value.replaceAll('`', "'").replaceAll(/\s+/g, ' ').trim().slice(0, max);
    const lines = [
      `# ${item.title}`,
      '',
      `- 项目根：\`${inline(item.projectRoot)}\``,
      ...(item.changeId ? [`- Change：\`${inline(item.changeId)}\``] : []),
      `- 行动类型：\`${item.actionType}\``,
      `- 当前证据：${item.description}`,
    ];
    if (item.taskGate) {
      lines.push(
        `- 任务：${item.taskGate.completed}/${item.taskGate.total}，剩余 ${item.taskGate.remaining}`,
      );
    }
    if (item.workState?.phase === 'reopened') {
      lines.push(`- 实施轮次：第 ${item.workState.iteration} 轮（再次实施）`);
    }
    if (item.evolution?.status === 'iteration' || item.evolution?.status === 'mixed') {
      lines.push('- 能力演进：包含既有能力的迭代');
    }
    lines.push('', '## 证据');
    for (const evidence of item.evidence) {
      lines.push(
        `- ${evidence.summary}${evidence.relativePath ? `（\`${inline(evidence.relativePath)}\`）` : ''}`,
      );
    }
    if (instructions) {
      lines.push('', '## OpenSpec 上下文');
      for (const group of instructions.contextFiles) {
        for (const path of group.paths) lines.push(`- \`${inline(path)}\``);
      }
      if (instructions.dependencies.length > 0) {
        lines.push(
          `- 依赖：${instructions.dependencies.map((entry) => `${entry.id}=${entry.done ? 'done' : 'pending'}`).join('，')}`,
        );
      }
      if (instructions.instruction) lines.push('', instructions.instruction);
    } else if (instructionError) {
      lines.push('', `OpenSpec instructions 暂不可用：${instructionError}`);
    }
    lines.push(
      '',
      '仅使用以上有界证据；不要自动归档或修改任务勾选，也不要把本机观察写成外部执行结果。',
    );
    return lines.join('\n').slice(0, 256 * 1024);
  }
}
