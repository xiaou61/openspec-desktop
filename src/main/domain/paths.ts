import { promises as fs } from 'node:fs';
import { basename, dirname, extname, join, normalize, relative, resolve, sep } from 'node:path';
import type { ArtifactType } from '@shared/contracts';

export const DEFAULT_MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;

export interface ClassifiedOpenSpecPath {
  relativePath: string;
  sourcePath: string;
  type: ArtifactType;
  changeId?: string;
  archived: boolean;
}

export interface DiscoveredOpenSpecFile extends ClassifiedOpenSpecPath {
  absolutePath: string;
  size: number;
  modifiedAt: Date;
  tooLarge: boolean;
}

const temporaryNamePattern =
  /(^|[/\\])(?:~\$|\.?#|\.~lock|\.#)|(?:~|\.swp|\.swo|\.tmp|\.part|\.bak)$/i;

export function normalizeProjectRoot(projectRoot: string): string {
  return resolve(projectRoot);
}

export function normalizeSlash(value: string): string {
  return value.replaceAll('\\', '/');
}

export function isPathWithin(rootPath: string, candidatePath: string): boolean {
  const root = resolve(rootPath);
  const candidate = resolve(candidatePath);
  const rel = relative(root, candidate);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !rel.startsWith(sep));
}

export function isTemporaryOpenSpecPath(relativePath: string): boolean {
  const normalized = normalizeSlash(relativePath);
  if (normalized === '.openspec.yaml' || normalized.endsWith('/.openspec.yaml')) return false;
  return (
    normalized
      .split('/')
      .some((segment) => segment.startsWith('.') && segment !== '.openspec.yaml') ||
    temporaryNamePattern.test(normalized)
  );
}

function safeRelativePath(relativePath: string): string | null {
  if (!relativePath || relativePath.includes('\\')) return null;
  const slashPath = normalizeSlash(relativePath);
  if (slashPath.startsWith('/') || slashPath.includes('\0')) return null;
  const normalized = normalize(slashPath).replaceAll(sep, '/');
  if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../'))
    return null;
  return normalized;
}

function markdownPath(value: string): boolean {
  return extname(value).toLowerCase() === '.md';
}

/** Classifies paths relative to the registered project's `openspec/` directory. */
export function classifyOpenSpecPath(inputPath: string): ClassifiedOpenSpecPath | null {
  const relativePath = safeRelativePath(inputPath);
  if (!relativePath || isTemporaryOpenSpecPath(relativePath)) return null;

  const segments = relativePath.split('/');
  const lowerSegments = segments.map((segment) => segment.toLowerCase());
  if (lowerSegments.length === 1 && lowerSegments[0] === 'config.yaml') {
    return {
      relativePath,
      sourcePath: `openspec/${relativePath}`,
      type: 'config',
      archived: false,
    };
  }

  if (lowerSegments[0] === 'specs' && lowerSegments.length >= 2 && markdownPath(relativePath)) {
    return { relativePath, sourcePath: `openspec/${relativePath}`, type: 'spec', archived: false };
  }

  if (lowerSegments[0] !== 'changes' || lowerSegments.length < 3) return null;
  const archived = lowerSegments[1] === 'archive';
  const changeIndex = archived ? 2 : 1;
  const changeId = segments[changeIndex];
  if (!changeId || changeId.startsWith('.')) return null;
  const artifactSegments = segments.slice(changeIndex + 1);
  const artifactPath = artifactSegments.join('/').toLowerCase();

  if (artifactPath === '.openspec.yaml') {
    return {
      relativePath,
      sourcePath: `openspec/${relativePath}`,
      type: 'metadata',
      changeId,
      archived,
    };
  }
  if (!markdownPath(relativePath)) return null;
  let type: ArtifactType | null = null;
  if (artifactPath === 'proposal.md') type = 'proposal';
  else if (artifactPath === 'design.md') type = 'design';
  else if (artifactPath === 'tasks.md') type = 'tasks';
  else if (artifactPath.startsWith('specs/') && artifactPath.endsWith('.md')) type = 'spec';
  if (!type) return null;
  return { relativePath, sourcePath: `openspec/${relativePath}`, type, changeId, archived };
}

async function isReadableDirectory(path: string): Promise<boolean> {
  try {
    const stats = await fs.lstat(path);
    return stats.isDirectory() && !stats.isSymbolicLink();
  } catch {
    return false;
  }
}

export interface OpenSpecProjectValidation {
  valid: boolean;
  rootPath: string;
  openspecPath: string;
  reason?: string;
}

export async function validateOpenSpecProject(
  projectRoot: string,
): Promise<OpenSpecProjectValidation> {
  const rootPath = normalizeProjectRoot(projectRoot);
  const openspecPath = join(rootPath, 'openspec');
  if (!(await isReadableDirectory(rootPath))) {
    return { valid: false, rootPath, openspecPath, reason: '项目目录不存在或不可读' };
  }
  if (!(await isReadableDirectory(openspecPath))) {
    return { valid: false, rootPath, openspecPath, reason: '缺少可读的 openspec 目录' };
  }

  try {
    const entries = await fs.readdir(openspecPath, { withFileTypes: true });
    const hasRecognizedRoot = entries.some((entry) => {
      const name = entry.name.toLowerCase();
      return name === 'config.yaml' || name === 'specs' || name === 'changes';
    });
    return hasRecognizedRoot
      ? { valid: true, rootPath, openspecPath }
      : { valid: false, rootPath, openspecPath, reason: '未发现 config.yaml、specs/ 或 changes/' };
  } catch {
    return { valid: false, rootPath, openspecPath, reason: 'openspec 目录不可读' };
  }
}

export interface DiscoverOptions {
  maxFileBytes?: number;
  maxDepth?: number;
}

export async function discoverOpenSpecFiles(
  projectRoot: string,
  options: DiscoverOptions = {},
): Promise<DiscoveredOpenSpecFile[]> {
  const rootPath = normalizeProjectRoot(projectRoot);
  const openspecPath = join(rootPath, 'openspec');
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_ARTIFACT_BYTES;
  const maxDepth = options.maxDepth ?? 32;
  const discovered: DiscoveredOpenSpecFile[] = [];

  async function walk(directory: string, relativeDirectory: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of entries) {
      const childRelative = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      if (isTemporaryOpenSpecPath(childRelative)) continue;
      const childAbsolute = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await walk(childAbsolute, childRelative, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const classified = classifyOpenSpecPath(childRelative);
      if (!classified || !isPathWithin(openspecPath, childAbsolute)) continue;
      try {
        const stats = await fs.stat(childAbsolute);
        discovered.push({
          ...classified,
          absolutePath: childAbsolute,
          size: stats.size,
          modifiedAt: stats.mtime,
          tooLarge: stats.size > maxFileBytes,
        });
      } catch {
        // A file can disappear between readdir and stat; reconciliation will see it later.
      }
    }
  }

  if (await isReadableDirectory(openspecPath)) await walk(openspecPath, '', 0);
  return discovered.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath, 'en'),
  );
}

export function resolveRegisteredArtifactPath(projectRoot: string, sourcePath: string): string {
  const rootPath = normalizeProjectRoot(projectRoot);
  const openspecPath = join(rootPath, 'openspec');
  const normalized = normalizeSlash(sourcePath).replace(/^openspec\//i, '');
  if (!isPathWithin(openspecPath, join(openspecPath, normalized))) {
    throw new Error('Artifact path escapes the registered OpenSpec root');
  }
  const classified = classifyOpenSpecPath(normalized);
  if (!classified) throw new Error('Artifact path is not a supported OpenSpec file');
  return join(openspecPath, normalized);
}

export function projectRootFromArtifactPath(artifactPath: string): string {
  return dirname(dirname(resolve(artifactPath)));
}

export function artifactFileName(path: string): string {
  return basename(path);
}
