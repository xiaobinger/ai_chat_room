import { Eye, Lightbulb, MessageCircle, Search } from 'lucide-react';
import {
  Countdown,
  InfoBlock,
  PhaseBadge,
  PlayerChips,
  PlayerCount,
  RoleCard,
  SpeechInput,
  Timeline,
  VoteGrid,
  WinnerBanner,
  type ActFn,
  type GameViewState,
} from './game-parts';

const ROLE_LABELS: Record<string, string> = {
  thief: '小偷',
  detective: '侦探',
  citizen: '普通市民',
  master_thief: '神偷',
  accomplice: '同伙',
  witness: '目击者',
};

const ROLE_DESCRIPTIONS: Record<string, string> = {
  thief: '隐藏身份，避免被投票出局。可以嫁祸他人一次（暗中增加其嫌疑）。',
  detective: '每轮可调查一名玩家是否为小偷（结果只有你知道）。',
  citizen: '通过观察和推理找出小偷。',
  master_thief: '被投票出局时可用金蝉脱壳逃脱一次。',
  accomplice: '帮助小偷隐藏身份，共同获胜。',
  witness: '可公开一条案件线索（整局一次）。',
};

interface ThiefViewState extends GameViewState {
  stolenItem?: string;
  crimeScene?: string;
  revealedClues?: string[];
  speechLog?: { round: number; playerId: string; nickname: string; content: string }[];
  myNotes?: string[];
  voteStatus?: Record<string, 'voted' | 'abstained'>;
}

export function ThiefGameView({
  view,
  myPlayerId,
  alive,
  deadline,
  act,
  refresh,
}: {
  view: ThiefViewState;
  myPlayerId: string | null;
  alive: boolean;
  deadline: number | null;
  act: ActFn;
  refresh: () => void;
}) {
  const finished = view.phase === 'result';
  const myRole = view.myRole;
  const myRoleLabel = myRole ? ROLE_LABELS[myRole] : undefined;
  const canAct = alive && !finished;
  const alivePlayers = view.players.filter((p) => p.isAlive);
  const iHaveSpoken = view.players.find((p) => p.playerId === myPlayerId)?.hasSpoken ?? false;

  return (
    <div className="game-view thief">
      <div className="game-toolbar">
        <PhaseBadge phase={view.phase} round={view.round} />
        <PlayerCount players={view.players} />
        <Countdown deadline={finished ? null : deadline} onExpire={refresh} />
      </div>

      {finished && view.winner && (
        <WinnerBanner
          text={view.winner === 'citizen' ? '市民阵营获胜！' : '小偷阵营获胜！'}
          tone={view.winner === 'citizen' ? 'good' : 'bad'}
        />
      )}

      <div className="case-brief">
        <h4>案件通报</h4>
        <p>{view.crimeScene}</p>
        <p>
          失窃物品：<b>{view.stolenItem}</b>
        </p>
      </div>

      {myRoleLabel && !finished && (
        <RoleCard title="我的身份" roleName={myRoleLabel} description={ROLE_DESCRIPTIONS[myRole ?? '']} accent={myRole === 'thief' || myRole === 'master_thief' || myRole === 'accomplice' ? 'wolf' : ''} />
      )}

      {view.myNotes && view.myNotes.length > 0 && (
        <InfoBlock>
          <Eye size={14} />
          <div>
            <b>我的调查笔记</b>
            {view.myNotes.map((note, index) => (
              <p key={index}>{note}</p>
            ))}
          </div>
        </InfoBlock>
      )}

      {/* 调查讨论 */}
      {view.phase === 'investigation' && (
        <div className="action-panel">
          <h4>
            <MessageCircle size={15} /> 调查讨论
          </h4>
          {canAct && !iHaveSpoken && (
            <SpeechInput
              placeholder="陈述你的推理、质疑或辩护……"
              disabled={!canAct}
              onSpeak={(content) => void act('speak', { content })}
              onSkip={() => void act('speak_skip')}
            />
          )}
          {canAct && iHaveSpoken && <p className="hint">你已发言，等待其他人……</p>}

          {canAct && myRole === 'detective' && (
            <div className="target-select">
              <p>
                <Search size={14} /> 侦探调查（每轮一次，结果仅自己可见）：
              </p>
              <div className="vote-options">
                {alivePlayers
                  .filter((p) => p.playerId !== myPlayerId)
                  .map((p) => (
                    <button key={p.playerId} className="vote-btn" onClick={() => void act('investigate', { targetId: p.playerId })}>
                      <span className="player-avatar small">{p.nickname.slice(0, 1)}</span>
                      {p.seatNumber ? `${p.seatNumber}号 ` : ''}
                      {p.nickname}
                    </button>
                  ))}
              </div>
            </div>
          )}

          {canAct && (myRole === 'thief' || myRole === 'master_thief') && (
            <div className="target-select">
              <p>嫁祸（整局一次，暗中增加目标嫌疑）：</p>
              <div className="vote-options">
                {alivePlayers
                  .filter((p) => p.playerId !== myPlayerId)
                  .map((p) => (
                    <button key={p.playerId} className="vote-btn danger" onClick={() => void act('frame', { targetId: p.playerId })}>
                      <span className="player-avatar small">{p.nickname.slice(0, 1)}</span>
                      {p.seatNumber ? `${p.seatNumber}号 ` : ''}
                      {p.nickname}
                    </button>
                  ))}
              </div>
            </div>
          )}

          {canAct && myRole === 'witness' && (
            <button className="action-btn secondary" onClick={() => void act('reveal_clue')}>
              <Lightbulb size={14} /> 公开我掌握的线索（整局一次）
            </button>
          )}
        </div>
      )}

      {/* 投票 */}
      {view.phase === 'voting' && (
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
            <p className="hint">{canAct ? '等待其他玩家投票……' : '观战中，等待投票结果……'}</p>
          )}
        </div>
      )}

      {/* 线索 */}
      {(view.revealedClues ?? []).length > 0 && (
        <div className="clues-section">
          <h4>已公开线索</h4>
          <div className="clue-cards">
            {(view.revealedClues ?? []).map((clue, index) => (
              <div key={index} className="clue-card">
                <p className="clue-desc">{clue}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 发言记录 */}
      {(view.speechLog ?? []).length > 0 && (
        <div className="game-section">
          <h4>发言记录</h4>
          <div className="day-messages">
            {(view.speechLog ?? []).map((s, index) => (
              <div key={index} className="day-message">
                <b>{s.nickname}：</b>
                <span>{s.content}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="game-section">
        <h4>玩家</h4>
        <PlayerChips players={view.players} voteStatus={view.phase === 'voting' ? view.voteStatus : undefined} showRoles={finished} />
      </div>

      <Timeline events={view.events ?? []} />
    </div>
  );
}
