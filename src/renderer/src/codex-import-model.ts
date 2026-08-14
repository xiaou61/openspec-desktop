import type {
  CodexDiscoveryEntry,
  CodexWorkspace,
  CodexWorkspaceReference,
} from '@shared/contracts';

export interface CodexImportLeaf {
  id: string;
  key: string;
  displayName: string;
  rootPath: string;
  workspace?: CodexWorkspaceReference;
}

export interface CodexDiscoveryCounts {
  workspaceCount: number;
  repositoryCount: number;
  openSpecProjectCount: number;
  availableCount: number;
}

export type WorkspaceSelectionState = 'disabled' | 'none' | 'mixed' | 'all';

export function codexRootKey(rootPath: string): string {
  const withoutPrefix = rootPath.trim().replace(/^\\\\\?\\/, '');
  const normalized = withoutPrefix.replaceAll('\\', '/').replace(/\/+$/, '');
  return normalized.toLocaleLowerCase('en-US');
}

export function collectAvailableCodexLeaves(
  entries: CodexDiscoveryEntry[],
  completedRoots: Iterable<string> = [],
): CodexImportLeaf[] {
  const completed = new Set([...completedRoots].map(codexRootKey));
  const leaves: CodexImportLeaf[] = [];
  for (const entry of entries) {
    if (entry.kind === 'direct-project') {
      const key = codexRootKey(entry.rootPath);
      if (entry.status === 'available' && !completed.has(key)) {
        leaves.push({
          id: entry.id,
          key,
          displayName: entry.displayName,
          rootPath: entry.rootPath,
        });
      }
      continue;
    }
    const workspace: CodexWorkspaceReference = {
      id: entry.id,
      rootPath: entry.rootPath,
      displayName: entry.displayName,
    };
    for (const member of entry.members) {
      const key = codexRootKey(member.rootPath);
      if (
        member.kind === 'openspec-project' &&
        member.status === 'available' &&
        !completed.has(key)
      ) {
        leaves.push({
          id: member.id,
          key,
          displayName: member.displayName,
          rootPath: member.rootPath,
          workspace,
        });
      }
    }
  }
  return leaves;
}

export function deriveCodexDiscoveryCounts(entries: CodexDiscoveryEntry[]): CodexDiscoveryCounts {
  const workspaces = entries.filter((entry): entry is CodexWorkspace => entry.kind === 'workspace');
  const directProjects = entries.filter(
    (entry) =>
      entry.kind === 'direct-project' &&
      (entry.status === 'available' || entry.status === 'already-added'),
  );
  return {
    workspaceCount: workspaces.length,
    repositoryCount:
      directProjects.length +
      workspaces.reduce((count, workspace) => count + workspace.repositoryCount, 0),
    openSpecProjectCount:
      directProjects.length +
      workspaces.reduce((count, workspace) => count + workspace.openSpecProjectCount, 0),
    availableCount:
      directProjects.filter(
        (entry) => entry.kind === 'direct-project' && entry.status === 'available',
      ).length + workspaces.reduce((count, workspace) => count + workspace.availableCount, 0),
  };
}

export function reconcileCodexSelection(
  selectedKeys: Iterable<string>,
  availableLeaves: CodexImportLeaf[],
): Set<string> {
  const available = new Set(availableLeaves.map((leaf) => leaf.key));
  return new Set([...selectedKeys].map(codexRootKey).filter((key) => available.has(key)));
}

export function workspaceSelectionState(
  workspaceId: string,
  availableLeaves: CodexImportLeaf[],
  selectedKeys: ReadonlySet<string>,
): WorkspaceSelectionState {
  const keys = availableLeaves
    .filter((leaf) => leaf.workspace?.id === workspaceId)
    .map((leaf) => leaf.key);
  if (keys.length === 0) return 'disabled';
  const selectedCount = keys.filter((key) => selectedKeys.has(key)).length;
  if (selectedCount === 0) return 'none';
  return selectedCount === keys.length ? 'all' : 'mixed';
}

export function toggleWorkspaceSelection(
  workspaceId: string,
  checked: boolean,
  availableLeaves: CodexImportLeaf[],
  selectedKeys: ReadonlySet<string>,
): Set<string> {
  const next = new Set(selectedKeys);
  for (const leaf of availableLeaves) {
    if (leaf.workspace?.id !== workspaceId) continue;
    if (checked) next.add(leaf.key);
    else next.delete(leaf.key);
  }
  return next;
}
