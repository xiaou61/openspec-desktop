import { describe, expect, it } from 'vitest';
import type { ArtifactProjection } from '@shared/contracts';
import { deriveChangeProjection, parseOpenSpecMetadata } from './openspec-adapter';

function artifact(
  type: ArtifactProjection['type'],
  taskTotals = { completed: 0, total: 0 },
): ArtifactProjection {
  return {
    type,
    relativePath: `changes/demo/${type}.md`,
    sourcePath: `openspec/changes/demo/${type}.md`,
    title: type,
    headings: [],
    tasks: [],
    taskTotals,
    rawContent: '# content',
    contentHash: 'a'.repeat(64),
    size: 10,
    lastModifiedAt: '2026-08-07T00:00:00.000Z',
    parseHealth: 'ok',
    archived: false,
    changeId: 'demo',
  };
}

describe('OpenSpec adapter', () => {
  it('parses safe metadata and derives readiness separately from CLI validation', () => {
    const metadata = parseOpenSpecMetadata(
      'schema: spec-driven\nversion: "1"\nstatus: implementing\n',
    );
    expect(metadata).toEqual({
      ok: true,
      value: { schema: 'spec-driven', version: '1', status: 'implementing' },
    });

    const adapterOptions = metadata.ok ? { metadata: metadata.value } : {};
    const projection = deriveChangeProjection(
      'demo',
      [
        artifact('proposal'),
        artifact('spec'),
        artifact('design'),
        artifact('tasks', { completed: 1, total: 2 }),
      ],
      adapterOptions,
    );
    expect(projection.readiness).toBe('ready');
    expect(projection.stage).toBe('implementing');
    expect(projection.validation).toEqual({ source: 'structural', status: 'not-run' });
  });

  it('marks malformed metadata without throwing', () => {
    const result = parseOpenSpecMetadata('schema: [unterminated');
    expect(result.ok).toBe(false);
  });
});
