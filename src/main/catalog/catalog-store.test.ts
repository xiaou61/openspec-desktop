import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CatalogStore, createDefaultCatalogState } from './catalog-store';

describe('CatalogStore', () => {
  it('writes validated state atomically and reloads it', async () => {
    const userData = await fs.mkdtemp(join(tmpdir(), 'openspec-catalog-'));
    try {
      const store = new CatalogStore(userData);
      const state = createDefaultCatalogState();
      state.preferences.showArchived = true;
      await store.save(state);
      const loaded = await store.load();
      expect(loaded.state.preferences.showArchived).toBe(true);
      expect((await fs.readdir(userData)).some((name) => name.includes('.tmp-'))).toBe(false);
    } finally {
      await fs.rm(userData, { recursive: true, force: true });
    }
  });

  it('moves corrupt JSON aside and returns a recoverable default', async () => {
    const userData = await fs.mkdtemp(join(tmpdir(), 'openspec-corrupt-'));
    try {
      await fs.writeFile(join(userData, 'catalog.json'), '{not-json');
      const result = await new CatalogStore(userData).load();
      expect(result.recoveredFromCorruption).toBe(true);
      expect(result.state.schemaVersion).toBe(1);
      expect(
        (await fs.readdir(userData)).some((name) => name.startsWith('catalog.json.corrupt-')),
      ).toBe(true);
    } finally {
      await fs.rm(userData, { recursive: true, force: true });
    }
  });
});
