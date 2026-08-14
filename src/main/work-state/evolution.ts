import {
  changeEvolutionAssessmentSchema,
  type ChangeEvolutionAssessment,
  type ChangeProjection,
} from '@shared/contracts';
import type { ProjectScanResult } from '../domain/scanner';
import { mainSpecPathForDelta } from '../lifecycle/fingerprint';

export interface AssessChangeEvolutionInput {
  scan: ProjectScanResult;
  change: ChangeProjection;
  assessedAt: string;
}

export function assessChangeEvolution(
  input: AssessChangeEvolutionInput,
): ChangeEvolutionAssessment {
  const deltas = input.change.artifacts.filter((artifact) => artifact.type === 'spec');
  if (input.change.archived || deltas.length === 0) {
    return changeEvolutionAssessmentSchema.parse({
      status: 'unknown',
      assessedAt: input.assessedAt,
      capabilities: [],
      message: input.change.archived
        ? '已归档 Change 不参与当前能力演进分类'
        : '未发现可分类的 delta spec',
    });
  }

  const mainPaths = new Set(
    input.scan.specs.map((artifact) => artifact.relativePath.replaceAll('\\', '/')),
  );
  const capabilities = deltas.map((artifact) => {
    const targetPath = mainSpecPathForDelta(
      artifact.relativePath,
      input.change.id,
      input.change.archived,
    );
    if (!targetPath || artifact.parseHealth !== 'ok') {
      return {
        capabilityPath: 'invalid-spec',
        targetPath: 'specs/invalid-spec/spec.md',
        status: 'unknown' as const,
      };
    }
    return {
      capabilityPath: targetPath.replace(/^specs\//, '').replace(/\/spec\.md$/i, ''),
      targetPath,
      status: mainPaths.has(targetPath) ? ('existing' as const) : ('new' as const),
    };
  });
  const hasUnknown = capabilities.some((entry) => entry.status === 'unknown');
  const hasExisting = capabilities.some((entry) => entry.status === 'existing');
  const hasNew = capabilities.some((entry) => entry.status === 'new');
  const status = hasUnknown
    ? 'unknown'
    : hasExisting && hasNew
      ? 'mixed'
      : hasExisting
        ? 'iteration'
        : 'new';
  return changeEvolutionAssessmentSchema.parse({
    status,
    assessedAt: input.assessedAt,
    capabilities,
    ...(hasUnknown ? { message: '部分 delta capability 路径或内容不可可靠分类' } : {}),
  });
}
