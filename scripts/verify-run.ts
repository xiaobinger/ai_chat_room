/**
 * 端到端验证：用真实 MySQL + Redis + 真实模型端点跑完一次讨论。
 *
 *   pnpm verify:run            # 用 MODELS_CONFIG 里的 DEFAULT_MODEL
 *   pnpm verify:run mock       # 强制离线模型，不碰外部端点
 *
 * 覆盖验收 #1（多轮自主发言）、#3（轮次与预算）、#4（终止原因）、#6（序号连续）。
 */
import { loadEnv, prisma } from '@tianma/database';
import { DEFAULT_RUN_SETTINGS, RUN_QUEUE_NAME, type RoomEvent } from '@tianma/contracts';
import { publishRoomEvent, closeEventPublisher, createQueue } from '@tianma/queue';
import { RunRepository } from '../apps/ai-worker/src/db';
import { RunRunner } from '../apps/ai-worker/src/run-runner';
import { ModelRegistry, parseModelsConfig, type ModelConfig } from '../apps/ai-worker/src/registry';

loadEnv();

const forcedModel = process.argv[2] === 'mock' ? 'mock' : undefined;
const MAX_ROUNDS = Number(process.env.VERIFY_ROUNDS ?? 4);

function buildRegistry(): ModelRegistry {
  const configs = parseModelsConfig(process.env.MODELS_CONFIG);
  if (forcedModel === 'mock') {
    return new ModelRegistry(configs.filter((config) => config.provider === 'mock'), 'mock');
  }
  const named = configs.filter((config) => config.provider !== 'mock');
  if (named.length === 0) throw new Error('MODELS_CONFIG 里没有真实模型；用 `pnpm verify:run mock` 走离线模型');
  const usable: ModelConfig[] = [...named, ...configs.filter((c) => c.provider === 'mock')];
  return new ModelRegistry(usable, named[0]!.name);
}

async function main(): Promise<number> {
  const registry = buildRegistry();
  const model = registry.resolve(forcedModel ?? 'auto');
  console.log(`模型=${model.name}  已注册=${registry.names.join(', ')}  队列名=${RUN_QUEUE_NAME}`);

  const owner = await prisma.user.findFirstOrThrow({ orderBy: { createdAt: 'asc' } });
  const room = await prisma.room.findFirstOrThrow({
    where: { ownerId: owner.id },
    include: { roomRoles: { orderBy: { createdAt: 'asc' } } },
  });
  if (room.roomRoles.length === 0) throw new Error('请先跑 pnpm db:seed');

  const startSeq = room.messageSeq;
  const run = await prisma.discussionRun.create({
    data: {
      roomId: room.id,
      topic: room.title,
      goal: '产出可执行结论',
      status: 'queued',
      settings: { ...DEFAULT_RUN_SETTINGS, maxRounds: MAX_ROUNDS },
      createdBy: owner.id,
    },
  });
  console.log(`run=${run.id} room=${room.id} 角色=${room.roomRoles.map((r) => r.name).join(' / ')}`);

  // 每个角色都用同一个模型，避免只有 host 走 mock 而看不出真实调用是否通
  const originalModels = room.roomRoles.map((role) => ({ id: role.id, modelName: role.modelName }));
  await prisma.roomRole.updateMany({ where: { roomId: room.id }, data: { modelName: model.name } });

  const repo = new RunRepository();
  const queue = createQueue<{ runId: string }>(RUN_QUEUE_NAME);
  const runner = new RunRunner({
    repo,
    registry,
    publish: async (event: RoomEvent) => {
      await publishRoomEvent(event);
      if (event.event.type === 'message') {
        const payload = event.event.payload;
        console.log(`  #${payload.sequence} [${payload.senderType}] ${payload.content.slice(0, 60)}`);
      }
    },
  });

  const started = Date.now();
  await runner.consume(run.id);
  await queue.close();
  await closeEventPublisher();

  const final = await prisma.discussionRun.findUniqueOrThrow({
    where: { id: run.id },
    include: {
      _count: { select: { messages: true, agentStates: true, scheduleAudits: true } },
      agentStates: true,
    },
  });
  const messages = await prisma.message.findMany({
    where: { roomId: room.id, sequence: { gt: startSeq } },
    orderBy: { sequence: 'asc' },
  });

  const sequences = messages.map((message) => message.sequence);
  const contiguous = sequences.every((value, index) => value === startSeq + index + 1);
  const tokens = messages.reduce((sum, message) => sum + (message.tokens ?? 0), 0);

  console.log(
    JSON.stringify(
      {
        status: final.status,
        terminationReason: final.terminationReason,
        currentRound: final.currentRound,
        agentMessages: messages.filter((m) => m.senderType === 'agent').length,
        systemMessages: messages.filter((m) => m.senderType === 'system').length,
        tokens,
        sequenceContiguous: contiguous,
        scheduleAudits: final._count.scheduleAudits,
        states: final.agentStates.map((state) => `${state.roleId.slice(0, 4)}:${state.state}`),
        elapsedMs: Date.now() - started,
      },
      null,
        2,
    ),
  );

  const ok =
    messages.length > 0 &&
    contiguous &&
    final.currentRound > 0 &&
    ['completed', 'terminated'].includes(final.status) &&
    final._count.scheduleAudits > 0;
  console.log(ok ? '\n真实模型讨论链路已跑通' : '\n讨论链路未达预期');
  // 还原种子里的 modelName：这是诊断脚本，不该永久改写房间配置
  for (const role of originalModels) {
    await prisma.roomRole.update({ where: { id: role.id }, data: { modelName: role.modelName } });
  }
  await prisma.$disconnect();
  return ok ? 0 : 1;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exitCode = 1;
  },
);
