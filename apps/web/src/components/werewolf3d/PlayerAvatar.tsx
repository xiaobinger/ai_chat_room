import { useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { GamePlayerView } from '../game-parts';

interface PlayerAvatarProps {
  player: GamePlayerView;
  position: [number, number, number];
  isCurrentActor: boolean;
  isTargetable: boolean;
  isSelected: boolean;
  onClick: () => void;
  showRole: boolean;
  roleLabel: string;
}

const ROLE_COLORS: Record<string, string> = {
  werewolf: '#dc2626',
  villager: '#6b7280',
  seer: '#8b5cf6',
  witch: '#10b981',
  hunter: '#f59e0b',
};

function getRoleColor(role?: string): string {
  if (!role) return '#6b7280';
  return ROLE_COLORS[role] ?? '#6b7280';
}

function getRoleIcon(role?: string): string {
  switch (role) {
    case 'werewolf': return '🐺';
    case 'seer': return '🔮';
    case 'witch': return '🧪';
    case 'hunter': return '🏹';
    default: return '👤';
  }
}

export function PlayerAvatar({
  player,
  position,
  isCurrentActor,
  isTargetable,
  isSelected,
  onClick,
  showRole,
  roleLabel,
}: PlayerAvatarProps) {
  const groupRef = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);
  const baseY = position[1];

  useFrame((state) => {
    if (!groupRef.current) return;
    const t = state.clock.elapsedTime;

    if (!player.isAlive) {
      groupRef.current.rotation.z = Math.PI / 2;
      groupRef.current.position.y = 0.1;
      return;
    }

    groupRef.current.rotation.z = 0;

    if (isCurrentActor) {
      groupRef.current.position.y = baseY + Math.sin(t * 3) * 0.08;
    } else if (hovered && isTargetable) {
      groupRef.current.position.y = baseY + 0.15;
    } else {
      groupRef.current.position.y = baseY + Math.sin(t * 1.5 + position[0]) * 0.03;
    }

    if (isSelected) {
      groupRef.current.scale.setScalar(1.15);
    } else if (hovered && isTargetable) {
      groupRef.current.scale.setScalar(1.08);
    } else {
      groupRef.current.scale.setScalar(1);
    }
  });

  const bodyColor = getRoleColor(player.role);
  const emissiveIntensity = isCurrentActor ? 0.4 : isSelected ? 0.3 : hovered && isTargetable ? 0.2 : 0;

  return (
    <group
      ref={groupRef}
      position={position}
      onClick={(e) => {
        if (!isTargetable || !player.isAlive) return;
        e.stopPropagation();
        onClick();
      }}
      onPointerOver={() => isTargetable && player.isAlive && setHovered(true)}
      onPointerOut={() => setHovered(false)}
    >
      <mesh castShadow>
        <capsuleGeometry args={[0.35, 0.6, 8, 16]} />
        <meshStandardMaterial
          color={bodyColor}
          emissive={bodyColor}
          emissiveIntensity={emissiveIntensity}
          roughness={0.4}
          metalness={0.1}
        />
      </mesh>

      <mesh position={[0, 0.6, 0]} castShadow>
        <sphereGeometry args={[0.28, 16, 16]} />
        <meshStandardMaterial color="#fcd5b4" roughness={0.6} />
      </mesh>

      {isCurrentActor && (
        <mesh position={[0, 1.2, 0]}>
          <coneGeometry args={[0.15, 0.3, 8]} />
          <meshStandardMaterial color="#fbbf24" emissive="#fbbf24" emissiveIntensity={0.5} />
        </mesh>
      )}

      {!player.isAlive && (
        <mesh position={[0, 0.1, 0.4]} rotation={[Math.PI / 2, 0, 0]}>
          <boxGeometry args={[0.6, 0.02, 0.4]} />
          <meshStandardMaterial color="#dc2626" />
        </mesh>
      )}

      <Html
        position={[0, 1.5, 0]}
        center
        distanceFactor={8}
        style={{ pointerEvents: 'none', userSelect: 'none' }}
      >
        <div className="werewolf3d-nameplate">
          <span className="werewolf3d-nameplate__icon">{getRoleIcon(player.role)}</span>
          <span className="werewolf3d-nameplate__name">{player.nickname}</span>
          {showRole && <span className="werewolf3d-nameplate__role">{roleLabel}</span>}
          {!player.isAlive && <span className="werewolf3d-nameplate__dead">✕</span>}
          {player.isMe && <span className="werewolf3d-nameplate__me">我</span>}
        </div>
      </Html>

      {isTargetable && player.isAlive && (hovered || isSelected) && (
        <mesh position={[0, -0.5, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.5, 0.6, 32]} />
          <meshBasicMaterial color={isSelected ? '#fbbf24' : '#ffffff'} transparent opacity={0.6} />
        </mesh>
      )}

      {isCurrentActor && (
        <mesh position={[0, -0.5, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.55, 0.7, 32]} />
          <meshBasicMaterial color="#fbbf24" transparent opacity={0.4} />
        </mesh>
      )}
    </group>
  );
}
