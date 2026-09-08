import { PrismaClient, type Prisma } from '@prisma/client';

/** 能在事务里读写消息与房间的执行器。PrismaClient 与 TransactionClient 都满足。 */
export type MessageWriter = Pick<Prisma.TransactionClient, 'room' | 'message'>;

export interface CreateRoomMessageInput {
  roomId: string;
  runId?: string | null;
  senderType: 'user' | 'agent' | 'system' | 'moderator';
  senderId?: string | null;
  roleId?: string | null;
  content: string;
  mentionRoles?: string[] | null;
  status?: 'pending' | 'streaming' | 'completed' | 'failed' | 'deleted';
  tokens?: number | null;
}

/**
 * 房间级消息落库：序号由 `Room.messageSeq` 原子自增发出。
 *
 * 这是验收 #6"不丢、不重、顺序一致"的唯一发号点，所以放在 @tianma/database 里
 * 让 API 与 Worker 共用同一份实现 —— 两边各写一遍迟早会漂移。
 *
 * 关键点：
 * - 绝不用 `count()` 发号。并发插入会算出相同序号，直接撞 @@unique([roomId, sequence])。
 * - InnoDB 的 UPDATE 持有行锁到事务提交，所以同一事务里紧随其后的 SELECT
 *   必然只包含"我这次 increment"，并发的 increment 会阻塞而不是交叉。
 * - 发号与插入必须在同一事务内，否则发完号崩溃会在序号上留洞。
 *
 * 本函数不自开事务：调用方已在事务里就直接传 TransactionClient，
 * 否则用下面的 appendRoomMessage。
 */
export async function createRoomMessage(
  db: MessageWriter,
  input: CreateRoomMessageInput,
): Promise<{ id: string; sequence: number }> {
  await db.room.update({
    where: { id: input.roomId },
    data: { messageSeq: { increment: 1 } },
  });
  const { messageSeq } = await db.room.findUniqueOrThrow({
    where: { id: input.roomId },
    select: { messageSeq: true },
  });
  const created = await db.message.create({
    data: {
      roomId: input.roomId,
      runId: input.runId ?? null,
      sequence: messageSeq,
      senderType: input.senderType,
      senderId: input.senderId ?? null,
      roleId: input.roleId ?? null,
      content: input.content,
      mentionRoles: input.mentionRoles ? (input.mentionRoles as unknown as Prisma.InputJsonValue) : undefined,
      status: input.status ?? 'completed',
      tokens: input.tokens ?? null,
    },
  });
  return { id: created.id, sequence: messageSeq };
}

/** 独立发一条房间消息（自带事务）。 */
export function appendRoomMessage(
  db: PrismaClient,
  input: CreateRoomMessageInput,
): Promise<{ id: string; sequence: number }> {
  return db.$transaction((tx) => createRoomMessage(tx, input));
}
