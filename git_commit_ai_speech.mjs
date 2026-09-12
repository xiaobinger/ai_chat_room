import { execSync } from 'child_process';

const commitMessage = `feat: 剧本杀 AI 发言优化 + TTS 差异化音色自动播放

主要改进：
1. LLM 发言提示词优化：few-shot 示例、防重复约束、角色一致性强化
2. 为所有 56 个剧本杀角色添加性别字段
3. 新增 computeVoiceParams 函数：根据性别和性格计算 TTS 音色参数
4. 前端 TTS 增强：自动播放开关、性别/性格差异化音色
5. 后端 speakFor 传递 gender 和 ownPreviousSpeeches 给 LLM

修改文件：
- apps/ai-worker/src/game/speech-generator.ts
- apps/ai-worker/src/game/mystery-game.ts
- apps/ai-worker/src/game/mystery-engine.ts
- apps/ai-worker/src/game/mystery-types.ts
- apps/web/src/components/MysteryView.tsx
- apps/web/src/components/game-parts.tsx
- apps/web/src/styles/app.css`;

try {
  console.log('=== git add ===');
  execSync('git add -A', { stdio: 'inherit', cwd: 'e:\\new_workspace\\ai_chat_room\\ai_chat_room' });

  console.log('\n=== git commit ===');
  execSync(`git commit -m "${commitMessage}"`, { stdio: 'inherit', cwd: 'e:\\new_workspace\\ai_chat_room\\ai_chat_room' });

  console.log('\n=== git push ===');
  execSync('git push origin master', { stdio: 'inherit', cwd: 'e:\\new_workspace\\ai_chat_room\\ai_chat_room' });

  console.log('\n=== DONE ===');
} catch (e) {
  console.error('FAILED:', e.message);
  process.exit(1);
}
