import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface GameTableProps {
  radius: number;
  playerCount: number;
  isNight: boolean;
}

export function GameTable({ radius, playerCount, isNight }: GameTableProps) {
  const lightRef = useRef<THREE.PointLight>(null);

  useFrame((state) => {
    if (!lightRef.current) return;
    const t = state.clock.elapsedTime;
    lightRef.current.intensity = isNight
      ? 0.8 + Math.sin(t * 2) * 0.2
      : 1.5 + Math.sin(t * 1.5) * 0.3;
  });

  const tableHeight = 0.8;

  return (
    <group position={[0, 0, 0]}>
      <mesh position={[0, tableHeight / 2, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[radius, radius, tableHeight, 64]} />
        <meshStandardMaterial
          color={isNight ? '#2a1a0a' : '#4a2a1a'}
          roughness={0.8}
          metalness={0.1}
        />
      </mesh>

      <mesh position={[0, tableHeight + 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[radius - 0.1, 64]} />
        <meshStandardMaterial
          color={isNight ? '#1a0f05' : '#2a1a0a'}
          roughness={0.9}
        />
      </mesh>

      {Array.from({ length: playerCount }).map((_, i) => {
        const angle = (i / playerCount) * Math.PI * 2 - Math.PI / 2;
        const x = Math.cos(angle) * (radius + 0.8);
        const z = Math.sin(angle) * (radius + 0.8);
        return (
          <mesh
            key={i}
            position={[x, tableHeight + 0.02, z]}
            rotation={[-Math.PI / 2, 0, 0]}
          >
            <circleGeometry args={[0.15, 16]} />
            <meshStandardMaterial
              color={isNight ? '#3a2a1a' : '#5a3a2a'}
              roughness={0.7}
            />
          </mesh>
        );
      })}

      <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[radius + 2, 64]} />
        <meshStandardMaterial color={isNight ? '#0a0a0a' : '#1a1a1a'} roughness={1} />
      </mesh>

      <pointLight
        ref={lightRef}
        position={[0, tableHeight + 1.5, 0]}
        color={isNight ? '#ff6b35' : '#ffd700'}
        intensity={1}
        distance={12}
        castShadow
      />

      {!isNight && (
        <mesh position={[0, tableHeight + 0.5, 0]}>
          <sphereGeometry args={[0.3, 16, 16]} />
          <meshStandardMaterial
            color="#ffd700"
            emissive="#ffd700"
            emissiveIntensity={0.5}
            transparent
            opacity={0.6}
          />
        </mesh>
      )}
    </group>
  );
}
