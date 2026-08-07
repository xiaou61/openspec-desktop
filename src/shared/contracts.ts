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

export const codexProjectCandidateStatusSchema = z.enum([
  'available',
  'already-added',
  'missing',
  'invalid-openspec',
]);
export type CodexProjectCandidateStatus = z.infer<typeof codexProjectCandidateStatusSchema>;

export const codexProjectCandidateSchema = z
  .object({
    id: localIdSchema,
    displayName: z.string().min(1).max(160),
    rootPath: z.string().min(1).max(4096),
    source: z.enum(['local-project', 'saved-workspace']),
    lastUsedAt: z.string().min(1).max(64).optional(),
    status: codexProjectCandidateStatusSchema,
    reason: z.string().min(1).max(500).optional(),
  })
  .strict();
export type CodexProjectCandidate = z.infer<typeof codexProjectCandidateSchema>;

export const codexScanSummarySchema = z
  .object({
    source: z.enum(['primary', 'backup', 'unavailable']),
    candidateCount: z.number().int().nonnegative().max(500),
    availableCount: z.number().int().nonnegative().max(500),
    truncated: z.boolean(),
    message: z.string().min(1).max(500).optional(),
  })
  .strict();
export type CodexScanSummary = z.infer<typeof codexScanSummarySchema>;

export const codexProjectListSchema = z
  .object({
    candidates: z.array(codexProjectCandidateSchema).max(500),
    summary: codexScanSummarySchema,
    scannedAt: z.string().min(1).max(64),
  })
  .strict();
export type CodexProjectList = z.infer<typeof codexProjectListSchema>;

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
  })
  .strict();
export type ChangeProjection = z.infer<typeof changeProjectionSchema>;

export const projectGroupSchema = z
  .object({
    id: localIdSchema,
    name: z.string().min(1).max(120),
    order: z.number().int().nonnegative(),
  })
  .strict();
export type ProjectGroup = z.infer<typeof projectGroupSchema>;

export const projectRecordSchema = z
  .object({
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
    taskDelta: z
      .object({ completed: z.number().int(), total: z.number().int() })
      .strict()
      .optional(),
  })
  .strict();
export type ActivityEntry = z.infer<typeof activityEntrySchema>;

export const projectionEventSchema = z
  .object({
    type: z.enum(['project-updated', 'watcher-state', 'history-updated']),
    projectId: localIdSchema,
    changeIds: z.array(localIdSchema),
    emittedAt: z.string().min(1),
    snapshot: projectSnapshotSchema.optional(),
  })
  .strict();
export type ProjectionEvent = z.infer<typeof projectionEventSchema>;

export const catalogStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    groups: z.array(projectGroupSchema),
    projects: z.array(projectRecordSchema),
    preferences: z
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
      .strict(),
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
    error: z.string().min(1).max(500).optional(),
  })
  .strict();
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
