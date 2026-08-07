import { parseDocument } from 'yaml';
import type {
  ArtifactProjection,
  ChangeProjection,
  ParseHealth,
  WorkflowStage,
} from '@shared/contracts';

const metadataStatus = new Set<WorkflowStage>([
  'draft',
  'specified',
  'designed',
  'planned',
  'implementing',
  'verifying',
  'completed',
]);

export interface OpenSpecMetadata {
  schema?: string;
  version?: string;
  status?: WorkflowStage;
  [key: string]: unknown;
}

export type MetadataParseResult =
  { ok: true; value: OpenSpecMetadata } | { ok: false; error: string };

export function parseOpenSpecMetadata(rawContent: string): MetadataParseResult {
  try {
    const document = parseDocument(rawContent, {
      schema: 'core',
      version: '1.2',
      prettyErrors: true,
    });
    if (document.errors.length > 0) {
      return { ok: false, error: document.errors.map((error) => error.message).join('; ') };
    }
    const value: unknown = document.toJS({ mapAsMap: false });
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, error: 'OpenSpec 元数据必须是对象' };
    }
    const metadata: OpenSpecMetadata = {};
    for (const [key, entry] of Object.entries(value)) {
      if (typeof key !== 'string' || key.length > 120) continue;
      metadata[key] = entry;
    }
    if (typeof metadata.schema !== 'undefined' && typeof metadata.schema !== 'string') {
      return { ok: false, error: 'schema 必须是字符串' };
    }
    if (typeof metadata.version !== 'undefined' && typeof metadata.version !== 'string') {
      return { ok: false, error: 'version 必须是字符串' };
    }
    if (typeof metadata.status !== 'undefined') {
      if (
        typeof metadata.status !== 'string' ||
        !metadataStatus.has(metadata.status as WorkflowStage)
      ) {
        delete metadata.status;
      }
    }
    return { ok: true, value: metadata };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'YAML 解析失败' };
  }
}

function hasType(artifacts: ArtifactProjection[], type: ArtifactProjection['type']): boolean {
  return artifacts.some((artifact) => artifact.type === type);
}

function aggregateParseHealth(artifacts: ArtifactProjection[]): ParseHealth {
  if (artifacts.some((artifact) => artifact.parseHealth === 'error')) return 'error';
  if (artifacts.some((artifact) => artifact.parseHealth === 'unreadable')) return 'unreadable';
  return 'ok';
}

function deriveStage(
  artifacts: ArtifactProjection[],
  archived: boolean,
  metadata?: OpenSpecMetadata,
): WorkflowStage {
  if (archived) return 'archived';
  if (metadata?.status && metadataStatus.has(metadata.status)) return metadata.status;
  const tasksArtifact = artifacts.find((artifact) => artifact.type === 'tasks');
  if (
    tasksArtifact &&
    tasksArtifact.taskTotals.total > 0 &&
    tasksArtifact.taskTotals.completed === tasksArtifact.taskTotals.total
  ) {
    return 'completed';
  }
  if (tasksArtifact) return 'implementing';
  if (hasType(artifacts, 'design')) return 'planned';
  if (hasType(artifacts, 'spec')) return 'designed';
  if (hasType(artifacts, 'proposal')) return 'specified';
  return 'draft';
}

export function deriveChangeProjection(
  changeId: string,
  artifacts: ArtifactProjection[],
  options: { archived?: boolean; metadata?: OpenSpecMetadata } = {},
): ChangeProjection {
  const archived = options.archived ?? artifacts.some((artifact) => artifact.archived);
  const missingArtifacts: ChangeProjection['missingArtifacts'] = [];
  if (!hasType(artifacts, 'proposal')) missingArtifacts.push('proposal');
  if (!hasType(artifacts, 'spec')) missingArtifacts.push('spec');
  if (!hasType(artifacts, 'design')) missingArtifacts.push('design');
  if (!hasType(artifacts, 'tasks')) missingArtifacts.push('tasks');

  const parseHealth = aggregateParseHealth(artifacts);
  const readiness =
    parseHealth !== 'ok' ? 'parse-error' : missingArtifacts.length === 0 ? 'ready' : 'incomplete';
  const lastActivityAt = artifacts
    .map((artifact) => artifact.lastModifiedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
  const tasksArtifact = artifacts.find((artifact) => artifact.type === 'tasks');
  const taskTotals =
    tasksArtifact?.taskTotals ??
    artifacts.reduce(
      (totals, artifact) => ({
        completed: totals.completed + artifact.taskTotals.completed,
        total: totals.total + artifact.taskTotals.total,
      }),
      { completed: 0, total: 0 },
    );

  const result: ChangeProjection = {
    id: changeId,
    name: changeId,
    archived,
    stage: deriveStage(artifacts, archived, options.metadata),
    readiness,
    artifacts: [...artifacts].sort((left, right) =>
      left.relativePath.localeCompare(right.relativePath, 'en'),
    ),
    missingArtifacts,
    taskTotals,
    parseHealth,
    validation: { source: 'structural', status: 'not-run' },
  };
  if (lastActivityAt) result.lastActivityAt = lastActivityAt;
  return result;
}
