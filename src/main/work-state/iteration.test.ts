import { describe, expect, it } from 'vitest';
import type { ChangeWorkState, ImplementationTaskObservation } from '@shared/contracts';
import { transitionImplementationIteration } from './iteration';

const at = '2026-08-10T08:00:00.000Z';

function observation(
  status: ImplementationTaskObservation['status'],
  completed: number,
  total: number,
  fingerprint = 'a'.repeat(64),
  observedAt = at,
): ImplementationTaskObservation {
  return {
    status,
    completed,
    total,
    remaining: total - completed,
    fingerprint,
    observedAt,
    projectVersion: { label: 'v2.4.0', source: 'git-tag', capturedAt: observedAt },
  };
}

describe('transitionImplementationIteration', () => {
  it('establishes conservative first-observation baselines', () => {
    const incomplete = transitionImplementationIteration(
      undefined,
      'change-a',
      observation('incomplete', 57, 64),
    );
    expect(incomplete.state).toMatchObject({ iteration: 1, phase: 'initial-in-progress' });
    expect(incomplete.reopened).toBeUndefined();
    expect(incomplete.state.completionMilestones).toEqual([]);

    const complete = transitionImplementationIteration(
      undefined,
      'change-b',
      observation('complete', 57, 57),
    );
    expect(complete.state).toMatchObject({ iteration: 1, phase: 'completed' });
    expect(complete.state.completionMilestones).toHaveLength(1);
  });

  it('reopens 57/57 as iteration 2 when 57/64 is observed and remains idempotent', () => {
    const completed = transitionImplementationIteration(
      undefined,
      'change-a',
      observation('complete', 57, 57),
    ).state;
    const reopened = transitionImplementationIteration(
      completed,
      'change-a',
      observation('incomplete', 57, 64, 'b'.repeat(64), '2026-08-10T09:00:00.000Z'),
    );

    expect(reopened.state).toMatchObject({ iteration: 2, phase: 'reopened' });
    expect(reopened.reopened).toMatchObject({
      iteration: 2,
      reason: 'tasks-added',
      before: { completed: 57, total: 57, remaining: 0 },
      after: { completed: 57, total: 64, remaining: 7 },
      delta: { completed: 0, total: 7 },
    });

    const duplicate = transitionImplementationIteration(
      reopened.state,
      'change-a',
      observation('incomplete', 57, 64, 'b'.repeat(64), '2026-08-10T09:05:00.000Z'),
    );
    expect(duplicate.changed).toBe(false);
    expect(duplicate.reopened).toBeUndefined();
    expect(duplicate.state).toEqual(reopened.state);
  });

  it.each([
    [56, 57, 'tasks-unchecked'],
    [56, 64, 'task-set-changed'],
  ] as const)(
    'classifies a completed 57/57 transition to %i/57+ as %s',
    (completed, total, reason) => {
      const previous = transitionImplementationIteration(
        undefined,
        'change-a',
        observation('complete', 57, 57),
      ).state;
      const result = transitionImplementationIteration(
        previous,
        'change-a',
        observation('incomplete', completed, total, 'c'.repeat(64)),
      );
      expect(result.reopened?.reason).toBe(reason);
    },
  );

  it('supports completion and another later reopen without duplicating formatting-only scans', () => {
    const first = transitionImplementationIteration(
      undefined,
      'change-a',
      observation('complete', 2, 2),
    ).state;
    const formatted = transitionImplementationIteration(
      first,
      'change-a',
      observation('complete', 2, 2, 'd'.repeat(64)),
    );
    expect(formatted.reopened).toBeUndefined();
    expect(formatted.state.iteration).toBe(1);

    const second = transitionImplementationIteration(
      formatted.state,
      'change-a',
      observation('incomplete', 2, 3, 'e'.repeat(64)),
    ).state;
    const secondComplete = transitionImplementationIteration(
      second,
      'change-a',
      observation('complete', 3, 3, 'f'.repeat(64)),
    ).state;
    const third = transitionImplementationIteration(
      secondComplete,
      'change-a',
      observation('incomplete', 2, 3, '0'.repeat(64)),
    );

    expect(secondComplete.completionMilestones.map((entry) => entry.iteration)).toEqual([1, 2]);
    expect(third.state.iteration).toBe(3);
    expect(third.reopened?.eventKey).not.toBe(second.reopenedEvents.at(-1)?.eventKey);
  });

  it('does not create milestones or iterations for empty and unknown observations', () => {
    const completed = transitionImplementationIteration(
      undefined,
      'change-a',
      observation('complete', 2, 2),
    ).state;
    const empty = transitionImplementationIteration(
      completed,
      'change-a',
      observation('empty', 0, 0, '1'.repeat(64)),
    ).state;
    const unknown = transitionImplementationIteration(
      empty,
      'change-a',
      observation('unknown', 0, 0, '2'.repeat(64)),
    ).state;

    expect(unknown.iteration).toBe(1);
    expect(unknown.phase).toBe('completed');
    expect(unknown.completionMilestones).toHaveLength(1);
  });

  it('starts a fresh active generation after an archived state', () => {
    const completed = transitionImplementationIteration(
      undefined,
      'change-a',
      observation('complete', 2, 2),
    ).state;
    const archived: ChangeWorkState = {
      ...completed,
      archivedAt: '2026-08-10T10:00:00.000Z',
      updatedAt: '2026-08-10T10:00:00.000Z',
    };
    const next = transitionImplementationIteration(
      archived,
      'change-a',
      observation('incomplete', 1, 2, '3'.repeat(64), '2026-08-11T08:00:00.000Z'),
    );

    expect(next.state).toMatchObject({ iteration: 1, phase: 'initial-in-progress' });
    expect(next.state.activeGeneration).not.toBe(archived.activeGeneration);
    expect(next.reopened).toBeUndefined();
  });
});
