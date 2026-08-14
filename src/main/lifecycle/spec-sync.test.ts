import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ArtifactProjection, ChangeProjection } from '@shared/contracts';
import type { ProjectScanResult } from '../domain/scanner';
import { assessSpecSync, parseDeltaSpec, parseMainSpec } from './spec-sync';

function makeArtifact(
  relativePath: string,
  rawContent: string,
  options: {
    changeId?: string;
    parseHealth?: ArtifactProjection['parseHealth'];
    size?: number;
  } = {},
): ArtifactProjection {
  return {
    type: 'spec',
    relativePath,
    sourcePath: `openspec/${relativePath}`,
    title: relativePath,
    headings: [],
    tasks: [],
    taskTotals: { completed: 0, total: 0 },
    rawContent,
    contentHash: createHash('sha256').update(rawContent).digest('hex'),
    size: options.size ?? Buffer.byteLength(rawContent),
    parseHealth: options.parseHealth ?? 'ok',
    ...(options.changeId ? { changeId: options.changeId } : {}),
    archived: false,
  };
}

function assess(
  delta: string | null,
  main: string | null,
  options: {
    skipSpecs?: boolean;
    deltaHealth?: ArtifactProjection['parseHealth'];
    size?: number;
    deltaPath?: string;
  } = {},
) {
  const artifacts = delta
    ? [
        makeArtifact(options.deltaPath ?? 'changes/change-a/specs/demo/spec.md', delta, {
          changeId: 'change-a',
          ...(options.deltaHealth ? { parseHealth: options.deltaHealth } : {}),
          ...(options.size !== undefined ? { size: options.size } : {}),
        }),
      ]
    : [];
  const change: ChangeProjection = {
    id: 'change-a',
    name: 'change-a',
    archived: false,
    stage: 'implementing',
    readiness: 'incomplete',
    artifacts,
    missingArtifacts: [],
    taskTotals: { completed: 0, total: 0 },
    parseHealth: options.deltaHealth ?? 'ok',
    validation: { source: 'structural', status: 'not-run' },
  };
  const specs = main ? [makeArtifact('specs/demo/spec.md', main)] : [];
  const scan: ProjectScanResult = {
    rootPath: 'C:/Projects/demo',
    openspecPath: 'C:/Projects/demo/openspec',
    available: true,
    scannedAt: '2026-08-10T08:00:00.000Z',
    specs,
    changes: [change],
    files: [...artifacts, ...specs],
    issues: [],
  };
  return assessSpecSync({
    scan,
    change,
    checkedAt: '2026-08-10T08:00:00.000Z',
    skipSpecs: options.skipSpecs ?? false,
    maxFileBytes: 1024,
  });
}

const addedDelta = `## Purpose

Demo capability purpose is long enough to describe the behavior clearly.

## ADDED Requirements

### Requirement: Create demo
The system MUST create a demo.

#### Scenario: Success
- **WHEN** the user asks
- **THEN** a demo is created
`;

const appliedMain = `## Purpose

Demo capability purpose is long enough to describe the behavior clearly.

## Requirements

### Requirement: Create demo
The system MUST create a demo.

#### Scenario: Success
- **WHEN** the user asks
- **THEN** a demo is created
`;

describe('delta spec synchronization preview', () => {
  it('parses Purpose, operations, requirements, scenarios, and source lines from AST', () => {
    const parsed = parseDeltaSpec(addedDelta, 'changes/change-a/specs/demo/spec.md');

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.purpose).toContain('Demo capability');
    expect(parsed.value.operations[0]).toMatchObject({
      type: 'ADDED',
      requirement: 'Create demo',
      scenarios: ['Success'],
      line: 7,
    });
  });

  it('distinguishes a new capability from an already synchronized capability', () => {
    expect(assess(addedDelta, null).status).toBe('pending');
    const synced = assess(addedDelta, appliedMain);
    expect(synced.status).toBe('synced');
    expect(synced.capabilities[0]?.operationCounts.added).toBe(1);
  });

  it('compares complete MODIFIED blocks deterministically', () => {
    const modified = addedDelta
      .replace('## ADDED Requirements', '## MODIFIED Requirements')
      .replace('create a demo.', 'create an updated demo.');
    expect(assess(modified, appliedMain).status).toBe('pending');
    expect(
      assess(modified, appliedMain.replace('create a demo.', 'create an updated demo.')).status,
    ).toBe('synced');
  });

  it('keeps a partially applied capability pending', () => {
    const twoRequirements = `${addedDelta}\n### Requirement: Share demo\nThe system MUST share a demo.\n\n#### Scenario: Shared\n- **WHEN** sharing is requested\n- **THEN** the demo is shared\n`;
    const result = assess(twoRequirements, appliedMain);

    expect(result.status).toBe('pending');
    expect(result.capabilities[0]?.requirements).toEqual(['Create demo', 'Share demo']);
  });

  it('handles REMOVED and RENAMED state combinations', () => {
    const removed = `## REMOVED Requirements

### Requirement: Create demo
**Reason**: Replaced
**Migration**: Use another requirement
`;
    expect(assess(removed, appliedMain).status).toBe('pending');
    expect(assess(removed, '## Purpose\n\nNo matching requirement.').status).toBe('synced');

    const renamed = `## RENAMED Requirements

### FROM: Create demo
### TO: Create example
`;
    expect(assess(renamed, appliedMain).status).toBe('pending');
    expect(assess(renamed, appliedMain.replace('Create demo', 'Create example')).status).toBe(
      'synced',
    );
    expect(assess(renamed, `${appliedMain}\n### Requirement: Create example\nText`).status).toBe(
      'unknown',
    );
  });

  it('returns not-applicable for explicit skip_specs and unknown for unsafe inputs', () => {
    expect(assess(null, null, { skipSpecs: true }).status).toBe('not-applicable');
    expect(assess(null, null).status).toBe('unknown');
    expect(assess(addedDelta, null, { deltaHealth: 'unreadable' }).status).toBe('unknown');
    expect(assess(addedDelta, null, { size: 2048 }).status).toBe('unknown');
  });

  it('keeps missing main specs and illegal target paths as locatable unknown evidence', () => {
    const modified = addedDelta.replace('## ADDED Requirements', '## MODIFIED Requirements');
    const missingMain = assess(modified, null);
    expect(missingMain.status).toBe('unknown');
    expect(missingMain.capabilities[0]?.conflicts).toContain(
      'MODIFIED Requirement “Create demo” 在主规格中不存在',
    );

    const invalidPath = assess(addedDelta, null, {
      deltaPath: 'changes/change-a/specs/../escape/spec.md',
    });
    expect(invalidPath.status).toBe('unknown');
    expect(invalidPath.capabilities[0]?.parseIssues).toEqual([
      expect.objectContaining({
        code: 'invalid-target-path',
        sourcePath: 'openspec/invalid-spec.md',
      }),
    ]);
  });

  it('emits stable evidence for all operation types, Chinese names, and nested capabilities', () => {
    const delta = `## ADDED Requirements

### Requirement: 新增目录
The system MUST add a catalog.

#### Scenario: 新增成功
- **WHEN** requested
- **THEN** the catalog is added

## MODIFIED Requirements

### Requirement: 更新目录
The system MUST update a catalog.

#### Scenario: 更新成功
- **WHEN** requested
- **THEN** the catalog is updated

## REMOVED Requirements

### Requirement: 删除目录
**Reason**: obsolete

## RENAMED Requirements

### FROM: 旧目录
### TO: 新目录
`;
    const artifact = makeArtifact('changes/change-a/specs/platform/catalog/spec.md', delta, {
      changeId: 'change-a',
    });
    const change: ChangeProjection = {
      id: 'change-a',
      name: 'change-a',
      archived: false,
      stage: 'implementing',
      readiness: 'incomplete',
      artifacts: [artifact],
      missingArtifacts: [],
      taskTotals: { completed: 0, total: 0 },
      parseHealth: 'ok',
      validation: { source: 'structural', status: 'not-run' },
    };
    const scan: ProjectScanResult = {
      rootPath: 'C:/Projects/demo',
      openspecPath: 'C:/Projects/demo/openspec',
      available: true,
      scannedAt: '2026-08-10T08:00:00.000Z',
      specs: [],
      changes: [change],
      files: [artifact],
      issues: [],
    };

    const result = assessSpecSync({
      scan,
      change,
      checkedAt: scan.scannedAt,
      skipSpecs: false,
    });
    const operations = result.capabilities[0]?.operations ?? [];

    expect(operations.map((operation) => operation.operationType)).toEqual([
      'ADDED',
      'MODIFIED',
      'REMOVED',
      'RENAMED',
    ]);
    expect(operations[0]).toMatchObject({
      capabilityPath: 'platform/catalog',
      sourcePath: 'openspec/changes/change-a/specs/platform/catalog/spec.md',
      targetPath: 'openspec/specs/platform/catalog/spec.md',
      requirementName: '新增目录',
      scenarios: ['新增成功'],
      line: 3,
    });
    expect(operations[3]).toMatchObject({
      requirementName: '旧目录 -> 新目录',
      renameFrom: '旧目录',
      renameTo: '新目录',
    });
    for (const operation of operations) {
      expect(operation.targetKey).toMatch(/^sdo1:[a-f0-9]{64}$/);
      expect(operation.contentFingerprint).toMatch(/^[a-f0-9]{64}$/);
      expect(operation.normalizedBlock.length).toBeGreaterThan(0);
    }
  });

  it('keeps target and content identity stable across CRLF and pure line movement', () => {
    const first = parseDeltaSpec(addedDelta, 'openspec/changes/change-a/specs/demo/spec.md');
    const moved = parseDeltaSpec(
      `\n\n${addedDelta.replaceAll('\n', '\r\n')}`,
      'openspec/changes/change-a/specs/demo/spec.md',
    );
    expect(first.ok && moved.ok).toBe(true);
    if (!first.ok || !moved.ok) return;

    expect(moved.value.operations[0]?.targetKey).toBe(first.value.operations[0]?.targetKey);
    expect(moved.value.operations[0]?.contentFingerprint).toBe(
      first.value.operations[0]?.contentFingerprint,
    );
    expect(moved.value.operations[0]?.line).not.toBe(first.value.operations[0]?.line);

    const changed = parseDeltaSpec(
      addedDelta.replace('create a demo.', 'create a different demo.'),
      'openspec/changes/change-a/specs/demo/spec.md',
    );
    expect(changed.ok).toBe(true);
    if (!changed.ok) return;
    expect(changed.value.operations[0]?.targetKey).toBe(first.value.operations[0]?.targetKey);
    expect(changed.value.operations[0]?.contentFingerprint).not.toBe(
      first.value.operations[0]?.contentFingerprint,
    );
  });

  it.each([
    [
      'duplicate Requirement identity',
      `${addedDelta}\n${addedDelta.replace('## Purpose\n\nDemo capability purpose is long enough to describe the behavior clearly.\n\n', '')}`,
      'Requirement “Create demo” 在 ADDED 中重复',
    ],
    [
      'ambiguous rename',
      '## RENAMED Requirements\n\n### FROM: Old A\n### FROM: Old B\n### TO: New\n',
      'RENAMED 操作无法唯一映射 FROM/TO',
    ],
    [
      'missing operation boundary',
      '### Requirement: Orphan\nThe system MUST not be detached.\n',
      'Requirement 标题缺少 operation 边界',
    ],
  ])('returns locatable parse evidence for %s', (_name, raw, message) => {
    const result = parseDeltaSpec(raw, 'openspec/changes/change-a/specs/demo/spec.md');
    expect(result).toMatchObject({
      ok: false,
      issue: expect.objectContaining({
        message,
        sourcePath: expect.any(String),
        line: expect.any(Number),
      }),
    });
  });
});

describe('main spec requirement parsing', () => {
  it('parses Requirement blocks and keeps identity stable across CRLF and trailing heading whitespace', () => {
    const trailingSpaces = '   ';
    const raw = `## Purpose

Main purpose.

## Requirements

### Requirement:  目录列表${trailingSpaces}
The system MUST list catalog entries.

#### Scenario: 列表成功
- **WHEN** catalog entries are requested
- **THEN** the entries are listed
`;
    const crlf = raw.replaceAll('\n', '\r\n');
    const moved = `\n\n${raw.replaceAll('\n', '\r\n')}`;

    const first = parseMainSpec(raw);
    const second = parseMainSpec(crlf);
    const third = parseMainSpec(moved);
    const requirement = first.requirements.get('目录列表');
    const crlfRequirement = second.requirements.get('目录列表');
    const movedRequirement = third.requirements.get('目录列表');

    expect(requirement?.name).toBe('目录列表');
    expect(requirement?.scenarios).toEqual(['列表成功']);
    expect(crlfRequirement?.normalizedBlock).toBe(requirement?.normalizedBlock);
    expect(movedRequirement?.normalizedBlock).toBe(requirement?.normalizedBlock);
    expect(movedRequirement?.line).not.toBe(requirement?.line);
  });

  it('rejects duplicate Requirement names with a locatable diagnostic', () => {
    const raw = `## Requirements

### Requirement: 重复需求
The system MUST keep the first statement.

### Requirement: 重复需求
The system MUST keep the second statement.
`;
    expect(() => parseMainSpec(raw)).toThrow('不唯一');
  });
});
