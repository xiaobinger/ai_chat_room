import { prisma } from '@tianma/database';
import { MessageSchema, type Message, type WSEvent } from '@tianma/contracts';

/**
 * 按 id 取回契约化的消息对象。
 *
 * 走一遍 MessageSchema 而不是直接把 Prisma 行塞进事件：Date 字段、可选字段与关联
 * 对象的形状都被契约固定下来，前端才不会收到"同一字段有时是 null、有时整个缺席"。
 */
export async function messagePayload(messageId: string): Promise<Message | null> {
  const row = await prisma.message.findUnique({
    where: { id: messageId },
    include: { role: { select: { id: true, name: true, color: true } } },
  });
  if (!row) return null;
  return MessageSchema.parse({ ...row, role: row.role ?? undefined });
}

export async function messageEvent(messageId: string): Promise<WSEvent | null> {
  const payload = await messagePayload(messageId);
  return payload ? { type: 'message', payload } : null;
}
