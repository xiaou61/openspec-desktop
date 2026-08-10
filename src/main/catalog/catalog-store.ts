import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  catalogStateSchema,
  catalogStateV1Schema,
  type CatalogState,
  type LegacyProjectRecord,
} from '@shared/contracts';

export interface CatalogLoadResult {
  state: CatalogState;
  recoveredFromCorruption: boolean;
  recoveryMessage?: string;
}

export function createDefaultCatalogState(): CatalogState {
  return {
    schemaVersion: 2,
    groups: [],
    projects: [],
    preferences: {
      selectedProjectId: null,
      selectedChangeId: null,
      showArchived: false,
      windowBounds: { width: 1440, height: 900 },
    },
  };
}

export function migrateCatalogStateV1(state: {
  schemaVersion: 1;
  groups: CatalogState['groups'];
  projects: LegacyProjectRecord[];
  preferences: CatalogState['preferences'];
}): CatalogState {
  return {
    schemaVersion: 2,
    groups: state.groups,
    projects: state.projects.map((project) => {
      const versionLabel = project.versionLabel.trim();
      return {
        ...project,
        versionLabel,
        versionMode: versionLabel ? 'manual' : 'automatic',
        versionSource: versionLabel ? 'manual' : 'workspace',
      };
    }),
    preferences: state.preferences,
  };
}

export class CatalogStore {
  readonly filePath: string;

  constructor(private readonly userDataPath: string) {
    this.filePath = join(userDataPath, 'catalog.json');
  }

  async load(): Promise<CatalogLoadResult> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed: unknown = JSON.parse(raw);

      const current = catalogStateSchema.safeParse(parsed);
      if (current.success) {
        return { state: current.data, recoveredFromCorruption: false };
      }

      const legacy = catalogStateV1Schema.safeParse(parsed);
      if (legacy.success) {
        const migrated = migrateCatalogStateV1(legacy.data);
        const backupPath = `${this.filePath}.v1-backup-${Date.now()}-${randomUUID()}.json`;
        try {
          await fs.copyFile(this.filePath, backupPath);
          await this.save(migrated);
          return {
            state: migrated,
            recoveredFromCorruption: false,
            recoveryMessage: '目录已从 v1 迁移到 v2',
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : '未知错误';
          return {
            state: createDefaultCatalogState(),
            recoveredFromCorruption: true,
            recoveryMessage: `目录 v1 迁移失败，已保留原文件：${message}`,
          };
        }
      }

      throw new Error('目录格式无效');
    } catch (error) {
      const message = error instanceof Error ? error.message : '目录读取失败';
      let recoveredFromCorruption = false;
      try {
        await fs.mkdir(dirname(this.filePath), { recursive: true });
        await fs.rename(
          this.filePath,
          `${this.filePath}.corrupt-${Date.now()}-${randomUUID()}.json`,
        );
        recoveredFromCorruption = true;
      } catch {
        // Missing files and an already-moved corrupt file are both safe to recover from.
      }
      return {
        state: createDefaultCatalogState(),
        recoveredFromCorruption,
        recoveryMessage: `目录读取失败：${message}`,
      };
    }
  }

  async save(state: CatalogState): Promise<void> {
    const validated = catalogStateSchema.parse(state);
    await fs.mkdir(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp-${randomUUID()}`;
    const handle = await fs.open(tempPath, 'w');
    try {
      await handle.writeFile(`${JSON.stringify(validated, null, 2)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await fs.rename(tempPath, this.filePath);
    } catch (error) {
      // Windows cannot replace an existing file with rename; unlink only the known catalog target.
      if (
        (error as NodeJS.ErrnoException).code !== 'EEXIST' &&
        (error as NodeJS.ErrnoException).code !== 'EPERM'
      )
        throw error;
      await fs.rm(this.filePath, { force: true });
      await fs.rename(tempPath, this.filePath);
    }
  }
}
