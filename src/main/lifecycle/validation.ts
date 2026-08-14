import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import {
  localIdSchema,
  validationAssessmentSchema,
  type ChangeProjection,
  type ValidationAssessment,
} from '@shared/contracts';
import type { ProjectScanResult } from '../domain/scanner';
import { createLifecycleFingerprint } from './fingerprint';

const validationCacheEntrySchema = z
  .object({
    schemaVersion: z.literal(1),
    projectId: localIdSchema,
    archiveKey: z
      .string()
      .min(1)
      .max(200)
      .regex(/^(?:active|archive):/),
    validation: validationAssessmentSchema,
  })
  .strict();

function notRun(): ValidationAssessment {
  return { status: 'not-run', source: 'validation-cache', diagnostics: [] };
}

export class ValidationCache {
  constructor(private readonly userDataPath: string) {}

  pathFor(projectId: string, changeId: string, archived: boolean): string {
    localIdSchema.parse(projectId);
    localIdSchema.parse(changeId);
    const filename = `${archived ? 'archive' : 'active'}--${changeId}.json`;
    return join(this.userDataPath, 'lifecycle-validation', projectId, filename);
  }

  async read(
    projectId: string,
    changeId: string,
    archived: boolean,
  ): Promise<ValidationAssessment> {
    const path = this.pathFor(projectId, changeId, archived);
    try {
      const raw = await fs.readFile(path, 'utf8');
      const entry = validationCacheEntrySchema.parse(JSON.parse(raw) as unknown);
      if (
        entry.projectId !== projectId ||
        entry.archiveKey !== `${archived ? 'archive' : 'active'}:${changeId}`
      )
        throw new Error('验证缓存身份不匹配');
      return entry.validation;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return notRun();
      try {
        await fs.rename(path, `${path}.corrupt-${Date.now()}-${randomUUID()}.json`);
      } catch {
        // A missing file can race with recovery and is equivalent to a cache miss.
      }
      return notRun();
    }
  }

  async write(
    projectId: string,
    changeId: string,
    archived: boolean,
    validation: ValidationAssessment,
  ): Promise<void> {
    const path = this.pathFor(projectId, changeId, archived);
    const entry = validationCacheEntrySchema.parse({
      schemaVersion: 1,
      projectId,
      archiveKey: `${archived ? 'archive' : 'active'}:${changeId}`,
      validation,
    });
    await fs.mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.tmp-${randomUUID()}`;
    const handle = await fs.open(temporary, 'w');
    try {
      await handle.writeFile(`${JSON.stringify(entry, null, 2)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await fs.rename(temporary, path);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST' && code !== 'EPERM') throw error;
      await fs.rm(path, { force: true });
      await fs.rename(temporary, path);
    }
  }
}

export interface ValidationRunContext {
  projectId: string;
  projectRoot: string;
  change: ChangeProjection;
  scan: ProjectScanResult;
  getCurrent: () =>
    | { scan: ProjectScanResult; change: ChangeProjection }
    | Promise<{ scan: ProjectScanResult; change: ChangeProjection }>;
}

export interface ValidationExecutorInput {
  projectRoot: string;
  changeId: string;
  checkedAt: string;
  fingerprint: string;
  allowedPaths: string[];
}

export interface ValidationCoordinatorOptions {
  cache: ValidationCache;
  validate: (input: ValidationExecutorInput) => Promise<ValidationAssessment>;
  now?: () => string;
}

function staleValidation(validation: ValidationAssessment, reason: string): ValidationAssessment {
  return validationAssessmentSchema.parse({
    ...validation,
    status: 'stale',
    source: 'validation-cache',
    staleReason: reason,
  });
}

export class ValidationCoordinator {
  private readonly running = new Set<string>();
  private readonly now: () => string;

  constructor(private readonly options: ValidationCoordinatorOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  isRunning(projectId: string, changeId: string): boolean {
    return this.running.has(`${projectId}:${changeId}`);
  }

  async current(
    projectId: string,
    scan: ProjectScanResult,
    change: ChangeProjection,
  ): Promise<ValidationAssessment> {
    if (this.isRunning(projectId, change.id)) {
      return { status: 'running', source: 'validation-cache', diagnostics: [] };
    }
    const cached = await this.options.cache.read(projectId, change.id, change.archived);
    if (!cached.fingerprint || cached.status === 'not-run' || cached.status === 'running')
      return cached;
    const fingerprint = createLifecycleFingerprint(scan, change);
    if (cached.fingerprint === fingerprint) return cached;
    if (cached.status === 'stale') return cached;
    const stale = staleValidation(cached, '相关 Change、主规格或 OpenSpec 配置已变化');
    await this.options.cache.write(projectId, change.id, change.archived, stale);
    return stale;
  }

  async run(context: ValidationRunContext): Promise<ValidationAssessment> {
    if (context.change.archived) throw new Error('已归档 Change 不允许重新验证');
    const key = `${context.projectId}:${context.change.id}`;
    if (this.running.has(key)) throw new Error('验证已在运行中');
    this.running.add(key);
    const startFingerprint = createLifecycleFingerprint(context.scan, context.change);
    try {
      const validation = await this.options.validate({
        projectRoot: context.projectRoot,
        changeId: context.change.id,
        checkedAt: this.now(),
        fingerprint: startFingerprint,
        allowedPaths: context.scan.files.map((artifact) => artifact.sourcePath),
      });
      const current = await context.getCurrent();
      const endFingerprint = createLifecycleFingerprint(current.scan, current.change);
      const result =
        startFingerprint === endFingerprint
          ? validation
          : staleValidation(validation, '验证期间相关文件发生变化，结果未用于归档就绪');
      await this.options.cache.write(context.projectId, context.change.id, false, result);
      return result;
    } finally {
      this.running.delete(key);
    }
  }
}
