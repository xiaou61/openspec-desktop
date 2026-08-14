import {
  changeLifecycleAssessmentSchema,
  type ArchiveGate,
  type ArtifactGraph,
  type ChangeLifecycleAssessment,
  type LifecycleArtifact,
  type LifecycleBlocker,
  type LifecycleEvidence,
  type LifecycleEvidenceSource,
  type LifecycleNextAction,
  type LifecycleNode,
  type LifecycleNodeId,
  type LifecycleNodeState,
  type LifecycleTaskGate,
  type SpecSyncAssessment,
  type ValidationAssessment,
} from '@shared/contracts';

export interface LifecycleEvaluationInput {
  projectId: string;
  changeId: string;
  archived: boolean;
  projectAvailable: boolean;
  contentFingerprint: string;
  evaluatedAt: string;
  artifactGraph: ArtifactGraph;
  taskGate: LifecycleTaskGate;
  validation: ValidationAssessment;
  sync: SpecSyncAssessment;
}

const artifactNodeIds: LifecycleNodeId[] = ['proposal', 'specs', 'design', 'tasks'];
const nodeLabels: Record<LifecycleNodeId, string> = {
  proposal: '提案',
  specs: '规格',
  design: '设计',
  tasks: '任务',
  validation: '验证',
  archive: '应用内归档',
};

function evidence(
  source: LifecycleEvidenceSource,
  summary: string,
  options: { relativePath?: string; line?: number; checkedAt?: string } = {},
): LifecycleEvidence {
  return { source, summary, ...options };
}

function artifactEvidence(graph: ArtifactGraph, artifact: LifecycleArtifact): LifecycleEvidence[] {
  return [
    evidence(
      graph.source,
      artifact.message ?? `工件状态：${artifact.status}`,
      artifact.outputPath ? { relativePath: artifact.outputPath } : {},
    ),
  ];
}

function requiredArtifactProblem(graph: ArtifactGraph): LifecycleArtifact | undefined {
  const artifacts = new Map(graph.artifacts.map((artifact) => [artifact.id, artifact]));
  for (const id of graph.applyRequires) {
    const artifact = artifacts.get(id);
    if (!artifact) return { id, status: 'unknown', requires: [], message: '缺少工件状态' };
    if (artifact.status !== 'done' && artifact.status !== 'skipped') return artifact;
  }
  if (!graph.authoritative) {
    return {
      id: graph.applyRequires[0] ?? 'proposal',
      status: 'unknown',
      requires: [],
      message: graph.message ?? '结构扫描无法证明条件工件与自定义依赖已经满足',
    };
  }
  return undefined;
}

function archiveGates(input: LifecycleEvaluationInput): ArchiveGate[] {
  const artifactProblem = requiredArtifactProblem(input.artifactGraph);
  const artifactStatus = artifactProblem
    ? artifactProblem.status === 'unknown'
      ? 'unknown'
      : 'fail'
    : 'pass';
  const taskStatus =
    input.taskGate.status === 'complete' ||
    input.taskGate.status === 'empty' ||
    input.taskGate.status === 'not-applicable'
      ? 'pass'
      : input.taskGate.status === 'unknown'
        ? 'unknown'
        : 'fail';
  const validationStatus =
    input.validation.status === 'passed'
      ? 'pass'
      : input.validation.status === 'unavailable' || input.validation.status === 'stale'
        ? 'unknown'
        : 'fail';
  const gates: ArchiveGate[] = [
    {
      id: 'artifacts',
      label: '所需工件',
      status: artifactStatus,
      evidence: artifactProblem
        ? artifactEvidence(input.artifactGraph, artifactProblem)
        : [evidence(input.artifactGraph.source, 'apply 依赖闭包已满足')],
    },
    {
      id: 'tasks',
      label: '任务门槛',
      status: taskStatus,
      evidence: taskGateEvidence(input.taskGate),
    },
    {
      id: 'validation',
      label: '严格验证',
      status: validationStatus,
      evidence: [
        evidence(
          input.validation.source,
          input.validation.message ?? `验证状态：${input.validation.status}`,
          input.validation.checkedAt ? { checkedAt: input.validation.checkedAt } : {},
        ),
      ],
    },
  ];
  return gates;
}

function taskGateEvidence(taskGate: LifecycleTaskGate): LifecycleEvidence[] {
  const summary = {
    complete: `${taskGate.completed}/${taskGate.total} 项任务已完成，非空任务清单全部完成`,
    incomplete: `${taskGate.completed}/${taskGate.total} 项任务已完成，剩余 ${taskGate.remaining} 项`,
    empty: '任务清单已就绪，无可追踪任务（0/0）',
    'not-applicable': '当前 schema 不要求 tasks 工件',
    unknown: taskGate.message ?? 'tasks 工件缺失、不可读或无法解析',
  }[taskGate.status];
  return [
    evidence(
      'structural',
      summary,
      taskGate.sourcePath ? { relativePath: taskGate.sourcePath } : {},
    ),
  ];
}

function addBlockers(
  input: LifecycleEvaluationInput,
): LifecycleBlocker[] {
  const blockers: LifecycleBlocker[] = [];
  if (!input.projectAvailable) {
    blockers.push({
      code: 'project-unavailable',
      node: 'proposal',
      title: '项目当前不可用',
      detail: '请恢复或重新定位项目目录后再检查生命周期。',
      evidence: [evidence('structural', '注册项目目录不可读或不存在')],
    });
  }

  const artifactProblem = requiredArtifactProblem(input.artifactGraph);
  if (artifactProblem) {
    const unknown = artifactProblem.status === 'unknown';
    blockers.push({
      code: unknown ? 'artifact-unknown' : 'artifact-incomplete',
      node: artifactNodeIds.includes(artifactProblem.id as LifecycleNodeId)
        ? (artifactProblem.id as LifecycleNodeId)
        : 'proposal',
      title: unknown ? '工件状态无法确认' : `工件 ${artifactProblem.id} 尚未就绪`,
      detail: artifactProblem.message ?? `当前状态为 ${artifactProblem.status}`,
      evidence: artifactEvidence(input.artifactGraph, artifactProblem),
    });
  }

  if (input.taskGate.status === 'incomplete') {
    blockers.push({
      code: 'tasks-incomplete',
      node: 'tasks',
      title: `还有 ${input.taskGate.remaining} 项任务未完成`,
      detail: `${input.taskGate.completed}/${input.taskGate.total} 项任务已完成。`,
      evidence: [
        evidence(
          'structural',
          `剩余 ${input.taskGate.remaining} 项任务`,
          input.taskGate.sourcePath ? { relativePath: input.taskGate.sourcePath } : {},
        ),
      ],
    });
  } else if (input.taskGate.status === 'unknown') {
    blockers.push({
      code: 'tasks-unknown',
      node: 'tasks',
      title: '任务状态无法确认',
      detail: input.taskGate.message ?? 'tasks 工件不可读或解析失败。',
      evidence: [evidence('structural', input.taskGate.message ?? '任务状态未知')],
    });
  }

  if (input.validation.status !== 'passed') {
    const details: Record<
      Exclude<ValidationAssessment['status'], 'passed'>,
      { code: LifecycleBlocker['code']; title: string; detail: string }
    > = {
      'not-run': {
        code: 'validation-required',
        title: '尚未运行严格验证',
        detail: '运行 OpenSpec 严格验证以确认当前内容。',
      },
      running: {
        code: 'validation-required',
        title: '严格验证正在运行',
        detail: '等待当前验证完成。',
      },
      failed: {
        code: 'validation-failed',
        title: '严格验证未通过',
        detail: input.validation.message ?? '请修复验证诊断后重新运行。',
      },
      unavailable: {
        code: 'validation-unavailable',
        title: '严格验证不可用',
        detail: input.validation.message ?? '请安装或修复本机 OpenSpec CLI。',
      },
      stale: {
        code: 'validation-stale',
        title: '验证结果已过期',
        detail: input.validation.staleReason ?? '相关文件已变化，请重新验证。',
      },
    };
    const detail = details[input.validation.status];
    blockers.push({
      ...detail,
      node: 'validation',
      evidence: [
        evidence(
          input.validation.source,
          detail.detail,
          input.validation.checkedAt ? { checkedAt: input.validation.checkedAt } : {},
        ),
      ],
    });
  }

  return blockers;
}

function nextAction(
  input: LifecycleEvaluationInput,
): LifecycleNextAction {
  if (input.archived) {
    return {
      kind: 'review-archive',
      targetNode: 'archive',
      title: '查看归档记录',
      description: '该 Change 已归档；应用不会再次生成归档操作。',
    };
  }
  if (!input.projectAvailable) {
    return {
      kind: 'recover-project',
      targetNode: 'proposal',
      title: '恢复项目路径',
      description: '项目目录不可用，请重新定位或恢复后继续。',
    };
  }
  const artifactProblem = requiredArtifactProblem(input.artifactGraph);
  if (artifactProblem) {
    const targetNode = artifactNodeIds.includes(artifactProblem.id as LifecycleNodeId)
      ? (artifactProblem.id as LifecycleNodeId)
      : 'proposal';
    return {
      kind: 'complete-artifact',
      targetNode,
      targetArtifactId: artifactProblem.id,
      title:
        artifactProblem.status === 'unknown' ? '确认工件依赖' : `继续完成${nodeLabels[targetNode]}`,
      description:
        artifactProblem.message ?? `工件 ${artifactProblem.id} 当前为 ${artifactProblem.status}。`,
    };
  }
  if (input.taskGate.status === 'incomplete' || input.taskGate.status === 'unknown') {
    return {
      kind: 'continue-implementation',
      targetNode: 'tasks',
      title: input.taskGate.status === 'unknown' ? '检查任务工件' : '继续实施任务',
      description:
        input.taskGate.status === 'unknown'
          ? (input.taskGate.message ?? '任务状态无法解析。')
          : `还有 ${input.taskGate.remaining} 项任务未完成。`,
    };
  }
  if (input.validation.status !== 'passed') {
    return {
      kind: input.validation.status === 'failed' ? 'fix-validation' : 'run-validation',
      targetNode: 'validation',
      title:
        input.validation.status === 'failed'
          ? '修复严格验证问题'
          : input.validation.status === 'running'
            ? '等待严格验证完成'
            : '运行严格验证',
      description:
        input.validation.message ??
        input.validation.staleReason ??
        '需要当前内容版本的严格验证结果。',
    };
  }
  const pendingCount = input.sync.status === 'pending' ? input.sync.summary.pendingCount : 0;
  return {
    kind: 'archive',
    targetNode: 'archive',
    title: '确认应用内可归档',
    description:
      pendingCount > 0
        ? `全部应用内门槛已满足；外部 OpenSpec CLI 权限未改变。归档时将把 ${pendingCount} 个能力的 delta 更新到主规格。`
        : input.sync.status === 'unknown'
          ? '全部应用内门槛已满足；外部 OpenSpec CLI 权限未改变，本地规格影响预览当前不可用。'
          : '全部应用内门槛已满足；这只是桌面端建议，归档仍需在外部 OpenSpec 流程中明确执行。',
  };
}

function nodeState(
  id: LifecycleNodeId,
  input: LifecycleEvaluationInput,
  action: LifecycleNextAction,
): LifecycleNodeState {
  if (id === 'archive') {
    if (input.archived) return 'archived';
    if (action.targetNode === 'archive') return 'current';
    return 'blocked';
  }
  if (!input.projectAvailable) return 'unavailable';
  if (id === 'tasks') {
    const artifact = input.artifactGraph.artifacts.find((entry) => entry.id === id);
    if (!artifact) {
      if (input.taskGate.status === 'not-applicable') return 'ready';
      if (input.taskGate.status === 'unknown') return 'unavailable';
      return action.targetNode === id ? 'current' : 'pending';
    }
    if (artifact.status === 'unknown') return 'unavailable';
    if (artifact.status === 'blocked') return 'blocked';
    if (artifact.status === 'pending') return action.targetNode === id ? 'current' : 'pending';
    if (input.taskGate.status === 'complete') return 'complete';
    if (input.taskGate.status === 'incomplete') return 'current';
    if (input.taskGate.status === 'empty' || input.taskGate.status === 'not-applicable')
      return 'ready';
    return 'unavailable';
  }
  if (artifactNodeIds.includes(id)) {
    const artifact = input.artifactGraph.artifacts.find((entry) => entry.id === id);
    if (!artifact) return action.targetNode === id ? 'current' : 'pending';
    if (artifact.status === 'done' || artifact.status === 'skipped') return 'complete';
    if (artifact.status === 'unknown') return 'unavailable';
    if (artifact.status === 'blocked') return 'blocked';
    return action.targetNode === id ? 'current' : 'pending';
  }
  if (id === 'validation') {
    if (input.validation.status === 'passed') return 'complete';
    if (input.validation.status === 'unavailable') return 'unavailable';
    if (input.validation.status === 'failed' || input.validation.status === 'stale')
      return 'blocked';
    return action.targetNode === id ? 'current' : 'pending';
  }
  return action.targetNode === id ? 'current' : 'pending';
}

function buildNodes(input: LifecycleEvaluationInput, action: LifecycleNextAction): LifecycleNode[] {
  return (Object.keys(nodeLabels) as LifecycleNodeId[]).map((id) => {
    let source: LifecycleEvidenceSource;
    let nodeEvidence: LifecycleEvidence[];
    if (id === 'tasks') {
      source = input.artifactGraph.source;
      const artifact = input.artifactGraph.artifacts.find((entry) => entry.id === id);
      nodeEvidence = [
        ...(artifact
          ? artifactEvidence(input.artifactGraph, artifact)
          : [evidence(source, '当前 schema 未返回 tasks 工件')]),
        ...taskGateEvidence(input.taskGate),
      ];
    } else if (artifactNodeIds.includes(id)) {
      source = input.artifactGraph.source;
      const artifact = input.artifactGraph.artifacts.find((entry) => entry.id === id);
      nodeEvidence = artifact
        ? artifactEvidence(input.artifactGraph, artifact)
        : [evidence(source, '当前 schema 未返回此工件')];
    } else if (id === 'validation') {
      source = input.validation.source;
      nodeEvidence = [
        evidence(
          source,
          input.validation.message ?? `验证状态：${input.validation.status}`,
          input.validation.checkedAt ? { checkedAt: input.validation.checkedAt } : {},
        ),
      ];
    } else {
      source = 'directory';
      nodeEvidence = [evidence('directory', input.archived ? 'Change 位于归档目录' : 'Change 尚未归档')];
    }
    return {
      id,
      label: nodeLabels[id],
      state: nodeState(id, input, action),
      source,
      evidence: nodeEvidence,
    };
  });
}

export function evaluateLifecycle(input: LifecycleEvaluationInput): ChangeLifecycleAssessment {
  const action = nextAction(input);
  const gates = archiveGates(input);
  const baseGateIds = new Set(['artifacts', 'tasks', 'validation']);
  const gateSatisfied =
    input.projectAvailable &&
    gates.filter((gate) => baseGateIds.has(gate.id)).every((gate) => gate.status === 'pass');
  const archiveStatus = input.archived ? 'archived' : gateSatisfied ? 'ready' : 'not-ready';

  return changeLifecycleAssessmentSchema.parse({
    schemaVersion: 1,
    projectId: input.projectId,
    changeId: input.changeId,
    archiveKey: `${input.archived ? 'archive' : 'active'}:${input.changeId}`,
    archived: input.archived,
    projectAvailable: input.projectAvailable,
    contentFingerprint: input.contentFingerprint,
    evaluatedAt: input.evaluatedAt,
    nodes: buildNodes(input, action),
    artifactGraph: input.artifactGraph,
    taskGate: input.taskGate,
    validation: input.validation,
    sync: input.sync,
    archiveReadiness: { status: archiveStatus, gates },
    nextAction: action,
    blockers: input.archived ? [] : addBlockers(input),
  });
}
