/**
 * 闸门 1 的验收脚本：证明一个 job 真的经由 Redis/BullMQ 从一个 OS 进程到达另一个 OS 进程，
 * 并且 Worker 侧发出的房间事件能被订阅端收到。
 *
 *   pnpm verify:queue
 *
 * 这一步存在的理由：修复前 API 与 Worker 各自 new 了一个 MemoryQueue，
 * 两个进程内的内存队列永远不会互相看见，而 typecheck/lint/test 全绿也发现不了。
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { loadEnv } from '@tianma/database/load-env';
import { resolveQueueDriver } from '@tianma/queue';
import { VERIFY_QUEUE_NAME } from './require-bullmq';

const loaded = loadEnv();
const TIMEOUT_MS = Number(process.env.VERIFY_TIMEOUT_MS ?? 25_000);

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  pid: number;
}

function run(script: string, args: string[], killAfterMs: number): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', join(__dirname, script), ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    const timer = setTimeout(() => child.kill('SIGKILL'), killAfterMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, pid: child.pid ?? -1 });
    });
  });
}

function check(label: string, passed: boolean, evidence: string): boolean {
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}${evidence ? ` — ${evidence}` : ''}`);
  return passed;
}

async function main(): Promise<number> {
  console.log(`env file: ${loaded.path ?? '(none, relying on process env)'}`);
  console.log(`传输验证走隔离队列 ${VERIFY_QUEUE_NAME}（真实队列名由 verify:e2e 覆盖）\n`);

  let driver: string;
  try {
    driver = resolveQueueDriver();
  } catch (error) {
    console.error(`QUEUE_DRIVER 配置无效：${(error as Error).message}`);
    return 1;
  }
  if (driver !== 'bullmq') {
    console.error(
      '本验证要求跨进程投递，请把 .env 设为 QUEUE_DRIVER=bullmq 并提供 REDIS_URL（当前驱动为 memory）',
    );
    return 1;
  }

  const runId = randomUUID();
  const consumer = run('queue-consumer.ts', [runId], TIMEOUT_MS);
  // 稍等再投，让 BullMQ Worker 完成注册；顺序反了也能收到，只是证据没那么干净
  await new Promise((done) => setTimeout(done, 1_500));
  const producer = run('queue-producer.ts', [runId], TIMEOUT_MS);

  const [consumerResult, producerResult] = await Promise.all([consumer, producer]);

  const produced = /PRODUCED job=(\S+) runId=(\S+) driver=(\S+) pid=(\d+)/.exec(producerResult.stdout);
  const published = /PUBLISHED roomId=(\S+) runId=(\S+)/.exec(producerResult.stdout);
  const consumed = /JOB run (\S+) pid=(\d+)/.exec(consumerResult.stdout);
  const received = /EVENT (\S+) (\S+) pid=(\d+)/.exec(consumerResult.stdout);

  let ok = true;
  ok = check('生产端入队成功', Boolean(produced) && producerResult.code === 0, produced?.[0] ?? producerResult.stderr) && ok;
  ok = check('生产端已广播房间事件', Boolean(published), published?.[1]?.slice(0, 8) ?? '') && ok;
  ok = check(
    '消费端收到同一个 runId',
    Boolean(consumed && consumed[1] === runId),
    consumed?.[0] ?? consumerResult.stderr.trim().slice(0, 200),
  ) && ok;
  ok = check(
    '消费端收到房间事件（Pub/Sub 桥已通）',
    Boolean(received && published && received[2] === published[1]),
    received?.[0] ?? '',
  ) && ok;
  ok = check(
    '确实是两个不同进程',
    Boolean(consumed && produced && consumed[2] !== produced[4]),
    `consumer pid=${consumed?.[2]} producer pid=${produced?.[4]}`,
  ) && ok;

  if (!ok) {
    // BullMQ 连不上 Redis 时既不抛错也不退出，只是静默重连到超时被杀，
    // 所以必须把两个子进程的原始输出倒出来才看得懂
    for (const [label, result] of [
      ['producer', producerResult],
      ['consumer', consumerResult],
    ] as const) {
      console.log(`\n--- ${label} exit=${result.code} ---`);
      console.log(`stdout:\n${result.stdout.trim() || '(empty)'}`);
      console.log(`stderr:\n${result.stderr.trim().slice(0, 1_500) || '(empty)'}`);
    }
  }

  console.log(ok ? '\n队列与事件桥已打通' : '\n跨进程投递未通过');
  return ok ? 0 : 1;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  },
);
