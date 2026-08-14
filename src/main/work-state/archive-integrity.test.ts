import { describe, expect, it } from 'vitest';
import type { ChangeProjection } from '@shared/contracts';
import { createArchiveContentFingerprint, transitionArchiveIntegrity } from './archive-integrity';

const at = '2026-08-10T08:00:00.000Z';

function archivedChange(hash: string): ChangeProjection {
  return {
    id: '2026-08-10-change-a',
    name: '2026-08-10-change-a',
    archived: true,
    stage: 'archived',
    readiness: 'ready',
    artifacts: [
      {
        type: 'proposal',
        relativePath: 'changes/archive/2026-08-10-change-a/proposal.md',
        sourcePath: 'openspec/changes/archive/2026-08-10-change-a/proposal.md',
        title: 'Proposal',
        headings: [],
        tasks: [],
        taskTotals: { completed: 0, total: 0 },
        contentHash: hash.repeat(64).slice(0, 64),
        parseHealth: 'ok',
        changeId: '2026-08-10-change-a',
        archived: true,
      },
    ],
    missingArtifacts: ['spec', 'design', 'tasks'],
    taskTotals: { completed: 0, total: 0 },
    parseHealth: 'ok',
    validation: { source: 'structural', status: 'not-run' },
  };
}

describe('archive integrity', () => {
  it('uses a stable aggregate fingerprint and reports changed/restored incidents', () => {
    const baselineFingerprint = createArchiveContentFingerprint(archivedChange('a'));
    expect(createArchiveContentFingerprint(archivedChange('a'))).toBe(baselineFingerprint);

    const baseline = transitionArchiveIntegrity(undefined, {
      fingerprint: baselineFingerprint,
      observedAt: at,
    });
    expect(baseline.state).toMatchObject({ status: 'baseline', incident: 0 });
    expect(baseline.changed).toBeUndefined();

    const changedFingerprint = createArchiveContentFingerprint(archivedChange('b'));
    const changed = transitionArchiveIntegrity(baseline.state, {
      fingerprint: changedFingerprint,
      observedAt: '2026-08-10T09:00:00.000Z',
    });
    expect(changed.state).toMatchObject({ status: 'changed', incident: 1 });
    expect(changed.changed?.eventKey).toHaveLength(64);

    const duplicate = transitionArchiveIntegrity(changed.state, {
      fingerprint: changedFingerprint,
      observedAt: '2026-08-10T09:05:00.000Z',
    });
    expect(duplicate.changed).toBeUndefined();
    expect(duplicate.state).toEqual(changed.state);

    const restored = transitionArchiveIntegrity(changed.state, {
      fingerprint: baselineFingerprint,
      observedAt: '2026-08-10T10:00:00.000Z',
    });
    expect(restored.state.status).toBe('restored');

    const changedAgain = transitionArchiveIntegrity(restored.state, {
      fingerprint: changedFingerprint,
      observedAt: '2026-08-10T11:00:00.000Z',
    });
    expect(changedAgain.state.incident).toBe(2);
    expect(changedAgain.changed?.eventKey).not.toBe(changed.changed?.eventKey);
  });
});
