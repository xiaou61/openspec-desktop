import { describe, expect, it } from 'vitest';
import {
  artifactProjectionSchema,
  codexProjectListSchema,
  projectRecordSchema,
  versionSourceSchema,
} from './contracts';
import {
  codexImportProjectsRequestSchema,
  openExternalRequestSchema,
  revealArtifactRequestSchema,
} from './ipc-contracts';

describe('shared contracts', () => {
  it('rejects unknown fields and unsafe paths at the serialization boundary', () => {
    expect(
      projectRecordSchema.safeParse({
        id: 'project-1',
        rootPath: 'C:/Projects/demo',
        displayName: 'Demo',
        versionLabel: 'v1',
        versionMode: 'manual',
        versionSource: 'manual',
        groupId: null,
        order: 0,
        watcherEnabled: true,
        watcherState: 'watching',
        available: true,
        registeredAt: new Date().toISOString(),
        unexpected: true,
      }).success,
    ).toBe(false);
    expect(
      revealArtifactRequestSchema.safeParse({ projectId: 'project-1', sourcePath: '../secret.md' })
        .success,
    ).toBe(false);
  });

  it('accepts every version source and enforces the 120-character version boundary', () => {
    expect(versionSourceSchema.options).toEqual(['git-tag', 'package-json', 'manual', 'workspace']);
    const record = {
      id: 'project-1',
      rootPath: 'C:/Projects/demo',
      displayName: 'Demo',
      versionLabel: 'v'.repeat(120),
      versionMode: 'manual' as const,
      versionSource: 'manual' as const,
      versionResolvedAt: new Date().toISOString(),
      groupId: null,
      order: 0,
      watcherEnabled: true,
      watcherState: 'watching' as const,
      available: true,
      registeredAt: new Date().toISOString(),
    };

    expect(projectRecordSchema.safeParse(record).success).toBe(true);
    expect(
      projectRecordSchema.safeParse({ ...record, versionLabel: 'v'.repeat(121) }).success,
    ).toBe(false);
    for (const versionSource of versionSourceSchema.options) {
      expect(projectRecordSchema.safeParse({ ...record, versionSource }).success).toBe(true);
    }
  });

  it('only accepts HTTPS-compatible external URLs through the request schema', () => {
    expect(openExternalRequestSchema.safeParse({ url: 'https://example.com/docs' }).success).toBe(
      true,
    );
    expect(openExternalRequestSchema.safeParse({ url: 'javascript:alert(1)' }).success).toBe(false);
    expect(artifactProjectionSchema.safeParse({}).success).toBe(false);
  });

  it('bounds Codex candidate and import payloads at the serialization boundary', () => {
    expect(
      codexImportProjectsRequestSchema.safeParse({
        projects: [{ rootPath: 'C:/Projects/demo', displayName: 'Demo' }],
      }).success,
    ).toBe(true);
    expect(codexImportProjectsRequestSchema.safeParse({ projects: [] }).success).toBe(false);
    expect(
      codexImportProjectsRequestSchema.safeParse({
        projects: Array.from({ length: 51 }, (_, index) => ({
          rootPath: `C:/Projects/${index}`,
          displayName: `${index}`,
        })),
      }).success,
    ).toBe(false);
    expect(
      codexProjectListSchema.safeParse({
        candidates: [],
        summary: { source: 'primary', candidateCount: 0, availableCount: 0, truncated: false },
        scannedAt: new Date().toISOString(),
      }).success,
    ).toBe(true);
  });
});
