import { z } from 'zod';
import {
  actionCenterActionKeySchema,
  codexWorkspaceReferenceSchema,
  localIdSchema,
  retentionSettingsSchema,
  safeRelativePathSchema,
  scanOptionsSchema,
  sha256FingerprintSchema,
  versionKeySchema,
  versionModeSchema,
} from './contracts';

export const ipcChannelSchema = z.enum([
  'catalog:get-snapshot',
  'catalog:update-preferences',
  'catalog:select-project',
  'catalog:register-project',
  'catalog:update-project',
  'catalog:relocate-project',
  'catalog:select-relocation',
  'catalog:unregister-project',
  'catalog:create-group',
  'catalog:update-group',
  'catalog:remove-group',
  'codex:list-projects',
  'codex:import-projects',
  'project:scan',
  'project:get-snapshot',
  'project:rescan',
  'history:list-revisions',
  'history:list-activity',
  'history:list-version-summaries',
  'history:compare',
  'history:clear',
  'history:get-retention',
  'history:set-retention',
  'project:refresh-version',
  'lifecycle:get-change',
  'lifecycle:run-validation',
  'action-center:get',
  'action-center:refresh',
  'action-center:build-handoff',
  'action-center:copy-handoff',
  'system:reveal-artifact',
  'system:reveal-user-data',
  'system:get-user-data-path',
  'system:open-external',
]);
export type IpcChannel = z.infer<typeof ipcChannelSchema>;

export const emptyRequestSchema = z.object({}).strict();

export const projectIdRequestSchema = z.object({ projectId: localIdSchema }).strict();
export type ProjectIdRequest = z.infer<typeof projectIdRequestSchema>;

export const updatePreferencesRequestSchema = z
  .object({
    selectedProjectId: localIdSchema.nullable().optional(),
    selectedChangeId: localIdSchema.nullable().optional(),
    showArchived: z.boolean().optional(),
  })
  .strict();
export type UpdatePreferencesRequest = z.infer<typeof updatePreferencesRequestSchema>;

export const registerProjectRequestSchema = z
  .object({
    rootPath: z.string().min(1).max(4096),
    displayName: z.string().min(1).max(160).optional(),
    versionLabel: z.string().max(120).optional(),
    versionMode: versionModeSchema.optional(),
    groupId: localIdSchema.nullable().optional(),
  })
  .strict();
export type RegisterProjectRequest = z.infer<typeof registerProjectRequestSchema>;

export const updateProjectRequestSchema = z
  .object({
    projectId: localIdSchema,
    displayName: z.string().min(1).max(160).optional(),
    versionLabel: z.string().max(120).optional(),
    versionMode: versionModeSchema.optional(),
    groupId: localIdSchema.nullable().optional(),
    order: z.number().int().nonnegative().optional(),
    watcherEnabled: z.boolean().optional(),
  })
  .strict();
export type UpdateProjectRequest = z.infer<typeof updateProjectRequestSchema>;

export const relocateProjectRequestSchema = z
  .object({
    projectId: localIdSchema,
    rootPath: z.string().min(1).max(4096),
  })
  .strict();
export type RelocateProjectRequest = z.infer<typeof relocateProjectRequestSchema>;

export const selectRelocationRequestSchema = projectIdRequestSchema;
export type SelectRelocationRequest = z.infer<typeof selectRelocationRequestSchema>;

export const groupMutationRequestSchema = z
  .object({
    groupId: localIdSchema,
    name: z.string().min(1).max(120).optional(),
    order: z.number().int().nonnegative().optional(),
  })
  .strict();
export type GroupMutationRequest = z.infer<typeof groupMutationRequestSchema>;

export const createGroupRequestSchema = z
  .object({
    name: z.string().min(1).max(120),
    order: z.number().int().nonnegative().optional(),
  })
  .strict();
export type CreateGroupRequest = z.infer<typeof createGroupRequestSchema>;

export const codexListProjectsRequestSchema = emptyRequestSchema;
export type CodexListProjectsRequest = z.infer<typeof codexListProjectsRequestSchema>;

export const codexImportProjectsRequestSchema = z
  .object({
    projects: z
      .array(
        z
          .object({
            rootPath: z.string().min(1).max(4096),
            displayName: z.string().min(1).max(160),
            workspace: codexWorkspaceReferenceSchema.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();
export type CodexImportProjectsRequest = z.infer<typeof codexImportProjectsRequestSchema>;

export const scanRequestSchema = projectIdRequestSchema.merge(scanOptionsSchema);
export type ScanRequest = z.infer<typeof scanRequestSchema>;

export const changeLifecycleRequestSchema = z
  .object({
    projectId: localIdSchema,
    changeId: localIdSchema,
    archived: z.boolean(),
  })
  .strict();
export type ChangeLifecycleRequest = z.infer<typeof changeLifecycleRequestSchema>;

export const runChangeValidationRequestSchema = z
  .object({
    projectId: localIdSchema,
    changeId: localIdSchema,
  })
  .strict();
export type RunChangeValidationRequest = z.infer<typeof runChangeValidationRequestSchema>;

export const actionCenterRequestSchema = z.object({ projectId: localIdSchema.optional() }).strict();
export type ActionCenterRequest = z.infer<typeof actionCenterRequestSchema>;

export const buildCodexHandoffRequestSchema = z
  .object({
    actionKey: actionCenterActionKeySchema,
    evidenceFingerprint: sha256FingerprintSchema,
  })
  .strict();
export type BuildCodexHandoffRequest = z.infer<typeof buildCodexHandoffRequestSchema>;

export const historyListRequestSchema = z
  .object({
    projectId: localIdSchema,
    relativePath: safeRelativePathSchema.optional(),
    changeId: localIdSchema.optional(),
    versionKey: versionKeySchema.optional(),
    artifactType: z.enum(['config', 'proposal', 'spec', 'design', 'tasks', 'metadata']).optional(),
    cursor: z.string().max(256).optional(),
    limit: z.number().int().min(1).max(200).default(50),
  })
  .strict();
export type HistoryListRequest = z.infer<typeof historyListRequestSchema>;

export const versionSummaryListRequestSchema = projectIdRequestSchema;
export type VersionSummaryListRequest = z.infer<typeof versionSummaryListRequestSchema>;

export const refreshVersionRequestSchema = projectIdRequestSchema;
export type RefreshVersionRequest = z.infer<typeof refreshVersionRequestSchema>;

export const historyRevisionListRequestSchema = historyListRequestSchema
  .extend({
    relativePath: safeRelativePathSchema,
  })
  .strict();
export type HistoryRevisionListRequest = z.infer<typeof historyRevisionListRequestSchema>;

export const compareRevisionsRequestSchema = z
  .object({
    projectId: localIdSchema,
    relativePath: safeRelativePathSchema,
    leftRevisionId: localIdSchema,
    rightRevisionId: localIdSchema,
    maxLines: z.number().int().min(1).max(2000).default(1000),
  })
  .strict();
export type CompareRevisionsRequest = z.infer<typeof compareRevisionsRequestSchema>;

export const clearHistoryRequestSchema = z
  .object({
    projectId: localIdSchema,
    confirm: z.literal(true),
    retention: retentionSettingsSchema.optional(),
  })
  .strict();
export type ClearHistoryRequest = z.infer<typeof clearHistoryRequestSchema>;

export const setRetentionRequestSchema = z
  .object({
    projectId: localIdSchema,
    retention: retentionSettingsSchema,
  })
  .strict();
export type SetRetentionRequest = z.infer<typeof setRetentionRequestSchema>;

export const revealArtifactRequestSchema = z
  .object({
    projectId: localIdSchema,
    sourcePath: safeRelativePathSchema,
  })
  .strict();
export type RevealArtifactRequest = z.infer<typeof revealArtifactRequestSchema>;

export const openExternalRequestSchema = z
  .object({
    url: z
      .string()
      .url()
      .max(2048)
      .refine((value) => {
        try {
          return new URL(value).protocol === 'https:';
        } catch {
          return false;
        }
      }, '仅允许 HTTPS 外部链接'),
  })
  .strict();
export type OpenExternalRequest = z.infer<typeof openExternalRequestSchema>;
