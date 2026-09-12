import { useState, useCallback, useMemo } from 'react';
import { WerewolfScene } from './WerewolfScene';
import type { GameViewState, ActFn } from '../game-parts';
import { Countdown, PhaseBadge, RoleCard, WinnerBanner, Timeline } from '../game-parts';
import {
  Moon,
  Sun,
  Skull,
  Vote as VoteIcon,
  MessageSquareQuote,
  Eye,
  FlaskConical,
  Target,
} from 'lucide-react';

interface Werewolf3DViewProps {
  view: GameViewState;
  act: ActFn;
  onExpire: () => void;
}

type InteractionMode = 'none' | 'wolf_kill' | 'seer_check' | 'witch_save' | 'witch_poison' | 'vote' | 'hunter_shot';

function isNightPhase(phase: string): boolean {
  return phase === 'night';
}

export function Werewolf3DView({ view, act, onExpire }: Werewolf3DViewProps) {
  const { phase, players, myRole, winner, events } = view;
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [interactionMode, setInteractionMode] = useState<InteractionMode>('none');
  const [speechContent, setSpeechContent] = useState('');

  const isNight = isNightPhase(phase);
  const isFinished = phase === 'finished';

  const me = useMemo(() => players.find((p) => p.isMe), [players]);
  const alivePlayers = useMemo(() => players.filter((p) => p.isAlive), [players]);
  const aliveTargets = useMemo(
    () => alivePlayers.filter((p) => !p.isMe),
    [alivePlayers],
  );

  const currentActorId = useMemo(() => {
    if (phase === 'night' && myRole === 'werewolf') {
      const wolf = players.find((p) => p.role === 'werewolf' && p.isAlive && p.isMe);
      if (wolf) return wolf.playerId;
    }
    if (phase === 'night' && myRole === 'seer') {
      const seer = players.find((p) => p.role === 'seer' && p.isAlive && p.isMe);
      if (seer) return seer.playerId;
    }
    if (phase === 'night' && myRole === 'witch') {
      const witch = players.find((p) => p.role === 'witch' && p.isAlive && p.isMe);
      if (witch) return witch.playerId;
    }
    return null;
  }, [phase, myRole, players]);

  const targetableIds = useMemo(() => {
    switch (interactionMode) {
      case 'wolf_kill':
      case 'seer_check':
      case 'witch_poison':
      case 'vote':
      case 'hunter_shot':
        return aliveTargets.map((p) => p.playerId);
      case 'witch_save':
        return me ? [me.playerId] : [];
      default:
        return [];
    }
  }, [interactionMode, aliveTargets, me]);

  const handleSelectTarget = useCallback((playerId: string) => {
    setSelectedTargetId((prev) => (prev === playerId ? null : playerId));
  }, []);

  const handleConfirmAction = useCallback(async () => {
    if (!selectedTargetId) return;
    switch (interactionMode) {
      case 'wolf_kill':
        await act('wolf_kill', { targetId: selectedTargetId });
        break;
      case 'seer_check':
        await act('seer_check', { targetId: selectedTargetId });
        break;
      case 'witch_poison':
        await act('witch_poison', { targetId: selectedTargetId });
        break;
      case 'vote':
        await act('vote', { targetId: selectedTargetId });
        break;
      case 'hunter_shot':
        await act('hunter_shot', { targetId: selectedTargetId });
        break;
    }
    setSelectedTargetId(null);
    setInteractionMode('none');
  }, [interactionMode, selectedTargetId, act]);

  const handleSkipAction = useCallback(async () => {
    if (interactionMode === 'witch_save') {
      await act('witch_save', {});
    } else if (interactionMode === 'witch_poison') {
      await act('witch_poison', {});
    } else {
      await act('skip', {});
    }
    setInteractionMode('none');
  }, [interactionMode, act]);

  const handleSubmitSpeech = useCallback(async () => {
    if (!speechContent.trim()) return;
    await act('speak', { content: speechContent });
    setSpeechContent('');
  }, [speechContent, act]);

  const showAllRoles = isFinished;

  const renderInteractionPanel = () => {
    if (isFinished) return null;

    if (phase === 'day' && me?.isAlive) {
      return (
        <div className="werewolf3d-panel werewolf3d-panel--speech">
          <div className="werewolf3d-panel__header">
            <MessageSquareQuote size={18} />
            <span>白天发言</span>
          </div>
          <textarea
            className="werewolf3d-panel__textarea"
            value={speechContent}
            onChange={(e) => setSpeechContent(e.target.value)}
            placeholder="输入你的发言..."
            rows={3}
          />
          <button
            className="werewolf3d-panel__submit"
            onClick={handleSubmitSpeech}
            disabled={!speechContent.trim()}
          >
            发送发言
          </button>
        </div>
      );
    }

    if (phase === 'night' && currentActorId) {
      if (myRole === 'werewolf' && interactionMode === 'none') {
        return (
          <div className="werewolf3d-panel werewolf3d-panel--action">
            <div className="werewolf3d-panel__header">
              <Target size={18} />
              <span>选择击杀目标</span>
            </div>
            <button
              className="werewolf3d-panel__action-btn"
              onClick={() => setInteractionMode('wolf_kill')}
            >
              选择目标
            </button>
          </div>
        );
      }

      if (myRole === 'seer' && interactionMode === 'none') {
        return (
          <div className="werewolf3d-panel werewolf3d-panel--action">
            <div className="werewolf3d-panel__header">
              <Eye size={18} />
              <span>选择查验目标</span>
            </div>
            <button
              className="werewolf3d-panel__action-btn"
              onClick={() => setInteractionMode('seer_check')}
            >
              选择目标
            </button>
          </div>
        );
      }

      if (myRole === 'witch' && interactionMode === 'none') {
        return (
          <div className="werewolf3d-panel werewolf3d-panel--action">
            <div className="werewolf3d-panel__header">
              <FlaskConical size={18} />
              <span>女巫行动</span>
            </div>
            <div className="werewolf3d-panel__btn-group">
              <button
                className="werewolf3d-panel__action-btn"
                onClick={() => setInteractionMode('witch_save')}
              >
                使用解药
              </button>
              <button
                className="werewolf3d-panel__action-btn"
                onClick={() => setInteractionMode('witch_poison')}
              >
                使用毒药
              </button>
              <button
                className="werewolf3d-panel__action-btn werewolf3d-panel__action-btn--skip"
                onClick={handleSkipAction}
              >
                跳过
              </button>
            </div>
          </div>
        );
      }
    }

    if (phase === 'vote' && me?.isAlive && interactionMode === 'none') {
      return (
        <div className="werewolf3d-panel werewolf3d-panel--action">
          <div className="werewolf3d-panel__header">
            <VoteIcon size={18} />
            <span>投票放逐</span>
          </div>
          <button
            className="werewolf3d-panel__action-btn"
            onClick={() => setInteractionMode('vote')}
          >
            选择投票目标
          </button>
        </div>
      );
    }

    if (interactionMode !== 'none' && interactionMode !== 'witch_save') {
      return (
        <div className="werewolf3d-panel werewolf3d-panel--confirm">
          <div className="werewolf3d-panel__header">
            <Target size={18} />
            <span>
              {interactionMode === 'wolf_kill' && '确认击杀'}
              {interactionMode === 'seer_check' && '确认查验'}
              {interactionMode === 'witch_poison' && '确认毒杀'}
              {interactionMode === 'vote' && '确认投票'}
              {interactionMode === 'hunter_shot' && '确认开枪'}
            </span>
          </div>
          <div className="werewolf3d-panel__selected">
            {selectedTargetId
              ? players.find((p) => p.playerId === selectedTargetId)?.nickname
              : '请在 3D 场景中选择目标'}
          </div>
          <div className="werewolf3d-panel__btn-group">
            <button
              className="werewolf3d-panel__action-btn"
              onClick={handleConfirmAction}
              disabled={!selectedTargetId}
            >
              确认
            </button>
            <button
              className="werewolf3d-panel__action-btn werewolf3d-panel__action-btn--skip"
              onClick={() => {
                setInteractionMode('none');
                setSelectedTargetId(null);
              }}
            >
              取消
            </button>
          </div>
        </div>
      );
    }

    return null;
  };

  return (
    <div className="werewolf3d">
      <div className="werewolf3d__hud">
        <div className="werewolf3d__hud-left">
          <PhaseBadge phase={phase} round={view.round} />
          <span className="werewolf3d__round">第 {view.round} 轮</span>
          {isNight ? <Moon size={16} className="werewolf3d__phase-icon" /> : <Sun size={16} className="werewolf3d__phase-icon" />}
        </div>
        <div className="werewolf3d__hud-right">
          <Countdown deadline={view.deadline as number | null} onExpire={onExpire} />
        </div>
      </div>

      <div className="werewolf3d__stage">
        <WerewolfScene
          players={players}
          isNight={isNight}
          currentActorId={currentActorId}
          targetablePlayerIds={targetableIds}
          selectedTargetId={selectedTargetId}
          onSelectTarget={handleSelectTarget}
          showAllRoles={showAllRoles}
          myRole={myRole}
        />

        {winner && (
          <div className="werewolf3d__winner-overlay">
            <WinnerBanner
              text={winner === 'werewolf' ? '狼人阵营获胜！' : '好人阵营获胜！'}
              tone={winner === 'werewolf' ? 'bad' : 'good'}
            />
          </div>
        )}
      </div>

      <div className="werewolf3d__sidebar">
        {myRole && me && (
          <RoleCard
            title="你的身份"
            roleName={getRoleLabel(myRole)}
            accent={myRole}
          />
        )}

        <div className="werewolf3d__player-list">
          <h4>
            <Skull size={14} />
            玩家 ({alivePlayers.length}/{players.length})
          </h4>
          {players.map((p) => (
            <div
              key={p.playerId}
              className={`werewolf3d__player-item ${!p.isAlive ? 'dead' : ''} ${p.isMe ? 'me' : ''}`}
            >
              <span className="werewolf3d__player-seat">#{p.seatNumber}</span>
              <span className="werewolf3d__player-name">{p.nickname}</span>
              {showAllRoles && p.role && (
                <span className="werewolf3d__player-role">{getRoleLabel(p.role)}</span>
              )}
              {!p.isAlive && <span className="werewolf3d__player-dead">✕</span>}
            </div>
          ))}
        </div>

        {events && events.length > 0 && (
          <div className="werewolf3d__timeline">
            <Timeline events={events} />
          </div>
        )}
      </div>

      <div className="werewolf3d__controls">
        {renderInteractionPanel()}
      </div>
    </div>
  );
}

function getRoleLabel(role: string): string {
  const labels: Record<string, string> = {
    werewolf: '狼人',
    villager: '村民',
    seer: '预言家',
    witch: '女巫',
    hunter: '猎人',
  };
  return labels[role] || role;
}
