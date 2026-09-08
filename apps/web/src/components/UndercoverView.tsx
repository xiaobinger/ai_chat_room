import { Sparkles } from 'lucide-react';
import {
  Countdown,
  PhaseBadge,
  PlayerChips,
  PlayerCount,
  SpeechInput,
  Timeline,
  VoteGrid,
  WinnerBanner,
  type ActFn,
  type GameViewState,
} from './game-parts';

interface UndercoverViewState extends GameViewState {
  myWord?: string;
  descriptions?: { playerId: string; nickname: string; round: number; content: string }[];
  currentSpeakerId?: string | null;
  voteStatus?: Record<string, 'voted' | 'abstained'>;
  civilianWord?: string;
  undercoverWord?: string;
}

const ROLE_DESCRIPTIONS: Record<string, string> = {
  civilian: '你和大多数人拿到同一个词。描述要让人懂但别直接说出词。',
  undercover: '你的词和其他人不同。描述得模糊一点，别露馅！',
};

export function UndercoverView({
  view,
  myPlayerId,
  alive,
  deadline,
  act,
  refresh,
}: {
  view: UndercoverViewState;
  myPlayerId: string | null;
  alive: boolean;
  deadline: number | null;
  act: ActFn;
  refresh: () => void;
}) {
  const finished = view.phase === 'result';
  const myRole = view.myRole;
  const isMyTurn = view.currentSpeakerId === myPlayerId && view.phase === 'describing';
  const canAct = alive && !finished;
  const me = view.players.find((p) => p.playerId === myPlayerId);

  return (
    <div className="game-view undercover">
      <div className="game-toolbar">
        <PhaseBadge phase={view.phase} round={view.round} />
        <PlayerCount players={view.players} />
        <Countdown deadline={finished ? null : deadline} onExpire={refresh} />
      </div>

      {finished && view.winner && (
        <WinnerBanner
          text={view.winner === 'civilians' ? '平民胜利！卧底全部出局！' : '卧底胜利！成功潜伏到最后！'}
          tone={view.winner === 'civilians' ? 'good' : 'bad'}
        />
      )}

      {finished && view.civilianWord && (
        <div className="word-reveal">
          <div className="word-card civilian">
            <small>平民词</small>
            <b>{view.civilianWord}</b>
          </div>
          <div className="word-card undercover">
            <small>卧底词</small>
            <b>{view.undercoverWord}</b>
          </div>
        </div>
      )}

      {view.myWord && !finished && (
        <div className="role-card word">
          <small>你拿到的词（只有你自己可见）</small>
          <b className="my-word">{view.myWord}</b>
          {myRole && <p>{ROLE_DESCRIPTIONS[myRole]}</p>}
        </div>
      )}

      {/* 描述阶段 */}
      {view.phase === 'describing' && !finished && (
        <div className="action-panel">
          <h4>轮流描述你的词</h4>
          {view.currentSpeakerId && (
            <p className="turn-hint">
              当前发言：
              <b>{view.players.find((p) => p.playerId === view.currentSpeakerId)?.nickname}</b>
              {isMyTurn && <span className="chip-tag active">轮到你了！</span>}
            </p>
          )}
          {isMyTurn && canAct && (
            <SpeechInput
              placeholder="用一句话描述你的词（不能包含这个词本身）"
              disabled={!canAct}
              onSpeak={(content) => void act('describe', { content })}
              onSkip={() => void act('describe_skip')}
              skipLabel="沉默"
              maxLength={120}
            />
          )}
          {!isMyTurn && canAct && <p className="hint">等待其他玩家描述……</p>}
          {me && !me.isAlive && <p className="hint">你已出局，观战中……</p>}
        </div>
      )}

      {/* 投票 */}
      {view.phase === 'voting' && !finished && (
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
            <p className="hint">{canAct ? '等待其他玩家投票……' : '等待投票结果……'}</p>
          )}
        </div>
      )}

      {/* 描述记录 */}
      {(view.descriptions ?? []).length > 0 && !finished && (
        <div className="game-section">
          <h4>
            <Sparkles size={14} /> 本轮描述
          </h4>
          <div className="day-messages">
            {(view.descriptions ?? []).map((d, index) => (
              <div key={index} className={`day-message ${d.playerId === myPlayerId ? 'mine' : ''}`}>
                <b>{d.nickname}：</b>
                <span>{d.content}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="game-section">
        <h4>玩家</h4>
        <PlayerChips
          players={view.players}
          currentSpeakerId={view.phase === 'describing' ? view.currentSpeakerId : undefined}
          voteStatus={view.phase === 'voting' ? view.voteStatus : undefined}
          showRoles={finished}
        />
      </div>

      <Timeline events={view.events ?? []} />
    </div>
  );
}
