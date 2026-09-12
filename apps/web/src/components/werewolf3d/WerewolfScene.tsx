import { useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import { PlayerAvatar } from './PlayerAvatar';
import { GameTable } from './GameTable';
import { Environment3D } from './Environment3D';
import type { GamePlayerView } from '../game-parts';

interface WerewolfSceneProps {
  players: GamePlayerView[];
  isNight: boolean;
  currentActorId: string | null;
  targetablePlayerIds: string[];
  selectedTargetId: string | null;
  onSelectTarget: (playerId: string) => void;
  showAllRoles: boolean;
  myRole?: string;
}

function getTableRadius(playerCount: number): number {
  if (playerCount <= 4) return 2;
  if (playerCount <= 6) return 2.5;
  if (playerCount <= 8) return 3;
  return 3.5;
}

function getRoleLabel(role?: string): string {
  const labels: Record<string, string> = {
    werewolf: '狼人',
    villager: '村民',
    seer: '预言家',
    witch: '女巫',
    hunter: '猎人',
  };
  return role ? labels[role] || role : '';
}

function SeatedPlayers({
  players,
  currentActorId,
  targetablePlayerIds,
  selectedTargetId,
  onSelectTarget,
  showAllRoles,
  myRole,
}: WerewolfSceneProps) {
  const radius = getTableRadius(players.length);

  const seatedPlayers = useMemo(() => {
    return players
      .map((player, index) => {
        const angle = (index / players.length) * Math.PI * 2 - Math.PI / 2;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        return { ...player, position: [x, 0, z] as [number, number, number], angle };
      })
      .sort((a, b) => a.angle - b.angle);
  }, [players, radius]);

  return (
    <>
      {seatedPlayers.map((player) => (
        <PlayerAvatar
          key={player.playerId}
          player={player}
          position={player.position}
          isCurrentActor={player.playerId === currentActorId}
          isTargetable={targetablePlayerIds.includes(player.playerId)}
          isSelected={player.playerId === selectedTargetId}
          onClick={() => onSelectTarget(player.playerId)}
          showRole={showAllRoles || player.isMe || player.role === myRole}
          roleLabel={getRoleLabel(player.role)}
        />
      ))}
    </>
  );
}

export function WerewolfScene(props: WerewolfSceneProps) {
  const { players, isNight } = props;
  const radius = getTableRadius(players.length);

  return (
    <Canvas shadows style={{ width: '100%', height: '100%' }}>
      <PerspectiveCamera makeDefault position={[0, radius * 1.2, radius * 1.5]} fov={50} />
      <OrbitControls
        enablePan={false}
        minDistance={radius * 0.8}
        maxDistance={radius * 2.5}
        minPolarAngle={Math.PI / 6}
        maxPolarAngle={Math.PI / 2.5}
        target={[0, 0, 0]}
      />

      <Environment3D isNight={isNight} />
      <GameTable radius={radius} playerCount={players.length} isNight={isNight} />
      <SeatedPlayers {...props} />

      <EffectComposer>
        <Bloom
          intensity={isNight ? 0.8 : 0.3}
          luminanceThreshold={0.6}
          luminanceSmoothing={0.9}
        />
        <Vignette eskil={false} offset={0.1} darkness={isNight ? 0.7 : 0.3} />
      </EffectComposer>
    </Canvas>
  );
}
