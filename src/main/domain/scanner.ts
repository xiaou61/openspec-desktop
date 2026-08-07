import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type {
  ArtifactProjection,
  ChangeProjection,
  ParseHealth,
  TaskTotals,
} from '@shared/contracts';
import {
  DEFAULT_MAX_ARTIFACT_BYTES,
  discoverOpenSpecFiles,
  normalizeProjectRoot,
  validateOpenSpecProject,
  type DiscoveredOpenSpecFile,
} from './paths';
import { parseMarkdown } from './markdown';
import {
  deriveChangeProjection,
  parseOpenSpecMetadata,
  type OpenSpecMetadata,
} from './openspec-adapter';

export interface ScanIssue {
  relativePath?: string;
  message: string;
  kind: 'unavailable' | 'unreadable' | 'parse-error' | 'oversize';
}

export interface ProjectScanResult {
  rootPath: string;
  openspecPath: string;
  available: boolean;
  scannedAt: string;
  config?: ArtifactProjection;
  specs: ArtifactProjection[];
  changes: ChangeProjection[];
  files: ArtifactProjection[];
  issues: ScanIssue[];
}

const emptyTotals: TaskTotals = { completed: 0, total: 0 };

function hashContent(rawContent: string): string {
  return createHash('sha256').update(rawContent, 'utf8').digest('hex');
}

function baseArtifact(file: DiscoveredOpenSpecFile): ArtifactProjection {
  const base: ArtifactProjection = {
    type: file.type,
    relativePath: file.relativePath,
    sourcePath: file.sourcePath,
    title: file.relativePath,
    headings: [],
    tasks: [],
    taskTotals: emptyTotals,
    size: file.size,
    lastModifiedAt: file.modifiedAt.toISOString(),
    parseHealth: 'ok',
    archived: file.archived,
  };
  if (file.changeId) base.changeId = file.changeId;
  return base;
}

function failedArtifact(
  file: DiscoveredOpenSpecFile,
  health: ParseHealth,
  message: string,
  rawContent?: string,
): ArtifactProjection {
  const result = baseArtifact(file);
  result.parseHealth = health;
  result.error = message;
  if (rawContent !== undefined) {
    result.rawContent = rawContent;
    result.contentHash = hashContent(rawContent);
  }
  return result;
}

async function parseFile(
  file: DiscoveredOpenSpecFile,
): Promise<{ artifact: ArtifactProjection; issue?: ScanIssue }> {
  if (file.tooLarge) {
    return {
      artifact: failedArtifact(
        file,
        'unreadable',
        `文件超过 ${DEFAULT_MAX_ARTIFACT_BYTES} 字节限制`,
      ),
      issue: { relativePath: file.relativePath, message: '文件超过大小限制', kind: 'oversize' },
    };
  }

  let rawContent: string;
  try {
    rawContent = await fs.readFile(file.absolutePath, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : '文件读取失败';
    return {
      artifact: failedArtifact(file, 'unreadable', message),
      issue: { relativePath: file.relativePath, message, kind: 'unreadable' },
    };
  }

  const result = baseArtifact(file);
  result.rawContent = rawContent;
  result.contentHash = hashContent(rawContent);
  if (file.type === 'config' || file.type === 'metadata') {
    const parsed = parseOpenSpecMetadata(rawContent);
    result.title = file.type === 'config' ? 'OpenSpec 配置' : 'Change 元数据';
    if (!parsed.ok) {
      result.parseHealth = 'error';
      result.error = parsed.error;
      return {
        artifact: result,
        issue: { relativePath: file.relativePath, message: parsed.error, kind: 'parse-error' },
      };
    }
    return { artifact: result };
  }

  const parsed = parseMarkdown(rawContent);
  if (!parsed.ok) {
    result.parseHealth = 'error';
    result.error = parsed.error;
    return {
      artifact: result,
      issue: { relativePath: file.relativePath, message: parsed.error, kind: 'parse-error' },
    };
  }
  result.title = parsed.value.title || file.relativePath;
  result.headings = parsed.value.headings;
  result.tasks = parsed.value.tasks;
  result.taskTotals = parsed.value.taskTotals;
  return { artifact: result };
}

function changeKey(file: ArtifactProjection): string {
  return `${file.archived ? 'archive/' : ''}${file.changeId ?? ''}`;
}

export async function scanOpenSpecProject(
  projectRoot: string,
  options: { maxFileBytes?: number; maxDepth?: number } = {},
): Promise<ProjectScanResult> {
  const rootPath = normalizeProjectRoot(projectRoot);
  const validation = await validateOpenSpecProject(rootPath);
  const scannedAt = new Date().toISOString();
  if (!validation.valid) {
    return {
      rootPath,
      openspecPath: validation.openspecPath,
      available: false,
      scannedAt,
      specs: [],
      changes: [],
      files: [],
      issues: [{ message: validation.reason ?? '项目不可用', kind: 'unavailable' }],
    };
  }

  const discoverOptions: { maxFileBytes: number; maxDepth?: number } = {
    maxFileBytes: options.maxFileBytes ?? DEFAULT_MAX_ARTIFACT_BYTES,
  };
  if (options.maxDepth !== undefined) discoverOptions.maxDepth = options.maxDepth;
  const files = await discoverOpenSpecFiles(rootPath, discoverOptions);
  const parsedFiles: ArtifactProjection[] = [];
  const issues: ScanIssue[] = [];
  for (const file of files) {
    const parsed = await parseFile(file);
    parsedFiles.push(parsed.artifact);
    if (parsed.issue) issues.push(parsed.issue);
  }

  const changeFiles = new Map<string, ArtifactProjection[]>();
  const specs: ArtifactProjection[] = [];
  let config: ArtifactProjection | undefined;
  for (const artifact of parsedFiles) {
    if (artifact.type === 'config') {
      config = artifact;
    } else if (artifact.changeId) {
      const key = changeKey(artifact);
      const current = changeFiles.get(key) ?? [];
      current.push(artifact);
      changeFiles.set(key, current);
    } else if (artifact.type === 'spec') {
      specs.push(artifact);
    }
  }

  const metadataByChange = new Map<string, OpenSpecMetadata>();
  for (const [key, artifacts] of changeFiles) {
    const metadataArtifact = artifacts.find((artifact) => artifact.type === 'metadata');
    if (metadataArtifact?.rawContent && metadataArtifact.parseHealth === 'ok') {
      const parsed = parseOpenSpecMetadata(metadataArtifact.rawContent);
      if (parsed.ok) metadataByChange.set(key, parsed.value);
    }
  }

  const changes: ChangeProjection[] = [];
  for (const [key, artifacts] of changeFiles) {
    const first = artifacts.find((artifact) => artifact.changeId);
    if (!first?.changeId) continue;
    const adapterOptions: { archived: boolean; metadata?: OpenSpecMetadata } = {
      archived: first.archived,
    };
    const metadata = metadataByChange.get(key);
    if (metadata) adapterOptions.metadata = metadata;
    changes.push(deriveChangeProjection(first.changeId, artifacts, adapterOptions));
  }
  changes.sort((left, right) => {
    if (left.archived !== right.archived) return left.archived ? 1 : -1;
    return left.name.localeCompare(right.name, 'en');
  });
  specs.sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'en'));
  parsedFiles.sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'en'));

  return {
    rootPath,
    openspecPath: validation.openspecPath,
    available: true,
    scannedAt,
    ...(config ? { config } : {}),
    specs,
    changes,
    files: parsedFiles,
    issues,
  };
}

export const scanProject = scanOpenSpecProject;

export function totalTasks(artifacts: ArtifactProjection[]): TaskTotals {
  return artifacts.reduce(
    (totals, artifact) => ({
      completed: totals.completed + artifact.taskTotals.completed,
      total: totals.total + artifact.taskTotals.total,
    }),
    { ...emptyTotals },
  );
}

export function projectHasParseErrors(result: ProjectScanResult): boolean {
  return result.issues.some((issue) => issue.kind === 'parse-error' || issue.kind === 'unreadable');
}

export function artifactAbsolutePath(
  result: ProjectScanResult,
  artifact: ArtifactProjection,
): string {
  return join(result.rootPath, artifact.sourcePath.replace(/^openspec[\\/]/, 'openspec/'));
}
