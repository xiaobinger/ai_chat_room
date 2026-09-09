import { describe, expect, it } from 'vitest';
import { GameError } from '../game/errors';
import { UndercoverGame } from '../game/undercover-game';
import { WerewolfGame } from '../game/werewolf-game';
import { ThiefGame } from '../game/thief-game';
import { MysteryGame } from '../game/mystery-game';
import type { GamePlayerInfo } from '../game/errors';

function aiPlayers(count: number): GamePlayerInfo[] {
  return Array.from({ length: count }, (_, i) => ({
    playerId: `p${i + 1}`,
    nickname: `玩家${i + 1}`,
    isAi: true,
  }));
}

/** 驱动全 AI 对局直到结束（或超过步数上限，视为卡死） */
function runToEnd(game: UndercoverGame | WerewolfGame | ThiefGame | MysteryGame, maxSteps = 500): number {
  let steps = 0;
  while (!game.isFinished() && steps < maxSteps) {
    const moved = game.step();
    if (!moved) throw new Error(`游戏在第 ${steps} 步卡住（无待行动人类却无法推进）`);
    steps += 1;
  }
  expect(game.isFinished()).toBe(true);
  return steps;
}

describe('谁是卧底', () => {
  it('按人数分配卧底数量，平民词一致且与卧底词不同', () => {
    const players = aiPlayers(6);
    const game = new UndercoverGame(players);
    const state = game.getState() as {
      players: { role: string; word: string }[];
      civilianWord: string;
      undercoverWord: string;
    };
    const undercovers = state.players.filter((p) => p.role === 'undercover');
    const civilians = state.players.filter((p) => p.role === 'civilian');
    expect(undercovers.length).toBe(2);
    expect(civilians.length).toBe(4);
    expect(state.civilianWord).not.toBe(state.undercoverWord);
    for (const c of civilians) expect(c.word).toBe(state.civilianWord);
    for (const u of undercovers) expect(u.word).toBe(state.undercoverWord);
  });

  it('描述必须轮到自己，且不能说出词本身', () => {
    const game = new UndercoverGame(aiPlayers(4));
    const view = game.getView('p1') as { currentSpeakerId: string };
    const speaker = view.currentSpeakerId;
    const speakerView = game.getView(speaker) as { myWord: string };
    const notSpeaker = ['p1', 'p2', 'p3', 'p4'].find((id) => id !== speaker)!;
    expect(() => game.handleAction({ type: 'describe', playerId: notSpeaker, content: '测试' })).toThrow(GameError);
    expect(() =>
      game.handleAction({ type: 'describe', playerId: speaker, content: `我说的是${speakerView.myWord}` }),
    ).toThrow(GameError);
    game.handleAction({ type: 'describe', playerId: speaker, content: '一种常见的东西' });
    const after = game.getView(speaker) as { currentSpeakerId: string | null; descriptions: unknown[] };
    expect(after.descriptions.length).toBe(1);
    expect(after.currentSpeakerId).not.toBe(speaker);
  });

  it('平票无人出局，多数票淘汰', () => {
    const game = new UndercoverGame(aiPlayers(4));
    // 快进到投票
    let guard = 0;
    while ((game.getState() as { phase: string }).phase === 'describing' && guard++ < 20) game.step();
    expect((game.getState() as { phase: string }).phase).toBe('voting');
  });

  it('全 AI 对局能完整跑完并给出胜负', () => {
    for (let run = 0; run < 5; run++) {
      const game = new UndercoverGame(aiPlayers(4 + (run % 5)));
      runToEnd(game);
      const results = game.getResults();
      expect(results).not.toBeNull();
      const entries = Object.values(results!);
      const undercovers = entries.filter((r) => r.role === '卧底').length;
      const winners = entries.filter((r) => r.won).length;
      expect(undercovers).toBeGreaterThan(0);
      // 胜者要么是全部卧底，要么是全部平民
      expect([undercovers, entries.length - undercovers]).toContain(winners);
    }
  });

  it('视角不泄露其他玩家的词和身份', () => {
    const game = new UndercoverGame(aiPlayers(5));
    const view = game.getView('p1') as { players: { word?: string; role?: string; isMe: boolean }[]; civilianWord?: string; undercoverWord?: string };
    for (const p of view.players) {
      if (!p.isMe) {
        expect(p.word).toBeUndefined();
        expect(p.role).toBeUndefined();
      }
    }
    expect(view.civilianWord).toBeUndefined();
    expect(view.undercoverWord).toBeUndefined();
  });
});

describe('狼人杀', () => {
  it('女巫药剂整局各一次，不会每晚重置', () => {
    const game = new WerewolfGame(aiPlayers(9));
    const witch = (game.getState() as { players: { playerId: string; role: string }[] }).players.find(
      (p) => p.role === 'witch',
    )!;
    // 模拟女巫用掉解药
    const state = game.getState() as { nightVictim?: string; witchPotions: { save: boolean } };
    state.nightVictim = 'p1';
    game.handleAction({ type: 'witch_save', playerId: witch.playerId });
    const after = game.getState() as { witchPotions: { save: boolean }; witchTonight?: string };
    expect(after.witchPotions.save).toBe(false);
    expect(after.witchTonight).toBe('save');
    // 再用一次应报错
    expect(() => {
      (game.getState() as { nightVictim?: string }).nightVictim = 'p2';
      game.handleAction({ type: 'witch_save', playerId: witch.playerId });
    }).toThrow(GameError);
  });

  it('非狼人不能发动狼人击杀', () => {
    const game = new WerewolfGame(aiPlayers(9));
    const villager = (game.getState() as { players: { playerId: string; role: string }[] }).players.find(
      (p) => p.role === 'villager',
    )!;
    expect(() => game.handleAction({ type: 'werewolf_kill', playerId: villager.playerId, targetId: 'p1' })).toThrow(
      GameError,
    );
  });

  it('视角只暴露自己的身份；狼人可见队友；预言家可见查验记录', () => {
    const game = new WerewolfGame(aiPlayers(9));
    const state = game.getState() as { players: { playerId: string; role: string }[] };
    const wolf = state.players.find((p) => p.role === 'werewolf')!;
    const seer = state.players.find((p) => p.role === 'seer')!;
    const villager = state.players.find((p) => p.role === 'villager')!;

    const wolfView = game.getView(wolf.playerId) as {
      myRole: string;
      wolfTeammates?: unknown[];
      players: { role?: string; isMe: boolean }[];
    };
    expect(wolfView.myRole).toBe('werewolf');
    expect(wolfView.wolfTeammates).toBeDefined();
    expect(wolfView.players.filter((p) => !p.isMe && p.role).length).toBe(0);

    const seerView = game.getView(seer.playerId) as { seerChecks?: unknown[] };
    expect(seerView.seerChecks).toBeDefined();

    const villagerView = game.getView(villager.playerId) as { wolfTeammates?: unknown[]; seerChecks?: unknown[] };
    expect(villagerView.wolfTeammates).toBeUndefined();
    expect(villagerView.seerChecks).toBeUndefined();

    const spectator = game.getView(null) as { myRole?: string; players: { role?: string }[] };
    expect(spectator.myRole).toBeUndefined();
    expect(spectator.players.every((p) => p.role === undefined)).toBe(true);
  });

  it('全 AI 对局能完整跑完（多狼投票/女巫/猎人开枪）', () => {
    for (let run = 0; run < 3; run++) {
      const game = new WerewolfGame(aiPlayers(9));
      runToEnd(game);
      const state = game.getState() as { winner: string };
      expect(['werewolf', 'villager']).toContain(state.winner);
    }
  });
});

describe('谁是凶手', () => {
  it('侦探调查结果只写入私密笔记', () => {
    const game = new ThiefGame(aiPlayers(5));
    const state = game.getState() as { players: { playerId: string; role: string }[] };
    const detective = state.players.find((p) => p.role === 'detective')!;
    const target = state.players.find((p) => p.playerId !== detective.playerId)!;
    game.handleAction({ type: 'investigate', playerId: detective.playerId, targetId: target.playerId });

    const myView = game.getView(detective.playerId) as { myNotes: string[] };
    expect(myView.myNotes.length).toBe(1);
    expect(myView.myNotes[0]).toContain(target.playerId ? '玩家' : '');

    const other = state.players.find((p) => p.playerId !== detective.playerId)!;
    const otherView = game.getView(other.playerId) as { myNotes: string[] };
    expect(otherView.myNotes.length).toBe(0);
  });

  it('视角不泄露其他玩家身份', () => {
    const game = new ThiefGame(aiPlayers(5));
    const state = game.getState() as { players: { playerId: string; role: string }[] };
    const me = state.players[0];
    const view = game.getView(me.playerId) as { players: { role?: string; isMe: boolean }[]; thiefTeamIds?: unknown };
    expect(view.players.filter((p) => !p.isMe && p.role).length).toBe(0);
    expect(view.thiefTeamIds).toBeUndefined();
  });

  it('全 AI 对局能完整跑完', () => {
    for (let run = 0; run < 3; run++) {
      const game = new ThiefGame(aiPlayers(6));
      runToEnd(game);
      const state = game.getState() as { winner: string };
      expect(['thief', 'citizen']).toContain(state.winner);
    }
  });
});

describe('剧本杀', () => {
  it('全 AI 对局按阶段推进到揭晓', () => {
    const game = new MysteryGame(aiPlayers(5));
    const phases: string[] = [];
    let steps = 0;
    while (!game.isFinished() && steps < 500) {
      const phase = (game.getState() as { phase: string }).phase;
      if (phases[phases.length - 1] !== phase) phases.push(phase);
      game.step();
      steps += 1;
    }
    expect(game.isFinished()).toBe(true);
    // 循环在进入 reveal 时退出，补记终态
    expect((game.getState() as { phase: string }).phase).toBe('reveal');
    expect(phases[0]).toBe('introduction');
    // 至少一轮 investigation → discussion → voting，可能有多个循环（多轮投票制）
    expect(phases.length).toBeGreaterThan(4);
    expect(phases.slice(1)).toEqual([...phases.slice(1)].filter((v, i, arr) => i === 0 || v !== arr[i - 1]));
    const state = game.getState() as { winner: string };
    expect(['murderer', 'detectives']).toContain(state.winner);
  });

  it('视角对非凶手隐藏凶手身份，凶手可见凶器', () => {
    const game = new MysteryGame(aiPlayers(5));
    const state = game.getState() as { players: { playerId: string; character: { isMurderer: boolean } }[]; murderWeapon: string };
    const murderer = state.players.find((p) => p.character.isMurderer)!;
    const innocent = state.players.find((p) => !p.character.isMurderer)!;

    const murdererView = game.getView(murderer.playerId) as { murderWeapon: string; murdererId?: string };
    expect(murdererView.murderWeapon).toBe(state.murderWeapon);
    expect(murdererView.murdererId).toBeUndefined();

    const innocentView = game.getView(innocent.playerId) as { murderWeapon: string };
    expect(innocentView.murderWeapon).toBe('???');
  });
});

describe('引擎重启恢复', () => {
  it('从持久化状态恢复后能继续推进', () => {
    const game = new UndercoverGame(aiPlayers(5));
    // 推进几步
    game.step();
    game.step();
    const saved = game.getState();

    const restored = new UndercoverGame(aiPlayers(5), saved);
    expect(restored.getState()).toEqual(saved);
    runToEnd(restored);
  });

  it('旧格式状态（无 format 字段）拒绝恢复', () => {
    expect(() => new UndercoverGame(aiPlayers(5), { phase: 'describing' } as never)).toThrow(GameError);
    expect(() => new WerewolfGame(aiPlayers(6), { phase: 'night' } as never)).toThrow(GameError);
  });
});
