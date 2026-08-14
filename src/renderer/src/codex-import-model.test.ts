import { describe, expect, it } from 'vitest';
import type { CodexDiscoveryEntry } from '@shared/contracts';
import {
  collectAvailableCodexLeaves,
  deriveCodexDiscoveryCounts,
  reconcileCodexSelection,
  toggleWorkspaceSelection,
  workspaceSelectionState,
} from './codex-import-model';

function entries(): CodexDiscoveryEntry[] {
  return [
    {
      kind: 'direct-project',
      id: 'direct-1',
      displayName: 'Direct',
      rootPath: 'C:/Direct/',
      source: 'local-project',
      status: 'available',
    },
    {
      kind: 'workspace',
      id: 'workspace-1',
      displayName: 'Workspace',
      rootPath: 'C:/Workspace',
      source: 'saved-workspace',
      members: [
        {
          kind: 'openspec-project',
          id: 'project-1',
          displayName: 'One',
          rootPath: 'C:/Workspace/One',
          status: 'available',
        },
        {
          kind: 'openspec-project',
          id: 'project-2',
          displayName: 'Two',
          rootPath: 'C:/Workspace/Two',
          status: 'already-added',
          reason: '已添加',
        },
        {
          kind: 'repository',
          id: 'repo-1',
          displayName: 'Three',
          rootPath: 'C:/Workspace/Three',
          status: 'not-configured',
          reason: '尚未配置 OpenSpec',
        },
      ],
      diagnostics: [],
      truncated: false,
      truncationReasons: [],
      repositoryCount: 3,
      openSpecProjectCount: 2,
      availableCount: 1,
    },
    {
      kind: 'workspace',
      id: 'workspace-empty',
      displayName: 'Empty',
      rootPath: 'C:/Empty',
      source: 'saved-workspace',
      members: [],
      diagnostics: [],
      truncated: false,
      truncationReasons: [],
      repositoryCount: 0,
      openSpecProjectCount: 0,
      availableCount: 0,
    },
  ];
}

describe('Codex import model', () => {
  it('derives available leaves and every discovery count without selecting containers', () => {
    const discovered = entries();
    expect(collectAvailableCodexLeaves(discovered)).toMatchObject([
      { id: 'direct-1', key: 'c:/direct' },
      { id: 'project-1', key: 'c:/workspace/one', workspace: { id: 'workspace-1' } },
    ]);
    expect(deriveCodexDiscoveryCounts(discovered)).toEqual({
      workspaceCount: 2,
      repositoryCount: 4,
      openSpecProjectCount: 3,
      availableCount: 2,
    });
    expect(collectAvailableCodexLeaves(discovered, ['c:\\WORKSPACE\\one'])).toHaveLength(1);
  });

  it('derives parent tri-state selection and toggles only available workspace leaves', () => {
    const leaves = collectAvailableCodexLeaves(entries());
    const directOnly = new Set([leaves[0]!.key]);
    expect(workspaceSelectionState('workspace-empty', leaves, directOnly)).toBe('disabled');
    expect(workspaceSelectionState('workspace-1', leaves, directOnly)).toBe('none');
    const selected = toggleWorkspaceSelection('workspace-1', true, leaves, directOnly);
    expect(workspaceSelectionState('workspace-1', leaves, selected)).toBe('all');
    expect(selected.has(leaves[0]!.key)).toBe(true);
    const cleared = toggleWorkspaceSelection('workspace-1', false, leaves, selected);
    expect(workspaceSelectionState('workspace-1', leaves, cleared)).toBe('none');
  });

  it('reconciles refresh selection by normalized project path identity', () => {
    const leaves = collectAvailableCodexLeaves(entries());
    const selected = new Set(['C:\\DIRECT\\', 'C:/Workspace/removed']);
    expect([...reconcileCodexSelection(selected, leaves)]).toEqual(['c:/direct']);
  });
});
