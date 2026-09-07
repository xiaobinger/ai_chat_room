import { hashSync } from 'bcryptjs';
import { ModeratorRuleSchema, type ModeratorRule } from '@tianma/contracts';
import { Prisma } from '@prisma/client';
import { prisma } from './client';

const DEMO_PASSWORD = process.env.SEED_PASSWORD ?? 'tianma-demo';

/** 内置角色模板：ownerId 为 null，所有人可见（mvp-spec §4 AgentProfile）。 */
const BUILT_IN_PROFILES = [
  {
    name: '理性分析师',
    tagline: '用数据和因果链说话',
    description: '习惯把问题拆成可验证的假设，会主动指出论据与结论之间的距离。',
    systemPrompt:
      '你是一名理性分析师。发言时先给出判断，再给出支撑理由；遇到证据不足时明确说"这里我没有足够依据"。不要为了附和而认同他人观点。',
    avatarColor: '#2871c9',
    rationality: 85,
    aggressiveness: 25,
  },
  {
    name: '尖锐质疑者',
    tagline: '专找论证的薄弱处',
    description: '对任何共识都先追问反例，擅长把含糊的表述逼成可讨论的命题。',
    systemPrompt:
      '你是一名尖锐的质疑者。针对场上最核心的一个观点提出反驳，并给出一个具体的反例或边界情形。批评观点，绝不攻击人。',
    avatarColor: '#d06b32',
    rationality: 60,
    aggressiveness: 85,
  },
  {
    name: '中立主持人',
    tagline: '收束分歧，推进议程',
    description: '不表达立场，负责归纳已达成的共识、澄清真正的分歧点，并把讨论推向下一个问题。',
    systemPrompt:
      '你是中立的主持人。不表达自己的立场。发言只做三件事：归纳目前共识、点明仍存在的分歧、提出下一个应当讨论的具体问题。',
    avatarColor: '#6f52d9',
    rationality: 70,
    aggressiveness: 20,
  },
  {
    name: '一线实践者',
    tagline: '拿落地经验说话',
    description: '关心方案能不能真的跑起来，会不断把抽象讨论拉回成本、流程和人的行为。',
    systemPrompt:
      '你是一名有一线落地经验的实践者。把抽象讨论拉回执行层面：谁来做、多少钱、多久见效、会遇到什么阻力。用具体场景而不是概念回答。',
    avatarColor: '#1f9d6f',
    rationality: 65,
    aggressiveness: 45,
  },
];

/**
 * R-01/R-03 对应 prototype 已批准的治理原则；R-04/R-05 是纯确定性检测器，
 * 保证离线 mock 模型下验收 #2 仍能复现出治理事件。
 *
 * 不含 R-02 霸占发言：导演的硬排除已在同一阈值（maxConsecutiveTurns）上把角色挡在
 * 候选集外，治理层再判一次等于把正常调度当违规连续记账。检测能力仍在 ai-core。
 */
const POLICY_RULES: ModeratorRule[] = [
  {
    id: 'R-01',
    kind: 'off_topic',
    label: '偏离主题',
    enabled: true,
    threshold: 0.6,
    action: 'remind',
    safety: false,
  },
  {
    id: 'R-03',
    kind: 'personal_attack',
    label: '攻击与骚扰',
    enabled: true,
    action: 'warn',
    safety: true,
    keywords: ['蠢货', '白痴', '垃圾话', '你就是个', '滚出去', '无可救药'],
  },
  {
    id: 'R-04',
    kind: 'spam_repetition',
    label: '重复灌水',
    enabled: true,
    threshold: 0.6,
    action: 'warn',
    safety: false,
  },
  {
    id: 'R-05',
    kind: 'forbidden_topic',
    label: '禁区话题',
    enabled: true,
    action: 'kick',
    safety: true,
    keywords: ['内幕交易', '洗钱', '代开发票', '绕过监管'],
  },
];

async function seedProfiles() {
  for (const profile of BUILT_IN_PROFILES) {
    const existing = await prisma.agentProfile.findFirst({
      where: { name: profile.name, isBuiltIn: true, ownerId: null },
    });
    if (existing) {
      await prisma.agentProfile.update({ where: { id: existing.id }, data: profile });
    } else {
      await prisma.agentProfile.create({ data: { ...profile, isBuiltIn: true } });
    }
  }
  return prisma.agentProfile.findMany({ where: { isBuiltIn: true } });
}

async function seedOwner() {
  const email = process.env.SEED_EMAIL ?? 'owner@tianma.dev';
  const passwordHash = hashSync(DEMO_PASSWORD, 10);
  return prisma.user.upsert({
    where: { email },
    update: { passwordHash },
    create: { email, passwordHash, displayName: '演示房主', avatarColor: '#7457ff' },
  });
}

async function seedRoom(ownerId: string, profiles: { id: string; name: string }[]) {
  const profileId = new Map(profiles.map((p) => [p.name, p.id]));
  const existing = await prisma.room.findFirst({ where: { title: '远程办公是不是伪命题', ownerId } });

  const room =
    existing ??
    (await prisma.room.create({
      data: {
        title: '远程办公是不是伪命题',
        description: '围绕混合办公的真实成本与收益做一次结构化辩论，产出一份可执行的团队约定。',
        mode: 'structured',
        status: 'idle',
        visibility: 'public',
        ownerId,
      },
    }));

  await prisma.membership.upsert({
    where: { roomId_userId: { roomId: room.id, userId: ownerId } },
    update: { status: 'approved' },
    create: {
      roomId: room.id,
      userId: ownerId,
      status: 'approved',
      intent: 'discuss',
      joinedAt: new Date(),
    },
  });

  const roles = [
    {
      name: '正方 · 支持远程',
      type: 'debater' as const,
      stance: '远程办公降低通勤成本、扩大人才池，是效率净收益',
      color: '#2871c9',
      template: '理性分析师',
    },
    {
      name: '反方 · 主张坐班',
      type: 'debater' as const,
      stance: '协作损耗、隐性知识传承与晋升公平性被系统性低估',
      color: '#d06b32',
      template: '尖锐质疑者',
    },
    {
      name: '主持人',
      type: 'host' as const,
      stance: '',
      color: '#6f52d9',
      template: '中立主持人',
    },
  ];

  for (const role of roles) {
    const template = await prisma.agentProfile.findUnique({
      where: { id: profileId.get(role.template) ?? '' },
    });
    const data = {
      roomId: room.id,
      name: role.name,
      type: role.type,
      stance: role.stance,
      color: role.color,
      modelName: 'auto',
      profileId: template?.id ?? null,
      systemPrompt:
        template?.systemPrompt ??
        '你是一场中文圆桌讨论的参与者。基于给定主题与他人发言，输出一段不超过 150 字的连贯发言，直接说内容，不要加角色名前缀。',
      aggressiveness: template?.aggressiveness ?? 50,
      priority: 50,
    };
    const existing = await prisma.roomRole.findFirst({ where: { roomId: room.id, name: role.name } });
    if (existing) await prisma.roomRole.update({ where: { id: existing.id }, data });
    else await prisma.roomRole.create({ data });
  }

  return room;
}

async function seedPolicy(roomId: string, ownerId: string) {
  // 走一遍 zod，确保落库的 JSON 与 contracts 定义完全一致
  const rules = POLICY_RULES.map((rule) => ModeratorRuleSchema.parse(rule));
  return prisma.moderatorPolicy.upsert({
    where: { roomId_version: { roomId, version: 1 } },
    update: { rules: rules as Prisma.InputJsonValue },
    create: {
      roomId,
      version: 1,
      createdBy: ownerId,
      rules: rules as Prisma.InputJsonValue,
      ladder: ['remind', 'warn', 'mute', 'kick'] as Prisma.InputJsonValue,
    },
  });
}

async function main() {
  const owner = await seedOwner();
  const profiles = await seedProfiles();
  const room = await seedRoom(owner.id, profiles);
  const policy = await seedPolicy(room.id, owner.id);
  const roleCount = await prisma.roomRole.count({ where: { roomId: room.id } });

  console.log(
    JSON.stringify(
      {
        owner: { email: owner.email, password: DEMO_PASSWORD },
        builtInProfiles: profiles.length,
        room: { id: room.id, title: room.title, roles: roleCount },
        policy: { id: policy.id, version: policy.version, rules: POLICY_RULES.length },
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
