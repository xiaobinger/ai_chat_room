import { Eye, Lightbulb, MessageCircle, Search } from 'lucide-react';
import {
  Countdown,
  HostSummaryCard,
  InfoBlock,
  PhaseBadge,
  PhaseSpotlight,
  PlayerChips,
  PlayerCount,
  RoleCard,
  SpeechInput,
  StageVeil,
  Timeline,
  TypingIndicator,
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

const PERSONA_DESCRIPTIONS: Record<string, string> = {
  冷静观察型: '先听再判断，擅长从矛盾点里慢慢缩小目标。',
  强势带队型: '喜欢主动立焦点、带讨论节奏，也更容易形成票型。',
  圆滑周旋型: '会留余地、顺势补刀，发言更像在试探全场反应。',
  直觉冲票型: '更看重第一感觉和现场气氛，容易快速点名施压。',
};

const THIEF_PHASE_COPY: Record<string, { title: string; subtitle: string; tone: 'neutral' | 'warn' | 'danger' }> = {
  investigation: { title: '搜证与试探', subtitle: '每个人都在用发言试着定义谁更像真正的小偷。', tone: 'neutral' },
  voting: { title: '锁定嫌犯', subtitle: '票型开始决定生死，带偏节奏的人也会一起暴露。', tone: 'warn' },
  result: { title: '身份揭晓', subtitle: '真假阵营全部翻开，案件终于有了答案。', tone: 'danger' },
};

interface ThiefViewState extends GameViewState {
  stolenItem?: string;
  crimeScene?: string;
  revealedClues?: string[];
  speechLog?: { round: number; playerId: string; nickname: string; content: string }[];
  myNotes?: string[];
  myPersona?: string;
  publicNotes?: { round: number; content: string }[];
  voteStatus?: Record<string, 'voted' | 'abstained'>;
  typingPlayerId?: string | null;
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
  const recentPublicNotes = (view.publicNotes ?? []).slice(-3).reverse();
  const hostSummary = recentPublicNotes[0];
  const focusPlayers = view.players
    .filter((player) => recentPublicNotes.some((note) => note.content.includes(player.nickname)))
    .slice(0, 3);
  const highlightedNames = focusPlayers.map((player) => `${player.seatNumber ? `${player.seatNumber}号` : ''}${player.nickname}`);
  const focusTerms = focusPlayers.map((player) => player.nickname);

  return (
    <div className="game-view thief">
      <StageVeil
        stageKey={`${view.round}-${view.phase}`}
        title={THIEF_PHASE_COPY[view.phase]?.title ?? '局势推进'}
        subtitle={THIEF_PHASE_COPY[view.phase]?.subtitle}
        tone={THIEF_PHASE_COPY[view.phase]?.tone ?? 'neutral'}
      />
      <div className="game-toolbar">
        <PhaseBadge phase={view.phase} round={view.round} />
        <PlayerCount players={view.players} />
        <Countdown deadline={finished ? null : deadline} onExpire={refresh} />
      </div>

      <PhaseSpotlight
        phaseKey={`${view.round}-${view.phase}`}
        title={THIEF_PHASE_COPY[view.phase]?.title ?? '局势推进'}
        subtitle={THIEF_PHASE_COPY[view.phase]?.subtitle ?? '注意听谁在立焦点，谁又在悄悄顺势。'}
        tone={THIEF_PHASE_COPY[view.phase]?.tone ?? 'neutral'}
      />

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

      {view.myPersona && !finished && (
        <InfoBlock>
          <Eye size={14} />
          <div>
            <b>我的发言风格：{view.myPersona}</b>
            <p>{PERSONA_DESCRIPTIONS[view.myPersona] ?? '这会影响你更自然的发言和带票方式。'}</p>
          </div>
        </InfoBlock>
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

      {hostSummary && (
        <HostSummaryCard
          title="本轮主持焦点"
          label={`第 ${hostSummary.round} 轮`}
          summary={hostSummary.content}
          highlights={highlightedNames}
          tone={view.phase === 'voting' ? 'warn' : 'neutral'}
        />
      )}

      {(view.publicNotes ?? []).length > 0 && (
        <div className="game-section">
          <h4>场上共识</h4>
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

      {/* 调查讨论 */}
      {view.phase === 'investigation' && (
        <div className="action-panel">
          <h4>
            <MessageCircle size={15} /> 调查讨论
          </h4>
          <p className="hint">先结合公开线索和别人的发言找焦点人物，再决定要不要带票。</p>
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
          <p className="hint">现在不是随便猜一个人的时候，优先处理最可疑、最像在带偏节奏的人。</p>
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
            <TypingIndicator players={view.players} typingPlayerId={view.typingPlayerId} />
          </div>
        </div>
      )}

      <div className="game-section">
        <h4>玩家</h4>
        <PlayerChips
          players={view.players}
          voteStatus={view.phase === 'voting' ? view.voteStatus : undefined}
          focusedPlayerIds={focusPlayers.map((player) => player.playerId)}
          showRoles={finished}
        />
      </div>

      <Timeline events={view.events ?? []} focusTerms={focusTerms} />
    </div>
  );
}
