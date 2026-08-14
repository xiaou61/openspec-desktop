import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join, relative } from 'node:path';

function taskMarkdown(completed: number, total: number): string {
  const lines = ['# Tasks', ''];
  for (let index = 1; index <= total; index += 1) {
    lines.push(`- [${index <= completed ? 'x' : ' '}] Task ${index}`);
  }
  return `${lines.join('\n')}\n`;
}

async function writeChange(
  projectRoot: string,
  changeId: string,
  completed: number,
  total: number,
  options: { capability?: string; archived?: boolean } = {},
): Promise<string> {
  const base = options.archived
    ? join(projectRoot, 'openspec', 'changes', 'archive', changeId)
    : join(projectRoot, 'openspec', 'changes', changeId);
  await fs.mkdir(base, { recursive: true });
  await fs.writeFile(join(base, 'proposal.md'), `# ${changeId}\n`, 'utf8');
  await fs.writeFile(join(base, 'design.md'), '# Design\n', 'utf8');
  await fs.writeFile(join(base, '.openspec.yaml'), 'schema: spec-driven\n', 'utf8');
  const capability = options.capability ?? `${changeId}-capability`;
  const specRoot = join(base, 'specs', capability);
  await fs.mkdir(specRoot, { recursive: true });
  await fs.writeFile(
    join(specRoot, 'spec.md'),
    `# ${capability}\n\n## ADDED Requirements\n\n### Requirement: Updated behavior\n`,
    'utf8',
  );
  const tasksPath = join(base, 'tasks.md');
  await fs.writeFile(tasksPath, taskMarkdown(completed, total), 'utf8');
  return tasksPath;
}

async function hashFiles(root: string): Promise<string> {
  const files: string[] = [];
  const walk = async (directory: string): Promise<void> => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  await walk(root);
  const digest = createHash('sha256');
  for (const path of files) {
    digest.update(relative(root, path).replaceAll('\\', '/'));
    digest.update('\0');
    digest.update(await fs.readFile(path));
    digest.update('\0');
  }
  return digest.digest('hex');
}

export interface ActionCenterDiskFixture {
  primaryRoot: string;
  secondaryRoot: string;
  paths: {
    completedThenExpanded: string;
    uncheckedAfterComplete: string;
    firstIncomplete: string;
    empty: string;
    completedAgainThenReopened: string;
    customArtifact: string;
    archived: string;
  };
  expandCompletedChange(): Promise<void>;
  uncheckCompletedTask(): Promise<void>;
  reopenSecondIteration(): Promise<void>;
  completeSecondIteration(): Promise<void>;
  reopenThirdIteration(): Promise<void>;
  modifyArchive(): Promise<void>;
  hashProjects(): Promise<{ primary: string; secondary: string }>;
}

export async function createActionCenterDiskFixture(
  root: string,
): Promise<ActionCenterDiskFixture> {
  const primaryRoot = join(root, 'primary-project');
  const secondaryRoot = join(root, 'secondary-project');
  await fs.mkdir(join(primaryRoot, 'openspec', 'specs', 'existing-capability'), {
    recursive: true,
  });
  await fs.mkdir(join(secondaryRoot, 'openspec'), { recursive: true });
  await fs.writeFile(join(primaryRoot, 'openspec', 'config.yaml'), 'schema: spec-driven\n');
  await fs.writeFile(join(secondaryRoot, 'openspec', 'config.yaml'), 'schema: spec-driven\n');
  await fs.writeFile(
    join(primaryRoot, 'openspec', 'specs', 'existing-capability', 'spec.md'),
    '# Existing capability\n',
  );

  const completedThenExpanded = await writeChange(primaryRoot, 'completed-then-expanded', 57, 57);
  const uncheckedAfterComplete = await writeChange(primaryRoot, 'unchecked-after-complete', 2, 2);
  const firstIncomplete = await writeChange(primaryRoot, 'first-incomplete', 57, 64);
  const empty = await writeChange(primaryRoot, 'empty-tasks', 0, 0);
  const completedAgainThenReopened = await writeChange(
    primaryRoot,
    'completed-again-then-reopened',
    2,
    2,
  );
  await writeChange(primaryRoot, 'capability-iteration', 0, 1, {
    capability: 'existing-capability',
  });
  const archived = await writeChange(primaryRoot, 'archived-change', 1, 1, {
    archived: true,
  });
  await writeChange(secondaryRoot, 'secondary-incomplete', 0, 1);

  const customRoot = join(primaryRoot, 'openspec', 'changes', 'custom-artifact');
  await fs.mkdir(customRoot, { recursive: true });
  await fs.writeFile(join(customRoot, '.openspec.yaml'), 'schema: custom-workflow\n');
  await fs.writeFile(join(customRoot, 'proposal.md'), '# Custom workflow\n');
  const customArtifact = join(customRoot, 'deploy.md');
  await fs.writeFile(customArtifact, '# Deploy\n');

  return {
    primaryRoot,
    secondaryRoot,
    paths: {
      completedThenExpanded,
      uncheckedAfterComplete,
      firstIncomplete,
      empty,
      completedAgainThenReopened,
      customArtifact,
      archived,
    },
    expandCompletedChange: () => fs.writeFile(completedThenExpanded, taskMarkdown(57, 64), 'utf8'),
    uncheckCompletedTask: () => fs.writeFile(uncheckedAfterComplete, taskMarkdown(1, 2), 'utf8'),
    reopenSecondIteration: () =>
      fs.writeFile(completedAgainThenReopened, taskMarkdown(2, 3), 'utf8'),
    completeSecondIteration: () =>
      fs.writeFile(completedAgainThenReopened, taskMarkdown(3, 3), 'utf8'),
    reopenThirdIteration: () =>
      fs.writeFile(completedAgainThenReopened, taskMarkdown(3, 4), 'utf8'),
    modifyArchive: () => fs.appendFile(archived, '\n- [x] Post-archive rewrite\n', 'utf8'),
    hashProjects: async () => ({
      primary: await hashFiles(primaryRoot),
      secondary: await hashFiles(secondaryRoot),
    }),
  };
}
