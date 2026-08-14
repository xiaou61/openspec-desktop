import { createHash } from 'node:crypto';
import {
  changeWorkStateSchema,
  type ChangeEvolutionAssessment,
  type ChangeLifecycleAssessment,
  type ChangeProjection,
  type ChangeWorkState,
  type ImplementationReopenedEvidence,
  type ImplementationTaskObservation,
  type ProjectRecord,
} from '@shared/contracts';
import type { ProjectScanResult } from '../domain/scanner';
import type { HistoryStore } from '../history/history-store';
import type { LifecycleContext } from '../lifecycle/lifecycle-service';
import { createArchiveContentFingerprint, transitionArchiveIntegrity } from './archive-integrity';
import type { ChangeWorkStateStore } from './change-work-state-store';
import { assessChangeEvolution } from './evolution';
import { transitionImplementationIteration } from './iteration';

interface WorkStateLifecycle {
  getAssessment(context: LifecycleContext): Promise<ChangeLifecycleAssessment>;
}

export interface ChangeWorkStateServiceOptions {
  store: ChangeWorkStateStore;
  lifecycle: WorkStateLifecycle;
  historyForProject: (projectId: string) => Promise<HistoryStore>;
}

export interface ChangeWorkStateReconcileInput {
  project: ProjectRecord;
  scan: ProjectScanResult;
}

export interface ChangeWorkStateReconcileResult {
  changedChangeIds: string[];
}

function hash(parts: string[]): string {
  return createHash('sha256').update(parts.join('\n'), 'utf8').digest('hex');
}

function taskFingerprint(change: ChangeProjection): string {
  const artifact = change.artifacts.find((entry) => entry.type === 'tasks');
  return (
    artifact?.contentHash ??
    hash([
      change.id,
      artifact?.sourcePath ?? 'missing',
      artifact?.parseHealth ?? 'missing',
      artifact?.rawContent ?? '',
    ])
  );
}

function sameEvolution(
  left: ChangeEvolutionAssessment | undefined,
  right: ChangeEvolutionAssessment,
): boolean {
  if (!left) return false;
  return (
    JSON.stringify({ ...left, assessedAt: '' }) === JSON.stringify({ ...right, assessedAt: '' })
  );
}

function archiveMatches(activeChangeId: string, archivedChangeId: string): boolean {
  return archivedChangeId === activeChangeId || archivedChangeId.endsWith(`-${activeChangeId}`);
}

function reasonLabel(event: ImplementationReopenedEvidence): string {
  return {
    'tasks-added': '新增了未完成任务',
    'tasks-unchecked': '已有任务被重新打开',
    'task-set-changed': '任务集合发生混合变化',
  }[event.reason];
}

export class ChangeWorkStateService {
  private readonly queues = new Map<string, Promise<void>>();

  constructor(private readonly options: ChangeWorkStateServiceOptions) {}

  reconcile(input: ChangeWorkStateReconcileInput): Promise<ChangeWorkStateReconcileResult> {
    return this.enqueue(input.project.id, () => this.reconcileProject(input));
  }

  private async reconcileProject(
    input: ChangeWorkStateReconcileInput,
  ): Promise<ChangeWorkStateReconcileResult> {
    const projectId = input.project.id;
    await this.options.store.initProject(projectId);
    const changed = new Set<string>();
    const activeChanges = input.scan.changes.filter((change) => !change.archived);
    const archivedChanges = input.scan.changes.filter((change) => change.archived);
    const activeIds = new Set(activeChanges.map((change) => change.id));
    const archiveOrigins = new Map<string, string>();
    let snapshot = this.options.store.snapshot(projectId);

    for (const activeChangeId of Object.keys(snapshot.active)) {
      if (activeIds.has(activeChangeId)) continue;
      const archived = archivedChanges.find(
        (change) => !snapshot.archived[change.id] && archiveMatches(activeChangeId, change.id),
      );
      if (!archived) {
        if (
          await this.options.store.removeActive(projectId, activeChangeId, input.scan.scannedAt)
        ) {
          changed.add(activeChangeId);
        }
        continue;
      }
      const integrity = transitionArchiveIntegrity(undefined, {
        fingerprint: createArchiveContentFingerprint(archived),
        observedAt: input.scan.scannedAt,
      }).state;
      await this.options.store.freezeActive(
        projectId,
        activeChangeId,
        archived.id,
        input.scan.scannedAt,
        integrity,
      );
      archiveOrigins.set(archived.id, activeChangeId);
      changed.add(activeChangeId);
      changed.add(archived.id);
    }

    snapshot = this.options.store.snapshot(projectId);
    const history = await this.options.historyForProject(projectId);
    for (const change of activeChanges) {
      const assessment = await this.options.lifecycle.getAssessment({
        projectId,
        projectRoot: input.project.rootPath,
        projectAvailable: input.project.available,
        scan: input.scan,
        change,
      });
      const observation: ImplementationTaskObservation = {
        status: assessment.taskGate.status,
        completed: assessment.taskGate.completed,
        total: assessment.taskGate.total,
        remaining: assessment.taskGate.remaining,
        fingerprint: taskFingerprint(change),
        observedAt: input.scan.scannedAt,
        projectVersion: {
          label: input.project.versionLabel,
          source: input.project.versionSource,
          capturedAt: input.scan.scannedAt,
        },
      };
      const previous = snapshot.active[change.id];
      const transition = transitionImplementationIteration(previous, change.id, observation);
      const assessedEvolution = assessChangeEvolution({
        scan: input.scan,
        change,
        assessedAt: input.scan.scannedAt,
      });
      const evolution = sameEvolution(previous?.evolution, assessedEvolution)
        ? previous!.evolution!
        : assessedEvolution;
      const evolutionChanged = evolution !== previous?.evolution;
      const state = changeWorkStateSchema.parse({
        ...transition.state,
        evolution,
        updatedAt:
          transition.changed || evolutionChanged
            ? input.scan.scannedAt
            : transition.state.updatedAt,
      });
      if (transition.reopened) {
        await this.recordReopened(history, change, transition.reopened);
      }
      if (transition.changed || evolutionChanged) {
        await this.options.store.updateActive(projectId, state);
        changed.add(change.id);
      }
      snapshot.active[change.id] = state;
    }

    snapshot = this.options.store.snapshot(projectId);
    for (const change of archivedChanges) {
      const previous = snapshot.archived[change.id];
      const fingerprint = createArchiveContentFingerprint(change);
      const transition = transitionArchiveIntegrity(previous?.archiveIntegrity, {
        fingerprint,
        observedAt: input.scan.scannedAt,
      });
      if (transition.changed) {
        await history.recordActivity({
          kind: 'archive-integrity',
          semanticKey: transition.changed.eventKey,
          changeId: change.id,
          createdAt: transition.changed.detectedAt,
          projectVersion: input.project.versionLabel,
          summary: '归档内容在本地基线建立后发生变化；建议创建新的 Change。',
        });
      }
      const integrityChanged =
        !previous || JSON.stringify(previous.archiveIntegrity) !== JSON.stringify(transition.state);
      const state = previous
        ? changeWorkStateSchema.parse({
            ...previous,
            archiveIntegrity: transition.state,
            updatedAt: integrityChanged ? input.scan.scannedAt : previous.updatedAt,
          })
        : this.createArchivedState(change, input.scan.scannedAt, transition.state);
      if (integrityChanged) {
        await this.options.store.updateArchived(projectId, state);
        changed.add(change.id);
      }
      snapshot.archived[change.id] = state;
    }

    return { changedChangeIds: [...changed] };
  }

  private async recordReopened(
    history: HistoryStore,
    change: ChangeProjection,
    event: ImplementationReopenedEvidence,
  ): Promise<void> {
    const sourcePath = change.artifacts.find((artifact) => artifact.type === 'tasks')?.sourcePath;
    await history.recordActivity({
      kind: 'task-progress',
      semanticKey: event.eventKey,
      changeId: change.id,
      ...(sourcePath ? { relativePath: sourcePath, artifactType: 'tasks' as const } : {}),
      createdAt: event.reopenedAt,
      projectVersion: event.projectVersion.label,
      summary: `进入第 ${event.iteration} 轮实施：${reasonLabel(event)}（${event.before.completed}/${event.before.total} → ${event.after.completed}/${event.after.total}）`,
      taskDelta: event.delta,
    });
  }

  private createArchivedState(
    change: ChangeProjection,
    observedAt: string,
    archiveIntegrity: NonNullable<ChangeWorkState['archiveIntegrity']>,
  ): ChangeWorkState {
    return changeWorkStateSchema.parse({
      schemaVersion: 1,
      changeId: change.id,
      activeGeneration: hash([
        'archive',
        change.id,
        archiveIntegrity.baselineFingerprint,
        observedAt,
      ]),
      iteration: 1,
      phase: 'observing',
      completionMilestones: [],
      reopenedEvents: [],
      archiveIntegrity,
      archivedAt: observedAt,
      updatedAt: observedAt,
    });
  }

  private enqueue<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
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
