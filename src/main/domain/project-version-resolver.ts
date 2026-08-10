import { execFile as execFileCallback } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { VersionMode, VersionSource } from '@shared/contracts';

const execFile = promisify(execFileCallback);

export const DEFAULT_VERSION_GIT_TIMEOUT_MS = 1500;
export const DEFAULT_VERSION_GIT_MAX_BUFFER = 128 * 1024;
export const DEFAULT_PACKAGE_JSON_MAX_BYTES = 256 * 1024;

export type VersionResolutionDiagnostic =
  | 'git-tag'
  | 'package-json'
  | 'workspace'
  | 'git-unavailable'
  | 'git-timeout'
  | 'git-invalid'
  | 'package-invalid';

export interface AutomaticVersionContext {
  versionLabel: string;
  versionMode: Extract<VersionMode, 'automatic'>;
  versionSource: VersionSource;
  versionResolvedAt: string;
  diagnostic: VersionResolutionDiagnostic;
}

export interface GitExecutionOptions {
  timeoutMs: number;
  maxBuffer: number;
}

export interface ProjectVersionResolverDependencies {
  runGit?: (rootPath: string, options: GitExecutionOptions) => Promise<string>;
  readPackageJson?: (rootPath: string, maxBytes: number) => Promise<string>;
  now?: () => string;
}

function validVersionLabel(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.trim().length <= 120 &&
    !hasControlCharacters(value)
  );
}

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function defaultRunGit(rootPath: string, options: GitExecutionOptions): Promise<string> {
  return execFile('git', ['tag', '--points-at', 'HEAD', '--sort=-version:refname'], {
    cwd: rootPath,
    shell: false,
    timeout: options.timeoutMs,
    maxBuffer: options.maxBuffer,
    windowsHide: true,
    encoding: 'utf8',
  }).then(({ stdout }) => String(stdout));
}

async function defaultReadPackageJson(rootPath: string, maxBytes: number): Promise<string> {
  const packagePath = join(rootPath, 'package.json');
  const stats = await fs.stat(packagePath);
  if (!stats.isFile()) throw new Error('package.json 不是文件');
  if (stats.size > maxBytes) throw new Error('package.json 超出安全读取上限');
  const raw = await fs.readFile(packagePath, 'utf8');
  if (Buffer.byteLength(raw, 'utf8') > maxBytes) throw new Error('package.json 超出安全读取上限');
  return raw;
}

function isTimeout(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; killed?: unknown; signal?: unknown };
  return (
    candidate.code === 'ETIMEDOUT' || candidate.killed === true || candidate.signal === 'SIGTERM'
  );
}

function sortedGitTags(output: string): string[] {
  const seen = new Set<string>();
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line): line is string => {
      if (!validVersionLabel(line) || seen.has(line)) return false;
      seen.add(line);
      return true;
    });
}

/** Resolve a project's local version clues without mutating the project or invoking a shell. */
export async function resolveProjectVersion(
  rootPath: string,
  dependencies: ProjectVersionResolverDependencies = {},
): Promise<AutomaticVersionContext> {
  const runGit = dependencies.runGit ?? defaultRunGit;
  const readPackageJson = dependencies.readPackageJson ?? defaultReadPackageJson;
  const now = dependencies.now ?? (() => new Date().toISOString());
  let gitDiagnostic: VersionResolutionDiagnostic;

  try {
    const output = await runGit(rootPath, {
      timeoutMs: DEFAULT_VERSION_GIT_TIMEOUT_MS,
      maxBuffer: DEFAULT_VERSION_GIT_MAX_BUFFER,
    });
    const tags = sortedGitTags(output);
    if (tags[0]) {
      return {
        versionLabel: tags[0],
        versionMode: 'automatic',
        versionSource: 'git-tag',
        versionResolvedAt: now(),
        diagnostic: 'git-tag',
      };
    }
    gitDiagnostic = 'git-invalid';
  } catch (error) {
    gitDiagnostic = isTimeout(error) ? 'git-timeout' : 'git-unavailable';
  }

  let raw: string;
  try {
    raw = await readPackageJson(rootPath, DEFAULT_PACKAGE_JSON_MAX_BYTES);
  } catch {
    return {
      versionLabel: '',
      versionMode: 'automatic',
      versionSource: 'workspace',
      versionResolvedAt: now(),
      diagnostic: gitDiagnostic,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      versionLabel: '',
      versionMode: 'automatic',
      versionSource: 'workspace',
      versionResolvedAt: now(),
      diagnostic: 'package-invalid',
    };
  }

  const version =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)['version']
      : undefined;
  if (validVersionLabel(version)) {
    return {
      versionLabel: version.trim(),
      versionMode: 'automatic',
      versionSource: 'package-json',
      versionResolvedAt: now(),
      diagnostic: 'package-json',
    };
  }
  return {
    versionLabel: '',
    versionMode: 'automatic',
    versionSource: 'workspace',
    versionResolvedAt: now(),
    diagnostic: 'package-invalid',
  };
}
