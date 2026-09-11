import { Crosshair, Eye, FlaskConical, Gavel, Moon, PawPrint, Shield, MessageSquareQuote } from 'lucide-react';
import {
  Countdown,
  PhaseBadge,
  PhaseSpotlight,
  PlayerChips,
  PlayerCount,
  RevealBanner,
  RoleCard,
  SpeechInput,
  StageVeil,
  Timeline,
  VoteGrid,
  WinnerBanner,
  InfoBlock,
  TypingIndicator,
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

const WEREWOLF_PHASE_COPY: Record<string, { title: string; subtitle: string; tone: 'neutral' | 'warn' | 'danger' }> = {
  night: { title: '夜幕降临', subtitle: '隐藏身份开始行动，局势会在黑暗里悄悄改写。', tone: 'danger' },
  day: { title: '白昼发言', subtitle: '公开信息重新洗牌，所有人都在试着定义今天的焦点。', tone: 'neutral' },
  vote: { title: '放逐投票', subtitle: '票型正在收紧，站错边的人会被迅速放大。', tone: 'warn' },
  final_speech: { title: '临终遗言', subtitle: '最后一句话往往最能改变风向。', tone: 'warn' },
  finished: { title: '胜负揭晓', subtitle: '阵营身份全部翻开，准备进入复盘。', tone: 'danger' },
};

interface WerewolfViewState extends GameViewState {
  isJudge?: boolean;
  judgeMode?: 'owner' | 'ai' | null;
  judgePlayerId?: string | null;
  wolfTeammates?: { playerId: string; nickname: string; isAlive: boolean }[];
  seerChecks?: { round: number; targetName: string; isWerewolf: boolean }[];
  witchPotions?: { save: boolean; poison: boolean };
  witchActed?: boolean;
  witchCanAct?: boolean;
  witchCanSave?: boolean;
  witchNightStatus?: 'waiting_wolves' | 'known_victim' | 'self_target' | 'no_save_potion' | 'no_victim';
  nightVictim?: string | null;
  nightVictimSeatNumber?: number | null;
  dayMessages?: { playerId: string; nickname: string; content: string; timestamp: number }[];
  speechStatus?: Record<string, 'spoken' | 'skipped'>;
  voteStatus?: Record<string, 'voted' | 'abstained'>;
  myNightActionDone?: boolean;
  pendingHunterIsMe?: boolean;
  canShoot?: boolean;
  deadTonight?: string[];
  deadToday?: string[];
  finalSpeeches?: Record<string, string>;
  finalSpeechStatus?: Record<string, 'spoken' | 'skipped'>;
  typingPlayerId?: string | null;
  // 法官视角下的完整秘密
  wolfVotes?: Record<string, string>;
  witchTonight?: 'save' | 'poison' | 'pass' | undefined;
  witchPoisonTarget?: string | null;
  nightVictim_full?: string | null;
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
  const isJudge = Boolean(view.isJudge);

  const alivePlayers = view.players.filter((p) => p.isAlive);
  const me = view.players.find((p) => p.playerId === myPlayerId);
  const canAct = alive && !finished && !isJudge;
  const deadTonightNames = (view.deadTonight ?? [])
    .map((id) => view.players.find((player) => player.playerId === id))
    .filter((player): player is GamePlayerView => Boolean(player))
    .map((player) => `${player.seatNumber ? `${player.seatNumber}号` : ''}${player.nickname}`);
  const deadTodayNames = (view.deadToday ?? [])
    .map((id) => view.players.find((player) => player.playerId === id))
    .filter((player): player is GamePlayerView => Boolean(player))
    .map((player) => `${player.seatNumber ? `${player.seatNumber}号` : ''}${player.nickname}`);
  const focusPlayerIds = [...(view.deadTonight ?? []), ...(view.deadToday ?? [])];
  const focusTerms = focusPlayerIds
    .map((id) => view.players.find((player) => player.playerId === id)?.nickname)
    .filter((name): name is string => Boolean(name));

  return (
    <div className="game-view werewolf">
      <StageVeil
        stageKey={`${view.round}-${view.phase}`}
        title={WEREWOLF_PHASE_COPY[view.phase]?.title ?? '阶段推进'}
        subtitle={WEREWOLF_PHASE_COPY[view.phase]?.subtitle}
        tone={WEREWOLF_PHASE_COPY[view.phase]?.tone ?? 'neutral'}
      />
      <div className="game-toolbar">
        <PhaseBadge phase={view.phase} round={view.round} />
        <PlayerCount players={view.players} />
        <Countdown deadline={finished ? null : deadline} onExpire={refresh} />
      </div>

      <PhaseSpotlight
        phaseKey={`${view.round}-${view.phase}`}
        title={WEREWOLF_PHASE_COPY[view.phase]?.title ?? '阶段推进'}
        subtitle={WEREWOLF_PHASE_COPY[view.phase]?.subtitle ?? '局势正在推进，注意观察发言与票型变化。'}
        tone={WEREWOLF_PHASE_COPY[view.phase]?.tone ?? 'neutral'}
      />

      {finished && view.winner && (
        <WinnerBanner
          text={view.winner === 'werewolf' ? '狼人阵营获胜！' : '好人阵营获胜！'}
          tone={view.winner === 'werewolf' ? 'bad' : 'good'}
        />
      )}

      {!finished && view.phase !== 'night' && deadTonightNames.length > 0 && (
        <RevealBanner
          title="昨夜死亡揭示"
          subtitle="天亮之后，所有人都会围绕这些死亡信息重新判断局势。"
          items={deadTonightNames}
          tone="danger"
        />
      )}

      {!finished && (view.phase === 'vote' || view.phase === 'final_speech') && deadTodayNames.length > 0 && (
        <RevealBanner
          title="白天放逐结果"
          subtitle="票型已经给出答案，接下来场上发言会围绕这次出局继续发酵。"
          items={deadTodayNames}
          tone="warn"
        />
      )}

      {/* 法官标识 */}
      {isJudge && !finished && (
        <InfoBlock>
          <Gavel size={14} /> 你是法官（{view.judgeMode === 'owner' ? '房主担任' : 'AI 担任'}）
          <small style={{ marginLeft: 8 }}>你可以看到所有玩家的身份和游戏细节，在发言阶段可发言维持秩序</small>
        </InfoBlock>
      )}

      {/* 法官全量身份表 */}
      {isJudge && !finished && (
        <div className="game-section judge-roles">
          <h4>
            <Eye size={15} /> 全员身份（法官可见）
          </h4>
          <div className="player-chips">
            {view.players.map((p) => (
              <div key={p.playerId} className={`player-chip ${!p.isAlive ? 'dead' : ''}`}>
                <span className="player-avatar">{p.nickname.slice(0, 1)}</span>
                <span className="player-name">
                  {p.seatNumber ? `${p.seatNumber}号 ` : ''}
                  {p.nickname}
                </span>
                {p.role && <span className="chip-tag role">{ROLE_LABELS[p.role] ?? p.role}</span>}
                {!p.isAlive && <span className="chip-tag dead">出局</span>}
              </div>
            ))}
          </div>
          {/* 法官秘密细节 */}
          <div className="judge-secrets">
            {view.nightVictim != null && (
              <p>
                <b>今晚被刀：</b>
                {view.nightVictimSeatNumber ? `${view.nightVictimSeatNumber}号` : '（暂无）'}
                {view.nightVictim ? ` · ${view.nightVictim}` : ''}
              </p>
            )}
            {view.witchPotions && (
              <p>
                <b>女巫药剂：</b>
                解药 {view.witchPotions.save ? '✓' : '✗'} · 毒药 {view.witchPotions.poison ? '✓' : '✗'}
                {view.witchTonight ? ` · 今晚${view.witchTonight === 'save' ? '使用了解药' : view.witchTonight === 'poison' ? '使用了毒药' : '未用药'}` : ''}
              </p>
            )}
            {view.seerChecks && view.seerChecks.length > 0 && (
              <p>
                <b>预言家查验记录：</b>
                {view.seerChecks.map((c, i) => (
                  <span key={i}>
                    {i > 0 && '；'}第{c.round}轮 {c.targetName} = {c.isWerewolf ? '狼人' : '好人'}
                  </span>
                ))}
              </p>
            )}
          </div>
        </div>
      )}

      {myRoleLabel && !finished && !isJudge && (
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
                      {p.seatNumber ? `${p.seatNumber}号 ` : ''}
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
                      {p.seatNumber ? `${p.seatNumber}号 ` : ''}
                      {p.nickname}
                    </button>
                  ))}
              </div>
            </div>
          )}

          {myRole === 'witch' && canAct && !view.witchActed && view.witchCanAct && (
            <div className="witch-panel">
              <p>
                <FlaskConical size={14} />
                {view.witchNightStatus === 'known_victim' && (
                  <>
                    今晚被杀的是：
                    <b>
                      {view.nightVictimSeatNumber ? `${view.nightVictimSeatNumber}号` : ''}
                      {view.nightVictim ? ` ${view.nightVictim}` : ''}
                    </b>
                  </>
                )}
                {view.witchNightStatus === 'self_target' && (
                  <>
                    法官今夜没有报号。
                    <b>这通常表示你自己就是被杀目标。</b>
                  </>
                )}
                {view.witchNightStatus === 'no_save_potion' && (
                  <>
                    解药已用完。
                    <b>本夜你不会获知被杀玩家。</b>
                  </>
                )}
                {view.witchNightStatus === 'no_victim' && (
                  <>
                    今夜暂未出现被杀信息。
                    <b>你仍可决定是否使用毒药。</b>
                  </>
                )}
              </p>
              <div className="witch-potions">
                <button
                  className="action-btn primary"
                  disabled={!view.witchCanSave}
                  onClick={() => void act('witch_save')}
                >
                  <Shield size={14} /> {view.witchNightStatus === 'self_target' ? '使用解药自救' : '使用解药救人'}
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
                          {p.seatNumber ? `${p.seatNumber}号 ` : ''}
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

          {myRole === 'witch' && canAct && !view.witchActed && !view.witchCanAct && (
            <p className="hint">等待狼人行动结束后，法官再向你通报夜晚信息……</p>
          )}
          {(myRole === 'villager' || myRole === 'hunter' || view.myNightActionDone || view.witchActed) && !isJudge && (
            <p className="hint">夜深了，等待其他玩家行动……</p>
          )}
          {isJudge && <p className="hint">法官观战中，等待夜晚行动结束……</p>}
          {me && !me.isAlive && !isJudge && <p className="hint">你已出局，以上帝视角观战。</p>}
          {!myPlayerId && !isJudge && <p className="hint">观战中……</p>}
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
                  {p.seatNumber ? `${p.seatNumber}号 ` : ''}
                  {p.nickname}
                </button>
              ))}
          </div>
          <button className="action-btn ghost" onClick={() => void act('hunter_shoot')}>
            收起枪，不开火
          </button>
        </div>
      )}

      {/* 临终遗言阶段 */}
      {view.phase === 'final_speech' && !finished && (
        <div className="action-panel final-speech">
          <h4>
            <MessageSquareQuote size={15} /> 临终遗言
          </h4>
          <p className="hint">出局的玩家可以发表临终遗言，增加游戏趣味。</p>

          {/* 法官发言 */}
          {isJudge && (
            <SpeechInput
              placeholder="法官发言：维持游戏秩序、提醒规则（Enter 发送）"
              disabled={false}
              onSpeak={(content) => void act('judge_speak', { content })}
            />
          )}

          {/* 死亡玩家的遗言输入 */}
          {(() => {
            const deadThisRound = [...(view.deadTonight ?? []), ...(view.deadToday ?? [])];
            const myDeath = deadThisRound.find((id) => id === myPlayerId);
            if (myDeath && !view.finalSpeechStatus?.[myPlayerId ?? '']) {
              return (
                <SpeechInput
                  placeholder="发表你的临终遗言（Enter 发送）"
                  disabled={false}
                  onSpeak={(content) => void act('final_speech', { content })}
                  onSkip={() => void act('final_speech_skip')}
                  skipLabel="放弃遗言"
                />
              );
            }
            return null;
          })()}

          {/* 已发表的遗言 */}
          {view.finalSpeeches && Object.entries(view.finalSpeeches).length > 0 && (
            <div className="day-messages">
              {Object.entries(view.finalSpeeches).map(([pid, content]) => {
                const player = view.players.find((p) => p.playerId === pid);
                return (
                  <div key={pid} className="day-message final-speech-item">
                    <b>{player?.nickname ?? pid}（遗言）：</b>
                    <span>{content}</span>
                  </div>
                );
              })}
            </div>
          )}

          {(!view.finalSpeeches || Object.keys(view.finalSpeeches).length === 0) && (
            <p className="hint">等待出局玩家发表遗言……</p>
          )}
        </div>
      )}

      {/* 白天发言 */}
      {view.phase === 'day' && !finished && (
        <div className="action-panel day">
          <h4>白天 · 自由发言</h4>
          {isJudge && (
            <SpeechInput
              placeholder="法官发言：维持游戏秩序（Enter 发送）"
              disabled={false}
              onSpeak={(content) => void act('judge_speak', { content })}
            />
          )}
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
            <TypingIndicator players={view.players} typingPlayerId={view.typingPlayerId} />
            {(!view.dayMessages || view.dayMessages.length === 0) && !view.typingPlayerId && <p className="hint">还没有人发言。</p>}
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
          focusedPlayerIds={focusPlayerIds}
          showRoles={finished || isJudge}
        />
      </div>

      <Timeline events={view.events ?? []} focusTerms={focusTerms} />
    </div>
  );
}

export type { GamePlayerView };
