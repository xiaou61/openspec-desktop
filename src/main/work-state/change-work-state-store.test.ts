import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ChangeWorkState, ImplementationTaskObservation } from '@shared/contracts';
import { HistoryStore } from '../history/history-store';
import { ChangeWorkStateStore } from './change-work-state-store';
import { transitionImplementationIteration } from './iteration';

function observation(
  status: ImplementationTaskObservation['status'],
  completed: number,
  total: number,
  fingerprint: string,
  observedAt: string,
): ImplementationTaskObservation {
  return {
    status,
    completed,
    total,
    remaining: total - completed,
    fingerprint,
    observedAt,
    projectVersion: { label: 'v1', source: 'manual', capturedAt: observedAt },
  };
}

function state(
  status: ImplementationTaskObservation['status'] = 'incomplete',
  completed = 1,
  total = 2,
  fingerprint = 'a'.repeat(64),
  observedAt = '2026-08-10T08:00:00.000Z',
): ChangeWorkState {
  return transitionImplementationIteration(
    undefined,
    'change-a',
    observation(status, completed, total, fingerprint, observedAt),
  ).state;
}

describe('ChangeWorkStateStore', () => {
  it('creates a versioned project index and restores it after restart', async () => {
    const userData = await fs.mkdtemp(join(tmpdir(), 'change-work-state-'));
    const store = new ChangeWorkStateStore(userData);
    await store.initProject('project-1');
    expect(store.snapshot('project-1')).toMatchObject({
      schemaVersion: 1,
      projectId: 'project-1',
      active: {},
      archived: {},
    });
    await store.updateActive('project-1', state());
    await store.flush();

    const restored = new ChangeWorkStateStore(userData);
    await restored.initProject('project-1');
    expect(restored.snapshot('project-1').active['change-a']).toEqual(state());
    expect(await fs.stat(restored.pathFor('project-1'))).toMatchObject({
      size: expect.any(Number),
    });
  });

  it('serializes concurrent updates in invocation order and skips idempotent writes', async () => {
    const userData = await fs.mkdtemp(join(tmpdir(), 'change-work-state-'));
    const store = new ChangeWorkStateStore(userData);
    await store.initProject('project-1');
    const first = state();
    const second = state('complete', 2, 2, 'b'.repeat(64), '2026-08-10T09:00:00.000Z');

    await Promise.all([
      store.updateActive('project-1', first),
      store.updateActive('project-1', second),
    ]);
    expect(store.snapshot('project-1').active['change-a']).toEqual(second);
    expect(await store.updateActive('project-1', second)).toBe(false);
  });

  it('freezes an active generation under its archived identity', async () => {
    const userData = await fs.mkdtemp(join(tmpdir(), 'change-work-state-'));
    const store = new ChangeWorkStateStore(userData);
    await store.initProject('project-1');
    await store.updateActive('project-1', state('complete', 2, 2));

    const frozen = await store.freezeActive(
      'project-1',
      'change-a',
      '2026-08-10-change-a',
      '2026-08-10T10:00:00.000Z',
    );

    expect(frozen).toMatchObject({
      changeId: '2026-08-10-change-a',
      archivedAt: expect.any(String),
    });
    expect(store.snapshot('project-1').active).not.toHaveProperty('change-a');
    expect(store.snapshot('project-1').archived).toHaveProperty('2026-08-10-change-a');
  });

  it('backs up corrupt state and recovers conservatively with an unavailable diagnostic', async () => {
    const userData = await fs.mkdtemp(join(tmpdir(), 'change-work-state-'));
    const store = new ChangeWorkStateStore(userData);
    await store.initProject('project-1');
    await fs.writeFile(store.pathFor('project-1'), '{not json', 'utf8');

    const recovered = new ChangeWorkStateStore(userData);
    await recovered.initProject('project-1');
    expect(recovered.snapshot('project-1')).toMatchObject({
      active: {},
      archived: {},
      diagnostic: { status: 'unavailable' },
    });
    const files = await fs.readdir(join(userData, 'change-work-state', 'project-1'));
    expect(files.some((file) => /^index\.corrupt-.*\.json$/.test(file))).toBe(true);
  });

  it('is independent from ordinary history pruning and supports explicit clearing', async () => {
    const userData = await fs.mkdtemp(join(tmpdir(), 'change-work-state-'));
    const store = new ChangeWorkStateStore(userData);
    await store.initProject('project-1');
    await store.updateActive('project-1', state());
    const history = new HistoryStore(userData, 'project-1');
    await history.init();
    await history.setRetention({ revisionsPerArtifact: 1, activityPerProject: 1 });
    await history.clearHistory();

    expect(store.snapshot('project-1').active).toHaveProperty('change-a');
    await store.clearProject('project-1');
    expect(store.snapshot('project-1')).toMatchObject({ active: {}, archived: {} });
  });
});
