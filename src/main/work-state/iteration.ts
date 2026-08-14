import { createHash } from 'node:crypto';
import {
  changeWorkStateSchema,
  implementationCompletionMilestoneSchema,
  implementationReopenedEvidenceSchema,
  implementationTaskObservationSchema,
  type ChangeWorkState,
  type ImplementationCompletionMilestone,
  type ImplementationReopenedEvidence,
  type ImplementationReopenedReason,
  type ImplementationTaskCounts,
  type ImplementationTaskObservation,
} from '@shared/contracts';

export interface ImplementationIterationTransition {
  state: ChangeWorkState;
  changed: boolean;
  completion?: ImplementationCompletionMilestone;
  reopened?: ImplementationReopenedEvidence;
}

function hash(parts: string[]): string {
  return createHash('sha256').update(parts.join('\n'), 'utf8').digest('hex');
}

function counts(observation: ImplementationTaskObservation): ImplementationTaskCounts {
  return {
    completed: observation.completed,
    total: observation.total,
    remaining: observation.remaining,
  };
}

function sameObservation(
  left: ImplementationTaskObservation | undefined,
  right: ImplementationTaskObservation,
): boolean {
  return Boolean(
    left &&
    left.status === right.status &&
    left.completed === right.completed &&
    left.total === right.total &&
    left.remaining === right.remaining &&
    left.fingerprint === right.fingerprint,
  );
}

function completion(
  iteration: number,
  observation: ImplementationTaskObservation,
): ImplementationCompletionMilestone {
  return implementationCompletionMilestoneSchema.parse({
    iteration,
    completedAt: observation.observedAt,
    taskFingerprint: observation.fingerprint,
    counts: counts(observation),
    projectVersion: observation.projectVersion,
  });
}

function initialState(
  changeId: string,
  observation: ImplementationTaskObservation,
): ImplementationIterationTransition {
  const milestone = observation.status === 'complete' ? completion(1, observation) : undefined;
  const phase =
    observation.status === 'complete'
      ? 'completed'
      : observation.status === 'incomplete'
        ? 'initial-in-progress'
        : 'observing';
  const state = changeWorkStateSchema.parse({
    schemaVersion: 1,
    changeId,
    activeGeneration: hash([changeId, observation.observedAt, observation.fingerprint]),
    iteration: 1,
    phase,
    lastObservation: observation,
    completionMilestones: milestone ? [milestone] : [],
    reopenedEvents: [],
    updatedAt: observation.observedAt,
  });
  return { state, changed: true, ...(milestone ? { completion: milestone } : {}) };
}

function reopenedReason(
  before: ImplementationTaskCounts,
  after: ImplementationTaskCounts,
): ImplementationReopenedReason {
  if (after.total > before.total && after.completed === before.completed) return 'tasks-added';
  if (after.total === before.total && after.completed < before.completed) return 'tasks-unchecked';
  return 'task-set-changed';
}

export function transitionImplementationIteration(
  previous: ChangeWorkState | undefined,
  changeId: string,
  rawObservation: ImplementationTaskObservation,
): ImplementationIterationTransition {
  const observation = implementationTaskObservationSchema.parse(rawObservation);
  if (!previous || previous.changeId !== changeId || previous.archivedAt) {
    return initialState(changeId, observation);
  }
  const current = changeWorkStateSchema.parse(previous);
  if (sameObservation(current.lastObservation, observation)) {
    return { state: current, changed: false };
  }

  if (observation.status === 'complete') {
    const alreadyCompleted = current.completionMilestones.some(
      (entry) => entry.iteration === current.iteration,
    );
    const nextCompletion = alreadyCompleted
      ? undefined
      : completion(current.iteration, observation);
    const state = changeWorkStateSchema.parse({
      ...current,
      phase: 'completed',
      lastObservation: observation,
      completionMilestones: nextCompletion
        ? [...current.completionMilestones, nextCompletion]
        : current.completionMilestones,
      updatedAt: observation.observedAt,
    });
    return { state, changed: true, ...(nextCompletion ? { completion: nextCompletion } : {}) };
  }

  if (observation.status === 'incomplete') {
    const completed = current.completionMilestones.find(
      (entry) => entry.iteration === current.iteration,
    );
    if (current.phase === 'completed' && completed) {
      const iteration = current.iteration + 1;
      const before = completed.counts;
      const after = counts(observation);
      const eventKey = hash([
        changeId,
        current.activeGeneration,
        `${iteration}`,
        completed.taskFingerprint,
        observation.fingerprint,
        `${before.completed}/${before.total}`,
        `${after.completed}/${after.total}`,
      ]);
      const reopened = implementationReopenedEvidenceSchema.parse({
        eventKey,
        iteration,
        reopenedAt: observation.observedAt,
        reason: reopenedReason(before, after),
        before,
        after,
        delta: {
          completed: after.completed - before.completed,
          total: after.total - before.total,
        },
        fromFingerprint: completed.taskFingerprint,
        toFingerprint: observation.fingerprint,
        projectVersion: observation.projectVersion,
      });
      const state = changeWorkStateSchema.parse({
        ...current,
        iteration,
        phase: 'reopened',
        lastObservation: observation,
        reopenedEvents: [...current.reopenedEvents, reopened],
        updatedAt: observation.observedAt,
      });
      return { state, changed: true, reopened };
    }
    const phase = current.phase === 'observing' ? 'initial-in-progress' : current.phase;
    return {
      state: changeWorkStateSchema.parse({
        ...current,
        phase,
        lastObservation: observation,
        updatedAt: observation.observedAt,
      }),
      changed: true,
    };
  }

  return {
    state: changeWorkStateSchema.parse({
      ...current,
      lastObservation: observation,
      updatedAt: observation.observedAt,
    }),
    changed: true,
  };
}
