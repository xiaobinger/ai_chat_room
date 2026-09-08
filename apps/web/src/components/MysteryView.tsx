import { BookOpen, Fingerprint, Search, Sparkles } from 'lucide-react';
import {
  Countdown,
  PlayerChips,
  PlayerCount,
  SpeechInput,
  Timeline,
  VoteGrid,
  WinnerBanner,
  type ActFn,
  type GameViewState,
} from './game-parts';

interface MysteryCharacter {
  name: string;
  role: string;
  personality: string;
  backstory: string;
  secret: string;
  objective: string;
  alibi: string;
  relationshipToVictim: string;
  isMurderer: boolean;
}

interface MysteryClue {
  id: string;
  name: string;
  description: string;
  location: string;
  revealsInfo: string;
  isKey: boolean;
}

interface MysteryViewState extends GameViewState {
  victim?: string;
  crimeScene?: string;
  murderWeapon?: string;
  myCharacter?: MysteryCharacter;
  discoveredClues?: MysteryClue[];
  totalClueCount?: number;
  discussionLog?: { playerId: string; playerName: string; characterName: string; content: string; type: string }[];
  voteStatus?: Record<string, 'voted' | 'abstained'>;
}

const MYSTERY_PHASE_LABELS: Record<string, string> = {
  introduction: '自我介绍',
  investigation: '搜证',
  discussion: '圆桌讨论',
  voting: '最终指认',
  reveal: '真相揭晓',
};

export function MysteryView({
  view,
  myPlayerId,
  alive,
  deadline,
  act,
  refresh,
}: {
  view: MysteryViewState;
  myPlayerId: string | null;
  alive: boolean;
  deadline: number | null;
  act: ActFn;
  refresh: () => void;
}) {
  const finished = view.phase === 'reveal';
  const canAct = alive && !finished;
  const me = view.players.find((p) => p.playerId === myPlayerId);
  const iHaveSpoken = me?.hasSpoken ?? false;
  const iHaveSearched = me?.hasSearched ?? false;

  return (
    <div className="game-view mystery">
      <div className="game-toolbar">
        <span className="phase-badge day">
          <BookOpen size={15} />
          {MYSTERY_PHASE_LABELS[view.phase] ?? view.phase}
          <small>第 {view.round} 轮</small>
        </span>
        <PlayerCount players={view.players} />
        <Countdown deadline={finished ? null : deadline} onExpire={refresh} />
      </div>

      {finished && view.winner && (
        <WinnerBanner
          text={view.winner === 'detectives' ? '侦探们获胜！真凶被绳之以法！' : '凶手获胜！成功逃过了指认！'}
          tone={view.winner === 'detectives' ? 'good' : 'bad'}
        />
      )}

      <div className="case-brief">
        <h4>案情</h4>
        <p>{view.crimeScene}</p>
        <p>
          受害者：<b>{view.victim}</b> · 凶器：
          <b>{view.murderWeapon ?? '未知'}</b>
        </p>
      </div>

      {view.myCharacter && (
        <div className="role-card character">
          <small>我的角色</small>
          <b>
            {view.myCharacter.name} · {view.myCharacter.role}
          </b>
          <p>{view.myCharacter.backstory}</p>
          <p className="secret">
            <Sparkles size={12} /> 秘密：{view.myCharacter.secret}
          </p>
          <p className="objective">目标：{view.myCharacter.objective}</p>
          <p className="alibi">不在场证明：{view.myCharacter.alibi}</p>
        </div>
      )}

      {/* 自我介绍 / 讨论 */}
      {(view.phase === 'introduction' || view.phase === 'discussion') && (
        <div className="action-panel">
          <h4>{view.phase === 'introduction' ? '请以角色身份做自我介绍' : '圆桌讨论'}</h4>
          {canAct && !iHaveSpoken && (
            <SpeechInput
              placeholder="以角色口吻发言……"
              disabled={!canAct}
              onSpeak={(content) => void act('speak', { content })}
              onSkip={() => void act('speak_skip')}
              skipLabel="沉默不语"
            />
          )}
          {canAct && iHaveSpoken && <p className="hint">你已发言，等待其他人……</p>}
        </div>
      )}

      {/* 搜证 */}
      {view.phase === 'investigation' && (
        <div className="action-panel">
          <h4>
            <Fingerprint size={15} /> 搜证阶段
          </h4>
          {canAct && !iHaveSearched ? (
            <button className="action-btn primary" onClick={() => void act('search')}>
              <Search size={14} /> 搜查现场（发现一条随机线索）
            </button>
          ) : (
            <p className="hint">{canAct ? '你已搜证，等待其他人……' : '观战中……'}</p>
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
            <p className="hint">{canAct ? '等待其他玩家投票……' : '等待指认结果……'}</p>
          )}
        </div>
      )}

      {/* 线索 */}
      {(view.discoveredClues ?? []).length > 0 && (
        <div className="clues-section">
          <h4>
            已发现线索（{view.discoveredClues?.length ?? 0}/{view.totalClueCount ?? '?'}）
          </h4>
          <div className="clue-cards">
            {(view.discoveredClues ?? []).map((clue) => (
              <div key={clue.id} className={`clue-card ${clue.isKey ? 'key' : ''}`}>
                <div className="clue-header">
                  <span className="clue-name">{clue.name}</span>
                  {clue.isKey && <span className="clue-key-badge">关键</span>}
                </div>
                <p className="clue-desc">{clue.description}</p>
                <p className="clue-reveals">{clue.revealsInfo}</p>
                <small className="clue-location">📍 {clue.location}</small>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 讨论记录 */}
      {(view.discussionLog ?? []).length > 0 && (
        <div className="game-section">
          <h4>发言记录</h4>
          <div className="day-messages">
            {(view.discussionLog ?? []).map((entry, index) => (
              <div key={index} className="day-message">
                <b>
                  {entry.playerName}（{entry.characterName}）：
                </b>
                <span>{entry.content}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="game-section">
        <h4>玩家</h4>
        <PlayerChips players={view.players} voteStatus={view.phase === 'voting' ? view.voteStatus : undefined} />
      </div>

      <Timeline events={view.events ?? []} />
    </div>
  );
}
