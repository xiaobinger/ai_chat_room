import type { DiscussionMode } from '@tianma/contracts';
import {
  DEFAULT_RUN_SETTINGS,
  MAX_ROUNDS_HARD_CAP,
  RunSettingsSchema,
  type RunSettings,
} from '@tianma/contracts';

export interface SettingIssue {
  path: string;
  message: string;
}

export type ParseRunSettingsResult =
  | { ok: true; settings: RunSettings }
  | { ok: false; issues: SettingIssue[] };

export function parseRunSettings(input: unknown): ParseRunSettingsResult {
  const parsed = RunSettingsSchema.safeParse(input ?? {});
  if (parsed.success) {
    return { ok: true, settings: parsed.data };
  }
  return {
    ok: false,
    issues: parsed.error.issues.map((issue) => ({
      path: issue.path.join('.') || '(root)',
      message: issue.message,
    })),
  };
}

/** 返回副本：DEFAULT_RUN_SETTINGS 是共享常量，就地改写会污染整个进程。 */
export function defaultRunSettings(): RunSettings {
  return { ...DEFAULT_RUN_SETTINGS };
}

export type RunStartBlocker = 'no_speakable_agent' | 'structured_requires_topic';

export interface RunStartInput {
  mode: DiscussionMode;
  topic?: string | null;
  speakableAgentCount: number;
}

export type ValidateRunStartResult =
  | { ok: true }
  | { ok: false; reason: RunStartBlocker };

/**
 * state-machines.md §1.2 START 行的约束。
 * 先查可发言角色，再查主题：没有角色时主题是否合法根本无从谈起。
 */
export function validateRunStart(
  input: RunStartInput,
): ValidateRunStartResult {
  if (input.speakableAgentCount < 1) {
    return { ok: false, reason: 'no_speakable_agent' };
  }
  if (input.mode === 'structured' && !input.topic?.trim()) {
    return { ok: false, reason: 'structured_requires_topic' };
  }
  return { ok: true };
}

export { MAX_ROUNDS_HARD_CAP };
export type { RunSettings };
