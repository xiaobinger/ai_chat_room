import { useEffect, useRef, useState } from 'react';
import { BookOpen, Fingerprint, Link2, Music, Music2, Search, Sparkles, Volume2, VolumeX } from 'lucide-react';
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
  TypingIndicator,
  VoteGrid,
  WinnerBanner,
  type ActFn,
  type GameViewState,
} from './game-parts';
import {
  computeVoiceParams,
  PHASE_CONTEXT,
  type CharacterGender,
  type VoiceContext,
  type VoiceProfile,
} from '../../../ai-worker/src/game/speech-generator';
import { MysteryAudioEngine, PHASE_MOOD, type MoodType } from './mystery-audio';
import { selectVoiceForProfile } from './tts-voice-selector';

/** 情绪标签（中文） */
const MOOD_LABELS: Record<MoodType, string> = {
  mysterious: '神秘',
  tense: '紧张',
  contemplative: '沉思',
  passionate: '激情',
  suspenseful: '悬念',
  climactic: '高潮',
  silent: '静音',
};

interface MysteryCharacter {
  name: string;
  role: string;
  personality: string;
  gender?: CharacterGender;
  backstory: string;
  secret: string;
  objective: string;
  alibi: string;
  relationshipToVictim: string;
  isMurderer: boolean;
  specialAbility?: string;
  suspicionLevel?: number;
}

interface MysteryClue {
  id: string;
  name: string;
  description: string;
  location: string;
  revealsInfo: string;
  isKey: boolean;
  chainStep?: 'means' | 'opportunity' | 'motive' | 'trace';
  isFabricated?: boolean;
  isFabricationExposed?: boolean;
}

interface MysteryMonologue {
  motive: string;
  planning: string;
  execution: string;
  aftermath: string;
  finalWords: string;
  emotion: string;
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
  typingPlayerId?: string | null;
  monologue?: MysteryMonologue;
  conflictLevel?: number;
  conflictEvents?: {
    id: string;
    round: number;
    phase: string;
    participants: { playerId: string; nickname: string; characterName: string }[];
    intensity: number;
    action: string;
    description: string;
    trigger: string;
    timestamp: number;
  }[];
  twists?: {
    id: string;
    round: number;
    kind: 'timeline' | 'fabricated_clue' | 'identity' | 'motive';
    title: string;
    content: string;
    revealedClueId?: string;
    timestamp: number;
  }[];
  timelineDisproved?: boolean;
  accompliceId?: string;
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

const EMOTION_LABELS: Record<string, string> = {
  remorseful: '悔恨',
  defiant: '挑衅',
  calm: '冷静',
  bitter: '怨恨',
  desperate: '绝望',
};

function emotionLabel(emotion: string): string {
  return EMOTION_LABELS[emotion] ?? emotion;
}

/** Web Speech API TTS 辅助——根据角色生理特征 + 语境差异化音色 */
function speakText(
  text: string,
  profile: VoiceProfile | undefined,
  context: VoiceContext | undefined,
  onEnd?: () => void,
): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'zh-CN';

  // 1. 选择对应角色特征的系统音色
  const selectedVoice = selectVoiceForProfile(profile);
  if (selectedVoice) {
    utterance.voice = selectedVoice;
  }

  // 2. 综合生理特征 + 语境计算 pitch/rate/volume
  const { pitch, rate, volume } = computeVoiceParams(profile, context);
  utterance.pitch = pitch;
  utterance.rate = rate;
  utterance.volume = volume;

  if (onEnd) {
    utterance.onend = onEnd;
    utterance.onerror = onEnd;
  }
  window.speechSynthesis.speak(utterance);
}

function stopSpeaking(): void {
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}

const CONFLICT_ACTION_LABELS: Record<string, string> = {
  shout: '怒吼',
  threaten: '威胁',
  shove: '推搡',
  grab: '揪扯',
  fight: '扭打',
};

const TWIST_LABELS: Record<string, { label: string; icon: string }> = {
  timeline: { label: '时间线推翻', icon: '⏱️' },
  fabricated_clue: { label: '伪证揭穿', icon: '🎭' },
  identity: { label: '身份反转', icon: '🔪' },
  motive: { label: '动机反转', icon: '💔' },
};

const CHAIN_STEP_LABELS: Record<string, string> = {
  means: '凶器',
  opportunity: '时机',
  motive: '动机',
  trace: '痕迹',
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

  // 获取当前说话者对应的 TTS 文本
  const [ttsText, setTtsText] = useState<string | null>(null);
  const isSpeaking = ttsText !== null;

  // 自动播放开关
  const [autoPlay, setAutoPlay] = useState(true);
  const autoPlayRef = useRef(autoPlay);
  autoPlayRef.current = autoPlay;

  // 已自动播放过的发言索引追踪
  const autoPlayedRef = useRef<Set<number>>(new Set());

  // ===== 氛围音乐引擎 =====
  const audioEngineRef = useRef<MysteryAudioEngine | null>(null);
  const [musicPlaying, setMusicPlaying] = useState(false);
  const [musicVolume, setMusicVolume] = useState(0.6);
  const [currentMood, setCurrentMood] = useState<MoodType>('mysterious');

  /** 初始化音频引擎（懒加载，首次用户交互时） */
  const ensureAudioEngine = async (): Promise<MysteryAudioEngine | null> => {
    if (!audioEngineRef.current) {
      const engine = new MysteryAudioEngine();
      await engine.init();
      if (!engine.isPlaying && audioEngineRef.current === null) {
        // init 失败
        return null;
      }
      audioEngineRef.current = engine;
    }
    return audioEngineRef.current;
  };

  /** 切换音乐播放/暂停 */
  const toggleMusic = async () => {
    const engine = await ensureAudioEngine();
    if (!engine) return;
    if (musicPlaying) {
      engine.pause();
      setMusicPlaying(false);
    } else {
      const mood = PHASE_MOOD[view.phase] ?? 'mysterious';
      engine.setMood(mood);
      engine.play();
      setMusicPlaying(true);
      setCurrentMood(mood);
    }
  };

  /** 设置音量 */
  const handleVolumeChange = (vol: number) => {
    setMusicVolume(vol);
    audioEngineRef.current?.setVolume(vol);
  };

  /** 阶段变化时自动切换情绪音景 */
  useEffect(() => {
    if (!musicPlaying || !audioEngineRef.current) return;
    const mood = PHASE_MOOD[view.phase] ?? 'mysterious';
    if (mood !== currentMood) {
      audioEngineRef.current.setMood(mood);
      setCurrentMood(mood);
    }
  }, [view.phase, musicPlaying, currentMood]);

  /** 组件卸载时清理音频引擎 */
  useEffect(() => {
    return () => {
      audioEngineRef.current?.dispose();
      audioEngineRef.current = null;
    };
  }, []);

  // 当前游戏阶段的语境
  const currentContext: VoiceContext = PHASE_CONTEXT[view.phase] ?? 'calm';

  // 根据 playerId 查找角色完整信息（性别/年龄/身高/体重/性格）
  const getCharacterInfo = (playerId: string): VoiceProfile => {
    const player = view.players.find((p) => p.playerId === playerId);
    return {
      gender: player?.character?.gender,
      age: player?.character?.age,
      height: player?.character?.height,
      weight: player?.character?.weight,
      personality: player?.character?.personality ?? '',
    };
  };

  // 播放某条发言的 TTS
  const playTts = (text: string, profile: VoiceProfile, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (isSpeaking) {
      stopSpeaking();
      setTtsText(null);
      return;
    }
    setTtsText(text);
    speakText(text, profile, currentContext, () => setTtsText(null));
  };

  // 自动播放新发言（当开关打开时）
  useEffect(() => {
    if (!autoPlay) return;
    const log = view.discussionLog ?? [];
    if (log.length === 0) return;

    const lastEntry = log[log.length - 1];
    const lastIndex = log.length - 1;

    // 只自动播放自己不是发言者的 AI 发言，且未播放过
    if (autoPlayedRef.current.has(lastIndex)) return;
    if (lastEntry.playerId === myPlayerId) return;

    autoPlayedRef.current.add(lastIndex);
    const profile = getCharacterInfo(lastEntry.playerId);
    setTtsText(lastEntry.content);
    speakText(lastEntry.content, profile, currentContext, () => setTtsText(null));
  }, [view.discussionLog, autoPlay, myPlayerId, currentContext]);

  // 切换自动播放时清空已播放记录
  const toggleAutoPlay = () => {
    setAutoPlay((prev) => {
      const next = !prev;
      if (next) {
        autoPlayedRef.current.clear();
      } else {
        stopSpeaking();
        setTtsText(null);
      }
      return next;
    });
  };

  // 离开游戏时停止语音播放
  useEffect(() => () => stopSpeaking(), []);

  const conflictLevel = view.conflictLevel ?? 0;
  const conflictCritical = conflictLevel >= 70;

  return (
    <div className={`game-view mystery${conflictCritical ? ' conflict-critical' : ''}`}>
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
        {/* 氛围音乐控制 */}
        <div className="music-control">
          <button
            className={`music-btn ${musicPlaying ? 'playing' : ''}`}
            onClick={toggleMusic}
            title={musicPlaying ? '点击暂停氛围音乐' : '点击播放氛围音乐'}
          >
            {musicPlaying ? <Music2 size={14} className="music-icon-spin" /> : <Music size={14} />}
            <span className="music-mood-tag">{MOOD_LABELS[currentMood] ?? '氛围'}</span>
          </button>
          {musicPlaying && (
            <div className="music-volume">
              <VolumeX size={10} />
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(musicVolume * 100)}
                onChange={(e) => handleVolumeChange(Number(e.target.value) / 100)}
                className="volume-slider"
              />
              <Volume2 size={12} />
            </div>
          )}
        </div>
        <Countdown deadline={finished ? null : deadline} onExpire={refresh} />
      </div>

      <PhaseSpotlight
        phaseKey={`${view.round}-${view.phase}`}
        title={MYSTERY_PHASE_COPY[view.phase]?.title ?? '案情推进'}
        subtitle={MYSTERY_PHASE_COPY[view.phase]?.subtitle ?? '每次阶段推进都可能让真相更近一步。'}
        tone={MYSTERY_PHASE_COPY[view.phase]?.tone ?? 'neutral'}
      />

      {/* 冲突等级条 */}
      {(conflictLevel > 10 || (view.conflictEvents?.length ?? 0) > 0) && view.phase !== 'reveal' && (
        <div className={`conflict-bar ${conflictCritical ? 'critical' : conflictLevel >= 40 ? 'elevated' : ''}`}>
          <span className="conflict-label">
            <span className="conflict-dot" />
            冲突警戒
          </span>
          <div className="conflict-track">
            <div className="conflict-fill" style={{ width: `${conflictLevel}%` }} />
          </div>
          <span className="conflict-value">{conflictLevel}</span>
          {(view.conflictEvents ?? [])
            .filter((c) => c.phase === view.phase || c.phase === 'discussion')
            .slice(-2)
            .reverse()
            .map((conflict) => (
              <div key={conflict.id} className={`conflict-flash ${conflict.action}`}>
                <b>[{CONFLICT_ACTION_LABELS[conflict.action] ?? '冲突'}]</b> {conflict.description}
              </div>
            ))}
        </div>
      )}

      {/* 剧情反转横幅 */}
      {(view.twists ?? []).length > 0 && view.phase !== 'reveal' && (
        <div className="twist-banner">
          {(view.twists ?? []).slice(-2).reverse().map((twist) => (
            <div key={twist.id} className={`twist-flash twist-${twist.kind}`}>
              <span className="twist-icon">{TWIST_LABELS[twist.kind]?.icon ?? '⚡'}</span>
              <div className="twist-body">
                <b>{TWIST_LABELS[twist.kind]?.label ?? '反转'} · {twist.title}</b>
                <p>{twist.content}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 证据链进度 */}
      {(view.discoveredClues ?? []).some((c) => c.chainStep) && (
        <div className="evidence-chain">
          <span className="chain-label">
            <Link2 size={13} /> 证据链
          </span>
          <div className="chain-steps">
            {(['means', 'opportunity', 'motive', 'trace'] as const).map((step) => {
              const found = (view.discoveredClues ?? []).some(
                (c) => c.chainStep === step
              );
              return (
                <span key={step} className={`chain-dot ${found ? 'found' : ''}`}>
                  <span className="chain-dot-fill" />
                  <small>{CHAIN_STEP_LABELS[step]}</small>
                </span>
              );
            })}
          </div>
          <span className="chain-hint">
            {(view.discoveredClues ?? []).filter((c) => c.chainStep).length}/4 环已闭合
          </span>
        </div>
      )}

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

      {finished && view.monologue && (
        <div className="monologue-reveal" style={{ animationDelay: '0.2s' }}>
          <div className="monologue-header">
            <span className="monologue-eyebrow">真相大白</span>
            <span className={`monologue-emotion ${view.monologue.emotion}`}>{emotionLabel(view.monologue.emotion)}</span>
          </div>
          <div className="monologue-content">
            <div className="monologue-section">
              <span className="monologue-label">🔥 杀人动机</span>
              <p>{view.monologue.motive}</p>
            </div>
            <div className="monologue-section">
              <span className="monologue-label">🎯 精心策划</span>
              <p>{view.monologue.planning}</p>
            </div>
            <div className="monologue-section">
              <span className="monologue-label">🔪 作案经过</span>
              <p>{view.monologue.execution}</p>
            </div>
            <div className="monologue-section">
              <span className="monologue-label">🧹 事后处理</span>
              <p>{view.monologue.aftermath}</p>
            </div>
            <div className="monologue-section monologue-final">
              <span className="monologue-label">💀 最后的话</span>
              <p className="final-words">{view.monologue.finalWords}</p>
            </div>
          </div>
        </div>
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
          {view.myCharacter.specialAbility && (
            <p className="special-ability">特殊能力：{view.myCharacter.specialAbility}</p>
          )}
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
          <div className="section-header">
            <h4>发言记录</h4>
            <button
              className={`autoplay-toggle ${autoPlay ? 'active' : ''}`}
              onClick={toggleAutoPlay}
              title={autoPlay ? '点击关闭自动播放' : '点击开启自动播放'}
            >
              <Volume2 size={13} />
              {autoPlay ? '自动播放中' : '自动播放已关'}
            </button>
          </div>
          <div className="day-messages">
            {(view.discussionLog ?? []).map((entry, index) => {
              const isTtsPlaying = ttsText === entry.content;
              const characterInfo = getCharacterInfo(entry.playerId);
              return (
                <div key={index} className={`day-message ${isTtsPlaying ? 'tts-playing' : ''}`}>
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
                  <button
                    className="tts-btn"
                    onClick={(e) => playTts(entry.content, characterInfo, e)}
                    title={isTtsPlaying ? '停止语音' : `播放语音（${characterInfo.gender === 'male' ? '男声' : characterInfo.gender === 'female' ? '女声' : '默认'}）`}
                  >
                    {isTtsPlaying ? <VolumeX size={13} /> : <Volume2 size={13} />}
                  </button>
                </div>
              );
            })}
            <TypingIndicator players={view.players} typingPlayerId={view.typingPlayerId} />
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
