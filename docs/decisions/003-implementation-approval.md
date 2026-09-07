# 决策 003：正式工程实施审批

## 状态
通过

## 日期
2026-09-03

## 决策主题
确认正式工程的技术范围、模块边界、里程碑和交付节奏。

## 提议结论
1. 采用 pnpm workspace + Turborepo 的 TypeScript Monorepo。
2. apps/web 使用 Next.js + React + TypeScript + Tailwind CSS + shadcn/ui。
3. apps/api 使用 NestJS + Fastify + WebSocket。
4. apps/ai-worker 负责模型调用、Run 状态机和流式输出。
5. packages/contracts 为前端、API、Worker 共享协议。
6. packages/ai-core 负责讨论导演和治理引擎。
7. packages/database 负责 Prisma Schema 和迁移。
8. 使用 PostgreSQL + Prisma，Redis + BullMQ 负责队列、在线状态、限流和取消。
9. 先以模块化单体 + 独立 AI Worker 开始，不提前拆微服务。
10. 消息以服务端房间 sequence 排序，支持断线补偿、幂等发送和审计。

## 依据
- `docs/product/mvp-spec.md`
- `docs/product/information-architecture.md`
- `docs/product/flows.md`
- `docs/product/state-machines.md`
- `docs/product/permissions.md`
- `prototype/` 可点击原型

## 验收清单
- [ ] Monorepo、CI、共享契约和本地环境就绪。
- [ ] 用户、房间、角色、消息、DiscussionRun 和治理事件 Schema 完成。
- [ ] HTTP 命令和 WebSocket 房间广播可用。
- [ ] AI Run 状态机、模型 Adapter、流式输出、超时和取消可用。
- [ ] 规则引擎、语义判定、处罚阶梯、循环终止、撤销和审计可用。
- [ ] 正式 Web 页面按冻结原型实现并连接 API/WebSocket。
- [ ] 集成测试和 E2E 测试覆盖七条主流程。
- [ ] 本地启动文档和 MVP 验收文档完成。

## 里程碑
1. 脚手架和共享契约
2. 数据库和 API 基础
3. AI Worker 和讨论导演
4. 治理和审计
5. Web 界面集成
6. 测试和文档
7. MVP 验收

## 批准记录
- 结论：通过，用户确认“进入C正式工程开干吧”
- 批准人：用户
- 批准时间：2026-09-03 10:01（本地会话时间）
- 条件或遗留项：Playwright 自动化在当前 Windows 机器上受浏览器运行时限制，待后续环境解决
