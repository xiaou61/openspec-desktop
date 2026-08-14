import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type {
  ArtifactGraph,
  CatalogState,
  OpenSpecContextSummary,
  OpenSpecDoctorSummary,
  OpenSpecInstructionsSummary,
  ProjectRecord,
  ValidationAssessment,
} from '@shared/contracts';
import { createActionCenterDiskFixture } from '../../../tests/fixtures/action-center-project';
import { scanOpenSpecProject, type ProjectScanResult } from '../domain/scanner';
import { HistoryStore } from '../history/history-store';
import { LifecycleService } from '../lifecycle/lifecycle-service';
import {
  createStructuralArtifactGraph,
  type RestrictedOpenSpecCli,
} from '../lifecycle/openspec-cli';
import { ChangeWorkStateService } from '../work-state/change-work-state-service';
import { ChangeWorkStateStore } from '../work-state/change-work-state-store';
import { ActionCenterService } from './action-center-service';

function project(id: string, rootPath: string, order: number): ProjectRecord {
  return {
    id,
    rootPath,
    displayName: id === 'project-primary' ? 'Primary' : 'Secondary',
    versionLabel: 'v1',
    versionMode: 'manual',
    versionSource: 'manual',
    groupId: null,
    order,
    watcherEnabled: true,
    watcherState: 'watching',
    available: true,
    registeredAt: '2026-08-10T07:00:00.000Z',
  };
}

describe('action-center real disk fixture', () => {
  it('covers iteration, empty, custom schema, partial projects, evolution and archive integrity', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'action-center-real-fixture-'));
    try {
      const fixture = await createActionCenterDiskFixture(root);
      const userData = join(root, 'user-data');
      const primary = project('project-primary', fixture.primaryRoot, 0);
      const secondary = project('project-secondary', fixture.secondaryRoot, 1);
      const scans = new Map<string, ProjectScanResult>();
      const refreshScan = async (record: ProjectRecord): Promise<ProjectScanResult> => {
        const next = await scanOpenSpecProject(record.rootPath);
        scans.set(record.rootPath, next);
        return next;
      };
      const status: RestrictedOpenSpecCli['status'] = async (projectRoot, changeId) => {
        if (changeId === 'custom-artifact') {
          return {
            schemaName: 'custom-workflow',
            source: 'openspec-cli',
            authoritative: true,
            applyRequires: ['proposal', 'deploy'],
            artifacts: [
              { id: 'proposal', status: 'done', requires: [] },
              { id: 'deploy', status: 'pending', requires: ['proposal'] },
            ],
          };
        }
        const change = scans
          .get(projectRoot)
          ?.changes.find((entry) => entry.id === changeId && !entry.archived);
        if (!change) throw new Error('Change unavailable');
        const graph = createStructuralArtifactGraph(change);
        delete graph.message;
        return { ...graph, source: 'openspec-cli', authoritative: true } as ArtifactGraph;
      };
      const validate: RestrictedOpenSpecCli['validate'] = async (
        _projectRoot,
        _changeId,
        options,
      ): Promise<ValidationAssessment> => ({
        status: 'passed',
        source: 'openspec-cli',
        checkedAt: options.checkedAt,
        fingerprint: options.fingerprint,
        diagnostics: [],
      });
      const lifecycle = new LifecycleService({ userDataPath: userData, cli: { status, validate } });
      const store = new ChangeWorkStateStore(userData);
      const history = new HistoryStore(userData, primary.id);
      await history.init();
      const workStates = new ChangeWorkStateService({
        store,
        lifecycle,
        historyForProject: async () => history,
      });

      let primaryScan = await refreshScan(primary);
      const secondaryScan = await refreshScan(secondary);
      await workStates.reconcile({ project: primary, scan: primaryScan });
      expect(store.snapshot(primary.id).active['completed-then-expanded']).toMatchObject({
        iteration: 1,
        phase: 'completed',
      });
      expect(store.snapshot(primary.id).active['first-incomplete']).toMatchObject({
        iteration: 1,
        phase: 'initial-in-progress',
      });
      expect(store.snapshot(primary.id).active['empty-tasks']).toMatchObject({
        iteration: 1,
        phase: 'observing',
      });
      expect(store.snapshot(primary.id).active['capability-iteration']?.evolution?.status).toBe(
        'iteration',
      );
      expect(store.snapshot(primary.id).archived['archived-change']?.archiveIntegrity?.status).toBe(
        'baseline',
      );

      const emptyChange = primaryScan.changes.find((entry) => entry.id === 'empty-tasks')!;
      const emptyAssessment = await lifecycle.getAssessment({
        projectId: primary.id,
        projectRoot: primary.rootPath,
        projectAvailable: true,
        scan: primaryScan,
        change: emptyChange,
      });
      expect(emptyAssessment.taskGate.status).toBe('empty');
      expect(emptyAssessment.nodes.find((node) => node.id === 'tasks')?.state).toBe('ready');

      await fixture.expandCompletedChange();
      await fixture.uncheckCompletedTask();
      await fixture.reopenSecondIteration();
      primaryScan = await refreshScan(primary);
      await workStates.reconcile({ project: primary, scan: primaryScan });
      expect(store.snapshot(primary.id).active['completed-then-expanded']).toMatchObject({
        iteration: 2,
        phase: 'reopened',
        reopenedEvents: [{ reason: 'tasks-added', delta: { completed: 0, total: 7 } }],
      });
      expect(store.snapshot(primary.id).active['unchecked-after-complete']).toMatchObject({
        iteration: 2,
        phase: 'reopened',
        reopenedEvents: [{ reason: 'tasks-unchecked' }],
      });

      await fixture.completeSecondIteration();
      primaryScan = await refreshScan(primary);
      await workStates.reconcile({ project: primary, scan: primaryScan });
      expect(store.snapshot(primary.id).active['completed-again-then-reopened']).toMatchObject({
        iteration: 2,
        phase: 'completed',
      });
      await fixture.reopenThirdIteration();
      primaryScan = await refreshScan(primary);
      await workStates.reconcile({ project: primary, scan: primaryScan });
      expect(store.snapshot(primary.id).active['completed-again-then-reopened']).toMatchObject({
        iteration: 3,
        phase: 'reopened',
      });

      await fixture.modifyArchive();
      primaryScan = await refreshScan(primary);
      await workStates.reconcile({ project: primary, scan: primaryScan });
      expect(store.snapshot(primary.id).archived['archived-change']?.archiveIntegrity?.status).toBe(
        'changed',
      );

      const catalog: CatalogState = {
        schemaVersion: 3,
        groups: [],
        projects: [primary, secondary],
        preferences: {
          selectedProjectId: primary.id,
          selectedChangeId: null,
          showArchived: false,
          windowBounds: { width: 1440, height: 900 },
        },
      };
      const doctor = async (projectRoot: string): Promise<OpenSpecDoctorSummary> => {
        if (projectRoot === secondary.rootPath) throw new Error('doctor timeout');
        return { healthy: true, rootSource: 'nearest', relations: [], diagnostics: [] };
      };
      const context = async (): Promise<OpenSpecContextSummary> => ({
        rootRole: 'openspec_root',
        rootSource: 'nearest',
        members: [],
        diagnostics: [],
      });
      const instructions = async (
        _projectRoot: string,
        changeId: string,
        target: string,
      ): Promise<OpenSpecInstructionsSummary> => ({
        changeId,
        target,
        schemaName: 'custom-workflow',
        dependencies: [],
        contextFiles: [],
      });
      const actionCenter = new ActionCenterService({
        catalog: { snapshot: () => catalog },
        getScan: (projectId) =>
          projectId === primary.id
            ? primaryScan
            : projectId === secondary.id
              ? secondaryScan
              : null,
        lifecycle,
        cli: { doctor, context, instructions },
        workStateStore: store,
      });
      const beforeQuery = await fixture.hashProjects();
      const actions = await actionCenter.getActionCenter({});
      expect(actions.status).toBe('partial');
      expect(actions.projects.find((entry) => entry.projectId === secondary.id)?.status).toBe(
        'degraded',
      );
      expect(actions.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            changeId: 'completed-then-expanded',
            actionType: 'continue-implementation',
            taskGate: expect.objectContaining({ completed: 57, total: 64, remaining: 7 }),
            workState: expect.objectContaining({ iteration: 2, phase: 'reopened' }),
          }),
          expect.objectContaining({
            changeId: 'custom-artifact',
            actionType: 'complete-artifact',
            targetArtifactId: 'deploy',
          }),
          expect.objectContaining({
            changeId: 'archived-change',
            actionType: 'archive-integrity',
          }),
        ]),
      );
      expect(await fixture.hashProjects()).toEqual(beforeQuery);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 60_000);
});
