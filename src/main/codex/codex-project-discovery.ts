import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { basename, join, normalize, parse, resolve } from 'node:path';
import {
  codexProjectListSchema,
  type CodexProjectCandidate,
  type CodexProjectList,
} from '@shared/contracts';
import { validateOpenSpecProject } from '../domain/paths';

export const DEFAULT_MAX_CODEX_STATE_BYTES = 5 * 1024 * 1024;
export const DEFAULT_MAX_CODEX_CANDIDATES = 500;

interface CodexProjectEntry {
  id: string;
  name: string;
  rootPaths: string[];
  updatedAt?: number;
}

interface IndexedRoot {
  displayName: string;
  rootPath: string;
  source: CodexProjectCandidate['source'];
  lastUsedAt?: string;
}

interface ParsedProjectIndex {
  recognized: boolean;
  roots: IndexedRoot[];
  truncated: boolean;
}

export interface DiscoverCodexProjectsOptions {
  userHome: string;
  codexHome?: string;
  registeredRoots?: string[];
  maxStateBytes?: number;
  maxCandidates?: number;
  readRetries?: number;
  retryDelayMs?: number;
  platform?: NodeJS.Platform;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function limitedString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

function isoFromEpoch(value: unknown): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function resolveCodexHome(userHome: string, configuredCodexHome?: string): string {
  const configured = configuredCodexHome?.trim();
  return resolve(configured || join(userHome, '.codex'));
}

export function normalizeCodexProjectPath(
  inputPath: string,
  platform: NodeJS.Platform = process.platform,
): string {
  let value = inputPath.trim();
  if (platform === 'win32') value = value.replace(/^\\\\\?\\/, '');
  let normalized = normalize(resolve(value));
  const root = parse(normalized).root;
  while (normalized.length > root.length && /[\\/]$/.test(normalized))
    normalized = normalized.slice(0, -1);
  return normalized;
}

export function codexProjectPathKey(
  inputPath: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const normalized = normalizeCodexProjectPath(inputPath, platform);
  return platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized;
}

function parseProjectEntry(id: string, value: unknown): CodexProjectEntry | null {
  if (!isRecord(value)) return null;
  const name = limitedString(value['name'], 160) ?? id.slice(0, 160);
  const rootPaths = Array.isArray(value['rootPaths'])
    ? value['rootPaths'].flatMap((entry) => {
        const path = limitedString(entry, 4096);
        return path ? [path] : [];
      })
    : [];
  if (rootPaths.length === 0) return null;
  const updatedAt = typeof value['updatedAt'] === 'number' ? value['updatedAt'] : undefined;
  return { id, name, rootPaths, ...(updatedAt !== undefined ? { updatedAt } : {}) };
}

function parseProjectIndex(value: unknown, maxCandidates: number): ParsedProjectIndex {
  if (!isRecord(value)) return { recognized: false, roots: [], truncated: false };
  const localProjectsValue = value['local-projects'];
  const savedRootsValue = value['electron-saved-workspace-roots'];
  const recognized = isRecord(localProjectsValue) || Array.isArray(savedRootsValue);
  if (!recognized) return { recognized: false, roots: [], truncated: false };

  const localProjects = new Map<string, CodexProjectEntry>();
  if (isRecord(localProjectsValue)) {
    for (const [id, entry] of Object.entries(localProjectsValue)) {
      const parsedEntry = parseProjectEntry(id, entry);
      if (parsedEntry) localProjects.set(id, parsedEntry);
    }
  }

  const projectOrder = Array.isArray(value['project-order'])
    ? value['project-order'].filter((entry): entry is string => typeof entry === 'string')
    : [];
  const orderedIds = [
    ...projectOrder.filter(
      (id, index) => localProjects.has(id) && projectOrder.indexOf(id) === index,
    ),
    ...[...localProjects.keys()].filter((id) => !projectOrder.includes(id)),
  ];
  const roots: IndexedRoot[] = [];
  for (const id of orderedIds) {
    const project = localProjects.get(id);
    if (!project) continue;
    const lastUsedAt = isoFromEpoch(project.updatedAt);
    for (const rootPath of project.rootPaths) {
      roots.push({
        displayName: project.name,
        rootPath,
        source: 'local-project',
        ...(lastUsedAt ? { lastUsedAt } : {}),
      });
    }
  }
  if (Array.isArray(savedRootsValue)) {
    for (const entry of savedRootsValue) {
      const rootPath = limitedString(entry, 4096);
      if (rootPath)
        roots.push({
          displayName: basename(rootPath) || rootPath,
          rootPath,
          source: 'saved-workspace',
        });
    }
  }
  return {
    recognized: true,
    roots: roots.slice(0, maxCandidates),
    truncated: roots.length > maxCandidates,
  };
}

async function delay(milliseconds: number): Promise<void> {
  if (milliseconds <= 0) return;
  await new Promise<void>((finish) => setTimeout(finish, milliseconds));
}

async function readStateFile(
  filePath: string,
  maxStateBytes: number,
  retries: number,
  retryDelayMs: number,
): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const before = await fs.stat(filePath);
      if (!before.isFile()) throw new Error('Codex 项目索引不是文件');
      if (before.size > maxStateBytes) throw new Error('Codex 项目索引超出安全读取上限');
      const raw = await fs.readFile(filePath, 'utf8');
      const after = await fs.stat(filePath);
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs)
        throw new Error('Codex 项目索引正在写入');
      return JSON.parse(raw) as unknown;
    } catch (error) {
      lastError = error;
      if (attempt < retries) await delay(retryDelayMs);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Codex 项目索引无法读取');
}

function candidateId(rootPath: string, platform: NodeJS.Platform): string {
  return `codex-${createHash('sha256').update(codexProjectPathKey(rootPath, platform)).digest('hex').slice(0, 20)}`;
}

async function makeCandidate(
  indexedRoot: IndexedRoot,
  registeredKeys: Set<string>,
  platform: NodeJS.Platform,
): Promise<CodexProjectCandidate> {
  let rootPath: string;
  try {
    rootPath = normalizeCodexProjectPath(indexedRoot.rootPath, platform);
  } catch {
    const fallbackPath = indexedRoot.rootPath.slice(0, 4096);
    return {
      id: candidateId(fallbackPath, platform),
      displayName: indexedRoot.displayName,
      rootPath: fallbackPath,
      source: indexedRoot.source,
      status: 'invalid-openspec',
      reason: '项目路径不是有效的绝对路径',
      ...(indexedRoot.lastUsedAt ? { lastUsedAt: indexedRoot.lastUsedAt } : {}),
    };
  }
  const base = {
    id: candidateId(rootPath, platform),
    displayName: indexedRoot.displayName,
    rootPath,
    source: indexedRoot.source,
    ...(indexedRoot.lastUsedAt ? { lastUsedAt: indexedRoot.lastUsedAt } : {}),
  };
  if (registeredKeys.has(codexProjectPathKey(rootPath, platform))) {
    return { ...base, status: 'already-added', reason: '该项目已添加到工作区' };
  }
  const validation = await validateOpenSpecProject(rootPath);
  if (validation.valid) return { ...base, status: 'available' };
  const missing = validation.reason === '项目目录不存在或不可读';
  return {
    ...base,
    status: missing ? 'missing' : 'invalid-openspec',
    reason: validation.reason ?? '不是有效的 OpenSpec 项目',
  };
}

export async function discoverCodexProjects(
  options: DiscoverCodexProjectsOptions,
): Promise<CodexProjectList> {
  const platform = options.platform ?? process.platform;
  const codexHome = resolveCodexHome(options.userHome, options.codexHome);
  const maxStateBytes = options.maxStateBytes ?? DEFAULT_MAX_CODEX_STATE_BYTES;
  const maxCandidates = options.maxCandidates ?? DEFAULT_MAX_CODEX_CANDIDATES;
  const readRetries = options.readRetries ?? 2;
  const retryDelayMs = options.retryDelayMs ?? 25;
  const sources = [
    {
      kind: 'primary' as const,
      path: join(codexHome, '.codex-global-state.json'),
      retries: readRetries,
    },
    { kind: 'backup' as const, path: join(codexHome, '.codex-global-state.json.bak'), retries: 0 },
  ];

  let parsedIndex: ParsedProjectIndex | null = null;
  let source: 'primary' | 'backup' | 'unavailable' = 'unavailable';
  let lastError: Error | undefined;
  for (const candidateSource of sources) {
    try {
      const rawState = await readStateFile(
        candidateSource.path,
        maxStateBytes,
        candidateSource.retries,
        retryDelayMs,
      );
      const parsed = parseProjectIndex(rawState, maxCandidates);
      if (!parsed.recognized) throw new Error('Codex 项目索引缺少可识别字段');
      parsedIndex = parsed;
      source = candidateSource.kind;
      break;
    } catch (error) {
      lastError ??= error instanceof Error ? error : new Error('Codex 项目索引无法读取');
    }
  }

  if (!parsedIndex) {
    return codexProjectListSchema.parse({
      candidates: [],
      summary: {
        source: 'unavailable',
        candidateCount: 0,
        availableCount: 0,
        truncated: false,
        message: lastError?.message ?? '未找到 Codex 项目索引',
      },
      scannedAt: new Date().toISOString(),
    });
  }

  const registeredKeys = new Set(
    (options.registeredRoots ?? []).map((rootPath) => codexProjectPathKey(rootPath, platform)),
  );
  const seen = new Set<string>();
  const candidates: CodexProjectCandidate[] = [];
  for (const indexedRoot of parsedIndex.roots) {
    let key: string;
    try {
      key = codexProjectPathKey(indexedRoot.rootPath, platform);
    } catch {
      key = `invalid:${indexedRoot.rootPath}`;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(await makeCandidate(indexedRoot, registeredKeys, platform));
  }

  return codexProjectListSchema.parse({
    candidates,
    summary: {
      source,
      candidateCount: candidates.length,
      availableCount: candidates.filter((candidate) => candidate.status === 'available').length,
      truncated: parsedIndex.truncated,
      ...(source === 'backup' ? { message: '主项目索引暂不可用，已读取只读备份' } : {}),
    },
    scannedAt: new Date().toISOString(),
  });
}
