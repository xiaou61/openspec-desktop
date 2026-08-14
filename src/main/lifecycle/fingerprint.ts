import { createHash } from 'node:crypto';
import type {
  ArtifactProjection,
  ChangeProjection,
} from '@shared/contracts';
import type { ProjectScanResult } from '../domain/scanner';

function artifactFingerprint(artifact: ArtifactProjection | undefined): string {
  if (!artifact) return 'missing';
  return artifact.contentHash ?? `${artifact.parseHealth}:${artifact.size ?? 0}`;
}

export function mainSpecPathForDelta(
  relativePath: string,
  changeId: string,
  archived: boolean,
): string | null {
  const normalized = relativePath.replaceAll('\\', '/');
  const prefix = archived ? `changes/archive/${changeId}/specs/` : `changes/${changeId}/specs/`;
  if (!normalized.startsWith(prefix)) return null;
  const remainder = normalized.slice(prefix.length);
  const segments = remainder.split('/');
  if (
    segments.length < 2 ||
    segments.at(-1)?.toLowerCase() !== 'spec.md' ||
    segments.some((segment) => !segment || segment === '.' || segment === '..')
  )
    return null;
  return `specs/${remainder}`;
}

export function createLifecycleFingerprint(
  scan: ProjectScanResult,
  change: ChangeProjection,
): string {
  const entries: string[] = [
    `identity:${change.archived ? 'archive' : 'active'}:${change.id}`,
    `available:${scan.available}`,
    `config:${artifactFingerprint(scan.config)}`,
  ];
  const targetPaths = new Set<string>();
  for (const artifact of change.artifacts) {
    entries.push(`change:${artifact.relativePath}:${artifactFingerprint(artifact)}`);
    if (artifact.type === 'spec') {
      const target = mainSpecPathForDelta(artifact.relativePath, change.id, change.archived);
      if (target) targetPaths.add(target);
    }
  }
  const specs = new Map(
    scan.specs.map((artifact) => [artifact.relativePath.replaceAll('\\', '/'), artifact]),
  );
  for (const targetPath of [...targetPaths].sort((left, right) =>
    left.localeCompare(right, 'en'),
  )) {
    entries.push(`main:${targetPath}:${artifactFingerprint(specs.get(targetPath))}`);
  }
  entries.sort((left, right) => left.localeCompare(right, 'en'));
  return createHash('sha256').update(entries.join('\n'), 'utf8').digest('hex');
}
