import { describe, expect, it } from 'vitest';
import { ipcChannelSchema } from './ipc-contracts';

describe('IPC channel contracts', () => {
  it('does not expose any legacy spec-assurance channels', () => {
    expect(ipcChannelSchema.options).toEqual(
      expect.not.arrayContaining([
        'assurance:get',
        'assurance:refresh',
        'assurance:record-reviews',
        'assurance:import-report',
        'assurance:preview-report',
        'assurance:update-conflict',
        'assurance:select-report-file',
        'assurance:request-clear',
        'assurance:clear',
        'assurance:get-mode',
        'assurance:set-mode',
      ]),
    );
    expect(ipcChannelSchema.safeParse('assurance:get').success).toBe(false);
    expect(ipcChannelSchema.safeParse('assurance:clear').success).toBe(false);
    expect(ipcChannelSchema.safeParse('insights:get-project').success).toBe(false);
    expect(ipcChannelSchema.safeParse('insights:export-digest').success).toBe(false);
  });
});
