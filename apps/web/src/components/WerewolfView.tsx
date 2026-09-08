import { Crosshair, Eye, FlaskConical, Moon, PawPrint, Shield } from 'lucide-react';
import {
  Countdown,
  PhaseBadge,
  PlayerChips,
  PlayerCount,
  RoleCard,
  SpeechInput,
  Timeline,
  VoteGrid,
  WinnerBanner,
  InfoBlock,
  type ActFn,
  type GamePlayerView,
  type GameViewState,
} from './game-parts';

const ROLE_LABELS: Record<string, string> = {
  werewolf: '狼人',
  villager: '村民',
  seer: '预言家',
  witch: '女巫',
  hunter: '猎人',
};

const ROLE_DESCRIPTIONS: Record<string, string> = {
  werewolf: '每晚与同伴共同选择一名玩家击杀。消灭所有好人即获胜。',
  villager: '白天发言与投票，找出狼人。',
  seer: '每晚查验一名玩家的阵营。',
  witch: '解药与毒药整局各一次；解药救当晚被刀的人，毒药毒死一名玩家。',
  hunter: '被放逐或被刀死时可开枪带走一人（被毒死不能开枪）。',
};

interface WerewolfViewState extends GameViewState {
  wolfTeammates?: { playerId: string; nickname: string; isAlive: boolean }[];
  seerChecks?: { round: number; targetName: string; isWerewolf: boolean }[];
  witchPotions?: { save: boolean; poison: boolean };
  witchActed?: boolean;
  nightVictim?: string | null;
  dayMessages?: { playerId: string; nickname: string; content: string; timestamp: number }[];
  speechStatus?: Record<string, 'spoken' | 'skipped'>;
  voteStatus?: Record<string, 'voted' | 'abstained'>;
  myNightActionDone?: boolean;
  pendingHunterIsMe?: boolean;
  canShoot?: boolean;
  deadTonight?: string[];
  deadToday?: string[];
}

export function WerewolfView({
  view,
  myPlayerId,
  alive,
  deadline,
  act,
  refresh,
}: {
  view: WerewolfViewState;
  myPlayerId: string | null;
  alive: boolean;
  deadline: number | null;
  act: ActFn;
  refresh: () => void;
}) {
  const finished = view.phase === 'finished';
  const myRole = view.myRole;
  const myRoleLabel = myRole ? ROLE_LABELS[myRole] : undefined;
  const iAmWerewolf = myRole === 'werewolf';

  const alivePlayers = view.players.filter((p) => p.isAlive);
  const me = view.players.find((p) => p.playerId === myPlayerId);
  const canAct = alive && !finished;

  return (
    <div className="game-view werewolf">
      <div className="game-toolbar">
        <PhaseBadge phase={view.phase} round={view.round} />
        <PlayerCount players={view.players} />
        <Countdown deadline={finished ? null : deadline} onExpire={refresh} />
      </div>

      {finished && view.winner && (
        <WinnerBanner
          text={view.winner === 'werewolf' ? '狼人阵营获胜！' : '好人阵营获胜！'}
          tone={view.winner === 'werewolf' ? 'bad' : 'good'}
        />
      )}

      {myRoleLabel && !finished && (
        <RoleCard title="我的身份" roleName={myRoleLabel} description={ROLE_DESCRIPTIONS[myRole ?? '']} accent={iAmWerewolf ? 'wolf' : ''} />
      )}

      {iAmWerewolf && view.wolfTeammates && view.wolfTeammates.length > 0 && !finished && (
        <InfoBlock>
          <PawPrint size={14} /> 狼队友：
          {view.wolfTeammates.map((t) => (
            <span key={t.playerId} className={`teammate ${t.isAlive ? '' : 'dead'}`}>
              {t.nickname}
              {!t.isAlive && '（出局）'}
            </span>
          ))}
        </InfoBlock>
      )}

      {/* 夜晚行动 */}
      {view.phase === 'night' && !finished && (
        <div className="action-panel night">
          <h4>
            <Moon size={15} /> 天黑请闭眼
          </h4>

          {myRole === 'werewolf' && canAct && !view.myNightActionDone && (
            <div className="target-select">
              <p>选择今晚的击杀目标：</p>
              <div className="vote-options">
                {alivePlayers
                  .filter((p) => p.playerId !== myPlayerId && !(view.wolfTeammates ?? []).some((t) => t.playerId === p.playerId))
                  .map((p) => (
                    <button key={p.playerId} className="vote-btn danger" onClick={() => void act('werewolf_kill', { targetId: p.playerId })}>
                      <span className="player-avatar small">{p.nickname.slice(0, 1)}</span>
                      {p.nickname}
                    </button>
                  ))}
              </div>
            </div>
          )}

          {myRole === 'seer' && canAct && !view.myNightActionDone && (
            <div className="target-select">
              <p>
                <Eye size={14} /> 选择今晚要查验的玩家：
              </p>
              <div className="vote-options">
                {alivePlayers
                  .filter((p) => p.playerId !== myPlayerId)
                  .map((p) => (
                    <button key={p.playerId} className="vote-btn" onClick={() => void act('seer_check', { targetId: p.playerId })}>
                      <span className="player-avatar small">{p.nickname.slice(0, 1)}</span>
                      {p.nickname}
                    </button>
                  ))}
              </div>
            </div>
          )}

          {myRole === 'witch' && canAct && !view.witchActed && (
            <div className="witch-panel">
              <p>
                <FlaskConical size={14} /> 今晚倒下的人：
                <b>{view.nightVictim ?? '（待狼人行动）'}</b>
              </p>
              <div className="witch-potions">
                <button
                  className="action-btn primary"
                  disabled={!view.witchPotions?.save || !view.nightVictim}
                  onClick={() => void act('witch_save')}
                >
                  <Shield size={14} /> 使用解药救人
                </button>
                <div className="poison-select">
                  <select id="poison-target" defaultValue="" disabled={!view.witchPotions?.poison}>
                    <option value="" disabled>
                      选择毒杀目标
                    </option>
                    {alivePlayers
                      .filter((p) => p.playerId !== myPlayerId)
                      .map((p) => (
                        <option key={p.playerId} value={p.playerId}>
                          {p.nickname}
                        </option>
                      ))}
                  </select>
                  <button
                    className="action-btn danger"
                    disabled={!view.witchPotions?.poison}
                    onClick={() => {
                      const select = document.getElementById('poison-target') as HTMLSelectElement | null;
                      const targetId = select?.value;
                      if (targetId) void act('witch_poison', { targetId });
                    }}
                  >
                    使用毒药
                  </button>
                </div>
                <button className="action-btn secondary" onClick={() => void act('witch_pass')}>
                  今晚不用药
                </button>
              </div>
            </div>
          )}

          {(myRole === 'villager' || myRole === 'hunter' || view.myNightActionDone || view.witchActed) && (
            <p className="hint">夜深了，等待其他玩家行动……</p>
          )}
          {me && !me.isAlive && <p className="hint">你已出局，以上帝视角观战。</p>}
          {!myPlayerId && <p className="hint">观战中……</p>}
        </div>
      )}

      {/* 猎人开枪（任意阶段） */}
      {view.pendingHunterIsMe && !finished && (
        <div className="action-panel hunter">
          <h4>
            <Crosshair size={15} /> 你是猎人，可以开枪带走一名玩家！
          </h4>
          <div className="vote-options">
            {alivePlayers
              .filter((p) => p.playerId !== myPlayerId)
              .map((p) => (
                <button key={p.playerId} className="vote-btn danger" onClick={() => void act('hunter_shoot', { targetId: p.playerId })}>
                  <span className="player-avatar small">{p.nickname.slice(0, 1)}</span>
                  {p.nickname}
                </button>
              ))}
          </div>
          <button className="action-btn ghost" onClick={() => void act('hunter_shoot')}>
            收起枪，不开火
          </button>
        </div>
      )}

      {/* 白天发言 */}
      {view.phase === 'day' && !finished && (
        <div className="action-panel day">
          <h4>白天 · 自由发言</h4>
          {canAct && !view.speechStatus?.[myPlayerId ?? ''] && (
            <SpeechInput
              placeholder="发表你的推理与看法（Enter 发送）"
              disabled={!canAct}
              onSpeak={(content) => void act('day_speak', { content })}
              onSkip={() => void act('day_skip')}
            />
          )}
          <div className="day-messages">
            {(view.dayMessages ?? []).map((m, index) => (
              <div key={index} className="day-message">
                <b>{m.nickname}：</b>
                <span>{m.content}</span>
              </div>
            ))}
            {(!view.dayMessages || view.dayMessages.length === 0) && <p className="hint">还没有人发言。</p>}
          </div>
        </div>
      )}

      {/* 投票 */}
      {view.phase === 'vote' && !finished && (
        <div className="action-panel vote">
          {canAct && !view.voteStatus?.[myPlayerId ?? ''] ? (
            <VoteGrid
              players={view.players}
              myPlayerId={myPlayerId}
              disabled={!canAct}
              onVote={(targetId) => void act('vote', { targetId })}
              onAbstain={() => void act('vote_abstain')}
            />
          ) : (
            <p className="hint">等待其他玩家投票……</p>
          )}
        </div>
      )}

      <div className="game-section">
        <h4>玩家</h4>
        <PlayerChips
          players={view.players}
          speechStatus={view.phase === 'day' ? view.speechStatus : undefined}
          voteStatus={view.phase === 'vote' ? view.voteStatus : undefined}
          showRoles={finished}
        />
      </div>

      <Timeline events={view.events ?? []} />
    </div>
  );
}

export type { GamePlayerView };
