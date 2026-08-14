import { z } from 'zod';

const idPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;

export const localIdSchema = z.string().min(1).max(160).regex(idPattern);
export const safeRelativePathSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine((value) => !value.includes('\\'), '路径必须使用正斜杠')
  .refine(
    (value) => !value.startsWith('/') && !value.startsWith('..') && !value.includes('/../'),
    '路径越界',
  );

export const artifactTypeSchema = z.enum([
  'config',
  'proposal',
  'spec',
  'design',
  'tasks',
  'metadata',
]);
export type ArtifactType = z.infer<typeof artifactTypeSchema>;

export const workflowStageSchema = z.enum([
  'draft',
  'specified',
  'designed',
  'planned',
  'implementing',
  'verifying',
  'completed',
  'archived',
]);
export type WorkflowStage = z.infer<typeof workflowStageSchema>;

export const readinessSchema = z.enum(['ready', 'incomplete', 'parse-error', 'unavailable']);
export type Readiness = z.infer<typeof readinessSchema>;

export const watcherStateSchema = z.enum([
  'scanning',
  'watching',
  'paused',
  'unavailable',
  'error',
]);
export type WatcherState = z.infer<typeof watcherStateSchema>;

export const parseHealthSchema = z.enum(['ok', 'error', 'unreadable', 'missing']);
export type ParseHealth = z.infer<typeof parseHealthSchema>;

export const MAX_CODEX_DISCOVERY_ENTRIES = 500;
export const MAX_CODEX_WORKSPACE_MEMBERS = 500;
export const MAX_CODEX_DISCOVERY_DIAGNOSTICS = 100;

export const codexDiscoverySourceSchema = z.enum(['local-project', 'saved-workspace']);
export type CodexDiscoverySource = z.infer<typeof codexDiscoverySourceSchema>;

export const codexDiscoveryTruncationReasonSchema = z.enum([
  'max-depth',
  'max-directories',
  'max-members',
  'time-budget',
  'max-candidates',
]);
export type CodexDiscoveryTruncationReason = z.infer<typeof codexDiscoveryTruncationReasonSchema>;

export const codexDiscoveryDiagnosticSchema = z
  .object({
    code: z.enum(['unreadable', 'disappeared', 'scan-error']),
    path: z.string().min(1).max(4096).optional(),
    message: z.string().min(1).max(500),
  })
  .strict();
export type CodexDiscoveryDiagnostic = z.infer<typeof codexDiscoveryDiagnosticSchema>;

const codexDiscoveryIdentityShape = {
  id: localIdSchema,
  displayName: z.string().min(1).max(160),
  rootPath: z.string().min(1).max(4096),
} as const;

const codexIndexedEntryShape = {
  ...codexDiscoveryIdentityShape,
  source: codexDiscoverySourceSchema,
  lastUsedAt: z.string().min(1).max(64).optional(),
} as const;

export const codexDirectProjectStatusSchema = z.enum([
  'available',
  'already-added',
  'unavailable',
  'unrecognized',
]);
export type CodexDirectProjectStatus = z.infer<typeof codexDirectProjectStatusSchema>;

export const codexDirectProjectSchema = z
  .object({
    kind: z.literal('direct-project'),
    ...codexIndexedEntryShape,
    status: codexDirectProjectStatusSchema,
    reason: z.string().min(1).max(500).optional(),
  })
  .strict();
export type CodexDirectProject = z.infer<typeof codexDirectProjectSchema>;

export const codexOpenSpecWorkspaceMemberSchema = z
  .object({
    kind: z.literal('openspec-project'),
    ...codexDiscoveryIdentityShape,
    status: z.enum(['available', 'already-added']),
    reason: z.string().min(1).max(500).optional(),
  })
  .strict();
export type CodexOpenSpecWorkspaceMember = z.infer<typeof codexOpenSpecWorkspaceMemberSchema>;

export const codexUnconfiguredRepositorySchema = z
  .object({
    kind: z.literal('repository'),
    ...codexDiscoveryIdentityShape,
    status: z.literal('not-configured'),
    reason: z.string().min(1).max(500),
  })
  .strict();
export type CodexUnconfiguredRepository = z.infer<typeof codexUnconfiguredRepositorySchema>;

export const codexWorkspaceMemberSchema = z.discriminatedUnion('kind', [
  codexOpenSpecWorkspaceMemberSchema,
  codexUnconfiguredRepositorySchema,
]);
export type CodexWorkspaceMember = z.infer<typeof codexWorkspaceMemberSchema>;

export const codexWorkspaceSchema = z
  .object({
    kind: z.literal('workspace'),
    ...codexIndexedEntryShape,
    members: z.array(codexWorkspaceMemberSchema).max(MAX_CODEX_WORKSPACE_MEMBERS),
    diagnostics: z.array(codexDiscoveryDiagnosticSchema).max(MAX_CODEX_DISCOVERY_DIAGNOSTICS),
    truncated: z.boolean(),
    truncationReasons: z.array(codexDiscoveryTruncationReasonSchema).max(5),
    repositoryCount: z.number().int().nonnegative().max(MAX_CODEX_WORKSPACE_MEMBERS),
    openSpecProjectCount: z.number().int().nonnegative().max(MAX_CODEX_WORKSPACE_MEMBERS),
    availableCount: z.number().int().nonnegative().max(MAX_CODEX_WORKSPACE_MEMBERS),
  })
  .strict()
  .superRefine((value, context) => {
    const openSpecProjectCount = value.members.filter(
      (member) => member.kind === 'openspec-project',
    ).length;
    const availableCount = value.members.filter(
      (member) => member.kind === 'openspec-project' && member.status === 'available',
    ).length;
    if (value.repositoryCount !== value.members.length) {
      context.addIssue({
        code: 'custom',
        path: ['repositoryCount'],
        message: '工作区代码仓库计数与成员不一致',
      });
    }
    if (value.openSpecProjectCount !== openSpecProjectCount) {
      context.addIssue({
        code: 'custom',
        path: ['openSpecProjectCount'],
        message: '工作区 OpenSpec 项目计数与成员不一致',
      });
    }
    if (value.availableCount !== availableCount) {
      context.addIssue({
        code: 'custom',
        path: ['availableCount'],
        message: '工作区可导入项目计数与成员不一致',
      });
    }
    if (value.truncated !== value.truncationReasons.length > 0) {
      context.addIssue({
        code: 'custom',
        path: ['truncationReasons'],
        message: '工作区截断状态与原因不一致',
      });
    }
  });
export type CodexWorkspace = z.infer<typeof codexWorkspaceSchema>;

export const codexDiscoveryEntrySchema = z.discriminatedUnion('kind', [
  codexDirectProjectSchema,
  codexWorkspaceSchema,
]);
export type CodexDiscoveryEntry = z.infer<typeof codexDiscoveryEntrySchema>;

export const codexScanSummarySchema = z
  .object({
    source: z.enum(['primary', 'backup', 'unavailable']),
    indexedRootCount: z.number().int().nonnegative().max(MAX_CODEX_DISCOVERY_ENTRIES),
    workspaceCount: z.number().int().nonnegative().max(MAX_CODEX_DISCOVERY_ENTRIES),
    repositoryCount: z.number().int().nonnegative().max(MAX_CODEX_DISCOVERY_ENTRIES),
    openSpecProjectCount: z.number().int().nonnegative().max(MAX_CODEX_DISCOVERY_ENTRIES),
    availableCount: z.number().int().nonnegative().max(MAX_CODEX_DISCOVERY_ENTRIES),
    truncated: z.boolean(),
    truncationReasons: z.array(codexDiscoveryTruncationReasonSchema).max(5),
    message: z.string().min(1).max(500).optional(),
  })
  .strict();
export type CodexScanSummary = z.infer<typeof codexScanSummarySchema>;

export const codexProjectListSchema = z
  .object({
    entries: z.array(codexDiscoveryEntrySchema).max(MAX_CODEX_DISCOVERY_ENTRIES),
    summary: codexScanSummarySchema,
    scannedAt: z.string().min(1).max(64),
  })
  .strict()
  .superRefine((value, context) => {
    const workspaces = value.entries.filter((entry) => entry.kind === 'workspace');
    const directProjects = value.entries.filter(
      (entry): entry is CodexDirectProject => entry.kind === 'direct-project',
    );
    const directOpenSpecProjects = directProjects.filter(
      (entry) => entry.status === 'available' || entry.status === 'already-added',
    );
    const counts = {
      workspaceCount: workspaces.length,
      repositoryCount:
        directOpenSpecProjects.length +
        workspaces.reduce((count, workspace) => count + workspace.repositoryCount, 0),
      openSpecProjectCount:
        directOpenSpecProjects.length +
        workspaces.reduce((count, workspace) => count + workspace.openSpecProjectCount, 0),
      availableCount:
        directOpenSpecProjects.filter((entry) => entry.status === 'available').length +
        workspaces.reduce((count, workspace) => count + workspace.availableCount, 0),
    };
    for (const [field, expected] of Object.entries(counts)) {
      if (value.summary[field as keyof typeof counts] !== expected) {
        context.addIssue({
          code: 'custom',
          path: ['summary', field],
          message: 'Codex 发现汇总计数与条目不一致',
        });
      }
    }
    if (value.summary.truncated !== value.summary.truncationReasons.length > 0) {
      context.addIssue({
        code: 'custom',
        path: ['summary', 'truncationReasons'],
        message: 'Codex 发现截断状态与原因不一致',
      });
    }
  });
export type CodexProjectList = z.infer<typeof codexProjectListSchema>;

export const codexWorkspaceReferenceSchema = z
  .object({
    id: localIdSchema,
    rootPath: z.string().min(1).max(4096),
    displayName: z.string().min(1).max(160),
  })
  .strict();
export type CodexWorkspaceReference = z.infer<typeof codexWorkspaceReferenceSchema>;

// Transitional aliases keep direct-project consumers type-safe while they move to entries.
export const codexProjectCandidateStatusSchema = codexDirectProjectStatusSchema;
export type CodexProjectCandidateStatus = CodexDirectProjectStatus;
export const codexProjectCandidateSchema = codexDirectProjectSchema;
export type CodexProjectCandidate = CodexDirectProject;

export const taskItemSchema = z
  .object({
    id: localIdSchema,
    text: z.string().min(1),
    checked: z.boolean(),
    line: z.number().int().positive(),
  })
  .strict();
export type TaskItem = z.infer<typeof taskItemSchema>;

export const taskTotalsSchema = z
  .object({
    completed: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  })
  .strict();
export type TaskTotals = z.infer<typeof taskTotalsSchema>;

export const sha256FingerprintSchema = z
  .string()
  .length(64)
  .regex(/^[a-f0-9]+$/);
const observedAtSchema = z.string().max(64).datetime({ offset: true });
const workStateVersionSourceSchema = z.enum(['git-tag', 'package-json', 'manual', 'workspace']);
const implementationTaskCountShape = {
  completed: z.number().int().nonnegative().max(1_000_000),
  total: z.number().int().nonnegative().max(1_000_000),
  remaining: z.number().int().nonnegative().max(1_000_000),
} as const;

function addTaskCountIssues(
  value: { completed: number; total: number; remaining: number },
  context: z.RefinementCtx,
): void {
  if (value.completed > value.total || value.remaining !== value.total - value.completed) {
    context.addIssue({ code: 'custom', message: '任务计数不一致' });
  }
}

export const implementationTaskCountsSchema = z
  .object(implementationTaskCountShape)
  .strict()
  .superRefine(addTaskCountIssues);
export type ImplementationTaskCounts = z.infer<typeof implementationTaskCountsSchema>;

export const projectVersionContextSchema = z
  .object({
    label: z.string().max(120),
    source: workStateVersionSourceSchema,
    capturedAt: observedAtSchema,
  })
  .strict();
export type ProjectVersionContext = z.infer<typeof projectVersionContextSchema>;

export const implementationTaskObservationStatusSchema = z.enum([
  'complete',
  'incomplete',
  'empty',
  'unknown',
  'not-applicable',
]);
export type ImplementationTaskObservationStatus = z.infer<
  typeof implementationTaskObservationStatusSchema
>;

export const implementationTaskObservationSchema = z
  .object({
    status: implementationTaskObservationStatusSchema,
    ...implementationTaskCountShape,
    fingerprint: sha256FingerprintSchema,
    observedAt: observedAtSchema,
    projectVersion: projectVersionContextSchema,
  })
  .strict()
  .superRefine((value, context) => {
    addTaskCountIssues(value, context);
    if (value.status === 'complete' && (value.total === 0 || value.completed !== value.total)) {
      context.addIssue({ code: 'custom', path: ['status'], message: 'complete 必须为非空全完成' });
    }
    if (value.status === 'incomplete' && (value.total === 0 || value.completed >= value.total)) {
      context.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'incomplete 必须仍有任务剩余',
      });
    }
    if (
      (value.status === 'empty' || value.status === 'not-applicable') &&
      (value.completed !== 0 || value.total !== 0 || value.remaining !== 0)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['status'],
        message: '空或不适用观察必须使用零计数',
      });
    }
  });
export type ImplementationTaskObservation = z.infer<typeof implementationTaskObservationSchema>;

export const implementationCompletionMilestoneSchema = z
  .object({
    iteration: z.number().int().min(1).max(1_000_000),
    completedAt: observedAtSchema,
    taskFingerprint: sha256FingerprintSchema,
    counts: implementationTaskCountsSchema,
    projectVersion: projectVersionContextSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.counts.total === 0 || value.counts.completed !== value.counts.total) {
      context.addIssue({ code: 'custom', path: ['counts'], message: '完成里程碑必须为非空全完成' });
    }
  });
export type ImplementationCompletionMilestone = z.infer<
  typeof implementationCompletionMilestoneSchema
>;

export const implementationReopenedReasonSchema = z.enum([
  'tasks-added',
  'tasks-unchecked',
  'task-set-changed',
]);
export type ImplementationReopenedReason = z.infer<typeof implementationReopenedReasonSchema>;

export const implementationReopenedEvidenceSchema = z
  .object({
    eventKey: sha256FingerprintSchema,
    iteration: z.number().int().min(2).max(1_000_000),
    reopenedAt: observedAtSchema,
    reason: implementationReopenedReasonSchema,
    before: implementationTaskCountsSchema,
    after: implementationTaskCountsSchema,
    delta: z.object({ completed: z.number().int(), total: z.number().int() }).strict(),
    fromFingerprint: sha256FingerprintSchema,
    toFingerprint: sha256FingerprintSchema,
    projectVersion: projectVersionContextSchema,
  })
  .strict();
export type ImplementationReopenedEvidence = z.infer<typeof implementationReopenedEvidenceSchema>;

export const archiveIntegrityStateSchema = z
  .object({
    status: z.enum(['baseline', 'changed', 'restored']),
    baselineFingerprint: sha256FingerprintSchema,
    currentFingerprint: sha256FingerprintSchema,
    observedAt: observedAtSchema,
    incident: z.number().int().nonnegative().max(1_000_000),
    changedAt: observedAtSchema.optional(),
    restoredAt: observedAtSchema.optional(),
    lastEventKey: sha256FingerprintSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === 'baseline' && value.incident !== 0) {
      context.addIssue({
        code: 'custom',
        path: ['incident'],
        message: 'baseline incident 必须为 0',
      });
    }
    if (value.status === 'changed' && (!value.changedAt || !value.lastEventKey)) {
      context.addIssue({ code: 'custom', path: ['status'], message: 'changed 必须包含异常证据' });
    }
  });
export type ArchiveIntegrityState = z.infer<typeof archiveIntegrityStateSchema>;

export const archiveIntegrityEventSchema = z
  .object({
    eventKey: sha256FingerprintSchema,
    incident: z.number().int().positive().max(1_000_000),
    detectedAt: observedAtSchema,
    baselineFingerprint: sha256FingerprintSchema,
    currentFingerprint: sha256FingerprintSchema,
  })
  .strict();
export type ArchiveIntegrityEvent = z.infer<typeof archiveIntegrityEventSchema>;

export const changeEvolutionAssessmentSchema = z
  .object({
    status: z.enum(['new', 'iteration', 'mixed', 'unknown']),
    assessedAt: observedAtSchema,
    capabilities: z
      .array(
        z
          .object({
            capabilityPath: safeRelativePathSchema,
            targetPath: safeRelativePathSchema,
            status: z.enum(['new', 'existing', 'unknown']),
          })
          .strict(),
      )
      .max(200),
    message: z.string().min(1).max(1000).optional(),
  })
  .strict();
export type ChangeEvolutionAssessment = z.infer<typeof changeEvolutionAssessmentSchema>;

export const changeWorkStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    changeId: localIdSchema,
    activeGeneration: sha256FingerprintSchema,
    iteration: z.number().int().min(1).max(1_000_000),
    phase: z.enum(['observing', 'initial-in-progress', 'reopened', 'completed']),
    lastObservation: implementationTaskObservationSchema.optional(),
    completionMilestones: z.array(implementationCompletionMilestoneSchema).max(1000),
    reopenedEvents: z.array(implementationReopenedEvidenceSchema).max(1000),
    evolution: changeEvolutionAssessmentSchema.optional(),
    archiveIntegrity: archiveIntegrityStateSchema.optional(),
    archivedAt: observedAtSchema.optional(),
    updatedAt: observedAtSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.completionMilestones.some((entry) => entry.iteration > value.iteration)) {
      context.addIssue({ code: 'custom', path: ['completionMilestones'], message: '完成轮次超前' });
    }
    if (value.reopenedEvents.some((entry) => entry.iteration > value.iteration)) {
      context.addIssue({ code: 'custom', path: ['reopenedEvents'], message: 'reopened 轮次超前' });
    }
    if (
      value.phase === 'completed' &&
      !value.completionMilestones.some((entry) => entry.iteration === value.iteration)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['phase'],
        message: 'completed 缺少当前轮完成里程碑',
      });
    }
    if (
      value.phase === 'reopened' &&
      !value.reopenedEvents.some((entry) => entry.iteration === value.iteration)
    ) {
      context.addIssue({ code: 'custom', path: ['phase'], message: 'reopened 缺少当前轮证据' });
    }
  });
export type ChangeWorkState = z.infer<typeof changeWorkStateSchema>;

export const changeWorkStateDiagnosticSchema = z
  .object({
    status: z.literal('unavailable'),
    message: z.string().min(1).max(1000),
    detectedAt: observedAtSchema,
    backupFile: safeRelativePathSchema.optional(),
  })
  .strict();
export type ChangeWorkStateDiagnostic = z.infer<typeof changeWorkStateDiagnosticSchema>;

export const changeWorkStateProjectSchema = z
  .object({
    schemaVersion: z.literal(1),
    projectId: localIdSchema,
    updatedAt: observedAtSchema,
    active: z.record(localIdSchema, changeWorkStateSchema),
    archived: z.record(localIdSchema, changeWorkStateSchema),
    diagnostic: changeWorkStateDiagnosticSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    for (const [changeId, state] of Object.entries(value.active)) {
      if (state.changeId !== changeId || state.archivedAt) {
        context.addIssue({
          code: 'custom',
          path: ['active', changeId],
          message: 'active 身份不一致',
        });
      }
    }
    for (const [changeId, state] of Object.entries(value.archived)) {
      if (state.changeId !== changeId || !state.archivedAt) {
        context.addIssue({
          code: 'custom',
          path: ['archived', changeId],
          message: 'archived 身份不一致',
        });
      }
    }
  });
export type ChangeWorkStateProject = z.infer<typeof changeWorkStateProjectSchema>;

export const headingSchema = z
  .object({
    depth: z.number().int().min(1).max(6),
    text: z.string(),
    line: z.number().int().positive(),
  })
  .strict();
export type Heading = z.infer<typeof headingSchema>;

export const artifactProjectionSchema = z
  .object({
    type: artifactTypeSchema,
    relativePath: safeRelativePathSchema,
    sourcePath: safeRelativePathSchema,
    title: z.string(),
    headings: z.array(headingSchema),
    tasks: z.array(taskItemSchema),
    taskTotals: taskTotalsSchema,
    rawContent: z.string().optional(),
    contentHash: z
      .string()
      .length(64)
      .regex(/^[a-f0-9]+$/)
      .optional(),
    size: z.number().int().nonnegative().optional(),
    lastModifiedAt: z.string().optional(),
    parseHealth: parseHealthSchema,
    error: z.string().optional(),
    changeId: localIdSchema.optional(),
    archived: z.boolean(),
  })
  .strict();
export type ArtifactProjection = z.infer<typeof artifactProjectionSchema>;

export const changeProjectionSchema = z
  .object({
    id: localIdSchema,
    name: z.string().min(1),
    archived: z.boolean(),
    stage: workflowStageSchema,
    readiness: readinessSchema,
    artifacts: z.array(artifactProjectionSchema),
    missingArtifacts: z.array(z.enum(['proposal', 'spec', 'design', 'tasks'])),
    taskTotals: taskTotalsSchema,
    parseHealth: parseHealthSchema,
    lastActivityAt: z.string().optional(),
    validation: z
      .object({
        source: z.literal('structural'),
        status: z.literal('not-run'),
      })
      .strict(),
    workState: changeWorkStateSchema.optional(),
    evolution: changeEvolutionAssessmentSchema.optional(),
  })
  .strict();
export type ChangeProjection = z.infer<typeof changeProjectionSchema>;

export const lifecycleNodeIdSchema = z.enum([
  'proposal',
  'specs',
  'design',
  'tasks',
  'validation',
  'archive',
]);
export type LifecycleNodeId = z.infer<typeof lifecycleNodeIdSchema>;

export const lifecycleNodeStateSchema = z.enum([
  'complete',
  'current',
  'ready',
  'blocked',
  'pending',
  'unavailable',
  'archived',
]);
export type LifecycleNodeState = z.infer<typeof lifecycleNodeStateSchema>;

export const lifecycleEvidenceSourceSchema = z.enum([
  'structural',
  'openspec-cli',
  'local-comparison',
  'validation-cache',
  'directory',
]);
export type LifecycleEvidenceSource = z.infer<typeof lifecycleEvidenceSourceSchema>;

export const lifecycleEvidenceSchema = z
  .object({
    source: lifecycleEvidenceSourceSchema,
    summary: z.string().min(1).max(1000),
    relativePath: safeRelativePathSchema.optional(),
    line: z.number().int().positive().optional(),
    checkedAt: z.string().min(1).max(64).optional(),
  })
  .strict();
export type LifecycleEvidence = z.infer<typeof lifecycleEvidenceSchema>;

export const lifecycleArtifactStatusSchema = z.enum([
  'done',
  'skipped',
  'blocked',
  'pending',
  'unknown',
]);
export type LifecycleArtifactStatus = z.infer<typeof lifecycleArtifactStatusSchema>;

export const lifecycleArtifactSchema = z
  .object({
    id: localIdSchema,
    status: lifecycleArtifactStatusSchema,
    requires: z.array(localIdSchema).max(100),
    outputPath: z.string().min(1).max(1024).optional(),
    message: z.string().min(1).max(1000).optional(),
  })
  .strict();
export type LifecycleArtifact = z.infer<typeof lifecycleArtifactSchema>;

export const artifactGraphSchema = z
  .object({
    schemaName: z.string().min(1).max(160),
    source: z.enum(['openspec-cli', 'structural']),
    authoritative: z.boolean(),
    applyRequires: z.array(localIdSchema).max(100),
    artifacts: z.array(lifecycleArtifactSchema).max(100),
    message: z.string().min(1).max(1000).optional(),
  })
  .strict();
export type ArtifactGraph = z.infer<typeof artifactGraphSchema>;

export const openSpecDiagnosticSchema = z
  .object({
    severity: z.enum(['error', 'warning', 'info']),
    message: z.string().min(1).max(1000),
  })
  .strict();
export type OpenSpecDiagnostic = z.infer<typeof openSpecDiagnosticSchema>;

export const openSpecDoctorSummarySchema = z
  .object({
    healthy: z.boolean(),
    rootSource: z.string().min(1).max(120),
    relations: z
      .array(
        z
          .object({
            kind: z.enum(['store', 'reference']),
            status: z.string().min(1).max(120),
            relativePath: safeRelativePathSchema.optional(),
          })
          .strict(),
      )
      .max(100),
    diagnostics: z.array(openSpecDiagnosticSchema).max(100),
  })
  .strict();
export type OpenSpecDoctorSummary = z.infer<typeof openSpecDoctorSummarySchema>;

export const openSpecContextSummarySchema = z
  .object({
    rootRole: z.string().min(1).max(120),
    rootSource: z.string().min(1).max(120),
    members: z
      .array(
        z
          .object({
            role: z.string().min(1).max(120),
            status: z.string().min(1).max(120),
            relativePath: safeRelativePathSchema.optional(),
          })
          .strict(),
      )
      .max(100),
    diagnostics: z.array(openSpecDiagnosticSchema).max(100),
  })
  .strict();
export type OpenSpecContextSummary = z.infer<typeof openSpecContextSummarySchema>;

export const openSpecInstructionsSummarySchema = z
  .object({
    changeId: localIdSchema,
    target: localIdSchema,
    schemaName: z.string().min(1).max(160).optional(),
    state: z.enum(['ready', 'blocked', 'all_done']).optional(),
    dependencies: z.array(z.object({ id: localIdSchema, done: z.boolean() }).strict()).max(100),
    contextFiles: z
      .array(
        z
          .object({
            artifactId: localIdSchema,
            paths: z.array(safeRelativePathSchema).max(100),
          })
          .strict(),
      )
      .max(100),
    progress: z
      .object({
        total: z.number().int().nonnegative().max(1_000_000),
        complete: z.number().int().nonnegative().max(1_000_000),
        remaining: z.number().int().nonnegative().max(1_000_000),
      })
      .strict()
      .refine(
        (value) =>
          value.complete <= value.total && value.remaining === value.total - value.complete,
        { message: 'instructions 进度计数不一致' },
      )
      .optional(),
    instruction: z.string().min(1).max(4000).optional(),
  })
  .strict();
export type OpenSpecInstructionsSummary = z.infer<typeof openSpecInstructionsSummarySchema>;

export const lifecycleTaskGateSchema = z
  .object({
    applicable: z.boolean(),
    status: z.enum(['complete', 'incomplete', 'empty', 'not-applicable', 'unknown']),
    completed: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    remaining: z.number().int().nonnegative(),
    sourcePath: safeRelativePathSchema.optional(),
    message: z.string().min(1).max(1000).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const issue = (message: string): void => {
      context.addIssue({ code: 'custom', path: ['status'], message });
    };
    if (value.completed > value.total || value.remaining !== value.total - value.completed) {
      issue('任务计数不一致');
      return;
    }
    if (value.status === 'complete') {
      if (!value.applicable || value.total === 0 || value.completed !== value.total) {
        issue('complete 仅适用于非空且全部完成的任务清单');
      }
    } else if (value.status === 'incomplete') {
      if (!value.applicable || value.total === 0 || value.completed >= value.total) {
        issue('incomplete 仅适用于非空且仍有剩余任务的清单');
      }
    } else if (value.status === 'empty') {
      if (
        !value.applicable ||
        value.completed !== 0 ||
        value.total !== 0 ||
        value.remaining !== 0
      ) {
        issue('empty 仅适用于可读取的 0/0 任务清单');
      }
    } else if (value.status === 'not-applicable') {
      if (value.applicable || value.completed !== 0 || value.total !== 0 || value.remaining !== 0) {
        issue('not-applicable 必须使用零计数且 applicable 为 false');
      }
    } else if (!value.applicable) {
      issue('unknown 仅适用于 schema 要求 tasks 的 Change');
    }
  });
export type LifecycleTaskGate = z.infer<typeof lifecycleTaskGateSchema>;

export const validationStatusSchema = z.enum([
  'not-run',
  'running',
  'passed',
  'failed',
  'unavailable',
  'stale',
]);
export type ValidationStatus = z.infer<typeof validationStatusSchema>;

export const validationDiagnosticSchema = z
  .object({
    severity: z.enum(['error', 'warning', 'info']),
    message: z.string().min(1).max(1000),
    relativePath: safeRelativePathSchema.optional(),
    line: z.number().int().positive().optional(),
    capability: z.string().min(1).max(240).optional(),
    requirement: z.string().min(1).max(500).optional(),
  })
  .strict();
export type ValidationDiagnostic = z.infer<typeof validationDiagnosticSchema>;

export const validationAssessmentSchema = z
  .object({
    status: validationStatusSchema,
    source: z.enum(['openspec-cli', 'validation-cache']),
    checkedAt: z.string().min(1).max(64).optional(),
    fingerprint: z
      .string()
      .length(64)
      .regex(/^[a-f0-9]+$/)
      .optional(),
    cliVersion: z.string().min(1).max(160).optional(),
    staleReason: z.string().min(1).max(1000).optional(),
    message: z.string().min(1).max(1000).optional(),
    diagnostics: z.array(validationDiagnosticSchema).max(100),
  })
  .strict();
export type ValidationAssessment = z.infer<typeof validationAssessmentSchema>;

export const specOperationTypeSchema = z.enum(['ADDED', 'MODIFIED', 'REMOVED', 'RENAMED']);
export type SpecOperationType = z.infer<typeof specOperationTypeSchema>;

export const specDeltaOperationTargetKeySchema = z
  .string()
  .length(69)
  .regex(/^sdo1:[a-f0-9]{64}$/);
export type SpecDeltaOperationTargetKey = z.infer<typeof specDeltaOperationTargetKeySchema>;

export const specDeltaParseIssueSchema = z
  .object({
    code: z.enum([
      'duplicate-requirement',
      'ambiguous-rename',
      'missing-operation-boundary',
      'invalid-target-path',
      'malformed-delta',
      'main-spec-unavailable',
    ]),
    message: z.string().min(1).max(1000),
    sourcePath: safeRelativePathSchema,
    line: z.number().int().positive().max(10_000_000).optional(),
    requirementName: z.string().min(1).max(500).optional(),
  })
  .strict();
export type SpecDeltaParseIssue = z.infer<typeof specDeltaParseIssueSchema>;

export const specDeltaOperationEvidenceSchema = z
  .object({
    capabilityPath: safeRelativePathSchema,
    sourcePath: safeRelativePathSchema,
    targetPath: safeRelativePathSchema,
    operationType: specOperationTypeSchema,
    requirementName: z.string().min(1).max(500),
    renameFrom: z.string().min(1).max(500).optional(),
    renameTo: z.string().min(1).max(500).optional(),
    scenarios: z.array(z.string().min(1).max(500)).max(100),
    line: z.number().int().positive().max(10_000_000),
    targetKey: specDeltaOperationTargetKeySchema,
    contentFingerprint: sha256FingerprintSchema,
    normalizedBlock: z
      .string()
      .min(1)
      .max(128 * 1024),
  })
  .strict()
  .superRefine((value, context) => {
    const renamed = value.operationType === 'RENAMED';
    if (renamed !== Boolean(value.renameFrom && value.renameTo)) {
      context.addIssue({
        code: 'custom',
        path: ['renameFrom'],
        message: 'RENAMED operation 必须同时包含 renameFrom 和 renameTo',
      });
    }
    if (!renamed && (value.renameFrom || value.renameTo)) {
      context.addIssue({
        code: 'custom',
        path: ['renameFrom'],
        message: '非 RENAMED operation 不得包含 rename 字段',
      });
    }
  });
export type SpecDeltaOperationEvidence = z.infer<typeof specDeltaOperationEvidenceSchema>;

export const specOperationCountsSchema = z
  .object({
    added: z.number().int().nonnegative(),
    modified: z.number().int().nonnegative(),
    removed: z.number().int().nonnegative(),
    renamed: z.number().int().nonnegative(),
  })
  .strict();
export type SpecOperationCounts = z.infer<typeof specOperationCountsSchema>;

export const specSyncCapabilitySchema = z
  .object({
    capabilityPath: safeRelativePathSchema,
    status: z.enum(['pending', 'synced', 'unknown']),
    sourcePath: safeRelativePathSchema,
    targetPath: safeRelativePathSchema,
    operationCounts: specOperationCountsSchema,
    requirements: z.array(z.string().min(1).max(500)).max(200),
    scenarios: z.array(z.string().min(1).max(500)).max(500),
    operations: z.array(specDeltaOperationEvidenceSchema).max(200).optional(),
    parseIssues: z.array(specDeltaParseIssueSchema).max(100).optional(),
    conflicts: z.array(z.string().min(1).max(1000)).max(100),
  })
  .strict();
export type SpecSyncCapability = z.infer<typeof specSyncCapabilitySchema>;

export const specSyncStatusSchema = z.enum(['not-applicable', 'pending', 'synced', 'unknown']);
export type SpecSyncStatus = z.infer<typeof specSyncStatusSchema>;

export const specSyncAssessmentSchema = z
  .object({
    status: specSyncStatusSchema,
    source: z.literal('local-comparison'),
    checkedAt: z.string().min(1).max(64),
    capabilities: z.array(specSyncCapabilitySchema).max(200),
    summary: z
      .object({
        capabilityCount: z.number().int().nonnegative(),
        pendingCount: z.number().int().nonnegative(),
        syncedCount: z.number().int().nonnegative(),
        unknownCount: z.number().int().nonnegative(),
      })
      .strict(),
    message: z.string().min(1).max(1000).optional(),
  })
  .strict();
export type SpecSyncAssessment = z.infer<typeof specSyncAssessmentSchema>;

export const archiveReadinessStatusSchema = z.enum(['not-ready', 'ready', 'archived']);
export type ArchiveReadinessStatus = z.infer<typeof archiveReadinessStatusSchema>;

export const archiveGateSchema = z
  .object({
    id: z.enum([
      'artifacts',
      'tasks',
      'validation',
    ]),
    label: z.string().min(1).max(120),
    status: z.enum(['pass', 'fail', 'unknown']),
    evidence: z.array(lifecycleEvidenceSchema).max(100),
  })
  .strict();
export type ArchiveGate = z.infer<typeof archiveGateSchema>;

export const archiveReadinessSchema = z
  .object({
    status: archiveReadinessStatusSchema,
    gates: z.array(archiveGateSchema).max(10),
  })
  .strict();
export type ArchiveReadiness = z.infer<typeof archiveReadinessSchema>;

export const lifecycleNextActionKindSchema = z.enum([
  'recover-project',
  'complete-artifact',
  'continue-implementation',
  'run-validation',
  'fix-validation',
  'archive',
  'review-archive',
]);
export type LifecycleNextActionKind = z.infer<typeof lifecycleNextActionKindSchema>;

export const lifecycleNextActionSchema = z
  .object({
    kind: lifecycleNextActionKindSchema,
    targetNode: lifecycleNodeIdSchema,
    targetArtifactId: localIdSchema.optional(),
    title: z.string().min(1).max(240),
    description: z.string().min(1).max(1000),
  })
  .strict();
export type LifecycleNextAction = z.infer<typeof lifecycleNextActionSchema>;

export const lifecycleBlockerSchema = z
  .object({
    code: z.enum([
      'project-unavailable',
      'artifact-incomplete',
      'artifact-unknown',
      'tasks-incomplete',
      'tasks-unknown',
      'validation-required',
      'validation-failed',
      'validation-unavailable',
      'validation-stale',
    ]),
    node: lifecycleNodeIdSchema,
    title: z.string().min(1).max(240),
    detail: z.string().min(1).max(1000),
    evidence: z.array(lifecycleEvidenceSchema).max(100),
  })
  .strict();
export type LifecycleBlocker = z.infer<typeof lifecycleBlockerSchema>;

export const lifecycleNodeSchema = z
  .object({
    id: lifecycleNodeIdSchema,
    label: z.string().min(1).max(120),
    state: lifecycleNodeStateSchema,
    source: lifecycleEvidenceSourceSchema,
    evidence: z.array(lifecycleEvidenceSchema).max(100),
  })
  .strict();
export type LifecycleNode = z.infer<typeof lifecycleNodeSchema>;

export const changeLifecycleAssessmentSchema = z
  .object({
    schemaVersion: z.literal(1),
    projectId: localIdSchema,
    changeId: localIdSchema,
    archiveKey: z
      .string()
      .min(1)
      .max(200)
      .regex(/^(?:active|archive):/),
    archived: z.boolean(),
    projectAvailable: z.boolean(),
    contentFingerprint: z
      .string()
      .length(64)
      .regex(/^[a-f0-9]+$/),
    evaluatedAt: z.string().min(1).max(64),
    nodes: z.array(lifecycleNodeSchema).min(1).max(6),
    artifactGraph: artifactGraphSchema,
    taskGate: lifecycleTaskGateSchema,
    validation: validationAssessmentSchema,
    sync: specSyncAssessmentSchema,
    archiveReadiness: archiveReadinessSchema,
    nextAction: lifecycleNextActionSchema,
    blockers: z.array(lifecycleBlockerSchema).max(100),
    workState: changeWorkStateSchema.optional(),
    evolution: changeEvolutionAssessmentSchema.optional(),
  })
  .strict();
export type ChangeLifecycleAssessment = z.infer<typeof changeLifecycleAssessmentSchema>;

export const actionCenterActionKeySchema = z
  .string()
  .length(68)
  .regex(/^ac1:[a-f0-9]{64}$/);
export const actionCenterActionTypeSchema = z.enum([
  'project-health',
  'complete-artifact',
  'continue-implementation',
  'run-validation',
  'fix-validation',
  'archive',
  'archive-integrity',
]);
export type ActionCenterActionType = z.infer<typeof actionCenterActionTypeSchema>;

export const actionCenterEvidenceSchema = z
  .object({
    source: z.enum([
      'openspec-cli',
      'structural',
      'local-work-state',
      'local-comparison',
      'validation-cache',
      'directory',
    ]),
    kind: z
      .enum([
        'primary',
      ])
      .optional(),
    summary: z.string().min(1).max(1000),
    relativePath: safeRelativePathSchema.optional(),
    line: z.number().int().positive().max(10_000_000).optional(),
    targetKey: specDeltaOperationTargetKeySchema.optional(),
    contentFingerprint: sha256FingerprintSchema.optional(),
    expectedFingerprint: sha256FingerprintSchema.optional(),
    checkedAt: observedAtSchema,
  })
  .strict();
export type ActionCenterEvidence = z.infer<typeof actionCenterEvidenceSchema>;

export const actionCenterProjectHealthSchema = z
  .object({
    projectId: localIdSchema,
    projectName: z.string().min(1).max(160),
    projectRoot: z.string().min(1).max(4096),
    status: z.enum(['healthy', 'degraded', 'unavailable']),
    source: z.enum(['openspec-cli', 'structural']),
    checkedAt: observedAtSchema,
    rootRole: z.string().min(1).max(120).optional(),
    doctor: openSpecDoctorSummarySchema.optional(),
    context: openSpecContextSummarySchema.optional(),
    diagnostics: z.array(z.string().min(1).max(1000)).max(100),
  })
  .strict();
export type ActionCenterProjectHealth = z.infer<typeof actionCenterProjectHealthSchema>;

export const actionCenterItemSchema = z
  .object({
    actionKey: actionCenterActionKeySchema,
    evidenceFingerprint: sha256FingerprintSchema,
    projectId: localIdSchema,
    projectName: z.string().min(1).max(160),
    projectRoot: z.string().min(1).max(4096),
    changeId: localIdSchema.optional(),
    archived: z.boolean(),
    actionType: actionCenterActionTypeSchema,
    priority: z.number().int().min(0).max(5),
    title: z.string().min(1).max(240),
    description: z.string().min(1).max(1000),
    targetNode: lifecycleNodeIdSchema,
    targetArtifactId: localIdSchema.optional(),
    evidence: z.array(actionCenterEvidenceSchema).max(100),
    taskGate: lifecycleTaskGateSchema.optional(),
    workState: changeWorkStateSchema.optional(),
    evolution: changeEvolutionAssessmentSchema.optional(),
    lastActivityAt: observedAtSchema.optional(),
  })
  .strict();
export type ActionCenterItem = z.infer<typeof actionCenterItemSchema>;

export const actionCenterScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }).strict(),
  z.object({ kind: z.literal('project'), projectId: localIdSchema }).strict(),
]);
export type ActionCenterScope = z.infer<typeof actionCenterScopeSchema>;

export const actionCenterSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    scope: actionCenterScopeSchema,
    status: z.enum(['complete', 'partial']),
    generatedAt: observedAtSchema,
    projects: z.array(actionCenterProjectHealthSchema).max(500),
    items: z.array(actionCenterItemSchema).max(5000),
    diagnostics: z
      .array(z.object({ projectId: localIdSchema, message: z.string().min(1).max(1000) }).strict())
      .max(500),
    summary: z
      .object({
        projectCount: z.number().int().nonnegative().max(500),
        actionCount: z.number().int().nonnegative().max(5000),
        degradedProjectCount: z.number().int().nonnegative().max(500),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.summary.projectCount !== value.projects.length ||
      value.summary.actionCount !== value.items.length ||
      value.summary.degradedProjectCount !==
        value.projects.filter((project) => project.status !== 'healthy').length
    ) {
      context.addIssue({ code: 'custom', path: ['summary'], message: '行动中心汇总计数不一致' });
    }
  });
export type ActionCenterSnapshot = z.infer<typeof actionCenterSnapshotSchema>;

export const codexHandoffSchema = z
  .object({
    schemaVersion: z.literal(1),
    actionKey: actionCenterActionKeySchema,
    evidenceFingerprint: sha256FingerprintSchema,
    generatedAt: observedAtSchema,
    stale: z.boolean(),
    title: z.string().min(1).max(240),
    markdown: z
      .string()
      .min(1)
      .max(256 * 1024),
    currentAction: actionCenterItemSchema.optional(),
  })
  .strict();
export type CodexHandoff = z.infer<typeof codexHandoffSchema>;

export const legacyProjectGroupSchema = z
  .object({
    id: localIdSchema,
    name: z.string().min(1).max(120),
    order: z.number().int().nonnegative(),
  })
  .strict();
export type LegacyProjectGroup = z.infer<typeof legacyProjectGroupSchema>;

export const normalizedSourceRootPathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => value === value.trim(), '来源路径不得包含首尾空白')
  .refine((value) => !/^\\\\\?\\/.test(value), '来源路径不得包含 Windows 扩展路径前缀')
  .refine(
    (value) => /^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+|\/)/.test(value),
    '来源路径必须是绝对路径',
  )
  .refine(
    (value) => !/[\\/]$/.test(value) || /^(?:[A-Za-z]:[\\/]|\/)$/.test(value),
    '来源路径必须移除尾部分隔符',
  );

export const manualProjectGroupSchema = z
  .object({
    id: localIdSchema,
    name: z.string().min(1).max(120),
    order: z.number().int().nonnegative(),
    kind: z.literal('manual'),
  })
  .strict();

export const codexWorkspaceProjectGroupSchema = z
  .object({
    id: localIdSchema,
    name: z.string().min(1).max(120),
    order: z.number().int().nonnegative(),
    kind: z.literal('codex-workspace'),
    sourceRootPath: normalizedSourceRootPathSchema,
  })
  .strict();

export const projectGroupSchema = z.discriminatedUnion('kind', [
  manualProjectGroupSchema,
  codexWorkspaceProjectGroupSchema,
]);
export type ProjectGroup = z.infer<typeof projectGroupSchema>;

export const versionModeSchema = z.enum(['automatic', 'manual']);
export type VersionMode = z.infer<typeof versionModeSchema>;

export const versionSourceSchema = workStateVersionSourceSchema;
export type VersionSource = z.infer<typeof versionSourceSchema>;

export const versionKeySchema = z.string().min(1).max(128);

const legacyProjectRecordShape = {
  id: localIdSchema,
  rootPath: z.string().min(1),
  displayName: z.string().min(1).max(160),
  versionLabel: z.string().max(120),
  groupId: localIdSchema.nullable(),
  order: z.number().int().nonnegative(),
  watcherEnabled: z.boolean(),
  watcherState: watcherStateSchema,
  available: z.boolean(),
  registeredAt: z.string().min(1),
  lastScannedAt: z.string().optional(),
  lastActivityAt: z.string().optional(),
  error: z.string().optional(),
} as const;

export const legacyProjectRecordSchema = z.object(legacyProjectRecordShape).strict();
export type LegacyProjectRecord = z.infer<typeof legacyProjectRecordSchema>;

export const projectRecordSchema = z
  .object({
    ...legacyProjectRecordShape,
    versionMode: versionModeSchema,
    versionSource: versionSourceSchema,
    versionResolvedAt: z.string().min(1).optional(),
  })
  .strict();
export type ProjectRecord = z.infer<typeof projectRecordSchema>;

export const projectSnapshotSchema = z
  .object({
    project: projectRecordSchema,
    groups: z.array(projectGroupSchema),
    changes: z.array(changeProjectionSchema),
    specs: z.array(artifactProjectionSchema),
    scannedAt: z.string().min(1),
    workStateDiagnostic: changeWorkStateDiagnosticSchema.optional(),
  })
  .strict();
export type ProjectSnapshot = z.infer<typeof projectSnapshotSchema>;

export const revisionSchema = z
  .object({
    id: localIdSchema,
    projectId: localIdSchema,
    relativePath: safeRelativePathSchema,
    changeId: localIdSchema.optional(),
    artifactType: artifactTypeSchema,
    contentHash: z
      .string()
      .length(64)
      .regex(/^[a-f0-9]+$/),
    snapshotPath: z.string().min(1),
    createdAt: z.string().min(1),
    size: z.number().int().nonnegative(),
    projectVersion: z.string(),
    priorRevisionId: localIdSchema.nullable(),
    taskDelta: z
      .object({ completed: z.number().int(), total: z.number().int() })
      .strict()
      .optional(),
  })
  .strict();
export type Revision = z.infer<typeof revisionSchema>;

export const activityKindSchema = z.enum([
  'artifact-change',
  'task-progress',
  'archive-integrity',
  'watcher-state',
  'recovery',
  'project-registration',
  'project-settings',
]);
export type ActivityKind = z.infer<typeof activityKindSchema>;

export const activityEntrySchema = z
  .object({
    id: localIdSchema,
    projectId: localIdSchema,
    kind: activityKindSchema,
    createdAt: z.string().min(1),
    relativePath: safeRelativePathSchema.optional(),
    changeId: localIdSchema.optional(),
    artifactType: artifactTypeSchema.optional(),
    projectVersion: z.string(),
    summary: z.string().min(1),
    semanticKey: sha256FingerprintSchema.optional(),
    taskDelta: z
      .object({ completed: z.number().int(), total: z.number().int() })
      .strict()
      .optional(),
  })
  .strict();
export type ActivityEntry = z.infer<typeof activityEntrySchema>;

export const projectionUpdateDomainSchema = z.enum([
  'snapshot',
  'history',
  'lifecycle',
  'action-center',
]);
export type ProjectionUpdateDomain = z.infer<typeof projectionUpdateDomainSchema>;

export const projectionEventSchema = z
  .object({
    type: z.enum(['project-updated', 'watcher-state', 'history-updated']),
    projectId: localIdSchema,
    changeIds: z.array(localIdSchema),
    domains: z.array(projectionUpdateDomainSchema).min(1).max(5).optional(),
    emittedAt: z.string().min(1),
    snapshot: projectSnapshotSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.domains && new Set(value.domains).size !== value.domains.length) {
      context.addIssue({
        code: 'custom',
        path: ['domains'],
        message: 'projection update domains 必须唯一',
      });
    }
  });
export type ProjectionEvent = z.infer<typeof projectionEventSchema>;

export const catalogPreferencesSchema = z
  .object({
    selectedProjectId: localIdSchema.nullable(),
    selectedChangeId: localIdSchema.nullable(),
    showArchived: z.boolean(),
    windowBounds: z
      .object({
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        x: z.number().int().optional(),
        y: z.number().int().optional(),
      })
      .strict(),
  })
  .strict();

export const catalogStateV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    groups: z.array(legacyProjectGroupSchema),
    projects: z.array(legacyProjectRecordSchema),
    preferences: catalogPreferencesSchema,
  })
  .strict();

export const catalogStateV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    groups: z.array(legacyProjectGroupSchema),
    projects: z.array(projectRecordSchema),
    preferences: catalogPreferencesSchema,
  })
  .strict();
export type CatalogStateV2 = z.infer<typeof catalogStateV2Schema>;

export const catalogStateSchema = z
  .object({
    schemaVersion: z.literal(3),
    groups: z.array(projectGroupSchema),
    projects: z.array(projectRecordSchema),
    preferences: catalogPreferencesSchema,
  })
  .strict();
export type CatalogState = z.infer<typeof catalogStateSchema>;

export const appSnapshotSchema = z
  .object({
    catalog: catalogStateSchema,
    projects: z.array(projectSnapshotSchema),
  })
  .strict();
export type AppSnapshot = z.infer<typeof appSnapshotSchema>;

export const codexImportItemResultSchema = z
  .object({
    rootPath: z.string().min(1).max(4096),
    displayName: z.string().min(1).max(160),
    status: z.enum(['imported', 'already-added', 'failed']),
    projectId: localIdSchema.optional(),
    workspace: codexWorkspaceReferenceSchema.optional(),
    workspaceGroupId: localIdSchema.optional(),
    error: z.string().min(1).max(500).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === 'imported' && !value.projectId) {
      context.addIssue({
        code: 'custom',
        path: ['projectId'],
        message: '成功导入结果必须包含项目 ID',
      });
    }
    if (value.status === 'failed' && !value.error) {
      context.addIssue({
        code: 'custom',
        path: ['error'],
        message: '失败导入结果必须包含错误原因',
      });
    }
    if (value.workspaceGroupId && !value.workspace) {
      context.addIssue({
        code: 'custom',
        path: ['workspaceGroupId'],
        message: '工作区分组关联必须包含工作区身份',
      });
    }
  });
export type CodexImportItemResult = z.infer<typeof codexImportItemResultSchema>;

export const codexImportResultSchema = z
  .object({
    snapshot: appSnapshotSchema,
    items: z.array(codexImportItemResultSchema).min(1).max(50),
  })
  .strict();
export type CodexImportResult = z.infer<typeof codexImportResultSchema>;

export const retentionSettingsSchema = z
  .object({
    revisionsPerArtifact: z.number().int().min(1).max(500),
    activityPerProject: z.number().int().min(1).max(10000),
  })
  .strict();
export type RetentionSettings = z.infer<typeof retentionSettingsSchema>;

export const historyIndexSchema = z
  .object({
    schemaVersion: z.literal(1),
    revisions: z.array(revisionSchema),
    activity: z.array(activityEntrySchema),
    retention: retentionSettingsSchema,
  })
  .strict();
export type HistoryIndex = z.infer<typeof historyIndexSchema>;

export const historyPageSchema = z
  .object({
    items: z.array(z.union([revisionSchema, activityEntrySchema])),
    nextCursor: z.string().nullable(),
  })
  .strict();

export const revisionPageSchema = z
  .object({
    items: z.array(revisionSchema),
    nextCursor: z.string().nullable(),
  })
  .strict();
export type RevisionPage = z.infer<typeof revisionPageSchema>;

export const activityPageSchema = z
  .object({
    items: z.array(activityEntrySchema),
    nextCursor: z.string().nullable(),
  })
  .strict();
export type ActivityPage = z.infer<typeof activityPageSchema>;

export const versionSummarySchema = z
  .object({
    key: versionKeySchema,
    label: z.string().min(1).max(120),
    source: versionSourceSchema.optional(),
    isCurrent: z.boolean(),
    activityCount: z.number().int().nonnegative(),
    revisionCount: z.number().int().nonnegative(),
    firstSeenAt: z.string().min(1),
    lastSeenAt: z.string().min(1),
    changeIds: z.array(localIdSchema),
  })
  .strict();
export type VersionSummary = z.infer<typeof versionSummarySchema>;

export const versionSummaryListSchema = z
  .object({
    items: z.array(versionSummarySchema).max(500),
    currentKey: versionKeySchema,
  })
  .strict();
export type VersionSummaryList = z.infer<typeof versionSummaryListSchema>;

export const diffHunkSchema = z
  .object({
    kind: z.enum(['added', 'removed', 'unchanged']),
    value: z.string(),
    lineCount: z.number().int().nonnegative(),
  })
  .strict();
export type DiffHunk = z.infer<typeof diffHunkSchema>;

export const revisionComparisonSchema = z
  .object({
    left: revisionSchema,
    right: revisionSchema,
    hunks: z.array(diffHunkSchema),
    truncated: z.boolean(),
  })
  .strict();
export type RevisionComparison = z.infer<typeof revisionComparisonSchema>;

export const scanOptionsSchema = z
  .object({
    maxFileBytes: z
      .number()
      .int()
      .positive()
      .max(50 * 1024 * 1024)
      .optional(),
  })
  .strict();
export type ScanOptions = z.infer<typeof scanOptionsSchema>;
