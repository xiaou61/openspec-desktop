import type {
  ActivityPage,
  AppSnapshot,
  CodexImportResult,
  CodexProjectList,
  ProjectionEvent,
  RevisionComparison,
  RevisionPage,
  RetentionSettings,
  VersionSummaryList,
} from './contracts';
import type {
  ClearHistoryRequest,
  CodexImportProjectsRequest,
  CompareRevisionsRequest,
  CreateGroupRequest,
  GroupMutationRequest,
  HistoryListRequest,
  HistoryRevisionListRequest,
  RefreshVersionRequest,
  RegisterProjectRequest,
  RelocateProjectRequest,
  SelectRelocationRequest,
  RevealArtifactRequest,
  SetRetentionRequest,
  UpdateProjectRequest,
  UpdatePreferencesRequest,
  VersionSummaryListRequest,
} from './ipc-contracts';

export interface DesktopApi {
  runtime: {
    platform: string;
  };
  getSnapshot(): Promise<AppSnapshot>;
  updatePreferences(request: UpdatePreferencesRequest): Promise<AppSnapshot>;
  selectProject(): Promise<AppSnapshot | null>;
  registerProject(request: RegisterProjectRequest): Promise<AppSnapshot>;
  listCodexProjects(): Promise<CodexProjectList>;
  importCodexProjects(request: CodexImportProjectsRequest): Promise<CodexImportResult>;
  updateProject(request: UpdateProjectRequest): Promise<AppSnapshot>;
  relocateProject(request: RelocateProjectRequest): Promise<AppSnapshot>;
  selectRelocation(request: SelectRelocationRequest): Promise<AppSnapshot | null>;
  unregisterProject(request: { projectId: string }): Promise<AppSnapshot>;
  createGroup(request: CreateGroupRequest): Promise<AppSnapshot>;
  updateGroup(request: GroupMutationRequest): Promise<AppSnapshot>;
  removeGroup(request: { groupId: string }): Promise<AppSnapshot>;
  rescanProject(request: { projectId: string }): Promise<AppSnapshot>;
  refreshVersion(request: RefreshVersionRequest): Promise<AppSnapshot>;
  listRevisions(request: HistoryRevisionListRequest): Promise<RevisionPage>;
  listActivity(request: HistoryListRequest): Promise<ActivityPage>;
  listVersionSummaries(request: VersionSummaryListRequest): Promise<VersionSummaryList>;
  compareRevisions(request: CompareRevisionsRequest): Promise<RevisionComparison>;
  clearHistory(request: ClearHistoryRequest): Promise<AppSnapshot>;
  getRetention(request: { projectId: string }): Promise<RetentionSettings>;
  setRetention(request: SetRetentionRequest): Promise<RetentionSettings>;
  revealArtifact(request: RevealArtifactRequest): Promise<void>;
  revealUserData(): Promise<void>;
  getUserDataPath(): Promise<string>;
  openExternal(url: string): Promise<void>;
  onProjection(listener: (event: ProjectionEvent) => void): () => void;
}
