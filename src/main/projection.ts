import {
  projectSnapshotSchema,
  type CatalogState,
  type ProjectRecord,
  type ProjectSnapshot,
} from '@shared/contracts';
import type { ProjectScanResult } from './domain/scanner';

export function toProjectSnapshot(
  project: ProjectRecord,
  catalog: Pick<CatalogState, 'groups'>,
  scan: ProjectScanResult | null,
): ProjectSnapshot {
  const scannedAt = scan?.scannedAt ?? project.lastScannedAt ?? new Date().toISOString();
  return projectSnapshotSchema.parse({
    project: structuredClone(project),
    groups: structuredClone(catalog.groups),
    changes: scan?.changes ?? [],
    specs: scan?.specs ?? [],
    scannedAt,
  });
}
