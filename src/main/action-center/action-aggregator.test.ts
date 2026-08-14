import { describe, expect, it } from 'vitest';
import type {
  ActionCenterItem,
  ChangeLifecycleAssessment,
  ChangeProjection,
  ProjectRecord,
} from '@shared/contracts';
import { evaluateLifecycle } from '../lifecycle/evaluator';
import { aggregateActionCenterItems, deriveChangeAction } from './action-aggregator';

const checkedAt = '2026-08-10T08:00:00.000Z';

function project(id: string): ProjectRecord {
  return {
    id,
    rootPath: `C:/Projects/${id}`,
    displayName: id,
    versionLabel: '',
    versionMode: 'automatic',
    versionSource: 'workspace',
    groupId: null,
    order: 0,
    watcherEnabled: true,
    watcherState: 'watching',
    available: true,
    registeredAt: checkedAt,
  };
}

function change(id: string, archived = false): ChangeProjection {
  return {
    id,
    name: id,
    archived,
    stage: archived ? 'archived' : 'implementing',
    readiness: 'ready',
    artifacts: [],
    missingArtifacts: [],
    taskTotals: { completed: 0, total: 0 },
    parseHealth: 'ok',
    validation: { source: 'structural', status: 'not-run' },
  };
}

function assessment(changeId: string, completed: number, total: number): ChangeLifecycleAssessment {
  return evaluateLifecycle({
    projectId: 'project-1',
    changeId,
    archived: false,
    projectAvailable: true,
    contentFingerprint: 'a'.repeat(64),
    evaluatedAt: checkedAt,
    artifactGraph: {
      schemaName: 'spec-driven',
      source: 'openspec-cli',
      authoritative: true,
      applyRequires: ['tasks'],
      artifacts: [{ id: 'tasks', status: 'done', requires: [] }],
    },
    taskGate: {
      applicable: true,
      status: completed === total ? 'complete' : 'incomplete',
      completed,
      total,
      remaining: total - completed,
    },
    validation: { status: 'not-run', source: 'validation-cache', diagnostics: [] },
    sync: {
      status: 'not-applicable',
      source: 'local-comparison',
      checkedAt,
      capabilities: [],
      summary: { capabilityCount: 0, pendingCount: 0, syncedCount: 0, unknownCount: 0 },
    },
  });
}

describe('action aggregation', () => {
  it('derives at most one primary action per Change and filters ordinary archives', () => {
    const active = change('change-a');
    const item = deriveChangeAction({
      project: project('project-1'),
      change: active,
      assessment: assessment('change-a', 57, 64),
      checkedAt,
    });
    expect(item).toMatchObject({
      actionType: 'continue-implementation',
      priority: 2,
      taskGate: { completed: 57, total: 64, remaining: 7 },
    });
    expect(
      deriveChangeAction({
        project: project('project-1'),
        change: change('archived-a', true),
        checkedAt,
      }),
    ).toBeNull();
  });

  it('sorts health, artifacts, implementation, validation, archive and integrity stably', () => {
    const base = {
      evidenceFingerprint: 'b'.repeat(64),
      projectName: 'Demo',
      projectRoot: 'C:/Projects/demo',
      archived: false,
      title: 'Action',
      description: 'Description',
      targetNode: 'proposal' as const,
      evidence: [],
    };
    const priorities = [5, 4, 2, 0, 3, 1];
    const items = priorities.map(
      (priority, index) =>
        ({
          ...base,
          actionKey: `ac1:${String(index).padStart(64, 'a')}`,
          projectId: `project-${index}`,
          changeId: `change-${index}`,
          actionType: [
            'archive-integrity',
            'archive',
            'continue-implementation',
            'project-health',
            'run-validation',
            'complete-artifact',
          ][index],
          priority,
        }) as ActionCenterItem,
    );
    expect(aggregateActionCenterItems(items).map((item) => item.priority)).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);
  });
});
