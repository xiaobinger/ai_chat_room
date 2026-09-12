# 开发日志

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |

## 命令

| 命令 | 说明 |
|------|------|
| `pnpm dev` | 启动所有包的开发服务器 |
| `pnpm build` | 构建所有包 |
| `pnpm typecheck` | TypeScript 类型检查（7 个包） |
| `pnpm test` | 运行所有测试 |
| `pnpm lint` | ESLint 检查 |

## 架构

### TTS 音色差异化系统

TTS 音色由角色的**物理特征** + **语境情绪**共同决定：

```
VoiceProfile (gender, age, height, weight, personality)
    ↓
VoiceContext (mysterious/tense/contemplative/passionate/suspenseful/climactic/calm)
    ↓
VoiceParams (pitch, rate, volume) + 选定的 SpeechSynthesisVoice
```

#### 数据流

1. **角色数据源** — `mystery-types.ts` 中每个 CharacterCard 包含 gender/age/height/weight/personality
2. **引擎暴露** — `mystery-engine.ts` `getPlayerView()` 在 character 对象中透出 age/height/weight
3. **LLM 调用** — `mystery-game.ts` `speakFor()` 构建 voiceProfile + context 传入 generateLlmSpeech
4. **前端播放** — `MysteryView.tsx` 根据 VoiceProfile 选择 Voice 对象 + computeVoiceParams 计算参数

#### 语境映射

| 游戏阶段 | VoiceContext | 情绪特征 |
|----------|-------------|---------|
| introduction | mysterious | 神秘、低沉 |
| investigation | tense | 紧张、急促 |
| discussion | contemplative | 沉思、平缓 |
| accusation | passionate | 激昂、高亢 |
| voting | suspenseful | 悬疑、压抑 |
| reveal | climactic | 高潮、强烈 |

#### 音色参数算法

`computeVoiceParams(profile, context)` 采用级联加权：

- **gender 基线**: male pitch=0.8 / female pitch=1.2
- **age 修正**: 每 10 岁 ±0.08（老年更低沉，儿童更尖锐）
- **height 修正**: 以 170cm 为基准，每 ±10cm ±0.04
- **weight 修正**: 以 65kg 为基准，每 ±10kg ±0.03（体厚则声沉）
- **personality 修正**: 暴躁型/温柔型 ±0.08
- **context 修正**: 各语境对 pitch/rate/volume 有不同偏移

#### Voice 选择

`selectVoiceForProfile(profile)` 使用 pitchHint 排序：

- 按性别过滤候选项
- 若多个候选项，根据 age/height/weight 计算目标 pitchHint
- 选择最接近目标值的 Voice

#### pitchHint 参考值

| 类型 | pitchHint |
|------|-----------|
| 成年男性 | 0.85 |
| 成年女性 | 1.15 |
| 老年 | 0.70 |
| 儿童 | 1.30 |

## 数据库 Schema

（暂无数据库依赖）

## 测试覆盖

- `apps/ai-worker/src/game/__tests__/mystery-engine.test.ts` — 游戏引擎核心逻辑
- `apps/ai-worker/src/game/__tests__/mystery-game.test.ts` — 游戏流程（含 LLM fallback）
- `apps/web/src/__tests__/MysteryView.test.tsx` — 前端渲染

## 经验教训

### 2026-09-12：大型 SearchReplace 的陷阱

使用大型 SearchReplace 块时，可能意外删除未参与替换的代码。修复方法：
1. 搜索所有引用点确认完整性
2. 用 `git show <commit>:<file>` 恢复原始版本
3. 对比 diff 确认修复正确

