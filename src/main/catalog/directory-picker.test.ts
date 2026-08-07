import { describe, expect, it, vi } from 'vitest';
import { selectOpenSpecProjectDirectory, type DirectoryDialog } from './directory-picker';

describe('selectOpenSpecProjectDirectory', () => {
  it('returns null on cancel and validates a selected path before returning it', async () => {
    const dialog: DirectoryDialog = {
      showOpenDialog: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] }),
    };
    expect(await selectOpenSpecProjectDirectory(dialog)).toBeNull();
    expect(dialog.showOpenDialog).toHaveBeenCalledWith(
      expect.objectContaining({ properties: expect.arrayContaining(['openDirectory']) }),
    );
  });
});
