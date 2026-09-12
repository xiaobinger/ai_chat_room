import { Bot, Sparkles, Volume2, VolumeX } from 'lucide-react';
import {
  Countdown,
  HostSummaryCard,
  InfoBlock,
  PhaseBadge,
  PhaseSpotlight,
  PlayerChips,
  PlayerCount,
  ResultRevealCard,
  SpeechInput,
  StageVeil,
  Timeline,
  TypingIndicator,
  VoteGrid,
  WinnerBanner,
  type ActFn,
  type GameViewState,
} from './game-parts';
import type { VoiceContext } from '../../../ai-worker/src/game/speech-generator';
import { useGameTts } from '../hooks/useGameTts';

interface UndercoverViewState extends GameViewState {
  myWord?: string;
  myPersona?: string;
  descriptions?: { playerId: string; nickname: string; round: number; content: string }[];
  currentSpeakerId?: string | null;
  publicNotes?: { round: number; content: string }[];
  voteStatus?: Record<string, 'voted' | 'abstained'>;
  typingPlayerId?: string | null;
  civilianWord?: string;
  undercoverWord?: string;
}

const ROLE_DESCRIPTIONS: Record<string, string> = {
  civilian: '你和大多数人拿到同一个词。描述要让人懂但别直接说出词。',
  undercover: '你的词和其他人不同。描述得模糊一点，别露馅！',
};

const PERSONA_DESCRIPTIONS: Record<string, string> = {
  谨慎试探型: '先给模糊线索，边听边修正，不轻易把话说满。',
  联想发散型: '更喜欢从画面、情绪和场景切入，描述更有氛围感。',
  稳健跟随型: '会顺着多数人的方向补充，尽量避免第一个暴露自己。',
  大胆误导型: '敢主动换角度带节奏，试着把大家往错误方向引。',
};

const UNDERCOVER_PHASE_CONTEXT: Record<string, VoiceContext> = {
  describing: 'contemplative',
  voting: 'suspenseful',
  result: 'climactic',
};

const UNDERCOVER_PHASE_COPY: Record<string, { title: string; subtitle: string; tone: 'neutral' | 'warn' | 'danger' }> = {
  describing: { title: '轮流试探', subtitle: '描述越自然越安全，越刻意越容易露出破绽。', tone: 'neutral' },
  voting: { title: '票型收口', subtitle: '现在要找的是最不合群、最像没跟上多数节奏的人。', tone: 'warn' },
  result: { title: '词底翻开', subtitle: '真正的词和身份即将揭晓，胜负只在这一刻。', tone: 'danger' },
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
  const recentPublicNotes = (view.publicNotes ?? []).slice(-3).reverse();
  const hostSummary = recentPublicNotes[0];
  const focusPlayers = view.players
    .filter((player) => recentPublicNotes.some((note) => note.content.includes(player.nickname)))
    .slice(0, 3);
  const highlightedNames = focusPlayers.map((player) => `${player.seatNumber ? `${player.seatNumber}号` : ''}${player.nickname}`);
  const focusTerms = focusPlayers.map((player) => player.nickname);
  const undercoverSpeechLog = (view.descriptions ?? []).map((d) => ({
    playerId: d.playerId,
    content: d.content,
  }));
  const tts = useGameTts({
    view,
    myPlayerId,
    speechLog: undercoverSpeechLog,
    phaseContextMap: UNDERCOVER_PHASE_CONTEXT,
  });

  return (
    <div className="game-view undercover">
      <StageVeil
        stageKey={`${view.round}-${view.phase}`}
        title={UNDERCOVER_PHASE_COPY[view.phase]?.title ?? '局势推进'}
        subtitle={UNDERCOVER_PHASE_COPY[view.phase]?.subtitle}
        tone={UNDERCOVER_PHASE_COPY[view.phase]?.tone ?? 'neutral'}
      />
      <div className="game-toolbar">
        <PhaseBadge phase={view.phase} round={view.round} />
        <PlayerCount players={view.players} />
        <Countdown deadline={finished ? null : deadline} onExpire={refresh} />
      </div>
      {myPlayerId && !finished && (() => {
        const hostedPlayers = (view.hostedPlayers as string[]) ?? [];
        const isHosted = hostedPlayers.includes(myPlayerId);
        return (
          <button
            className={`ai-host-btn ${isHosted ? 'active' : ''}`}
            onClick={() => void act(isHosted ? 'unhost_ai' : 'host_ai')}
            title={isHosted ? '点击取消 AI 托管' : '点击让 AI 代替你发言和行动'}
          >
            <Bot size={14} />
            {isHosted ? 'AI 托管中' : 'AI 托管'}
          </button>
        );
      })()}

      <PhaseSpotlight
        phaseKey={`${view.round}-${view.phase}`}
        title={UNDERCOVER_PHASE_COPY[view.phase]?.title ?? '局势推进'}
        subtitle={UNDERCOVER_PHASE_COPY[view.phase]?.subtitle ?? '越接近真相，描述和票型的微妙差别越重要。'}
        tone={UNDERCOVER_PHASE_COPY[view.phase]?.tone ?? 'neutral'}
      />

      {finished && view.winner && (
        <WinnerBanner
          text={view.winner === 'civilians' ? '平民胜利！卧底全部出局！' : '卧底胜利！成功潜伏到最后！'}
          tone={view.winner === 'civilians' ? 'good' : 'bad'}
        />
      )}

      {finished && view.civilianWord && (
        <div className="word-reveal">
          <ResultRevealCard eyebrow="平民词" title={view.civilianWord} tone="good" />
          <ResultRevealCard eyebrow="卧底词" title={view.undercoverWord ?? '未知'} tone="bad" delayMs={220} />
        </div>
      )}

      {view.myWord && !finished && (
        <div className="role-card word">
          <small>你拿到的词（只有你自己可见）</small>
          <b className="my-word">{view.myWord}</b>
          {myRole && <p>{ROLE_DESCRIPTIONS[myRole]}</p>}
        </div>
      )}

      {view.myPersona && !finished && (
        <InfoBlock>
          <Sparkles size={14} />
          <div>
            <b>我的描述风格：{view.myPersona}</b>
            <p>{PERSONA_DESCRIPTIONS[view.myPersona] ?? '这会影响你的描述节奏和带偏方式。'}</p>
          </div>
        </InfoBlock>
      )}

      {hostSummary && (
        <HostSummaryCard
          title="本轮主持观察"
          label={`第 ${hostSummary.round} 轮`}
          summary={hostSummary.content}
          highlights={highlightedNames}
          tone={view.phase === 'voting' ? 'warn' : 'neutral'}
        />
      )}

      {(view.publicNotes ?? []).length > 0 && (
        <div className="game-section">
          <h4>场上观察</h4>
          <div className="day-messages">
            {recentPublicNotes.map((note, index) => (
              <div key={`${note.round}-${index}`} className={`day-message ${index === 0 ? 'focus' : ''}`}>
                <b>第 {note.round} 轮：</b>
                <span>{note.content}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 描述阶段 */}
      {view.phase === 'describing' && !finished && (
        <div className="action-panel">
          <h4>轮流描述你的词</h4>
          <p className="hint">每轮尽量换个角度描述，比如场景、感觉、用途、外观，别一直重复上一轮的话。</p>
          {view.currentSpeakerId && (
            <p className="turn-hint">
              当前发言：
              <b>
                {(() => {
                  const current = view.players.find((p) => p.playerId === view.currentSpeakerId);
                  return `${current?.seatNumber ? `${current.seatNumber}号 ` : ''}${current?.nickname ?? ''}`;
                })()}
              </b>
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
          <p className="hint">优先找描述最别扭、最难和大多数人对上的那个人，不要只凭直觉乱投。</p>
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
          <div className="tts-toolbar">
            <h4>
              <Sparkles size={14} /> 本轮描述
            </h4>
            <button className="tts-autoplay-btn" onClick={tts.toggleAutoPlay} title={tts.autoPlay ? '关闭自动朗读' : '开启自动朗读'}>
              {tts.autoPlay ? <Volume2 size={14} /> : <VolumeX size={14} />}
              {tts.autoPlay ? '自动朗读开' : '自动朗读关'}
            </button>
          </div>
          <div className="day-messages">
            {(view.descriptions ?? []).map((d, index) => (
              <div key={index} className={`day-message ${d.playerId === myPlayerId ? 'mine' : ''}`}>
                <b>{d.nickname}：</b>
                <span>{d.content}</span>
                <button
                  className="tts-play-btn"
                  onClick={(e) => tts.playTts(d.content, tts.getCharacterInfo(d.playerId), e)}
                  title="朗读"
                >
                  <Volume2 size={12} />
                </button>
              </div>
            ))}
            {view.phase === 'describing' && (
              <TypingIndicator players={view.players} typingPlayerId={view.typingPlayerId} />
            )}
          </div>
        </div>
      )}

      <div className="game-section">
        <h4>玩家</h4>
        <PlayerChips
          players={view.players}
          currentSpeakerId={view.phase === 'describing' ? view.currentSpeakerId : undefined}
          voteStatus={view.phase === 'voting' ? view.voteStatus : undefined}
          focusedPlayerIds={focusPlayers.map((player) => player.playerId)}
          showRoles={finished}
        />
      </div>

      <Timeline events={view.events ?? []} focusTerms={focusTerms} />
    </div>
  );
}
