import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface Environment3DProps {
  isNight: boolean;
}

function Tree({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 1, 0]} castShadow>
        <cylinderGeometry args={[0.15, 0.2, 2, 8]} />
        <meshStandardMaterial color="#3d2817" roughness={0.9} />
      </mesh>
      <mesh position={[0, 2.5, 0]} castShadow>
        <coneGeometry args={[1, 2.5, 8]} />
        <meshStandardMaterial color="#1a3d1a" roughness={0.8} />
      </mesh>
      <mesh position={[0, 3.2, 0]} castShadow>
        <coneGeometry args={[0.7, 1.5, 8]} />
        <meshStandardMaterial color="#1f4d1f" roughness={0.8} />
      </mesh>
    </group>
  );
}

function Campfire({ position }: { position: [number, number, number] }) {
  const lightRef = useRef<THREE.PointLight>(null);

  useFrame((state) => {
    if (!lightRef.current) return;
    const t = state.clock.elapsedTime;
    lightRef.current.intensity = 2 + Math.sin(t * 8) * 0.5 + Math.sin(t * 13) * 0.3;
  });

  return (
    <group position={position}>
      <mesh position={[0, 0.2, 0]} rotation={[0, 0, 0]}>
        <cylinderGeometry args={[0.4, 0.5, 0.4, 8]} />
        <meshStandardMaterial color="#2a2a2a" roughness={1} />
      </mesh>
      {[0, 1, 2, 3, 4].map((i) => {
        const angle = (i / 5) * Math.PI * 2;
        return (
          <mesh
            key={i}
            position={[Math.cos(angle) * 0.25, 0.1, Math.sin(angle) * 0.25]}
            rotation={[0, angle, Math.PI / 6]}
          >
            <cylinderGeometry args={[0.03, 0.05, 0.6, 6]} />
            <meshStandardMaterial color="#4a2a0a" roughness={0.9} />
          </mesh>
        );
      })}
      <pointLight
        ref={lightRef}
        position={[0, 0.8, 0]}
        color="#ff6b35"
        intensity={2}
        distance={8}
        castShadow
      />
      <mesh position={[0, 0.6, 0]}>
        <coneGeometry args={[0.2, 0.5, 8]} />
        <meshBasicMaterial color="#ff4500" transparent opacity={0.7} />
      </mesh>
    </group>
  );
}

function Moon() {
  const ref = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (!ref.current) return;
    const t = state.clock.elapsedTime;
    ref.current.position.y = 12 + Math.sin(t * 0.2) * 0.5;
  });

  return (
    <mesh ref={ref} position={[8, 12, -10]}>
      <sphereGeometry args={[1.5, 32, 32]} />
      <meshBasicMaterial color="#fffacd" />
    </mesh>
  );
}

function StarField() {
  const ref = useRef<THREE.Points>(null);

  useFrame((state) => {
    if (!ref.current) return;
    const t = state.clock.elapsedTime;
    ref.current.rotation.y = t * 0.01;
  });

  const positions = new Float32Array(300 * 3);
  for (let i = 0; i < 300; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI * 0.5;
    const r = 20 + Math.random() * 10;
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.cos(phi) + 5;
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={300}
          array={positions}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial color="#ffffff" size={0.1} sizeAttenuation transparent opacity={0.8} />
    </points>
  );
}

export function Environment3D({ isNight }: Environment3DProps) {
  const treePositions: [number, number, number][] = [
    [-6, 0, -4],
    [-7, 0, 2],
    [-5, 0, 6],
    [6, 0, -5],
    [7, 0, 1],
    [5, 0, 5],
    [-3, 0, -7],
    [3, 0, -7],
    [-2, 0, 8],
    [4, 0, 8],
  ];

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[30, 30]} />
        <meshStandardMaterial
          color={isNight ? '#0a0f0a' : '#1a2a1a'}
          roughness={1}
        />
      </mesh>

      {isNight && <Moon />}
      {isNight && <StarField />}

      {treePositions.map((pos, i) => (
        <Tree key={i} position={pos} />
      ))}

      <Campfire position={[0, 0, 0]} />

      <ambientLight intensity={isNight ? 0.15 : 0.4} color={isNight ? '#4a5568' : '#ffffff'} />
      <directionalLight
        position={[5, 10, 5]}
        intensity={isNight ? 0.1 : 0.6}
        color={isNight ? '#6366f1' : '#fffaf0'}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />

      {isNight && (
        <fog attach="fog" args={['#0a0f1a', 8, 25]} />
      )}
      {!isNight && (
        <fog attach="fog" args={['#1a2a3a', 12, 30]} />
      )}
    </group>
  );
}
