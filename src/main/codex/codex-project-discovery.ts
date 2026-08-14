import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { basename, join, normalize, parse, relative, resolve } from 'node:path';
import {
  codexDiscoveryDiagnosticSchema,
  codexProjectListSchema,
  type CodexDirectProject,
  type CodexDiscoveryDiagnostic,
  type CodexDiscoveryEntry,
  type CodexDiscoverySource,
  type CodexOpenSpecWorkspaceMember,
  type CodexProjectList,
  type CodexUnconfiguredRepository,
  type CodexWorkspace,
  type CodexWorkspaceMember,
} from '@shared/contracts';
import { validateOpenSpecProject } from '../domain/paths';

export const DEFAULT_MAX_CODEX_STATE_BYTES = 5 * 1024 * 1024;
export const DEFAULT_MAX_CODEX_CANDIDATES = 500;
export const DEFAULT_MAX_WORKSPACE_DEPTH = 2;
export const DEFAULT_MAX_WORKSPACE_DIRECTORIES = 2_000;
export const DEFAULT_MAX_WORKSPACE_MEMBERS = 200;
export const DEFAULT_MAX_WORKSPACE_CONCURRENCY = 4;
export const DEFAULT_WORKSPACE_TIME_BUDGET_MS = 1_000;

const DEFAULT_EXCLUDED_DIRECTORY_NAMES = [
  '.git',
  'node_modules',
  '.next',
  'dist',
  'build',
  'target',
  'coverage',
  '.cache',
  '.venv',
  'vendor',
  '.idea',
  '.vscode',
];

const SUPPORTED_MANIFEST_NAMES = new Set([
  'package.json',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'pyproject.toml',
  'cargo.toml',
  'go.mod',
]);

interface CodexProjectEntry {
  id: string;
  name: string;
  rootPaths: string[];
  updatedAt?: number;
}

interface IndexedRoot {
  displayName: string;
  rootPath: string;
  source: CodexDiscoverySource;
  lastUsedAt?: string;
  index: number;
}

interface ParsedProjectIndex {
  recognized: boolean;
  roots: IndexedRoot[];
  indexedRootCount: number;
  truncated: boolean;
  truncationReasons: Array<'max-candidates'>;
}

export interface WorkspaceDiscoveryOptions {
  maxDepth?: number;
  maxDirectories?: number;
  maxMembers?: number;
  maxConcurrency?: number;
  timeBudgetMs?: number;
  excludeDirectories?: string[];
  registeredRoots?: string[];
}

export interface DiscoverCodexProjectsOptions extends WorkspaceDiscoveryOptions {
  userHome: string;
  codexHome?: string;
  maxStateBytes?: number;
  maxCandidates?: number;
  readRetries?: number;
  retryDelayMs?: number;
  platform?: NodeJS.Platform;
}

export interface WorkspaceDiscoveryResult {
  members: CodexWorkspaceMember[];
  diagnostics: CodexDiscoveryDiagnostic[];
  truncated: boolean;
  truncationReasons: Array<
    'max-depth' | 'max-directories' | 'max-members' | 'time-budget' | 'max-candidates'
  >;
}

interface EffectiveWorkspaceLimits {
  maxDepth: number;
  maxDirectories: number;
  maxMembers: number;
  maxConcurrency: number;
  timeBudgetMs: number;
  excludeDirectories: Set<string>;
}

interface DirectoryEntry {
  name: string;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

interface QueuedDirectory {
  path: string;
  depth: number;
  entries: DirectoryEntry[];
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
  if (!isRecord(value))
    return {
      recognized: false,
      roots: [],
      indexedRootCount: 0,
      truncated: false,
      truncationReasons: [],
    };
  const localProjectsValue = value['local-projects'];
  const savedRootsValue = value['electron-saved-workspace-roots'];
  const recognized = isRecord(localProjectsValue) || Array.isArray(savedRootsValue);
  if (!recognized)
    return {
      recognized: false,
      roots: [],
      indexedRootCount: 0,
      truncated: false,
      truncationReasons: [],
    };

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
        index: roots.length,
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
          index: roots.length,
        });
    }
  }
  const limit = Math.max(1, Math.min(maxCandidates, 500));
  const truncated = roots.length > limit;
  return {
    recognized: true,
    roots: roots.slice(0, limit),
    indexedRootCount: Math.min(roots.length, 500),
    truncated,
    truncationReasons: truncated ? ['max-candidates'] : [],
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

function candidateId(rootPath: string, prefix = 'codex'): string {
  return `${prefix}-${createHash('sha256').update(rootPath).digest('hex').slice(0, 20)}`;
}

function effectiveLimits(options: WorkspaceDiscoveryOptions): EffectiveWorkspaceLimits {
  return {
    maxDepth: Math.max(0, Math.min(options.maxDepth ?? DEFAULT_MAX_WORKSPACE_DEPTH, 8)),
    maxDirectories: Math.max(
      1,
      Math.min(options.maxDirectories ?? DEFAULT_MAX_WORKSPACE_DIRECTORIES, 10_000),
    ),
    maxMembers: Math.max(1, Math.min(options.maxMembers ?? DEFAULT_MAX_WORKSPACE_MEMBERS, 500)),
    maxConcurrency: Math.max(
      1,
      Math.min(options.maxConcurrency ?? DEFAULT_MAX_WORKSPACE_CONCURRENCY, 16),
    ),
    timeBudgetMs: Math.max(
      1,
      Math.min(options.timeBudgetMs ?? DEFAULT_WORKSPACE_TIME_BUDGET_MS, 30_000),
    ),
    excludeDirectories: new Set(
      (options.excludeDirectories ?? DEFAULT_EXCLUDED_DIRECTORY_NAMES).map((name) =>
        name.toLowerCase(),
      ),
    ),
  };
}

function memberPathKey(path: string): string {
  return codexProjectPathKey(path);
}

export async function canonicalizeCodexProjectPath(inputPath: string): Promise<string> {
  const normalized = normalizeCodexProjectPath(inputPath);
  try {
    return normalizeCodexProjectPath(await fs.realpath(normalized));
  } catch {
    return normalized;
  }
}

function isPathWithin(parent: string, child: string): boolean {
  const parentKey = memberPathKey(parent);
  const childKey = memberPathKey(child);
  if (parentKey === childKey) return true;
  const relativePath = relative(parent, child);
  return relativePath.length > 0 && !relativePath.startsWith('..') && !/^[\\/]/.test(relativePath);
}

function pathDistance(parent: string, child: string): number | null {
  if (!isPathWithin(parent, child)) return null;
  const relativePath = relative(parent, child);
  if (!relativePath) return 0;
  return relativePath.split(/[\\/]/).filter(Boolean).length;
}

function diagnosticCode(error: unknown): 'unreadable' | 'disappeared' | 'scan-error' {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  return code === 'ENOENT' || code === 'ENOTDIR' ? 'disappeared' : 'unreadable';
}

function addReason(
  reasons: WorkspaceDiscoveryResult['truncationReasons'],
  reason: WorkspaceDiscoveryResult['truncationReasons'][number],
): void {
  if (!reasons.includes(reason)) reasons.push(reason);
}

function isRepositoryMarker(entries: DirectoryEntry[]): boolean {
  return entries.some((entry) => {
    const lowerName = entry.name.toLowerCase();
    if (lowerName === '.git') return true;
    if (SUPPORTED_MANIFEST_NAMES.has(lowerName)) return true;
    return entry.isFile() && lowerName.endsWith('.sln');
  });
}

async function registeredKeySet(registeredRoots: string[]): Promise<Set<string>> {
  const canonicalRoots = await Promise.all(
    registeredRoots.map((rootPath) => canonicalizeCodexProjectPath(rootPath)),
  );
  return new Set(canonicalRoots.map((rootPath) => memberPathKey(rootPath)));
}

async function readDirectoryEntries(path: string): Promise<DirectoryEntry[]> {
  const entries = await fs.readdir(path, { withFileTypes: true });
  return [...entries].sort((left, right) => left.name.localeCompare(right.name, 'en'));
}

async function discoverWorkspaceMembersWithRegisteredKeys(
  rootPathInput: string,
  options: WorkspaceDiscoveryOptions,
  registeredKeys: ReadonlySet<string>,
): Promise<WorkspaceDiscoveryResult> {
  const limits = effectiveLimits(options);
  const rootPath = await canonicalizeCodexProjectPath(rootPathInput);
  const deadline = Date.now() + limits.timeBudgetMs;
  const members: CodexWorkspaceMember[] = [];
  const diagnostics: CodexDiscoveryDiagnostic[] = [];
  const truncationReasons: WorkspaceDiscoveryResult['truncationReasons'] = [];
  const queued: QueuedDirectory[] = [];
  let directoriesChecked = 0;

  const isBudgetAvailable = (): boolean => {
    if (Date.now() >= deadline) {
      addReason(truncationReasons, 'time-budget');
      return false;
    }
    if (members.length >= limits.maxMembers) {
      addReason(truncationReasons, 'max-members');
      return false;
    }
    return true;
  };

  const inspectDirectory = async (path: string): Promise<DirectoryEntry[] | null> => {
    if (!isBudgetAvailable()) return null;
    if (directoriesChecked >= limits.maxDirectories) {
      addReason(truncationReasons, 'max-directories');
      return null;
    }
    directoriesChecked += 1;
    try {
      return await readDirectoryEntries(path);
    } catch (error) {
      diagnostics.push(
        codexDiscoveryDiagnosticSchema.parse({
          code: diagnosticCode(error),
          path,
          message: error instanceof Error ? error.message.slice(0, 500) : '目录不可读取',
        }),
      );
      return null;
    }
  };

  const rootEntries = await inspectDirectory(rootPath);
  if (!rootEntries) {
    return { members, diagnostics, truncated: true, truncationReasons };
  }
  queued.push({ path: rootPath, depth: 0, entries: rootEntries });

  while (queued.length > 0 && isBudgetAvailable()) {
    const currentBatch = queued.splice(0, limits.maxConcurrency);
    for (const directory of currentBatch) {
      if (!isBudgetAvailable()) break;
      const children = directory.entries.filter((entry) => {
        if (entry.isSymbolicLink()) return false;
        return entry.isDirectory() && !limits.excludeDirectories.has(entry.name.toLowerCase());
      });

      for (let offset = 0; offset < children.length; offset += limits.maxConcurrency) {
        const batch = children.slice(offset, offset + limits.maxConcurrency);
        const results = await Promise.all(
          batch.map(async (entry) => {
            const rawChildPath = join(directory.path, entry.name);
            if (entry.isSymbolicLink()) return null;
            let childPath: string;
            try {
              const rawStat = await fs.lstat(rawChildPath);
              if (rawStat.isSymbolicLink() || !rawStat.isDirectory()) return null;
              childPath = await canonicalizeCodexProjectPath(rawChildPath);
            } catch (error) {
              diagnostics.push(
                codexDiscoveryDiagnosticSchema.parse({
                  code: diagnosticCode(error),
                  path: rawChildPath,
                  message: error instanceof Error ? error.message.slice(0, 500) : '成员扫描失败',
                }),
              );
              return null;
            }
            if (!isBudgetAvailable()) return null;
            try {
              const validation = await validateOpenSpecProject(childPath);
              if (validation.valid) {
                return {
                  kind: 'openspec-project' as const,
                  id: candidateId(memberPathKey(childPath)),
                  displayName: basename(childPath) || childPath,
                  rootPath: childPath,
                  status: registeredKeys.has(memberPathKey(childPath))
                    ? ('already-added' as const)
                    : ('available' as const),
                  ...(registeredKeys.has(memberPathKey(childPath))
                    ? { reason: '该项目已添加到工作区' }
                    : {}),
                } satisfies CodexOpenSpecWorkspaceMember;
              }
              const entries = await inspectDirectory(childPath);
              if (!entries) return null;
              if (isRepositoryMarker(entries)) {
                return {
                  kind: 'repository' as const,
                  id: candidateId(memberPathKey(childPath)),
                  displayName: basename(childPath) || childPath,
                  rootPath: childPath,
                  status: 'not-configured' as const,
                  reason: '尚未配置 OpenSpec',
                } satisfies CodexUnconfiguredRepository;
              }
              if (directory.depth + 1 >= limits.maxDepth) {
                addReason(truncationReasons, 'max-depth');
                return null;
              }
              return {
                path: childPath,
                depth: directory.depth + 1,
                entries,
              } satisfies QueuedDirectory;
            } catch (error) {
              diagnostics.push(
                codexDiscoveryDiagnosticSchema.parse({
                  code: diagnosticCode(error),
                  path: childPath,
                  message: error instanceof Error ? error.message.slice(0, 500) : '成员扫描失败',
                }),
              );
              return null;
            }
          }),
        );

        for (const result of results) {
          if (!result) continue;
          if ('kind' in result) {
            if (members.length >= limits.maxMembers) {
              addReason(truncationReasons, 'max-members');
              break;
            }
            members.push(result as CodexWorkspaceMember);
          } else {
            queued.push(result);
          }
        }
        if (!isBudgetAvailable()) break;
      }
    }
  }

  if (queued.length > 0 && truncationReasons.length === 0)
    addReason(truncationReasons, 'time-budget');
  return {
    members: members.slice(0, limits.maxMembers),
    diagnostics: diagnostics.slice(0, 100),
    truncated: truncationReasons.length > 0,
    truncationReasons,
  };
}

export async function discoverWorkspaceMembers(
  rootPathInput: string,
  options: WorkspaceDiscoveryOptions = {},
): Promise<WorkspaceDiscoveryResult> {
  const registeredKeys = await registeredKeySet(options.registeredRoots ?? []);
  return discoverWorkspaceMembersWithRegisteredKeys(rootPathInput, options, registeredKeys);
}

function directProject(
  indexedRoot: IndexedRoot,
  rootPath: string,
  status: CodexDirectProject['status'],
  reason?: string,
): CodexDirectProject {
  return {
    kind: 'direct-project',
    id: candidateId(memberPathKey(rootPath)),
    displayName: indexedRoot.displayName,
    rootPath,
    source: indexedRoot.source,
    status,
    ...(indexedRoot.lastUsedAt ? { lastUsedAt: indexedRoot.lastUsedAt } : {}),
    ...(reason ? { reason } : {}),
  };
}

function workspaceProject(
  indexedRoot: IndexedRoot,
  rootPath: string,
  result: WorkspaceDiscoveryResult,
): CodexWorkspace {
  return {
    kind: 'workspace',
    id: candidateId(memberPathKey(rootPath), 'workspace'),
    displayName: indexedRoot.displayName || basename(rootPath) || rootPath,
    rootPath,
    source: indexedRoot.source,
    ...(indexedRoot.lastUsedAt ? { lastUsedAt: indexedRoot.lastUsedAt } : {}),
    members: result.members,
    diagnostics: result.diagnostics,
    truncated: result.truncated,
    truncationReasons: result.truncationReasons,
    repositoryCount: result.members.length,
    openSpecProjectCount: result.members.filter((member) => member.kind === 'openspec-project')
      .length,
    availableCount: result.members.filter(
      (member) => member.kind === 'openspec-project' && member.status === 'available',
    ).length,
  };
}

async function classifyIndexedRoot(
  indexedRoot: IndexedRoot,
  options: WorkspaceDiscoveryOptions,
  registeredKeys: ReadonlySet<string>,
): Promise<CodexDiscoveryEntry> {
  let rootPath: string;
  try {
    const normalizedInput = normalizeCodexProjectPath(indexedRoot.rootPath);
    const rawStat = await fs.lstat(normalizedInput);
    if (rawStat.isSymbolicLink() || !rawStat.isDirectory())
      return directProject(indexedRoot, normalizedInput, 'unavailable', '项目目录不存在或不可读');
    rootPath = await canonicalizeCodexProjectPath(normalizedInput);
  } catch {
    return directProject(
      indexedRoot,
      indexedRoot.rootPath.slice(0, 4096),
      'unavailable',
      '项目路径不是有效的绝对路径',
    );
  }
  try {
    const stat = await fs.lstat(rootPath);
    if (stat.isSymbolicLink() || !stat.isDirectory())
      return directProject(indexedRoot, rootPath, 'unavailable', '项目目录不存在或不可读');
  } catch {
    return directProject(indexedRoot, rootPath, 'unavailable', '项目目录不存在或不可读');
  }

  const validation = await validateOpenSpecProject(rootPath);
  if (validation.valid) {
    return directProject(
      indexedRoot,
      rootPath,
      registeredKeys.has(memberPathKey(rootPath)) ? 'already-added' : 'available',
      registeredKeys.has(memberPathKey(rootPath)) ? '该项目已添加到工作区' : undefined,
    );
  }
  if (validation.reason === '项目目录不存在或不可读')
    return directProject(indexedRoot, rootPath, 'unavailable', validation.reason);

  const result = await discoverWorkspaceMembersWithRegisteredKeys(
    rootPath,
    options,
    registeredKeys,
  );
  if (result.members.length === 0 && result.diagnostics.length === 0 && !result.truncated)
    return directProject(indexedRoot, rootPath, 'unrecognized', '未发现 OpenSpec 项目或代码仓库');
  return workspaceProject(indexedRoot, rootPath, result);
}

function mergeWorkspaceEntries(
  entries: Array<{ entry: CodexWorkspace; index: number }>,
): Array<{ entry: CodexWorkspace; index: number }> {
  const byRoot = new Map<string, { entry: CodexWorkspace; index: number }>();
  for (const current of entries) {
    const key = memberPathKey(current.entry.rootPath);
    const existing = byRoot.get(key);
    if (!existing) {
      byRoot.set(key, {
        entry: {
          ...current.entry,
          members: [...current.entry.members],
          diagnostics: [...current.entry.diagnostics],
        },
        index: current.index,
      });
      continue;
    }
    const memberMap = new Map(
      existing.entry.members.map((member) => [memberPathKey(member.rootPath), member]),
    );
    for (const member of current.entry.members)
      memberMap.set(memberPathKey(member.rootPath), member);
    existing.entry.members = [...memberMap.values()];
    existing.entry.diagnostics = [
      ...existing.entry.diagnostics,
      ...current.entry.diagnostics,
    ].slice(0, 100);
    existing.entry.truncated = existing.entry.truncated || current.entry.truncated;
    existing.entry.truncationReasons = [
      ...new Set([...existing.entry.truncationReasons, ...current.entry.truncationReasons]),
    ];
  }

  const merged = [...byRoot.values()];
  const winners = new Map<string, { rootKey: string; distance: number; index: number }>();
  for (const workspace of merged) {
    for (const member of workspace.entry.members) {
      const distance = pathDistance(workspace.entry.rootPath, member.rootPath);
      if (distance === null) continue;
      const key = memberPathKey(member.rootPath);
      const current = winners.get(key);
      if (
        !current ||
        distance < current.distance ||
        (distance === current.distance && workspace.index < current.index)
      )
        winners.set(key, {
          rootKey: memberPathKey(workspace.entry.rootPath),
          distance,
          index: workspace.index,
        });
    }
  }
  for (const workspace of merged) {
    workspace.entry.members = workspace.entry.members.filter(
      (member) =>
        winners.get(memberPathKey(member.rootPath))?.rootKey ===
        memberPathKey(workspace.entry.rootPath),
    );
    workspace.entry.repositoryCount = workspace.entry.members.length;
    workspace.entry.openSpecProjectCount = workspace.entry.members.filter(
      (member) => member.kind === 'openspec-project',
    ).length;
    workspace.entry.availableCount = workspace.entry.members.filter(
      (member) => member.kind === 'openspec-project' && member.status === 'available',
    ).length;
  }
  return merged.filter(
    ({ entry }) => entry.members.length > 0 || entry.diagnostics.length > 0 || entry.truncated,
  );
}

function mergeDiscoveredEntries(
  collected: Array<{ entry: CodexDiscoveryEntry; index: number }>,
): CodexDiscoveryEntry[] {
  const directByPath = new Map<string, { entry: CodexDirectProject; index: number }>();
  for (const current of collected) {
    if (current.entry.kind !== 'direct-project') continue;
    const key = memberPathKey(current.entry.rootPath);
    if (!directByPath.has(key))
      directByPath.set(key, current as { entry: CodexDirectProject; index: number });
  }
  const workspaces = mergeWorkspaceEntries(
    collected
      .filter(
        (current): current is { entry: CodexWorkspace; index: number } =>
          current.entry.kind === 'workspace',
      )
      .map((current) => current),
  );
  const workspaceMemberPaths = new Set(
    workspaces.flatMap(({ entry }) =>
      entry.members.map((member) => memberPathKey(member.rootPath)),
    ),
  );
  const entries: Array<{ entry: CodexDiscoveryEntry; index: number }> = [
    ...[...directByPath.values()].filter(
      ({ entry }) => !workspaceMemberPaths.has(memberPathKey(entry.rootPath)),
    ),
    ...workspaces,
  ];
  entries.sort((left, right) => left.index - right.index);
  return entries.map(({ entry }) => entry);
}

export async function discoverCodexProjects(
  options: DiscoverCodexProjectsOptions,
): Promise<CodexProjectList> {
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
      entries: [],
      summary: {
        source: 'unavailable',
        indexedRootCount: 0,
        workspaceCount: 0,
        repositoryCount: 0,
        openSpecProjectCount: 0,
        availableCount: 0,
        truncated: false,
        truncationReasons: [],
        message: lastError?.message ?? '未找到 Codex 项目索引',
      },
      scannedAt: new Date().toISOString(),
    });
  }

  const registeredRoots = options.registeredRoots ?? [];
  const registeredKeys = await registeredKeySet(registeredRoots);
  const collected: Array<{ entry: CodexDiscoveryEntry; index: number }> = [];
  for (const indexedRoot of parsedIndex.roots) {
    const entry = await classifyIndexedRoot(
      indexedRoot,
      { ...options, registeredRoots },
      registeredKeys,
    );
    collected.push({ entry, index: indexedRoot.index });
  }
  const entries = mergeDiscoveredEntries(collected);
  const workspaces = entries.filter((entry): entry is CodexWorkspace => entry.kind === 'workspace');
  const directProjects = entries.filter(
    (entry): entry is CodexDirectProject => entry.kind === 'direct-project',
  );
  const directOpenSpecProjects = directProjects.filter(
    (entry) => entry.status === 'available' || entry.status === 'already-added',
  );
  const truncationReasons = parsedIndex.truncationReasons;
  return codexProjectListSchema.parse({
    entries,
    summary: {
      source,
      indexedRootCount: parsedIndex.indexedRootCount,
      workspaceCount: workspaces.length,
      repositoryCount:
        directOpenSpecProjects.length +
        workspaces.reduce((count, workspace) => count + workspace.repositoryCount, 0),
      openSpecProjectCount:
        directOpenSpecProjects.length +
        workspaces.reduce((count, workspace) => count + workspace.openSpecProjectCount, 0),
      availableCount:
        directProjects.filter((entry) => entry.status === 'available').length +
        workspaces.reduce((count, workspace) => count + workspace.availableCount, 0),
      truncated: truncationReasons.length > 0,
      truncationReasons,
      ...(source === 'backup' ? { message: '主项目索引暂不可用，已读取只读备份' } : {}),
    },
    scannedAt: new Date().toISOString(),
  });
}
