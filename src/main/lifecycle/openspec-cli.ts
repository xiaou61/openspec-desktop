import { spawn } from 'node:child_process';
import { constants as fsConstants, promises as fs } from 'node:fs';
import { delimiter, isAbsolute, join, relative, resolve } from 'node:path';
import {
  artifactGraphSchema,
  localIdSchema,
  openSpecContextSummarySchema,
  openSpecDoctorSummarySchema,
  openSpecInstructionsSummarySchema,
  safeRelativePathSchema,
  validationAssessmentSchema,
  type ArtifactGraph,
  type ChangeProjection,
  type LifecycleArtifact,
  type OpenSpecContextSummary,
  type OpenSpecDiagnostic,
  type OpenSpecDoctorSummary,
  type OpenSpecInstructionsSummary,
  type ValidationAssessment,
  type ValidationDiagnostic,
} from '@shared/contracts';
import { auditChildProcessInvocation } from '../domain/child-process-audit';

const STATUS_TIMEOUT_MS = 5_000;
const VALIDATION_TIMEOUT_MS = 30_000;
const STATUS_OUTPUT_BYTES = 512 * 1024;
const VALIDATION_OUTPUT_BYTES = 1024 * 1024;
const HEALTH_TIMEOUT_MS = 5_000;
const HEALTH_OUTPUT_BYTES = 256 * 1024;
const INSTRUCTIONS_TIMEOUT_MS = 5_000;
const INSTRUCTIONS_OUTPUT_BYTES = 512 * 1024;

export interface OpenSpecInvocation {
  command: string;
  prefixArgs: string[];
}

export interface BoundedProcessInput {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  maxOutputBytes: number;
  env: NodeJS.ProcessEnv;
}

export interface BoundedProcessResult {
  outcome: 'completed' | 'timeout' | 'output-limit' | 'error';
  exitCode: number | null;
  stdout: string;
  stderr: string;
  errorMessage?: string;
}

export async function executeBoundedProcess(
  input: BoundedProcessInput,
): Promise<BoundedProcessResult> {
  return new Promise((resolve) => {
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let forcedOutcome: BoundedProcessResult['outcome'] | null = null;
    let processError: string | undefined;
    let settled = false;
    auditChildProcessInvocation(input.command, input.args, input.cwd);
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: input.env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const finish = (exitCode: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        outcome: forcedOutcome ?? (processError ? 'error' : 'completed'),
        exitCode,
        stdout: stdout.toString('utf8'),
        stderr: stderr.toString('utf8'),
        ...(processError ? { errorMessage: processError } : {}),
      });
    };

    const append = (target: 'stdout' | 'stderr', chunk: Buffer | string): void => {
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const used = stdout.byteLength + stderr.byteLength;
      const remaining = Math.max(0, input.maxOutputBytes - used);
      const accepted = data.subarray(0, remaining);
      if (target === 'stdout') stdout = Buffer.concat([stdout, accepted]);
      else stderr = Buffer.concat([stderr, accepted]);
      if (data.byteLength > remaining && !forcedOutcome) {
        forcedOutcome = 'output-limit';
        child.kill();
      }
    };

    child.stdout?.on('data', (chunk: Buffer) => append('stdout', chunk));
    child.stderr?.on('data', (chunk: Buffer) => append('stderr', chunk));
    child.on('error', (error) => {
      processError = error.message;
    });
    child.on('close', (code) => finish(code));

    const timer = setTimeout(() => {
      if (!forcedOutcome) forcedOutcome = 'timeout';
      child.kill();
    }, input.timeoutMs);
  });
}

async function executable(path: string): Promise<boolean> {
  try {
    await fs.access(path, process.platform === 'win32' ? fsConstants.F_OK : fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function resolveOpenSpecInvocation(): Promise<OpenSpecInvocation> {
  const pathValue = process.env['PATH'] ?? process.env['Path'] ?? '';
  const directories = [
    ...new Set(
      pathValue
        .split(delimiter)
        .map((entry) => entry.replace(/^"|"$/g, ''))
        .filter(Boolean),
    ),
  ];
  const pathNode =
    process.platform === 'win32'
      ? (
          await Promise.all(
            directories.map(async (directory) => {
              const candidate = join(directory, 'node.exe');
              return (await executable(candidate)) ? candidate : null;
            }),
          )
        ).find((candidate): candidate is string => candidate !== null)
      : undefined;
  for (const directory of directories) {
    if (process.platform === 'win32') {
      const executablePath = join(directory, 'openspec.exe');
      if (await executable(executablePath)) return { command: executablePath, prefixArgs: [] };

      const shim = join(directory, 'openspec.cmd');
      const script = join(
        directory,
        'node_modules',
        '@fission-ai',
        'openspec',
        'bin',
        'openspec.js',
      );
      if ((await executable(shim)) && (await executable(script))) {
        const adjacentNode = join(directory, 'node.exe');
        const nodeCommand = (await executable(adjacentNode)) ? adjacentNode : pathNode;
        if (!nodeCommand) continue;
        return {
          command: nodeCommand,
          prefixArgs: [script],
        };
      }
      continue;
    }
    const command = join(directory, 'openspec');
    if (await executable(command)) return { command, prefixArgs: [] };
  }
  throw new Error('未找到兼容的 OpenSpec CLI');
}

function safeProcessEnvironment(): NodeJS.ProcessEnv {
  const keys = [
    'PATH',
    'Path',
    'PATHEXT',
    'SystemRoot',
    'WINDIR',
    'TEMP',
    'TMP',
    'HOME',
    'USERPROFILE',
    'APPDATA',
    'LOCALAPPDATA',
  ];
  const env: NodeJS.ProcessEnv = { NO_COLOR: '1', CI: '1' };
  for (const key of keys) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  return env;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is string =>
          typeof entry === 'string' && localIdSchema.safeParse(entry).success,
      )
    : [];
}

function safeProjectRelativePath(
  value: unknown,
  projectRoot: string,
  options: { changeId?: string } = {},
): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const raw = value.trim();
  let normalized: string;
  if (isAbsolute(raw)) {
    normalized = relative(resolve(projectRoot), resolve(raw)).replaceAll('\\', '/');
  } else {
    normalized = raw.replaceAll('\\', '/').replace(/^\.\//, '');
    if (!normalized.startsWith('openspec/')) {
      if (/^(?:changes|specs)\//i.test(normalized) || /^config\.ya?ml$/i.test(normalized)) {
        normalized = `openspec/${normalized}`;
      } else if (options.changeId) {
        normalized = `openspec/changes/${options.changeId}/${normalized}`;
      }
    }
  }
  return safeRelativePathSchema.safeParse(normalized).success ? normalized : undefined;
}

function normalizeArtifact(
  value: unknown,
  options: { projectRoot?: string; changeId?: string } = {},
): LifecycleArtifact | null {
  const item = objectValue(value);
  if (!item || typeof item['id'] !== 'string' || !localIdSchema.safeParse(item['id']).success)
    return null;
  const rawStatus = typeof item['status'] === 'string' ? item['status'].toLowerCase() : 'unknown';
  const status = ['done', 'skipped', 'blocked', 'pending'].includes(rawStatus)
    ? (rawStatus as LifecycleArtifact['status'])
    : 'unknown';
  const artifact: LifecycleArtifact = {
    id: item['id'],
    status,
    requires: stringArray(item['requires']),
  };
  if (typeof item['outputPath'] === 'string' && item['outputPath'].length <= 1024) {
    const outputPath = options.projectRoot
      ? safeProjectRelativePath(item['outputPath'], options.projectRoot, {
          ...(options.changeId ? { changeId: options.changeId } : {}),
        })
      : item['outputPath'].replaceAll('\\', '/');
    if (outputPath) artifact.outputPath = outputPath;
  }
  if (typeof item['description'] === 'string' && item['description'].trim())
    artifact.message = item['description'].trim().slice(0, 1000);
  return artifact;
}

function dependencyClosure(artifacts: LifecycleArtifact[], roots: string[]): string[] {
  const byId = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  const result: string[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visited.has(id) || visiting.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id)?.requires ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
    result.push(id);
  };
  for (const root of roots) visit(root);
  return result;
}

export function parseOpenSpecStatus(
  raw: string,
  options: { projectRoot?: string; changeId?: string } = {},
): ArtifactGraph {
  const parsed = objectValue(JSON.parse(raw) as unknown);
  if (!parsed) throw new Error('OpenSpec status JSON 必须是对象');
  const schemaName = typeof parsed['schemaName'] === 'string' ? parsed['schemaName'] : null;
  const rawArtifacts: unknown = parsed['artifacts'];
  if (!schemaName || !Array.isArray(rawArtifacts))
    throw new Error('OpenSpec status JSON 缺少关键字段');
  const artifacts = rawArtifacts
    .map((entry: unknown) => normalizeArtifact(entry, options))
    .filter((entry): entry is LifecycleArtifact => Boolean(entry));
  const roots = stringArray(parsed['applyRequires']);
  const applyRequires = dependencyClosure(
    artifacts,
    roots.length > 0 ? roots : artifacts.map((entry) => entry.id),
  );
  return artifactGraphSchema.parse({
    schemaName,
    source: 'openspec-cli',
    authoritative: true,
    applyRequires,
    artifacts,
  });
}

export function createStructuralArtifactGraph(
  change: ChangeProjection,
  options: { skipSpecs?: boolean; tasksRequired?: boolean; message?: string } = {},
): ArtifactGraph {
  const definitions: Array<{
    id: string;
    type: ChangeProjection['artifacts'][number]['type'];
    requires: string[];
  }> = [
    { id: 'proposal', type: 'proposal', requires: [] },
    { id: 'specs', type: 'spec', requires: ['proposal'] },
    { id: 'design', type: 'design', requires: ['proposal'] },
    { id: 'tasks', type: 'tasks', requires: ['specs', 'design'] },
  ];
  const artifacts: LifecycleArtifact[] = definitions.map((definition) => {
    const matches = change.artifacts.filter((artifact) => artifact.type === definition.type);
    const first = matches[0];
    const status: LifecycleArtifact['status'] =
      definition.id === 'specs' && options.skipSpecs && matches.length === 0
        ? 'skipped'
        : matches.length === 0
          ? 'pending'
          : matches.some((artifact) => artifact.parseHealth !== 'ok')
            ? 'unknown'
            : 'done';
    return {
      id: definition.id,
      status,
      requires: definition.requires,
      ...(first ? { outputPath: first.sourcePath } : {}),
      ...(status === 'unknown' ? { message: first?.error ?? '工件无法可靠解析' } : {}),
    };
  });
  const tasksRequired = options.tasksRequired ?? true;
  return artifactGraphSchema.parse({
    schemaName: 'spec-driven',
    source: 'structural',
    authoritative: false,
    applyRequires: tasksRequired
      ? ['proposal', 'specs', 'design', 'tasks']
      : ['proposal', 'specs', 'design'],
    artifacts,
    message: options.message ?? 'OpenSpec CLI 不可用，当前结果仅来自结构扫描',
  });
}

function safeMessage(value: unknown, projectRoot: string): string {
  const raw = typeof value === 'string' ? value : 'OpenSpec 返回了未命名诊断';
  const slashRoot = projectRoot.replaceAll('\\', '/');
  const backslashRoot = slashRoot.replaceAll('/', '\\');
  return (
    raw
      .replaceAll(projectRoot, '<project>')
      .replaceAll(slashRoot, '<project>')
      .replaceAll(backslashRoot, '<project>')
      .replace(/\p{Cc}+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 1000) || 'OpenSpec 返回了空诊断'
  );
}

function limitedText(value: unknown, fallback: string, maxLength = 120): string {
  if (typeof value !== 'string') return fallback;
  const normalized = value
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized ? normalized.slice(0, maxLength) : fallback;
}

function normalizeSummaryDiagnostics(value: unknown, projectRoot: string): OpenSpecDiagnostic[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).map((entry) => {
    const item = objectValue(entry);
    const rawSeverity = limitedText(item?.['severity'] ?? item?.['level'], 'info').toLowerCase();
    const severity: OpenSpecDiagnostic['severity'] = rawSeverity.includes('error')
      ? 'error'
      : rawSeverity.includes('warn')
        ? 'warning'
        : 'info';
    return {
      severity,
      message: safeMessage(item?.['message'] ?? item?.['text'] ?? entry, projectRoot),
    };
  });
}

export function normalizeOpenSpecDoctor(raw: string, projectRoot: string): OpenSpecDoctorSummary {
  const parsed = objectValue(JSON.parse(raw) as unknown);
  const root = objectValue(parsed?.['root']);
  if (!parsed || !root || typeof root['healthy'] !== 'boolean') {
    throw new Error('OpenSpec doctor JSON 缺少 root health');
  }
  const relations: OpenSpecDoctorSummary['relations'] = [];
  const store = objectValue(parsed['store']);
  if (store) {
    const relativePath = safeProjectRelativePath(
      store['path'] ?? store['root'] ?? store['location'],
      projectRoot,
    );
    relations.push({
      kind: 'store',
      status: limitedText(store['status'] ?? store['state'], 'unknown'),
      ...(relativePath ? { relativePath } : {}),
    });
  }
  if (Array.isArray(parsed['references'])) {
    for (const rawReference of parsed['references'].slice(0, 100 - relations.length)) {
      const reference = objectValue(rawReference);
      if (!reference) continue;
      const relativePath = safeProjectRelativePath(
        reference['path'] ?? reference['root'] ?? reference['location'],
        projectRoot,
      );
      relations.push({
        kind: 'reference',
        status: limitedText(reference['status'] ?? reference['state'], 'unknown'),
        ...(relativePath ? { relativePath } : {}),
      });
    }
  }
  const diagnostics = normalizeSummaryDiagnostics(
    [
      ...(Array.isArray(root['status']) ? root['status'] : []),
      ...(Array.isArray(parsed['status']) ? parsed['status'] : []),
    ],
    projectRoot,
  );
  return openSpecDoctorSummarySchema.parse({
    healthy: root['healthy'],
    rootSource: limitedText(root['source'], 'unknown'),
    relations,
    diagnostics,
  });
}

export function normalizeOpenSpecContext(raw: string, projectRoot: string): OpenSpecContextSummary {
  const parsed = objectValue(JSON.parse(raw) as unknown);
  const root = objectValue(parsed?.['root']);
  if (!parsed || !root || typeof root['role'] !== 'string') {
    throw new Error('OpenSpec context JSON 缺少 root role');
  }
  const members: OpenSpecContextSummary['members'] = [];
  if (Array.isArray(parsed['members'])) {
    for (const rawMember of parsed['members'].slice(0, 100)) {
      const member = objectValue(rawMember);
      if (!member) continue;
      const relativePath = safeProjectRelativePath(
        member['path'] ?? member['root'] ?? member['location'],
        projectRoot,
      );
      members.push({
        role: limitedText(member['role'] ?? member['kind'], 'unknown'),
        status: limitedText(member['status'] ?? member['state'], 'unknown'),
        ...(relativePath ? { relativePath } : {}),
      });
    }
  }
  return openSpecContextSummarySchema.parse({
    rootRole: limitedText(root['role'], 'unknown'),
    rootSource: limitedText(root['source'], 'unknown'),
    members,
    diagnostics: normalizeSummaryDiagnostics(parsed['status'], projectRoot),
  });
}

export interface NormalizeInstructionsOptions {
  projectRoot: string;
  changeId: string;
  target: string;
}

export function normalizeOpenSpecInstructions(
  raw: string,
  options: NormalizeInstructionsOptions,
): OpenSpecInstructionsSummary {
  localIdSchema.parse(options.changeId);
  localIdSchema.parse(options.target);
  const parsed = objectValue(JSON.parse(raw) as unknown);
  if (!parsed || parsed['changeName'] !== options.changeId) {
    throw new Error('OpenSpec instructions JSON Change 身份不匹配');
  }
  if (
    options.target !== 'apply' &&
    options.target !== 'archive' &&
    typeof parsed['artifactId'] === 'string' &&
    parsed['artifactId'] !== options.target
  ) {
    throw new Error('OpenSpec instructions JSON artifact 身份不匹配');
  }
  const dependencies: OpenSpecInstructionsSummary['dependencies'] = [];
  if (Array.isArray(parsed['dependencies'])) {
    for (const rawDependency of parsed['dependencies'].slice(0, 100)) {
      const dependency = objectValue(rawDependency);
      if (
        dependency &&
        typeof dependency['id'] === 'string' &&
        localIdSchema.safeParse(dependency['id']).success &&
        typeof dependency['done'] === 'boolean'
      ) {
        dependencies.push({ id: dependency['id'], done: dependency['done'] });
      }
    }
  }
  const contextFiles: OpenSpecInstructionsSummary['contextFiles'] = [];
  const rawContextFiles = objectValue(parsed['contextFiles']);
  if (rawContextFiles) {
    for (const [artifactId, rawPaths] of Object.entries(rawContextFiles).slice(0, 100)) {
      if (!localIdSchema.safeParse(artifactId).success || !Array.isArray(rawPaths)) continue;
      const paths = [
        ...new Set(
          rawPaths
            .slice(0, 100)
            .map((path) =>
              safeProjectRelativePath(path, options.projectRoot, { changeId: options.changeId }),
            )
            .filter((path): path is string => Boolean(path)),
        ),
      ];
      if (paths.length > 0) contextFiles.push({ artifactId, paths });
    }
  }
  const resolvedOutputPath = safeProjectRelativePath(
    parsed['resolvedOutputPath'],
    options.projectRoot,
    { changeId: options.changeId },
  );
  if (resolvedOutputPath) {
    const existing = contextFiles.find((entry) => entry.artifactId === options.target);
    if (existing) {
      if (!existing.paths.includes(resolvedOutputPath)) existing.paths.push(resolvedOutputPath);
    } else {
      contextFiles.push({ artifactId: options.target, paths: [resolvedOutputPath] });
    }
  }
  const progressValue = objectValue(parsed['progress']);
  const progress = progressValue
    ? {
        total: progressValue['total'],
        complete: progressValue['complete'],
        remaining: progressValue['remaining'],
      }
    : undefined;
  const rawState = parsed['state'];
  const state =
    rawState === 'ready' || rawState === 'blocked' || rawState === 'all_done'
      ? rawState
      : undefined;
  const schemaName =
    typeof parsed['schemaName'] === 'string' && parsed['schemaName'].trim()
      ? parsed['schemaName'].trim().slice(0, 160)
      : undefined;
  const instruction =
    typeof parsed['instruction'] === 'string' && parsed['instruction'].trim()
      ? safeMessage(parsed['instruction'], options.projectRoot).slice(0, 4000)
      : undefined;
  return openSpecInstructionsSummarySchema.parse({
    changeId: options.changeId,
    target: options.target,
    ...(schemaName ? { schemaName } : {}),
    ...(state ? { state } : {}),
    dependencies,
    contextFiles,
    ...(progress ? { progress } : {}),
    ...(instruction ? { instruction } : {}),
  });
}

export interface NormalizeValidationOptions {
  changeId: string;
  checkedAt: string;
  fingerprint: string;
  projectRoot: string;
  allowedPaths: string[];
}

export function normalizeValidationOutput(
  raw: string,
  options: NormalizeValidationOptions,
): ValidationAssessment {
  const parsed = objectValue(JSON.parse(raw) as unknown);
  if (!parsed) throw new Error('OpenSpec validate JSON 必须是对象');
  const items = Array.isArray(parsed['items'])
    ? parsed['items'].map(objectValue).filter(Boolean)
    : [];
  const item = items.find((entry) => entry?.['id'] === options.changeId) ?? items[0] ?? parsed;
  const issues = Array.isArray(item['issues']) ? item['issues'] : [];
  const allowedPaths = new Set(options.allowedPaths.map((path) => path.replaceAll('\\', '/')));
  const diagnostics: ValidationDiagnostic[] = issues.slice(0, 100).map((issue) => {
    const detail = objectValue(issue);
    const rawSeverity = String(detail?.['severity'] ?? detail?.['level'] ?? 'error').toLowerCase();
    const severity: ValidationDiagnostic['severity'] = rawSeverity.includes('warn')
      ? 'warning'
      : rawSeverity.includes('info')
        ? 'info'
        : 'error';
    const diagnostic: ValidationDiagnostic = {
      severity,
      message: safeMessage(detail?.['message'] ?? detail?.['text'] ?? issue, options.projectRoot),
    };
    const rawPath = detail?.['path'] ?? detail?.['relativePath'] ?? detail?.['file'];
    if (typeof rawPath === 'string') {
      const normalized = rawPath.replaceAll('\\', '/').replace(/^\.\//, '');
      if (safeRelativePathSchema.safeParse(normalized).success && allowedPaths.has(normalized))
        diagnostic.relativePath = normalized;
    }
    const line = detail?.['line'];
    if (typeof line === 'number' && Number.isInteger(line) && line > 0) diagnostic.line = line;
    if (typeof detail?.['capability'] === 'string' && detail['capability'].trim())
      diagnostic.capability = safeMessage(detail['capability'], options.projectRoot).slice(0, 240);
    if (typeof detail?.['requirement'] === 'string' && detail['requirement'].trim())
      diagnostic.requirement = safeMessage(detail['requirement'], options.projectRoot).slice(
        0,
        500,
      );
    return diagnostic;
  });
  const valid = item['valid'] === true && !diagnostics.some((entry) => entry.severity === 'error');
  const version =
    typeof parsed['version'] === 'string' ? parsed['version'].slice(0, 160) : undefined;
  return validationAssessmentSchema.parse({
    status: valid ? 'passed' : 'failed',
    source: 'openspec-cli',
    checkedAt: options.checkedAt,
    fingerprint: options.fingerprint,
    ...(version ? { cliVersion: version } : {}),
    ...(!valid ? { message: `${diagnostics.length} 条验证诊断` } : {}),
    diagnostics,
  });
}

export interface RestrictedOpenSpecCliOptions {
  resolveInvocation?: () => Promise<OpenSpecInvocation>;
  execute?: (input: BoundedProcessInput) => Promise<BoundedProcessResult>;
}

export class RestrictedOpenSpecCli {
  private readonly resolveInvocation: () => Promise<OpenSpecInvocation>;
  private readonly execute: (input: BoundedProcessInput) => Promise<BoundedProcessResult>;

  constructor(options: RestrictedOpenSpecCliOptions = {}) {
    this.resolveInvocation = options.resolveInvocation ?? resolveOpenSpecInvocation;
    this.execute = options.execute ?? executeBoundedProcess;
  }

  async status(projectRoot: string, changeId: string): Promise<ArtifactGraph> {
    localIdSchema.parse(changeId);
    const result = await this.run(projectRoot, ['status', '--change', changeId, '--json'], {
      timeoutMs: STATUS_TIMEOUT_MS,
      maxOutputBytes: STATUS_OUTPUT_BYTES,
    });
    if (result.outcome !== 'completed' || result.exitCode !== 0)
      throw new Error(this.failureMessage(result));
    return parseOpenSpecStatus(result.stdout, { projectRoot, changeId });
  }

  async doctor(projectRoot: string): Promise<OpenSpecDoctorSummary> {
    const result = await this.run(projectRoot, ['doctor', '--json'], {
      timeoutMs: HEALTH_TIMEOUT_MS,
      maxOutputBytes: HEALTH_OUTPUT_BYTES,
    });
    if (result.outcome !== 'completed' || result.exitCode !== 0) {
      throw new Error(this.failureMessage(result));
    }
    try {
      return normalizeOpenSpecDoctor(result.stdout, projectRoot);
    } catch {
      throw new Error('OpenSpec CLI 返回了不兼容的 doctor JSON');
    }
  }

  async context(projectRoot: string): Promise<OpenSpecContextSummary> {
    const result = await this.run(projectRoot, ['context', '--json'], {
      timeoutMs: HEALTH_TIMEOUT_MS,
      maxOutputBytes: HEALTH_OUTPUT_BYTES,
    });
    if (result.outcome !== 'completed' || result.exitCode !== 0) {
      throw new Error(this.failureMessage(result));
    }
    try {
      return normalizeOpenSpecContext(result.stdout, projectRoot);
    } catch {
      throw new Error('OpenSpec CLI 返回了不兼容的 context JSON');
    }
  }

  async instructions(
    projectRoot: string,
    changeId: string,
    target: string,
  ): Promise<OpenSpecInstructionsSummary> {
    localIdSchema.parse(changeId);
    localIdSchema.parse(target);
    const result = await this.run(
      projectRoot,
      ['instructions', target, '--change', changeId, '--json'],
      { timeoutMs: INSTRUCTIONS_TIMEOUT_MS, maxOutputBytes: INSTRUCTIONS_OUTPUT_BYTES },
    );
    if (result.outcome !== 'completed' || result.exitCode !== 0) {
      throw new Error(this.failureMessage(result));
    }
    try {
      return normalizeOpenSpecInstructions(result.stdout, { projectRoot, changeId, target });
    } catch {
      throw new Error('OpenSpec CLI 返回了不兼容的 instructions JSON');
    }
  }

  async validate(
    projectRoot: string,
    changeId: string,
    options: Omit<NormalizeValidationOptions, 'changeId' | 'projectRoot'>,
  ): Promise<ValidationAssessment> {
    localIdSchema.parse(changeId);
    const result = await this.run(
      projectRoot,
      ['validate', changeId, '--strict', '--json', '--no-interactive'],
      { timeoutMs: VALIDATION_TIMEOUT_MS, maxOutputBytes: VALIDATION_OUTPUT_BYTES },
    );
    if (result.outcome !== 'completed') {
      return validationAssessmentSchema.parse({
        status: 'unavailable',
        source: 'openspec-cli',
        checkedAt: options.checkedAt,
        fingerprint: options.fingerprint,
        message: this.failureMessage(result),
        diagnostics: [],
      });
    }
    try {
      return normalizeValidationOutput(result.stdout || result.stderr, {
        ...options,
        changeId,
        projectRoot,
      });
    } catch {
      return validationAssessmentSchema.parse({
        status: 'unavailable',
        source: 'openspec-cli',
        checkedAt: options.checkedAt,
        fingerprint: options.fingerprint,
        message: 'OpenSpec CLI 返回了不兼容的验证 JSON',
        diagnostics: [],
      });
    }
  }

  private async run(
    cwd: string,
    args: string[],
    limits: { timeoutMs: number; maxOutputBytes: number },
  ): Promise<BoundedProcessResult> {
    const invocation = await this.resolveInvocation();
    return this.execute({
      command: invocation.command,
      args: [...invocation.prefixArgs, ...args],
      cwd,
      env: safeProcessEnvironment(),
      ...limits,
    });
  }

  private failureMessage(result: BoundedProcessResult): string {
    if (result.outcome === 'timeout') return 'OpenSpec CLI 运行超时';
    if (result.outcome === 'output-limit') return 'OpenSpec CLI 输出超过安全上限';
    if (result.outcome === 'error') return result.errorMessage ?? 'OpenSpec CLI 无法启动';
    return `OpenSpec CLI 退出码 ${result.exitCode ?? 'unknown'}`;
  }
}
