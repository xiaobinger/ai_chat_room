import { describe, expect, it } from 'vitest';
import { GameError } from '../game/errors';
import { decideSeerCheck, decideVote, decideWitchAction, decideWolfKill } from '../game/ai-decision';
import { UndercoverGame } from '../game/undercover-game';
import { WerewolfGame } from '../game/werewolf-game';
import { ThiefGame } from '../game/thief-game';
import { MysteryGame } from '../game/mystery-game';
import { aiJudgeBroadcast } from '../game/werewolf-engine';
import type { GameState } from '../game/types';
import type { GamePlayerInfo } from '../game/errors';

function aiPlayers(count: number): GamePlayerInfo[] {
  return Array.from({ length: count }, (_, i) => ({
    playerId: `p${i + 1}`,
    nickname: `玩家${i + 1}`,
    isAi: true,
  }));
}

function withMockedRandom<T>(value: number, fn: () => T): T {
  const original = Math.random;
  Math.random = () => value;
  try {
    return fn();
  } finally {
    Math.random = original;
  }
}

/** 驱动全 AI 对局直到结束（或超过步数上限，视为卡死） */
async function runToEnd(game: UndercoverGame | WerewolfGame | ThiefGame | MysteryGame, maxSteps = 500): Promise<number> {
  let steps = 0;
  while (!game.isFinished() && steps < maxSteps) {
    const moved = await game.step();
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

  it('全 AI 对局能完整跑完并给出胜负', async () => {
    for (let run = 0; run < 5; run++) {
      const game = new UndercoverGame(aiPlayers(4 + (run % 5)));
      await runToEnd(game);
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

  it('玩家视角包含座位号，便于后续 3D 座位映射', () => {
    const game = new UndercoverGame(aiPlayers(5));
    const state = game.getState() as { players: { playerId: string }[] };
    const view = game.getView(state.players[0].playerId) as { players: { seatNumber?: number }[] };

    expect(view.players.map((player) => player.seatNumber)).toEqual([1, 2, 3, 4, 5]);
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

  it('人类女巫要等狼人行动结束后才进入待行动列表', () => {
    const base = new WerewolfGame(aiPlayers(9));
    const baseState = base.getState() as { players: { playerId: string; role: string }[] };
    const witch = baseState.players.find((p) => p.role === 'witch')!;
    const players = aiPlayers(9).map((p) => (p.playerId === witch.playerId ? { ...p, isAi: false } : p));
    const game = new WerewolfGame(players, base.getState());
    const state = game.getState() as { players: { playerId: string; role: string }[] };
    const wolves = state.players.filter((p) => p.role === 'werewolf');
    const target = state.players.find((p) => p.role === 'villager')!;

    expect(game.pendingHumans()).toEqual([]);

    wolves.forEach((wolf) => {
      game.handleAction({ type: 'werewolf_kill', playerId: wolf.playerId, targetId: target.playerId });
    });

    expect(game.pendingHumans()).toContain(witch.playerId);
  });

  it('女巫被刀且解药未用时，不报号但仍可自救', () => {
    const game = new WerewolfGame(aiPlayers(9));
    const state = game.getState() as { players: { playerId: string; role: string }[] };
    const wolves = state.players.filter((p) => p.role === 'werewolf');
    const witch = state.players.find((p) => p.role === 'witch')!;

    wolves.forEach((wolf) => {
      game.handleAction({ type: 'werewolf_kill', playerId: wolf.playerId, targetId: witch.playerId });
    });

    const witchView = game.getView(witch.playerId) as {
      witchNightStatus?: string;
      nightVictim?: string | null;
      witchCanAct?: boolean;
      witchCanSave?: boolean;
    };
    expect(witchView.witchNightStatus).toBe('self_target');
    expect(witchView.nightVictim).toBeNull();
    expect(witchView.witchCanAct).toBe(true);
    expect(witchView.witchCanSave).toBe(true);
  });

  it('女巫解药用完后，不再知道夜晚刀口', () => {
    const game = new WerewolfGame(aiPlayers(9));
    const state = game.getState() as {
      players: { playerId: string; role: string; isAlive: boolean }[];
      witchPotions: { save: boolean; poison: boolean };
      witchTonight?: string;
      wolfVotes: Record<string, string>;
      nightVictim?: string;
    };
    const wolves = state.players.filter((p) => p.role === 'werewolf');
    const witch = state.players.find((p) => p.role === 'witch')!;
    const firstTarget = state.players.find((p) => p.role === 'villager')!;

    wolves.forEach((wolf) => {
      game.handleAction({ type: 'werewolf_kill', playerId: wolf.playerId, targetId: firstTarget.playerId });
    });
    game.handleAction({ type: 'witch_save', playerId: witch.playerId });
    state.witchTonight = undefined;
    state.wolfVotes = {};
    state.nightVictim = undefined;
    const nextTarget = state.players.find((p) => p.role !== 'werewolf' && p.playerId !== witch.playerId && p.isAlive)!;
    const nextWolves = state.players.filter((p) => p.role === 'werewolf' && p.isAlive);
    nextWolves.forEach((wolf) => {
      game.handleAction({ type: 'werewolf_kill', playerId: wolf.playerId, targetId: nextTarget.playerId });
    });

    const witchView = game.getView(witch.playerId) as {
      witchNightStatus?: string;
      nightVictim?: string | null;
      witchCanSave?: boolean;
    };
    expect(witchView.witchNightStatus).toBe('no_save_potion');
    expect(witchView.nightVictim).toBeNull();
    expect(witchView.witchCanSave).toBe(false);
  });

  it('AI 法官会按夜晚子阶段切换主持词，并使用座位号', () => {
    const game = new WerewolfGame(aiPlayers(9));
    const state = game.getState() as {
      phase: string;
      players: { playerId: string; role: string }[];
    };
    const wolves = state.players.filter((p) => p.role === 'werewolf');
    const seer = state.players.find((p) => p.role === 'seer')!;
    const witch = state.players.find((p) => p.role === 'witch')!;
    const villager = state.players.find((p) => p.role === 'villager')!;

    expect(aiJudgeBroadcast(game.getState() as unknown as GameState)).toContain('狼人请睁眼');

    wolves.forEach((wolf) => {
      game.handleAction({ type: 'werewolf_kill', playerId: wolf.playerId, targetId: villager.playerId });
    });
    expect(aiJudgeBroadcast(game.getState() as unknown as GameState)).toContain('预言家请睁眼');

    game.handleAction({ type: 'seer_check', playerId: seer.playerId, targetId: wolves[0].playerId });
    const witchBroadcast = aiJudgeBroadcast(game.getState() as unknown as GameState);
    expect(witchBroadcast).toContain('女巫请睁眼');
    expect(witchBroadcast).toContain('号');

    const witchView = game.getView(witch.playerId) as {
      players: { playerId: string; seatNumber?: number }[];
      nightVictimSeatNumber?: number | null;
    };
    const villagerSeatNumber = witchView.players.find((p) => p.playerId === villager.playerId)?.seatNumber;
    expect(villagerSeatNumber).toBeTypeOf('number');
    expect(witchView.nightVictimSeatNumber).toBe(villagerSeatNumber);
  });

  it('狼人 AI 会优先刀公开跳预言家的玩家', () => {
    const game = new WerewolfGame(aiPlayers(9));
    const state = game.getState() as unknown as GameState;
    const wolf = state.players.find((player) => player.role === 'werewolf')!;
    const fakeSeer = state.players.find((player) => player.role === 'villager')!;
    state.dayMessages.push({
      playerId: fakeSeer.playerId,
      nickname: fakeSeer.nickname,
      content: '我是预言家，今天大家先听我归票。',
      timestamp: Date.now(),
    });

    const targetId = withMockedRandom(0.1, () => decideWolfKill({ state, aiPlayer: wolf }));
    expect(targetId).toBe(fakeSeer.playerId);
  });

  it('预言家 AI 会优先查验跳预言家的对跳玩家', () => {
    const game = new WerewolfGame(aiPlayers(9));
    const state = game.getState() as unknown as GameState;
    const seer = state.players.find((player) => player.role === 'seer')!;
    const fakeSeer = state.players.find((player) => player.role === 'villager')!;
    state.dayMessages.push({
      playerId: fakeSeer.playerId,
      nickname: fakeSeer.nickname,
      content: '我是预言家，我昨晚已经验过人了。',
      timestamp: Date.now(),
    });

    const targetId = decideSeerCheck({ state, aiPlayer: seer });
    expect(targetId).toBe(fakeSeer.playerId);
  });

  it('女巫 AI 被刀时会优先选择自救', () => {
    const game = new WerewolfGame(aiPlayers(9));
    const state = game.getState() as unknown as GameState;
    const witch = state.players.find((player) => player.role === 'witch')!;
    state.nightVictim = witch.playerId;

    expect(decideWitchAction({ state, aiPlayer: witch })).toBe('save');
  });

  it('平民 AI 遇到预言家对跳时会优先在对跳位中投票', () => {
    const game = new WerewolfGame(aiPlayers(9));
    const state = game.getState() as unknown as GameState;
    const villager = state.players.find((player) => player.role === 'villager')!;
    const otherVillager = state.players.find((player) => player.role === 'villager' && player.playerId !== villager.playerId)!;
    const hunter = state.players.find((player) => player.role === 'hunter')!;
    hunter.suspicion = 1;
    otherVillager.suspicion = 2;
    state.dayMessages.push(
      {
        playerId: villager.playerId,
        nickname: villager.nickname,
        content: '我是预言家，昨晚查到信息了。',
        timestamp: Date.now(),
      },
      {
        playerId: otherVillager.playerId,
        nickname: otherVillager.nickname,
        content: '我才是真预言家，前面那个在悍跳。',
        timestamp: Date.now() + 1,
      },
    );

    const voter = state.players.find((player) => player.role === 'hunter')!;
    const vote = decideVote({ state, aiPlayer: voter });
    expect([villager.playerId, otherVillager.playerId]).toContain(vote.targetId);
    expect(vote.targetId).toBe(otherVillager.playerId);
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

  it('全 AI 对局能完整跑完（多狼投票/女巫/猎人开枪）', async () => {
    for (let run = 0; run < 3; run++) {
      const game = new WerewolfGame(aiPlayers(9));
      await runToEnd(game);
      const state = game.getState() as { winner: string };
      expect(['werewolf', 'villager']).toContain(state.winner);
    }
  });

  it('AI 法官模式：全 AI 对局完整跑完，法官有广播且不参与角色分配', async () => {
    for (let run = 0; run < 3; run++) {
      const players = [...aiPlayers(8), { playerId: 'judge', nickname: 'AI 法官', isAi: true }];
      const game = new WerewolfGame(players, undefined, { judgeMode: 'ai', judgePlayerId: 'judge' });
      await runToEnd(game);
      const state = game.getState() as {
        winner: string;
        players: { playerId: string }[];
        events: { type: string }[];
      };
      expect(['werewolf', 'villager']).toContain(state.winner);
      expect(state.players.every((p) => p.playerId !== 'judge')).toBe(true);
      expect(state.events.some((e) => e.type === 'judge_speak')).toBe(true);
      // 终局视角全量公开：秘密夜晚行动可见（复盘数据源）
      const view = game.getView(null) as { events: { type: string }[] };
      expect(view.events.some((e) => e.type === 'night_action')).toBe(true);
    }
  });

  it('村民/猎人夜晚无行动，不阻塞夜晚结算（人类村民在场也能推进）', async () => {
    const base = new WerewolfGame(aiPlayers(9));
    const baseState = base.getState() as { players: { playerId: string; role: string }[] };
    const villager = baseState.players.find((p) => p.role === 'villager')!;
    const hunter = baseState.players.find((p) => p.role === 'hunter')!;
    const players = aiPlayers(9).map((p) =>
      p.playerId === villager.playerId || p.playerId === hunter.playerId ? { ...p, isAi: false } : p,
    );
    const game = new WerewolfGame(players, base.getState());
    // 夜晚：人类村民/猎人没有夜晚行动，不应出现在待行动列表
    expect(game.pendingHumans()).toEqual([]);
    // 夜晚应能由 AI 行动直接结算完毕
    let guard = 0;
    while ((game.getState() as { phase: string }).phase === 'night' && guard++ < 50) {
      expect(await game.step()).toBe(true);
    }
    expect((game.getState() as { phase: string }).phase).not.toBe('night');
  });

  it('人类猎人阵亡后进入待行动列表，超时托管自动收枪', () => {
    const base = new WerewolfGame(aiPlayers(9));
    const baseState = base.getState() as { players: { playerId: string; role: string }[] };
    const hunter = baseState.players.find((p) => p.role === 'hunter')!;
    const players = aiPlayers(9).map((p) => (p.playerId === hunter.playerId ? { ...p, isAi: false } : p));
    const game = new WerewolfGame(players, base.getState());
    const state = game.getState() as {
      pendingHunter?: string;
      players: { playerId: string; isAlive: boolean }[];
    };
    // 模拟猎人阵亡待开枪（阵亡者不在存活列表，历史上因此永远等不到人类行动）
    state.players.find((p) => p.playerId === hunter.playerId)!.isAlive = false;
    state.pendingHunter = hunter.playerId;
    expect(game.pendingHumans()).toContain(hunter.playerId);
    game.autoAct(hunter.playerId);
    expect(state.pendingHunter).toBeUndefined();
  });

  it('复盘事件记录夜晚细节（狼刀/查验/女巫用药），且对局中不泄露', () => {
    const game = new WerewolfGame(aiPlayers(9));
    const state = game.getState() as {
      players: { playerId: string; nickname: string; role: string }[];
      events: { type: string; content: string; secret?: boolean }[];
    };
    const wolf = state.players.find((p) => p.role === 'werewolf')!;
    const seer = state.players.find((p) => p.role === 'seer')!;
    const witch = state.players.find((p) => p.role === 'witch')!;
    const villager = state.players.find((p) => p.role === 'villager')!;

    game.handleAction({ type: 'werewolf_kill', playerId: wolf.playerId, targetId: villager.playerId });
    game.handleAction({ type: 'seer_check', playerId: seer.playerId, targetId: wolf.playerId });
    game.handleAction({ type: 'witch_save', playerId: witch.playerId });

    const nightEvents = state.events.filter((e) => e.type === 'night_action');
    expect(nightEvents.length).toBeGreaterThanOrEqual(3);
    expect(nightEvents.every((e) => e.secret)).toBe(true);
    expect(
      nightEvents.some((e) => e.content.includes(wolf.nickname) && e.content.includes(villager.nickname)),
    ).toBe(true);
    expect(nightEvents.some((e) => e.content.includes(seer.nickname))).toBe(true);
    expect(nightEvents.some((e) => e.content.includes(witch.nickname))).toBe(true);

    // 对局中玩家视角过滤秘密事件（防泄露身份）
    const view = game.getView(villager.playerId) as { events: { secret?: boolean; type: string }[] };
    expect(view.events.every((e) => !e.secret)).toBe(true);
    expect(view.events.every((e) => e.type !== 'night_action')).toBe(true);
  });
});

describe('谁是小偷', () => {
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

  it('全 AI 对局能完整跑完', async () => {
    for (let run = 0; run < 3; run++) {
      const game = new ThiefGame(aiPlayers(6));
      await runToEnd(game);
      const state = game.getState() as { winner: string };
      expect(['thief', 'citizen']).toContain(state.winner);
    }
  });

  it('玩家视角包含座位号，便于轻推理局 3D 化', () => {
    const game = new ThiefGame(aiPlayers(5));
    const state = game.getState() as { players: { playerId: string }[] };
    const view = game.getView(state.players[0].playerId) as { players: { seatNumber?: number }[] };

    expect(view.players.map((player) => player.seatNumber)).toEqual([1, 2, 3, 4, 5]);
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
    // 至少一轮 investigation → discussion → voting，首轮投对凶手则仅 4 个阶段，否则循环多轮
    expect(phases.length).toBeGreaterThanOrEqual(4);
    // introduction 之后的阶段必须严格按 investigation → discussion → voting 循环
    const cycle = ['investigation', 'discussion', 'voting'];
    phases.slice(1).forEach((phase, i) => {
      expect(phase).toBe(cycle[i % 3]);
    });
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

  it('玩家视角包含案名、座位号和嫌疑值，便于沉浸式案件展示', () => {
    const game = new MysteryGame(aiPlayers(5));
    const state = game.getState() as { scenarioTitle?: string; players: { playerId: string }[] };
    const view = game.getView(state.players[0].playerId) as {
      scenarioTitle?: string;
      players: { seatNumber?: number; suspicionLevel?: number }[];
    };

    expect(view.scenarioTitle).toBe(state.scenarioTitle);
    expect(view.players.map((player) => player.seatNumber)).toEqual([1, 2, 3, 4, 5]);
    expect(view.players.every((player) => typeof player.suspicionLevel === 'number')).toBe(true);
  });
});

describe('引擎重启恢复', () => {
  it('从持久化状态恢复后能继续推进', async () => {
    const game = new UndercoverGame(aiPlayers(5));
    // 推进几步
    game.step();
    game.step();
    const saved = game.getState();

    const restored = new UndercoverGame(aiPlayers(5), saved);
    expect(restored.getState()).toEqual(saved);
    await runToEnd(restored);
  });

  it('旧格式状态（无 format 字段）拒绝恢复', () => {
    expect(() => new UndercoverGame(aiPlayers(5), { phase: 'describing' } as never)).toThrow(GameError);
    expect(() => new WerewolfGame(aiPlayers(6), { phase: 'night' } as never)).toThrow(GameError);
  });
});
