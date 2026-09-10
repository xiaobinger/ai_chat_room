import { BookOpen, Fingerprint, Search, Sparkles } from 'lucide-react';
import {
  Countdown,
  HostSummaryCard,
  InfoBlock,
  PhaseSpotlight,
  PlayerChips,
  PlayerCount,
  SpeechInput,
  StageVeil,
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
  scenarioTitle?: string;
  victim?: string;
  crimeScene?: string;
  murderWeapon?: string;
  myCharacter?: MysteryCharacter;
  publicNotes?: { round: number; content: string }[];
  discoveredClues?: MysteryClue[];
  totalClueCount?: number;
  discussionLog?: { playerId: string; playerName: string; characterName: string; content: string; type: string }[];
  voteStatus?: Record<string, 'voted' | 'abstained'>;
}

const MYSTERY_PHASE_LABELS: Record<string, string> = {
  introduction: '自我介绍',
  investigation: '搜证',
  discussion: '圆桌讨论',
  accusation: '公开指控',
  voting: '最终指认',
  reveal: '真相揭晓',
};

const DISCUSSION_TYPE_LABELS: Record<string, string> = {
  statement: '陈述',
  question: '追问',
  accusation: '指控',
  defense: '辩解',
};

const MYSTERY_PHASE_COPY: Record<string, { title: string; subtitle: string; tone: 'neutral' | 'warn' | 'danger' }> = {
  introduction: { title: '角色入场', subtitle: '每个人都在用第一句话塑造自己的可信度。', tone: 'neutral' },
  investigation: { title: '现场搜证', subtitle: '证据正在浮出水面，谁被线索反复提到就越危险。', tone: 'neutral' },
  discussion: { title: '圆桌对峙', subtitle: '动机、证词与情绪开始互相冲撞，真正的裂缝会在这里出现。', tone: 'warn' },
  accusation: { title: '公开指控', subtitle: '所有怀疑正在收束成最终指向，误判也会被无限放大。', tone: 'danger' },
  voting: { title: '最终指认', subtitle: '真凶只差最后一票，局势已没有多少回旋空间。', tone: 'danger' },
  reveal: { title: '真相揭晓', subtitle: '所有秘密与谎言都会在这一刻被掀开。', tone: 'danger' },
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
  const keyClueCount = (view.discoveredClues ?? []).filter((clue) => clue.isKey).length;
  const remainingClues = Math.max((view.totalClueCount ?? 0) - (view.discoveredClues?.length ?? 0), 0);
  const suspectBoard = [...view.players]
    .filter((player) => player.isAlive && typeof player.suspicionLevel === 'number')
    .sort((a, b) => (b.suspicionLevel ?? 0) - (a.suspicionLevel ?? 0))
    .slice(0, 3);
  const recentPublicNotes = (view.publicNotes ?? []).slice(-3).reverse();
  const hostSummary = recentPublicNotes[0];
  const highlightedSuspects = suspectBoard.map((player) => `${player.seatNumber ? `${player.seatNumber}号` : ''}${player.nickname}`);
  const focusTerms = suspectBoard.flatMap((player) => [player.nickname, player.character?.name ?? '']).filter(Boolean);

  return (
    <div className="game-view mystery">
      <StageVeil
        stageKey={`${view.round}-${view.phase}`}
        title={MYSTERY_PHASE_COPY[view.phase]?.title ?? '案情推进'}
        subtitle={MYSTERY_PHASE_COPY[view.phase]?.subtitle}
        tone={MYSTERY_PHASE_COPY[view.phase]?.tone ?? 'neutral'}
      />
      <div className="game-toolbar">
        <span className="phase-badge day">
          <BookOpen size={15} />
          {MYSTERY_PHASE_LABELS[view.phase] ?? view.phase}
          <small>第 {view.round} 轮</small>
        </span>
        <PlayerCount players={view.players} />
        <Countdown deadline={finished ? null : deadline} onExpire={refresh} />
      </div>

      <PhaseSpotlight
        phaseKey={`${view.round}-${view.phase}`}
        title={MYSTERY_PHASE_COPY[view.phase]?.title ?? '案情推进'}
        subtitle={MYSTERY_PHASE_COPY[view.phase]?.subtitle ?? '每次阶段推进都可能让真相更近一步。'}
        tone={MYSTERY_PHASE_COPY[view.phase]?.tone ?? 'neutral'}
      />

      <div className="case-dossier">
        <div>
          <small>案件档案</small>
          <h3>{view.scenarioTitle ?? '未命名案件'}</h3>
          <p>{view.crimeScene}</p>
        </div>
        <div className="case-stats">
          <div className="case-stat">
            <span>已发现线索</span>
            <b>{view.discoveredClues?.length ?? 0}</b>
          </div>
          <div className="case-stat">
            <span>剩余线索</span>
            <b>{remainingClues}</b>
          </div>
          <div className="case-stat">
            <span>关键线索</span>
            <b>{keyClueCount}</b>
          </div>
        </div>
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

      {view.myCharacter?.personality && !finished && (
        <InfoBlock>
          <Sparkles size={14} />
          <div>
            <b>角色气质：{view.myCharacter.personality}</b>
            <p>发言时尽量贴合这个性格去表达，会更像真人在场推理。</p>
          </div>
        </InfoBlock>
      )}

      {hostSummary && (
        <HostSummaryCard
          title="案件焦点播报"
          label={`第 ${hostSummary.round} 轮`}
          summary={hostSummary.content}
          highlights={highlightedSuspects}
          tone={view.phase === 'accusation' || view.phase === 'voting' ? 'danger' : 'warn'}
        />
      )}

      {(view.publicNotes ?? []).length > 0 && (
        <div className="game-section">
          <h4>案件焦点</h4>
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

      {suspectBoard.length > 0 && !finished && (
        <div className="game-section">
          <h4>当前嫌疑榜</h4>
          <div className="suspect-board">
            {suspectBoard.map((player) => (
              <div key={player.playerId} className="suspect-item">
                <b>
                  {player.seatNumber ? `${player.seatNumber}号 ` : ''}
                  {player.nickname}
                </b>
                <span>{player.character?.name ?? '未知身份'}</span>
                <small>嫌疑值 {player.suspicionLevel ?? 0}</small>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 自我介绍 / 讨论 */}
      {(view.phase === 'introduction' || view.phase === 'discussion' || view.phase === 'accusation') && (
        <div className="action-panel">
          <h4>
            {view.phase === 'introduction'
              ? '请以角色身份做自我介绍'
              : view.phase === 'accusation'
                ? '公开指控：请给出你最终怀疑的对象和理由'
                : '圆桌讨论'}
          </h4>
          {canAct && !iHaveSpoken && (
            <SpeechInput
              placeholder={view.phase === 'accusation' ? '说出你最终怀疑的对象和理由……' : '以角色口吻发言……'}
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
                  {view.players.find((p) => p.playerId === entry.playerId)?.seatNumber
                    ? `${view.players.find((p) => p.playerId === entry.playerId)?.seatNumber}号 `
                    : ''}
                  {entry.playerName}（{entry.characterName}）：
                </b>
                <span className={`chip-tag ${entry.type === 'accusation' ? 'danger' : entry.type === 'defense' ? 'active' : 'muted'}`}>
                  {DISCUSSION_TYPE_LABELS[entry.type] ?? '发言'}
                </span>
                <span>{entry.content}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="game-section">
        <h4>玩家</h4>
        <PlayerChips
          players={view.players}
          voteStatus={view.phase === 'voting' ? view.voteStatus : undefined}
          focusedPlayerIds={suspectBoard.map((player) => player.playerId)}
        />
      </div>

      <Timeline events={view.events ?? []} focusTerms={focusTerms} />
    </div>
  );
}
