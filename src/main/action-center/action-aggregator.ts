import { createHash } from 'node:crypto';
import {
  actionCenterItemSchema,
  type ActionCenterActionType,
  type ActionCenterItem,
  type ActionCenterProjectHealth,
  type ChangeLifecycleAssessment,
  type ChangeProjection,
  type ProjectRecord,
} from '@shared/contracts';

export interface DeriveChangeActionInput {
  project: ProjectRecord;
  change: ChangeProjection;
  assessment?: ChangeLifecycleAssessment;
  checkedAt: string;
}

function hash(parts: string[]): string {
  return createHash('sha256').update(parts.join('\n'), 'utf8').digest('hex');
}

function actionKey(
  projectId: string,
  changeId: string,
  actionType: ActionCenterActionType,
): string {
  return `ac1:${hash([projectId, changeId, actionType])}`;
}

function stableLifecycleState(assessment: ChangeLifecycleAssessment | undefined): string {
  if (!assessment) return 'no-assessment';
  return JSON.stringify({
    archiveReadiness: assessment.archiveReadiness,
    validation: assessment.validation,
    taskGate: assessment.taskGate,
    nextAction: assessment.nextAction,
  });
}

function priority(actionType: ActionCenterActionType): number {
  return {
    'project-health': 0,
    'complete-artifact': 1,
    'continue-implementation': 2,
    'run-validation': 3,
    'fix-validation': 3,
    archive: 4,
    'archive-integrity': 5,
  }[actionType];
}

function baseItem(
  input: DeriveChangeActionInput,
  actionType: ActionCenterActionType,
  evidenceFingerprint: string,
) {
  return {
    actionKey: actionKey(input.project.id, input.change.id, actionType),
    evidenceFingerprint,
    projectId: input.project.id,
    projectName: input.project.displayName,
    projectRoot: input.project.rootPath,
    changeId: input.change.id,
    archived: input.change.archived,
    actionType,
    priority: priority(actionType),
    ...(input.change.workState ? { workState: input.change.workState } : {}),
    ...(input.change.evolution ? { evolution: input.change.evolution } : {}),
    ...(input.change.lastActivityAt ? { lastActivityAt: input.change.lastActivityAt } : {}),
  };
}

export function deriveChangeAction(input: DeriveChangeActionInput): ActionCenterItem | null {
  const archiveIntegrity = input.change.workState?.archiveIntegrity;
  if (input.change.archived) {
    if (archiveIntegrity?.status !== 'changed') return null;
    const actionType = 'archive-integrity' as const;
    return actionCenterItemSchema.parse({
      ...baseItem(
        input,
        actionType,
        hash([
          actionType,
          archiveIntegrity.baselineFingerprint,
          archiveIntegrity.currentFingerprint,
        ]),
      ),
      title: '检查归档内容异常',
      description: '归档内容在本地基线建立后发生变化；请创建新的 Change 继续工作。',
      targetNode: 'archive',
      evidence: [
        {
          source: 'local-work-state',
          summary: `归档内容异常（第 ${archiveIntegrity.incident} 次）`,
          checkedAt: archiveIntegrity.observedAt,
        },
      ],
    });
  }

  if (!input.assessment) {
    const { completed, total } = input.change.taskTotals;
    if (input.change.parseHealth !== 'ok' || total === 0 || completed >= total) return null;
    const actionType = 'continue-implementation' as const;
    const tasks = input.change.artifacts.find((artifact) => artifact.type === 'tasks');
    return actionCenterItemSchema.parse({
      ...baseItem(
        input,
        actionType,
        hash([actionType, `${completed}/${total}`, tasks?.contentHash ?? 'structural']),
      ),
      title: '继续实施任务',
      description: `还有 ${total - completed} 项任务未完成。`,
      targetNode: 'tasks',
      evidence: [
        {
          source: 'structural',
          summary: `${completed}/${total} 项任务已完成，剩余 ${total - completed} 项`,
          ...(tasks ? { relativePath: tasks.sourcePath } : {}),
          checkedAt: input.checkedAt,
        },
      ],
      taskGate: {
        applicable: true,
        status: 'incomplete',
        completed,
        total,
        remaining: total - completed,
        ...(tasks ? { sourcePath: tasks.sourcePath } : {}),
      },
    });
  }

  if (
    !input.assessment.artifactGraph.authoritative &&
    input.assessment.taskGate.status === 'incomplete'
  ) {
    const actionType = 'continue-implementation' as const;
    return actionCenterItemSchema.parse({
      ...baseItem(
        input,
        actionType,
        hash([
          actionType,
          input.assessment.contentFingerprint,
          JSON.stringify(input.assessment.taskGate),
          stableLifecycleState(input.assessment),
          'structural',
        ]),
      ),
      title: '继续实施任务',
      description: `还有 ${input.assessment.taskGate.remaining} 项任务未完成。`,
      targetNode: 'tasks',
      evidence: [
        {
          source: 'structural',
          kind: 'primary',
          summary: `${input.assessment.taskGate.completed}/${input.assessment.taskGate.total} 项任务已完成，剩余 ${input.assessment.taskGate.remaining} 项`,
        ...(input.assessment.taskGate.sourcePath
          ? { relativePath: input.assessment.taskGate.sourcePath }
          : {}),
          checkedAt: input.checkedAt,
        },
      ],
      taskGate: input.assessment.taskGate,
      ...(input.assessment.workState ? { workState: input.assessment.workState } : {}),
      ...(input.assessment.evolution ? { evolution: input.assessment.evolution } : {}),
    });
  }

  const next = input.assessment.nextAction;
  if (next.kind === 'review-archive') return null;
  const actionType: ActionCenterActionType =
    next.kind === 'recover-project' ? 'project-health' : next.kind;
  const taskSummary = `${input.assessment.taskGate.completed}/${input.assessment.taskGate.total} 项任务已完成`;
  const primaryEvidence = input.assessment.blockers[0]?.evidence[0];
  return actionCenterItemSchema.parse({
    ...baseItem(
      input,
      actionType,
      hash([
        actionType,
        input.assessment.contentFingerprint,
        JSON.stringify(input.assessment.nextAction),
        JSON.stringify(input.assessment.taskGate),
        stableLifecycleState(input.assessment),
      ]),
    ),
    title: next.title,
    description: next.description,
    targetNode: next.targetNode,
    ...(next.targetArtifactId ? { targetArtifactId: next.targetArtifactId } : {}),
    evidence: [
      {
        source: primaryEvidence?.source ?? input.assessment.artifactGraph.source,
        kind: 'primary',
        summary:
          next.kind === 'continue-implementation'
            ? `${taskSummary}，剩余 ${input.assessment.taskGate.remaining} 项`
            : (primaryEvidence?.summary ?? next.description),
        ...(primaryEvidence?.relativePath
          ? { relativePath: primaryEvidence.relativePath }
          : input.assessment.taskGate.sourcePath
            ? { relativePath: input.assessment.taskGate.sourcePath }
            : {}),
        checkedAt: input.checkedAt,
      },
    ],
    taskGate: input.assessment.taskGate,
    ...(input.assessment.workState ? { workState: input.assessment.workState } : {}),
    ...(input.assessment.evolution ? { evolution: input.assessment.evolution } : {}),
  });
}

export function deriveProjectHealthAction(
  health: ActionCenterProjectHealth,
): ActionCenterItem | null {
  if (health.status === 'healthy') return null;
  const actionType = 'project-health' as const;
  const message = health.diagnostics[0] ?? 'OpenSpec 项目环境需要检查。';
  return actionCenterItemSchema.parse({
    actionKey: actionKey(health.projectId, 'project-health', actionType),
    evidenceFingerprint: hash([
      actionType,
      health.status,
      health.source,
      JSON.stringify(health.diagnostics),
    ]),
    projectId: health.projectId,
    projectName: health.projectName,
    projectRoot: health.projectRoot,
    archived: false,
    actionType,
    priority: 0,
    title: health.status === 'unavailable' ? '恢复 OpenSpec 项目' : '检查 OpenSpec 环境',
    description: message,
    targetNode: 'proposal',
    evidence: [
      {
        source: health.source,
        summary: message,
        checkedAt: health.checkedAt,
      },
    ],
  });
}

export function aggregateActionCenterItems(items: ActionCenterItem[]): ActionCenterItem[] {
  const selected = new Map<string, ActionCenterItem>();
  for (const item of items) {
    const identity = item.changeId ? `${item.projectId}:${item.changeId}` : item.actionKey;
    const current = selected.get(identity);
    if (!current || item.priority < current.priority) selected.set(identity, item);
  }
  return [...selected.values()].sort((left, right) => {
    if (left.priority !== right.priority) return left.priority - right.priority;
    const byActivity = (right.lastActivityAt ?? '').localeCompare(left.lastActivityAt ?? '');
    if (byActivity) return byActivity;
    const byProject = left.projectId.localeCompare(right.projectId, 'en');
    if (byProject) return byProject;
    const byChange = (left.changeId ?? '').localeCompare(right.changeId ?? '', 'en');
    return byChange || left.actionKey.localeCompare(right.actionKey, 'en');
  });
}
