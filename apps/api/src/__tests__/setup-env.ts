/**
 * 必须在导入 app 之前生效：dotenv 不覆盖已存在的变量，
 * 所以这里显式设成 memory 就能让测试不往共享 Redis 里投真任务。
 */
process.env.QUEUE_DRIVER = 'memory';
