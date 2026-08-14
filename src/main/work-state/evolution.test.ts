import { describe, expect, it } from 'vitest';
import type { ArtifactProjection, ChangeProjection } from '@shared/contracts';
import type { ProjectScanResult } from '../domain/scanner';
import { assessChangeEvolution } from './evolution';

const assessedAt = '2026-08-10T08:00:00.000Z';

function spec(relativePath: string, changeId?: string): ArtifactProjection {
  return {
    type: 'spec',
    relativePath,
    sourcePath: `openspec/${relativePath}`,
    title: relativePath,
    headings: [],
    tasks: [],
    taskTotals: { completed: 0, total: 0 },
    rawContent: '# Spec',
    contentHash: 'a'.repeat(64),
    parseHealth: 'ok',
    ...(changeId ? { changeId } : {}),
    archived: false,
  };
}

function fixture(deltaPaths: string[], mainPaths: string[]) {
  const artifacts = deltaPaths.map((path) => spec(path, 'change-a'));
  const change: ChangeProjection = {
    id: 'change-a',
    name: 'change-a',
    archived: false,
    stage: 'implementing',
    readiness: 'ready',
    artifacts,
    missingArtifacts: [],
    taskTotals: { completed: 0, total: 0 },
    parseHealth: 'ok',
    validation: { source: 'structural', status: 'not-run' },
  };
  const specs = mainPaths.map((path) => spec(path));
  const scan: ProjectScanResult = {
    rootPath: 'C:/demo',
    openspecPath: 'C:/demo/openspec',
    available: true,
    scannedAt: assessedAt,
    specs,
    changes: [change],
    files: [...artifacts, ...specs],
    issues: [],
  };
  return { scan, change };
}

describe('assessChangeEvolution', () => {
  it.each([
    [['changes/change-a/specs/new-cap/spec.md'], [], 'new'],
    [['changes/change-a/specs/existing/spec.md'], ['specs/existing/spec.md'], 'iteration'],
    [
      ['changes/change-a/specs/existing/spec.md', 'changes/change-a/specs/new-cap/spec.md'],
      ['specs/existing/spec.md'],
      'mixed',
    ],
  ] as const)('classifies capability paths as %s', (deltaPaths, mainPaths, status) => {
    const current = fixture([...deltaPaths], [...mainPaths]);
    expect(assessChangeEvolution({ ...current, assessedAt }).status).toBe(status);
  });

  it('returns unknown when capability paths cannot be established', () => {
    const current = fixture(['changes/change-a/specs/../escape/spec.md'], []);
    expect(assessChangeEvolution({ ...current, assessedAt }).status).toBe('unknown');
  });
});
