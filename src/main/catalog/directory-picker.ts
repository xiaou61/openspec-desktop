import { validateOpenSpecProject } from '../domain/paths';

export interface DirectoryDialog {
  showOpenDialog(options: {
    title: string;
    properties: Array<'openDirectory' | 'createDirectory' | 'promptToCreate'>;
  }): Promise<{
    canceled: boolean;
    filePaths: string[];
  }>;
}

export async function selectOpenSpecProjectDirectory(
  dialog: DirectoryDialog,
): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title: '选择 OpenSpec 项目目录',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const selected = result.filePaths[0];
  if (!selected) return null;
  const validation = await validateOpenSpecProject(selected);
  if (!validation.valid) throw new Error(validation.reason ?? '所选目录不是有效的 OpenSpec 项目');
  return validation.rootPath;
}
