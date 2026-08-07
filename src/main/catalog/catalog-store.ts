import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { catalogStateSchema, type CatalogState } from '@shared/contracts';

export interface CatalogLoadResult {
  state: CatalogState;
  recoveredFromCorruption: boolean;
  recoveryMessage?: string;
}

export function createDefaultCatalogState(): CatalogState {
  return {
    schemaVersion: 1,
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

export class CatalogStore {
  readonly filePath: string;

  constructor(private readonly userDataPath: string) {
    this.filePath = join(userDataPath, 'catalog.json');
  }

  async load(): Promise<CatalogLoadResult> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      return { state: catalogStateSchema.parse(parsed), recoveredFromCorruption: false };
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
        recoveryMessage: message,
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
