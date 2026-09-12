import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type BgmStingerType = 'phase_change' | 'vote_start' | 'elimination' | 'game_end' | 'tension_peak';

interface GamePhaseInput {
  gameType?: string | null;
  phase?: string | null;
  gameStatus?: string | null;
  conflictLevel?: number | null;
}

interface BgmProfile {
  key: string;
  label: string;
  description: string;
  tempo: number;
  root: number;
  droneIntervals: number[];
  pulsePattern: number[];
  shimmerPattern: number[];
  droneWave: OscillatorType;
  pulseWave: OscillatorType;
  masterGain: number;
  droneGain: number;
  pulseGain: number;
  filterFrequency: number;
  accentEvery: number;
}

interface AudioEngine {
  stop: () => void;
  setVolume: (volume: number) => void;
}

const ENABLED_KEY = 'game-bgm-enabled';
const VOLUME_KEY = 'game-bgm-volume';
/** 各 profile 的 masterGain 偏保守，全局再乘一个增益系数，避免整段音乐听不清 */
const GLOBAL_GAIN_BOOST = 5;

function readStoredBoolean(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback;
  const value = window.localStorage.getItem(key);
  if (value === null) return fallback;
  return value === '1';
}

function readStoredNumber(key: string, fallback: number): number {
  if (typeof window === 'undefined') return fallback;
  const value = Number(window.localStorage.getItem(key));
  return Number.isFinite(value) ? value : fallback;
}

function semitone(root: number, interval: number): number {
  return root * Math.pow(2, interval / 12);
}

function phaseKey(
  gameType?: string | null,
  phase?: string | null,
  gameStatus?: string | null,
  conflictLevel?: number | null,
): string {
  const conflictTag = (gameStatus === 'playing' && (conflictLevel ?? 0) >= 50) ? ':conflict' : '';
  return `${gameType ?? 'unknown'}:${phase ?? 'idle'}:${gameStatus ?? 'idle'}${conflictTag}`;
}

function createProfile(input: GamePhaseInput): BgmProfile {
  const { gameType, phase, gameStatus, conflictLevel } = input;

  if (
    gameStatus === 'playing' &&
    gameType === 'murder_mystery' &&
    (conflictLevel ?? 0) >= 50 &&
    (phase === 'discussion' || phase === 'accusation')
  ) {
    return {
      key: phaseKey(gameType, phase, gameStatus, conflictLevel),
      label: '冲突爆发',
      description: '急促的鼓点与尖锐的锯齿波，圆桌已经变成扭打的战场。',
      tempo: 112,
      root: 146.83,
      droneIntervals: [0, 6, 11],
      pulsePattern: [0, 1, 6, 11],
      shimmerPattern: [12, 13, 18, 13],
      droneWave: 'sawtooth',
      pulseWave: 'square',
      masterGain: 0.08,
      droneGain: 0.12,
      pulseGain: 0.058,
      filterFrequency: 820,
      accentEvery: 2,
    };
  }

  if (gameStatus === 'finished') {
    if (gameType === 'werewolf') {
      return {
        key: phaseKey(gameType, phase, gameStatus),
        label: '残局余响',
        description: '低沉和弦慢慢落下，像天亮后的复盘与清算。',
        tempo: 58,
        root: 174.61,
        droneIntervals: [0, 7, 10],
        pulsePattern: [0, 7, 10, 12],
        shimmerPattern: [12, 10, 7, 5],
        droneWave: 'triangle',
        pulseWave: 'sine',
        masterGain: 0.06,
        droneGain: 0.12,
        pulseGain: 0.05,
        filterFrequency: 880,
        accentEvery: 4,
      };
    }
    if (gameType === 'murder_mystery') {
      return {
        key: phaseKey(gameType, phase, gameStatus),
        label: '真相落幕',
        description: '悬念收束后的冷色尾音，让结案更有仪式感。',
        tempo: 62,
        root: 196,
        droneIntervals: [0, 7, 12],
        pulsePattern: [0, 3, 7, 10],
        shimmerPattern: [12, 15, 10, 7],
        droneWave: 'sine',
        pulseWave: 'triangle',
        masterGain: 0.055,
        droneGain: 0.11,
        pulseGain: 0.045,
        filterFrequency: 1100,
        accentEvery: 4,
      };
    }
    if (gameType === 'who_is_the_thief') {
      return {
        key: phaseKey(gameType, phase, gameStatus),
        label: '失窃揭晓',
        description: '轻快又带一点狡黠，适合公布真假身份后的回味。',
        tempo: 82,
        root: 220,
        droneIntervals: [0, 7, 12],
        pulsePattern: [0, 4, 7, 9],
        shimmerPattern: [12, 16, 19, 16],
        droneWave: 'triangle',
        pulseWave: 'square',
        masterGain: 0.06,
        droneGain: 0.1,
        pulseGain: 0.042,
        filterFrequency: 1400,
        accentEvery: 4,
      };
    }
    return {
      key: phaseKey(gameType, phase, gameStatus),
      label: '谜底揭开',
      description: '紧张感退去一点，留下适合复盘的轻悬疑氛围。',
      tempo: 78,
      root: 207.65,
      droneIntervals: [0, 5, 12],
      pulsePattern: [0, 2, 5, 7],
      shimmerPattern: [12, 14, 17, 19],
      droneWave: 'triangle',
      pulseWave: 'sine',
      masterGain: 0.055,
      droneGain: 0.1,
      pulseGain: 0.04,
      filterFrequency: 1350,
      accentEvery: 4,
    };
  }

  if (gameStatus !== 'playing') {
    return {
      key: phaseKey(gameType, phase, gameStatus),
      label: '入局暖场',
      description: '开局前的轻悬浮环境音，避免等待区过于干。',
      tempo: 72,
      root: 196,
      droneIntervals: [0, 7, 12],
      pulsePattern: [0, 7, 12, 7],
      shimmerPattern: [12, 14, 12, 9],
      droneWave: 'sine',
      pulseWave: 'triangle',
      masterGain: 0.045,
      droneGain: 0.09,
      pulseGain: 0.032,
      filterFrequency: 1200,
      accentEvery: 4,
    };
  }

  if (gameType === 'werewolf') {
    if (phase === 'night') {
      return {
        key: phaseKey(gameType, phase, gameStatus),
        label: '猎月夜行',
        description: '低频心跳和冷色长音，更贴近狼人夜晚行动的紧张感。',
        tempo: 54,
        root: 110,
        droneIntervals: [0, 7, 10],
        pulsePattern: [0, 0, 3, 7],
        shimmerPattern: [12, 10, 7, 3],
        droneWave: 'triangle',
        pulseWave: 'sine',
        masterGain: 0.072,
        droneGain: 0.14,
        pulseGain: 0.05,
        filterFrequency: 760,
        accentEvery: 2,
      };
    }
    if (phase === 'vote' || phase === 'final_speech') {
      return {
        key: phaseKey(gameType, phase, gameStatus),
        label: '审判时刻',
        description: '节拍更硬，像票型慢慢收紧到最后一刀。',
        tempo: 88,
        root: 146.83,
        droneIntervals: [0, 7, 12],
        pulsePattern: [0, 3, 7, 10],
        shimmerPattern: [12, 15, 19, 15],
        droneWave: 'sawtooth',
        pulseWave: 'square',
        masterGain: 0.07,
        droneGain: 0.1,
        pulseGain: 0.052,
        filterFrequency: 980,
        accentEvery: 4,
      };
    }
    return {
      key: phaseKey(gameType, phase, gameStatus),
      label: '白昼对峙',
      description: '保留压迫感，但节奏更清晰，适合白天发言和找狼。',
      tempo: 78,
      root: 164.81,
      droneIntervals: [0, 5, 10],
      pulsePattern: [0, 2, 5, 7],
      shimmerPattern: [12, 14, 17, 14],
      droneWave: 'triangle',
      pulseWave: 'triangle',
      masterGain: 0.062,
      droneGain: 0.105,
      pulseGain: 0.045,
      filterFrequency: 1050,
      accentEvery: 4,
    };
  }

  if (gameType === 'murder_mystery') {
    if (phase === 'introduction') {
      return {
        key: phaseKey(gameType, phase, gameStatus),
        label: '宴会暗影',
        description: '缓慢铺底的悬疑和弦，适合角色刚入场时的戏剧感。',
        tempo: 66,
        root: 185,
        droneIntervals: [0, 7, 12],
        pulsePattern: [0, 3, 7, 12],
        shimmerPattern: [12, 15, 19, 15],
        droneWave: 'sine',
        pulseWave: 'triangle',
        masterGain: 0.06,
        droneGain: 0.11,
        pulseGain: 0.038,
        filterFrequency: 1150,
        accentEvery: 4,
      };
    }
    if (phase === 'investigation') {
      return {
        key: phaseKey(gameType, phase, gameStatus),
        label: '线索搜寻',
        description: '有脚步感的轻节拍，像在案发现场一点点摸索证据。',
        tempo: 76,
        root: 196,
        droneIntervals: [0, 7, 10],
        pulsePattern: [0, 2, 7, 10],
        shimmerPattern: [12, 14, 19, 17],
        droneWave: 'triangle',
        pulseWave: 'square',
        masterGain: 0.06,
        droneGain: 0.105,
        pulseGain: 0.042,
        filterFrequency: 1320,
        accentEvery: 4,
      };
    }
    if (phase === 'accusation' || phase === 'voting') {
      return {
        key: phaseKey(gameType, phase, gameStatus),
        label: '真凶逼近',
        description: '和弦收窄、鼓点更近，适合公开指控和最终指认。',
        tempo: 92,
        root: 174.61,
        droneIntervals: [0, 6, 10],
        pulsePattern: [0, 3, 6, 10],
        shimmerPattern: [12, 15, 18, 15],
        droneWave: 'sawtooth',
        pulseWave: 'triangle',
        masterGain: 0.07,
        droneGain: 0.11,
        pulseGain: 0.05,
        filterFrequency: 950,
        accentEvery: 4,
      };
    }
    return {
      key: phaseKey(gameType, phase, gameStatus),
      label: '质询回廊',
      description: '保持悬疑但更强调来回试探，适合圆桌讨论阶段。',
      tempo: 82,
      root: 185,
      droneIntervals: [0, 7, 10],
      pulsePattern: [0, 5, 7, 10],
      shimmerPattern: [12, 17, 19, 17],
      droneWave: 'triangle',
      pulseWave: 'triangle',
      masterGain: 0.064,
      droneGain: 0.11,
      pulseGain: 0.045,
      filterFrequency: 1080,
      accentEvery: 4,
    };
  }

  if (gameType === 'who_is_the_thief') {
    if (phase === 'voting') {
      return {
        key: phaseKey(gameType, phase, gameStatus),
        label: '锁定嫌犯',
        description: '更利落的短音节拍，像一点点把嫌疑人围住。',
        tempo: 96,
        root: 220,
        droneIntervals: [0, 7, 12],
        pulsePattern: [0, 4, 7, 11],
        shimmerPattern: [12, 16, 19, 23],
        droneWave: 'triangle',
        pulseWave: 'square',
        masterGain: 0.068,
        droneGain: 0.09,
        pulseGain: 0.048,
        filterFrequency: 1480,
        accentEvery: 4,
      };
    }
    return {
      key: phaseKey(gameType, phase, gameStatus),
      label: '潜行搜证',
      description: '带一点滑头感的轻快潜行动机，适合小偷局的调查阶段。',
      tempo: 84,
      root: 207.65,
      droneIntervals: [0, 7, 12],
      pulsePattern: [0, 4, 7, 9],
      shimmerPattern: [12, 16, 19, 16],
      droneWave: 'triangle',
      pulseWave: 'triangle',
      masterGain: 0.06,
      droneGain: 0.09,
      pulseGain: 0.04,
      filterFrequency: 1520,
      accentEvery: 4,
    };
  }

  if (phase === 'voting') {
    return {
      key: phaseKey(gameType, phase, gameStatus),
      label: '卧底锁票',
      description: '节奏更紧，突出“谁在跟上大多数人、谁在露馅”的压迫感。',
      tempo: 94,
      root: 196,
      droneIntervals: [0, 5, 10],
      pulsePattern: [0, 2, 5, 10],
      shimmerPattern: [12, 14, 17, 22],
      droneWave: 'triangle',
      pulseWave: 'square',
      masterGain: 0.067,
      droneGain: 0.1,
      pulseGain: 0.048,
      filterFrequency: 1380,
      accentEvery: 4,
    };
  }

  return {
    key: phaseKey(gameType, phase, gameStatus),
    label: '试探描述',
    description: '轻悬疑底色加一点留白，适合谁是卧底一轮轮试探发言。',
    tempo: 82,
    root: 196,
    droneIntervals: [0, 7, 12],
    pulsePattern: [0, 2, 7, 9],
    shimmerPattern: [12, 14, 19, 21],
    droneWave: 'sine',
    pulseWave: 'triangle',
    masterGain: 0.058,
    droneGain: 0.095,
    pulseGain: 0.04,
    filterFrequency: 1450,
    accentEvery: 4,
  };
}

function createAmbientEngine(ctx: AudioContext, profile: BgmProfile, volumePercent: number): AudioEngine {
  const nodes: AudioNode[] = [];
  const oscillators: OscillatorNode[] = [];
  const timers: number[] = [];

  const master = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  const pulseBus = ctx.createGain();
  const droneBus = ctx.createGain();
  const shimmerBus = ctx.createGain();
  const masterVolume = (volumePercent / 100) * profile.masterGain * GLOBAL_GAIN_BOOST;

  filter.type = 'lowpass';
  filter.frequency.value = profile.filterFrequency;
  filter.Q.value = 0.8;

  master.gain.setValueAtTime(0.0001, ctx.currentTime);
  master.gain.linearRampToValueAtTime(masterVolume, ctx.currentTime + 0.8);
  pulseBus.gain.value = 1;
  droneBus.gain.value = 1;
  shimmerBus.gain.value = 1;

  pulseBus.connect(filter);
  droneBus.connect(filter);
  shimmerBus.connect(filter);
  filter.connect(master);
  master.connect(ctx.destination);

  nodes.push(master, filter, pulseBus, droneBus, shimmerBus);

  const tremolo = ctx.createOscillator();
  const tremoloDepth = ctx.createGain();
  tremolo.type = 'sine';
  tremolo.frequency.value = 0.09;
  tremoloDepth.gain.value = profile.droneGain * 0.35;
  tremolo.connect(tremoloDepth);
  tremoloDepth.connect(droneBus.gain);
  tremolo.start();
  oscillators.push(tremolo);
  nodes.push(tremoloDepth);

  for (const interval of profile.droneIntervals) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = profile.droneWave;
    osc.frequency.value = semitone(profile.root, interval);
    gain.gain.value = profile.droneGain / profile.droneIntervals.length;
    osc.connect(gain);
    gain.connect(droneBus);
    osc.start();
    oscillators.push(osc);
    nodes.push(gain);
  }

  const beatMs = Math.max(420, Math.round(60000 / profile.tempo));
  let step = 0;

  const triggerNote = (frequency: number, time: number, duration: number, gainAmount: number, waveform: OscillatorType, targetBus: AudioNode) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = waveform;
    osc.frequency.setValueAtTime(frequency, time);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(gainAmount, time + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    osc.connect(gain);
    gain.connect(targetBus);
    osc.start(time);
    osc.stop(time + duration + 0.05);
  };

  const schedulePulse = () => {
    const beatTime = ctx.currentTime + 0.02;
    const pulseInterval = profile.pulsePattern[step % profile.pulsePattern.length] ?? 0;
    const shimmerInterval = profile.shimmerPattern[step % profile.shimmerPattern.length] ?? 12;
    const accent = step % profile.accentEvery === 0 ? 1.2 : 0.9;

    triggerNote(
      semitone(profile.root, pulseInterval),
      beatTime,
      Math.min(0.52, beatMs / 1000 * 0.72),
      profile.pulseGain * accent,
      profile.pulseWave,
      pulseBus,
    );
    triggerNote(
      semitone(profile.root, pulseInterval - 12),
      beatTime,
      Math.min(0.44, beatMs / 1000 * 0.58),
      profile.pulseGain * 0.3,
      'sine',
      pulseBus,
    );
    if (step % 2 === 0) {
      triggerNote(
        semitone(profile.root, shimmerInterval),
        beatTime + beatMs / 1000 * 0.36,
        Math.min(0.28, beatMs / 1000 * 0.38),
        profile.pulseGain * 0.18,
        'triangle',
        shimmerBus,
      );
    }
    step += 1;
  };

  schedulePulse();
  timers.push(window.setInterval(schedulePulse, beatMs));

  return {
    stop: () => {
      for (const timer of timers) window.clearInterval(timer);
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
      master.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.45);
      window.setTimeout(() => {
        for (const osc of oscillators) {
          try {
            osc.stop();
          } catch {
            // Oscillators may already be stopped by scheduled envelopes.
          }
        }
        for (const node of nodes) node.disconnect();
      }, 520);
    },
    setVolume: (volumePercentNext: number) => {
      const next = (volumePercentNext / 100) * profile.masterGain * GLOBAL_GAIN_BOOST;
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.linearRampToValueAtTime(next, ctx.currentTime + 0.18);
    },
  };
}

export function useAdaptiveGameBgm(input: GamePhaseInput) {
  const [enabled, setEnabled] = useState(() => readStoredBoolean(ENABLED_KEY, true));
  const [volume, setVolume] = useState(() => Math.min(100, Math.max(0, readStoredNumber(VOLUME_KEY, 60))));
  const [unlocked, setUnlocked] = useState(false);
  const [supported] = useState(() => typeof window !== 'undefined' && (window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext));

  const profile = useMemo(() => createProfile(input), [input.gameStatus, input.gameType, input.phase, input.conflictLevel]);
  const ctxRef = useRef<AudioContext | null>(null);
  const engineRef = useRef<AudioEngine | null>(null);
  const activeKeyRef = useRef<string | null>(null);

  const stopCurrent = useCallback(() => {
    engineRef.current?.stop();
    engineRef.current = null;
    activeKeyRef.current = null;
  }, []);

  const ensureContext = useCallback(async () => {
    if (!supported) return null;
    if (!ctxRef.current) {
      const AudioCtor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtor) return null;
      ctxRef.current = new AudioCtor();
    }
    if (ctxRef.current.state !== 'running') {
      try {
        await ctxRef.current.resume();
      } catch {
        return ctxRef.current;
      }
    }
    setUnlocked(ctxRef.current.state === 'running');
    return ctxRef.current;
  }, [supported]);

  const startCurrentProfile = useCallback(async () => {
    if (!enabled || !supported) {
      stopCurrent();
      return;
    }
    const ctx = await ensureContext();
    if (!ctx || ctx.state !== 'running') return;
    setUnlocked(true);
    if (activeKeyRef.current === profile.key && engineRef.current) {
      engineRef.current.setVolume(volume);
      return;
    }
    stopCurrent();
    engineRef.current = createAmbientEngine(ctx, profile, volume);
    activeKeyRef.current = profile.key;
  }, [enabled, ensureContext, profile, stopCurrent, supported, volume]);

  /** 播放短促音效（stiger）用于关键事件提醒 */
  const playStinger = useCallback(
    (type: BgmStingerType) => {
      if (!enabled || !supported) return;
      const ctx = ctxRef.current;
      if (!ctx || ctx.state !== 'running') return;
      const now = ctx.currentTime;
      const master = ctx.destination;

      const playTone = (freq: number, dur: number, gainAmt: number, wave: OscillatorType, delay = 0) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = wave;
        osc.frequency.value = freq;
        g.gain.setValueAtTime(0, now + delay);
        g.gain.linearRampToValueAtTime(gainAmt, now + delay + 0.01);
        g.gain.exponentialRampToValueAtTime(0.001, now + delay + dur);
        osc.connect(g);
        g.connect(master);
        osc.start(now + delay);
        osc.stop(now + delay + dur + 0.05);
      };

      switch (type) {
        case 'phase_change':
          playTone(330, 0.6, 0.12, 'sine');
          playTone(440, 0.5, 0.08, 'sine', 0.08);
          break;
        case 'vote_start':
          playTone(294, 0.3, 0.1, 'triangle');
          playTone(392, 0.25, 0.08, 'triangle', 0.12);
          break;
        case 'elimination':
          playTone(200, 0.5, 0.12, 'sine');
          playTone(150, 0.6, 0.15, 'sine', 0.1);
          break;
        case 'game_end': {
          const notes = [262, 330, 392, 523];
          notes.forEach((f, i) => playTone(f, 0.4, 0.09, 'sine', i * 0.1));
          break;
        }
        case 'tension_peak':
          playTone(147, 0.4, 0.1, 'sawtooth');
          playTone(110, 0.5, 0.08, 'sawtooth', 0.05);
          break;
      }
    },
    [enabled, supported],
  );

  const toggleEnabled = useCallback(async () => {
    const next = !enabled;
    setEnabled(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(ENABLED_KEY, next ? '1' : '0');
    }
    if (!next) {
      stopCurrent();
      return;
    }
    await startCurrentProfile();
  }, [enabled, startCurrentProfile, stopCurrent]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(ENABLED_KEY, enabled ? '1' : '0');
  }, [enabled]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(VOLUME_KEY, String(volume));
  }, [volume]);

  useEffect(() => {
    if (!enabled || !supported) {
      stopCurrent();
      return;
    }
    void startCurrentProfile();
  }, [enabled, profile.key, startCurrentProfile, stopCurrent, supported]);

  useEffect(() => {
    engineRef.current?.setVolume(volume);
  }, [volume]);

  useEffect(() => {
    if (!enabled || !supported || unlocked) return;

    const unlock = () => {
      void startCurrentProfile();
    };

    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [enabled, startCurrentProfile, supported, unlocked]);

  useEffect(() => {
    if (!supported) return;
    const handleVisibility = () => {
      if (!ctxRef.current) return;
      if (document.hidden) {
        stopCurrent();
        void ctxRef.current.suspend();
        setUnlocked(false);
        return;
      }
      if (enabled) void startCurrentProfile();
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [enabled, startCurrentProfile, stopCurrent, supported]);

  useEffect(() => {
    return () => {
      stopCurrent();
      void ctxRef.current?.close();
      ctxRef.current = null;
    };
  }, [stopCurrent]);

  return {
    enabled,
    unlocked,
    supported: Boolean(supported),
    volume,
    profile,
    setVolume,
    toggleEnabled,
    resume: startCurrentProfile,
    playStinger,
  };
}
