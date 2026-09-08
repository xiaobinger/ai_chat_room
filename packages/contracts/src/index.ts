import { z } from 'zod';

/**
 * 共享契约 —— 全项目命名权威。
 * 同时被 Node（api / ai-worker）与浏览器（web，经 vite alias）消费，
 * 因此只依赖 zod，不得引入任何 node 内置模块。
 *
 * 安全约定：所有 *InputSchema 一律不含身份字段（ownerId / createdBy / approverId / senderId）。
 * 身份只能由服务端从已验证的 JWT 推导，绝不接受客户端声明。
 */

// ===== 枚举 =====

export const RoleTypeSchema = z.enum(['host', 'debater', 'observer']);
export type RoleType = z.infer<typeof RoleTypeSchema>;

/** 房间生命周期。draft = 向导未走完（flows.md §1）；archived = 归档（mvp-spec §3.1） */
export const RoomStatusSchema = z.enum([
  'draft',
  'idle',
  'running',
  'paused',
  'ended',
  'archived',
]);
export type RoomStatus = z.infer<typeof RoomStatusSchema>;

export const RoomVisibilitySchema = z.enum(['private', 'public']);
export type RoomVisibility = z.infer<typeof RoomVisibilitySchema>;

/** state-machines.md §1.1 */
export const RunStatusSchema = z.enum([
  'draft',
  'queued',
  'running',
  'paused',
  'completed',
  'terminated',
  'failed',
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

/** state-machines.md §1.3 */
export const RunTerminationReasonSchema = z.enum([
  'round_limit',
  'token_budget',
  'cost_budget',
  'time_limit',
  'repetition_loop',
  'safety_violation',
  'no_available_agents',
  'owner_terminated',
  'user_cancelled',
]);
export type RunTerminationReason = z.infer<typeof RunTerminationReasonSchema>;

/** state-machines.md §3。只有 completed 进入其他角色的正式上下文 */
export const MessageStatusSchema = z.enum([
  'pending',
  'streaming',
  'completed',
  'failed',
  'deleted',
]);
export type MessageStatus = z.infer<typeof MessageStatusSchema>;

/** state-machines.md §2.1 */
export const RoleRunStateSchema = z.enum([
  'idle',
  'thinking',
  'speaking',
  'muted',
  'removed',
  'error',
]);
export type RoleRunState = z.infer<typeof RoleRunStateSchema>;

export const MessageSenderTypeSchema = z.enum(['user', 'agent', 'system', 'moderator']);
export type MessageSenderType = z.infer<typeof MessageSenderTypeSchema>;

export const MembershipStatusSchema = z.enum(['invited', 'approved', 'rejected', 'left']);
export type MembershipStatus = z.infer<typeof MembershipStatusSchema>;

/** 申请意图：参与讨论 / 潜水 */
export const MembershipIntentSchema = z.enum(['discuss', 'observe']);
export type MembershipIntent = z.infer<typeof MembershipIntentSchema>;

export const ModerationActionSchema = z.enum(['remind', 'warn', 'mute', 'kick', 'revoke', 'unmute']);
export type ModerationAction = z.infer<typeof ModerationActionSchema>;

/** permissions.md §5 审计字段 */
export const ModerationActorTypeSchema = z.enum(['owner', 'moderator', 'system']);
export type ModerationActorType = z.infer<typeof ModerationActorTypeSchema>;

export const ModerationTargetTypeSchema = z.enum(['role', 'user']);
export type ModerationTargetType = z.infer<typeof ModerationTargetTypeSchema>;

export const DiscussionModeSchema = z.enum(['structured', 'free']);
export type DiscussionMode = z.infer<typeof DiscussionModeSchema>;

export const SummaryStatusSchema = z.enum(['pending', 'generating', 'ready', 'failed']);
export type SummaryStatus = z.infer<typeof SummaryStatusSchema>;

// ===== RunSettings（mvp-spec.md §5 默认运行约束）=====

export const MAX_ROUNDS_HARD_CAP = 100;

export const RunSettingsSchema = z.object({
  /** 最大讨论轮次，默认 20，硬上限 100 */
  maxRounds: z.number().int().min(1).max(MAX_ROUNDS_HARD_CAP).default(20),
  /** 单角色最大连续发言次数 */
  maxConsecutiveTurns: z.number().int().min(1).max(10).default(2),
  /** 单次 AI 发言最大输出 tokens */
  maxTokensPerMessage: z.number().int().min(1).max(8000).default(1500),
  /** 单次讨论总输出预算 tokens */
  tokenBudget: z.number().int().min(1).max(10_000_000).default(12_000),
  /** 单次讨论最长运行时间（分钟） */
  timeLimitMinutes: z.number().int().min(1).max(600).default(30),
  /** 同一观点连续重复阈值 */
  repetitionThreshold: z.number().int().min(2).max(20).default(3),
  /** AI 响应超时（秒） */
  aiTimeoutSeconds: z.number().int().min(5).max(600).default(60),
  /** 失败自动重试上限 */
  maxRetries: z.number().int().min(0).max(5).default(1),
  /** 限时禁言默认时长（讨论轮次） */
  defaultMuteRounds: z.number().int().min(1).max(50).default(3),
});
export type RunSettings = z.infer<typeof RunSettingsSchema>;

/** ai-core 的 defaultRunSettings() 直接返回此常量的拷贝 */
export const DEFAULT_RUN_SETTINGS: RunSettings = {
  maxRounds: 20,
  maxConsecutiveTurns: 2,
  maxTokensPerMessage: 1500,
  tokenBudget: 12_000,
  timeLimitMinutes: 30,
  repetitionThreshold: 3,
  aiTimeoutSeconds: 60,
  maxRetries: 1,
  defaultMuteRounds: 3,
};

// ===== 实体 =====

export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string().min(1).max(64),
  avatarColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  createdAt: z.coerce.date(),
});
export type User = z.infer<typeof UserSchema>;

/** 对外暴露的用户视图，绝不含 passwordHash */
export const PublicUserSchema = UserSchema.omit({ email: true });
export type PublicUser = z.infer<typeof PublicUserSchema>;

/** 可复用角色模板（mvp-spec §4 AgentProfile） */
export const AgentProfileSchema = z.object({
  id: z.string().uuid(),
  ownerId: z.string().uuid().nullable(),
  name: z.string().min(1).max(64),
  tagline: z.string().max(120),
  description: z.string(),
  systemPrompt: z.string().min(1).max(8000),
  avatarColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#7457ff'),
  rationality: z.number().int().min(0).max(100).default(50),
  aggressiveness: z.number().int().min(0).max(100).default(50),
  isBuiltIn: z.boolean().default(false),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type AgentProfile = z.infer<typeof AgentProfileSchema>;

export const RoomSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(120),
  description: z.string().max(500).default(''),
  mode: DiscussionModeSchema,
  status: RoomStatusSchema.default('draft'),
  visibility: RoomVisibilitySchema.default('private'),
  language: z.string().max(16).default('zh-CN'),
  ownerId: z.string().uuid(),
  messageSeq: z.number().int().nonnegative().default(0),
  membersCanChat: z.boolean().default(true),
  membersCanModifyTopic: z.boolean().default(false),
  membersCanAddRoles: z.boolean().default(false),
  membersCanStartRun: z.boolean().default(false),
  moderatorEnabled: z.boolean().default(true),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Room = z.infer<typeof RoomSchema>;

/** 角色在当前房间的实例（mvp-spec §4 RoomAgent） */
export const RoomRoleSchema = z.object({
  id: z.string().uuid(),
  roomId: z.string().uuid(),
  profileId: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(64),
  type: RoleTypeSchema,
  systemPrompt: z.string().min(1).max(8000),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  /** 对应 MODELS_CONFIG 里的 name；未命中回退 mock */
  modelName: z.string().min(1).max(64).default('auto'),
  stance: z.string().max(500).default(''),
  aggressiveness: z.number().int().min(0).max(100).default(50),
  priority: z.number().int().min(0).max(100).default(50),
  createdAt: z.coerce.date(),
});
export type RoomRole = z.infer<typeof RoomRoleSchema>;

export const MembershipSchema = z.object({
  id: z.string().uuid(),
  roomId: z.string().uuid(),
  userId: z.string().uuid(),
  roleId: z.string().uuid().nullable().optional(),
  status: MembershipStatusSchema.default('invited'),
  intent: MembershipIntentSchema.default('discuss'),
  joinedAt: z.coerce.date().nullable().optional(),
  leftAt: z.coerce.date().nullable().optional(),
});
export type Membership = z.infer<typeof MembershipSchema>;

export const DiscussionRunSchema = z.object({
  id: z.string().uuid(),
  roomId: z.string().uuid(),
  topic: z.string().min(1).max(500),
  goal: z.string().max(500).default(''),
  completionCriteria: z.string().max(500).default(''),
  status: RunStatusSchema.default('draft'),
  currentRound: z.number().int().nonnegative().default(0),
  settings: RunSettingsSchema,
  terminationReason: RunTerminationReasonSchema.nullable().optional(),
  startedAt: z.coerce.date().nullable().optional(),
  endedAt: z.coerce.date().nullable().optional(),
  createdAt: z.coerce.date(),
  createdBy: z.string().uuid(),
});
export type Run = z.infer<typeof DiscussionRunSchema>;

export const RunAgentStateSchema = z.object({
  runId: z.string().uuid(),
  roleId: z.string().uuid(),
  state: RoleRunStateSchema.default('idle'),
  mutedUntilRound: z.number().int().nonnegative().default(0),
  consecutiveTurns: z.number().int().nonnegative().default(0),
  errorCount: z.number().int().nonnegative().default(0),
  lastSpokeRound: z.number().int().default(-1),
  updatedAt: z.coerce.date(),
});
export type RunAgentState = z.infer<typeof RunAgentStateSchema>;

export const MessageSchema = z.object({
  id: z.string().uuid(),
  roomId: z.string().uuid(),
  runId: z.string().uuid().nullable().optional(),
  /** 房间级单调序号，客户端断线重连的回补游标 */
  sequence: z.number().int().nonnegative(),
  senderType: MessageSenderTypeSchema,
  senderId: z.string().uuid().nullable().optional(),
  roleId: z.string().uuid().nullable().optional(),
  content: z.string().min(1).max(8000),
  status: MessageStatusSchema.default('completed'),
  tokens: z.number().int().nonnegative().nullable().optional(),
  createdAt: z.coerce.date(),
});
export type Message = z.infer<typeof MessageSchema>;

/** 治理规则（ModeratorPolicy.rules 数组元素） */
export const ModeratorRuleSchema = z.object({
  id: z.string().min(1).max(64),
  kind: z.enum([
    'off_topic',
    'personal_attack',
    'spam_repetition',
    'turn_hogging',
    'forbidden_topic',
    'custom',
  ]),
  label: z.string().min(1).max(120),
  enabled: z.boolean().default(true),
  /** 0..1，kind 相关的触发阈值 */
  threshold: z.number().min(0).max(1).optional(),
  /** forbidden_topic / personal_attack / custom 的确定性命中词表 */
  keywords: z.array(z.string().min(1).max(64)).max(200).optional(),
  /** 命中后建议的动作；实际动作仍受处罚阶梯约束 */
  action: ModerationActionSchema,
  /** 安全紧急规则：可跳过"移出前须先有警告/禁言"（permissions §4） */
  safety: z.boolean().default(false),
});
export type ModeratorRule = z.infer<typeof ModeratorRuleSchema>;

/** 处罚阶梯：提醒 → 警告 → 限时禁言 → 移出（mvp-spec §3.5） */
export const PenaltyLadderSchema = z
  .array(z.enum(['remind', 'warn', 'mute', 'kick']))
  .min(1)
  .max(4)
  .default(['remind', 'warn', 'mute', 'kick']);
export type PenaltyLadder = z.infer<typeof PenaltyLadderSchema>;

export const ModeratorPolicySchema = z.object({
  id: z.string().uuid(),
  roomId: z.string().uuid(),
  version: z.number().int().positive(),
  rules: z.array(ModeratorRuleSchema),
  ladder: PenaltyLadderSchema,
  publishedAt: z.coerce.date(),
  createdBy: z.string().uuid(),
});
export type ModeratorPolicy = z.infer<typeof ModeratorPolicySchema>;

export const ModerationEventSchema = z.object({
  id: z.string().uuid(),
  roomId: z.string().uuid(),
  runId: z.string().uuid().nullable().optional(),
  actorType: ModerationActorTypeSchema.default('moderator'),
  actorId: z.string().uuid().nullable().optional(),
  targetType: ModerationTargetTypeSchema.default('role'),
  targetUserId: z.string().uuid().nullable().optional(),
  targetRoleId: z.string().uuid().nullable().optional(),
  action: ModerationActionSchema,
  reason: z.string().min(1).max(2000),
  matchedRule: z.string().max(64).nullable().optional(),
  policyVersion: z.number().int().nullable().optional(),
  evidenceMessageIds: z.array(z.string().uuid()).default([]),
  evidenceMessageId: z.string().uuid().nullable().optional(),
  durationRounds: z.number().int().nonnegative().nullable().optional(),
  penaltyLevel: z.number().int().nonnegative().nullable().optional(),
  createdBy: z.string().uuid(),
  createdAt: z.coerce.date(),
  /** permissions §3：房主撤销不删除原治理事件 */
  revertedAt: z.coerce.date().nullable().optional(),
  revertedBy: z.string().uuid().nullable().optional(),
});
export type ModerationEvent = z.infer<typeof ModerationEventSchema>;

/** 复盘条目：每条结论自带 sourceMessageIds，使验收 #7 的"定位原消息"成为真实链接 */
export const SummaryItemSchema = z.object({
  text: z.string().min(1).max(2000),
  sourceMessageIds: z.array(z.string().uuid()).default([]),
});
export type SummaryItem = z.infer<typeof SummaryItemSchema>;

/**
 * 模型返回的原始条目。
 *
 * 刻意让模型引用**消息序号**而不是 uuid：模型无法可靠复述 36 位 uuid，
 * 由服务端把序号映射回真实消息 id，并丢弃映射不上的条目 —— 这样"引用"
 * 不可能是编造的，验收 #7 的可追溯性由构造保证而非祈祷模型听话。
 */
export const RawSummaryItemSchema = z.object({
  text: z.string().min(1).max(2000),
  sourceSequences: z.array(z.number().int().positive()).default([]),
});
export type RawSummaryItem = z.infer<typeof RawSummaryItemSchema>;

/** 模型返回的复盘草稿。所有字段都可缺省 —— 缺了就退化成摘录，而不是整体失败。 */
export const SummaryDraftSchema = z.object({
  completionScore: z.number().min(0).max(100).optional(),
  keyPoints: z.array(RawSummaryItemSchema).optional(),
  camps: z
    .array(z.object({ name: z.string().max(120), speakers: z.array(z.string().max(64)).default([]), position: z.string().max(1000).default('') }))
    .optional(),
  disputes: z.array(RawSummaryItemSchema).optional(),
  consensus: z.array(RawSummaryItemSchema).optional(),
  unresolved: z.array(RawSummaryItemSchema).optional(),
  followUps: z.array(RawSummaryItemSchema).optional(),
});
export type SummaryDraft = z.infer<typeof SummaryDraftSchema>;

export const SummaryCampSchema = z.object({
  name: z.string().min(1).max(120),
  roleIds: z.array(z.string().uuid()).default([]),
  position: z.string().max(1000).default(''),
});
export type SummaryCamp = z.infer<typeof SummaryCampSchema>;

export const SummaryPayloadSchema = z.object({
  /** model = 模型归纳；extractive = 模型不可用时从原消息摘录，界面必须区分标注 */
  mode: z.enum(['model', 'extractive']).default('model'),
  completionScore: z.number().min(0).max(100).nullable().optional(),
  keyPoints: z.array(SummaryItemSchema).default([]),
  camps: z.array(SummaryCampSchema).default([]),
  disputes: z.array(SummaryItemSchema).default([]),
  consensus: z.array(SummaryItemSchema).default([]),
  unresolved: z.array(SummaryItemSchema).default([]),
  moderation: z.array(SummaryItemSchema).default([]),
  followUps: z.array(SummaryItemSchema).default([]),
});
export type SummaryPayload = z.infer<typeof SummaryPayloadSchema>;

export const DiscussionSummarySchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  status: SummaryStatusSchema.default('pending'),
  payload: SummaryPayloadSchema,
  sourceMessageIds: z.array(z.string().uuid()).default([]),
  error: z.string().max(500).nullable().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type DiscussionSummary = z.infer<typeof DiscussionSummarySchema>;

// ===== 输入契约（一律不含身份字段）=====

export const RegisterInputSchema = z.object({
  email: z.string().email().max(191),
  password: z.string().min(8).max(128),
  displayName: z.string().min(1).max(64),
});
export type RegisterInput = z.infer<typeof RegisterInputSchema>;

export const LoginInputSchema = z.object({
  email: z.string().email().max(191),
  password: z.string().min(1).max(128),
});
export type LoginInput = z.infer<typeof LoginInputSchema>;

export const CreateRoomInputSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  mode: DiscussionModeSchema,
  visibility: RoomVisibilitySchema.optional(),
  language: z.string().max(16).optional(),
  membersCanModifyTopic: z.boolean().optional(),
  membersCanAddRoles: z.boolean().optional(),
  membersCanStartRun: z.boolean().optional(),
  moderatorEnabled: z.boolean().optional(),
});
export type CreateRoomInput = z.infer<typeof CreateRoomInputSchema>;

export const UpdateRoomInputSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  description: z.string().max(500).optional(),
  visibility: RoomVisibilitySchema.optional(),
  status: z.enum(['idle', 'archived']).optional(),
  membersCanChat: z.boolean().optional(),
  membersCanModifyTopic: z.boolean().optional(),
  membersCanAddRoles: z.boolean().optional(),
  membersCanStartRun: z.boolean().optional(),
  moderatorEnabled: z.boolean().optional(),
});
export type UpdateRoomInput = z.infer<typeof UpdateRoomInputSchema>;

export const CreateRoleInputSchema = z.object({
  name: z.string().min(1).max(64),
  type: RoleTypeSchema,
  systemPrompt: z.string().min(1).max(8000),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  modelName: z.string().min(1).max(64).optional(),
  stance: z.string().max(500).optional(),
  aggressiveness: z.number().int().min(0).max(100).optional(),
  priority: z.number().int().min(0).max(100).optional(),
  profileId: z.string().uuid().optional(),
});
export type CreateRoleInput = z.infer<typeof CreateRoleInputSchema>;

export const CreateProfileInputSchema = z.object({
  name: z.string().min(1).max(64),
  tagline: z.string().max(120).optional(),
  description: z.string().max(4000).optional(),
  systemPrompt: z.string().min(1).max(8000),
  avatarColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  rationality: z.number().int().min(0).max(100).optional(),
  aggressiveness: z.number().int().min(0).max(100).optional(),
});
export type CreateProfileInput = z.infer<typeof CreateProfileInputSchema>;

export const StartRunInputSchema = z.object({
  topic: z.string().min(1).max(500),
  goal: z.string().max(500).optional(),
  completionCriteria: z.string().max(500).optional(),
  /** 缺省时服务端用 DEFAULT_RUN_SETTINGS；提供则做 zod 校验后快照入库 */
  settings: RunSettingsSchema.partial().optional(),
});
export type StartRunInput = z.infer<typeof StartRunInputSchema>;

/** Run 状态变更：事件驱动，不允许客户端直接指定目标状态 */
export const RunCommandSchema = z.object({
  command: z.enum(['pause', 'resume', 'complete', 'terminate', 'cancel', 'retry']),
  /** terminate 时的原因，缺省 owner_terminated */
  terminationReason: RunTerminationReasonSchema.optional(),
});
export type RunCommand = z.infer<typeof RunCommandSchema>;

export const SendMessageInputSchema = z.object({
  content: z.string().min(1).max(8000),
  runId: z.string().uuid().nullable().optional(),
  mentionRoles: z.array(z.string().uuid()).optional(),
});
export type SendMessageInput = z.infer<typeof SendMessageInputSchema>;

export const ModerationActionInputSchema = z.object({
  action: ModerationActionSchema,
  reason: z.string().min(1).max(2000),
  targetRoleId: z.string().uuid().optional(),
  targetUserId: z.string().uuid().optional(),
  evidenceMessageId: z.string().uuid().optional(),
  durationRounds: z.number().int().min(1).max(50).optional(),
});
export type ModerationActionInput = z.infer<typeof ModerationActionInputSchema>;

/** 自助申请加入（mvp-spec §3.1：必须经房主审批） */
export const JoinRequestInputSchema = z.object({
  intent: MembershipIntentSchema.default('discuss'),
});
export type JoinRequestInput = z.infer<typeof JoinRequestInputSchema>;

export const InviteInputSchema = z.object({
  email: z.string().email(),
});
export type InviteInput = z.infer<typeof InviteInputSchema>;

export const MembershipApproveInputSchema = z.object({
  roleId: z.string().uuid().nullable().optional(),
});
export type MembershipApproveInput = z.infer<typeof MembershipApproveInputSchema>;

export const MembershipNicknameInputSchema = z.object({
  nickname: z.string().max(64).nullable().optional(),
});
export type MembershipNicknameInput = z.infer<typeof MembershipNicknameInputSchema>;

export const PublishPolicyInputSchema = z.object({
  rules: z.array(ModeratorRuleSchema).min(1).max(20),
  ladder: PenaltyLadderSchema,
});
export type PublishPolicyInput = z.infer<typeof PublishPolicyInputSchema>;

// ===== WebSocket 事件（api ↔ web）=====

export const WSEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('hello'),
    payload: z.object({ roomId: z.string(), userId: z.string().nullable().optional() }),
  }),
  z.object({ type: z.literal('pong'), payload: z.object({ ts: z.number() }) }),
  z.object({ type: z.literal('message'), payload: MessageSchema }),
  z.object({
    type: z.literal('run_status'),
    payload: z.object({
      runId: z.string(),
      status: RunStatusSchema,
      currentRound: z.number().int().optional(),
      terminationReason: RunTerminationReasonSchema.nullable().optional(),
      endedAt: z.coerce.date().nullable().optional(),
    }),
  }),
  z.object({
    type: z.literal('role_state'),
    payload: z.object({ runId: z.string(), roleId: z.string(), state: RoleRunStateSchema }),
  }),
  z.object({ type: z.literal('role_created'), payload: RoomRoleSchema.partial() }),
  z.object({
    type: z.literal('moderation_event'),
    payload: z.object({
      event: ModerationEventSchema,
      notice: MessageSchema.optional(),
    }),
  }),
  z.object({
    type: z.literal('presence'),
    payload: z.object({
      userId: z.string().nullable().optional(),
      status: z.enum(['online', 'offline']),
    }),
  }),
  z.object({
    type: z.literal('error'),
    payload: z.object({ message: z.string(), code: z.string().optional() }),
  }),
  z.object({
    type: z.literal('game_player_joined'),
    payload: z.object({ player: z.object({ id: z.string(), nickname: z.string(), role: z.enum(['human', 'ai']) }) }),
  }),
  z.object({
    type: z.literal('game_player_left'),
    payload: z.object({ playerId: z.string() }),
  }),
  z.object({
    type: z.literal('game_started'),
    payload: z.object({
      gameState: z.record(z.unknown()),
      players: z.array(z.object({ id: z.string(), nickname: z.string(), role: z.enum(['human', 'ai']) })),
    }),
  }),
  z.object({
    type: z.literal('game_action'),
    payload: z.object({ playerId: z.string(), action: z.record(z.unknown()) }),
  }),
  z.object({
    type: z.literal('game_phase_changed'),
    payload: z.record(z.unknown()),
  }),
  z.object({
    type: z.literal('game_player_died'),
    payload: z.record(z.unknown()),
  }),
  z.object({
    type: z.literal('game_vote_result'),
    payload: z.record(z.unknown()),
  }),
  z.object({
    type: z.literal('game_game_ended'),
    payload: z.record(z.unknown()),
  }),
  z.object({
    type: z.literal('game_ai_action'),
    payload: z.record(z.unknown()),
  }),
]);
export type WSEvent = z.infer<typeof WSEventSchema>;

/** Worker → API 的 Redis Pub/Sub 载荷（与 WSEvent 同构，额外带 roomId 供路由） */
export const RoomEventSchema = z.object({
  roomId: z.string().uuid(),
  event: WSEventSchema,
});
export type RoomEvent = z.infer<typeof RoomEventSchema>;

// ===== 队列任务 =====

export const RunJobSchema = z.object({
  runId: z.string().uuid(),
  /**
   * run = 驱动讨论；summarize = 只生成复盘。
   *
   * 房主点"正常结束"时 Run 由 API 转成 completed，模型能力却只在 Worker 侧，
   * 所以归纳必须作为第二种任务派过去，而不是让 API 自己调模型。
   */
  action: z.enum(['run', 'summarize']).default('run'),
});
export type RunJob = z.infer<typeof RunJobSchema>;

export const RUN_QUEUE_NAME = 'discussion-runs';
