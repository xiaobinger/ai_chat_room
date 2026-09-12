/**
 * 剧本杀氛围音乐引擎 —— 程序化音景生成器
 * 使用 Web Audio API 实时合成情绪背景音，无需外部音频文件。
 *
 * 六种情绪音景：
 * - mysterious  (introduction)  : 低频 drone + 稀疏钟声，神秘悬疑
 * - tense       (investigation) : 不规则节奏 + 下行音阶，紧张探索
 * - contemplative (discussion)  : 缓慢 pad + 环境噪音，沉闷思索
 * - passionate  (accusation)    : 急促弦乐 + 上升旋律，激情冲突
 * - suspenseful (voting)        : 心跳低频 + 高频泛音，悬念压抑
 * - climactic   (reveal)        : 铜管齐奏 + 宽频铺底，高潮揭晓
 */

export type MoodType = 'mysterious' | 'tense' | 'contemplative' | 'passionate' | 'suspenseful' | 'climactic' | 'silent';

export type StingerType = 'phase_change' | 'clue_found' | 'accusation' | 'vote_cast' | 'reveal' | 'death' | 'whisper';

/** 阶段 → 情绪映射 */
export const PHASE_MOOD: Record<string, MoodType> = {
  introduction: 'mysterious',
  investigation: 'tense',
  discussion: 'contemplative',
  accusation: 'passionate',
  voting: 'suspenseful',
  reveal: 'climactic',
};

interface LayerConfig {
  type: OscillatorType;
  frequency: number;
  gain: number;
  detune?: number;
  lfoRate?: number;
  lfoDepth?: number;
  filterFreq?: number;
  filterQ?: number;
}

/** 每种情绪的音色配置 */
const MOOD_PRESETS: Record<MoodType, { layers: LayerConfig[]; masterGain: number; reverbGain: number }> = {
  mysterious: {
    masterGain: 0.18,
    reverbGain: 0.4,
    layers: [
      { type: 'sine', frequency: 110, gain: 0.5, lfoRate: 0.08, lfoDepth: 0.3 },
      { type: 'triangle', frequency: 165, gain: 0.2, detune: 8, lfoRate: 0.05, lfoDepth: 0.15 },
      { type: 'sine', frequency: 330, gain: 0.08, lfoRate: 0.12, lfoDepth: 0.4 },
    ],
  },
  tense: {
    masterGain: 0.16,
    reverbGain: 0.25,
    layers: [
      { type: 'sawtooth', frequency: 85, gain: 0.25, filterFreq: 400, filterQ: 3, lfoRate: 0.3, lfoDepth: 0.2 },
      { type: 'square', frequency: 170, gain: 0.1, detune: -5, lfoRate: 0.5, lfoDepth: 0.3 },
      { type: 'triangle', frequency: 255, gain: 0.08, lfoRate: 0.7, lfoDepth: 0.25 },
    ],
  },
  contemplative: {
    masterGain: 0.14,
    reverbGain: 0.5,
    layers: [
      { type: 'sine', frequency: 130.81, gain: 0.35, lfoRate: 0.04, lfoDepth: 0.1 },
      { type: 'sine', frequency: 196, gain: 0.2, detune: 5, lfoRate: 0.06, lfoDepth: 0.08 },
      { type: 'sine', frequency: 261.63, gain: 0.12, lfoRate: 0.03, lfoDepth: 0.05 },
    ],
  },
  passionate: {
    masterGain: 0.2,
    reverbGain: 0.3,
    layers: [
      { type: 'sawtooth', frequency: 146.83, gain: 0.3, filterFreq: 800, filterQ: 2, lfoRate: 0.6, lfoDepth: 0.35 },
      { type: 'square', frequency: 220, gain: 0.15, detune: 7, lfoRate: 0.8, lfoDepth: 0.3 },
      { type: 'triangle', frequency: 440, gain: 0.08, lfoRate: 1.2, lfoDepth: 0.2 },
    ],
  },
  suspenseful: {
    masterGain: 0.15,
    reverbGain: 0.35,
    layers: [
      { type: 'sine', frequency: 55, gain: 0.45, lfoRate: 1.5, lfoDepth: 0.5 },
      { type: 'sine', frequency: 110, gain: 0.2, detune: -3, lfoRate: 1.0, lfoDepth: 0.3 },
      { type: 'triangle', frequency: 1308.13, gain: 0.04, lfoRate: 2.0, lfoDepth: 0.15 },
    ],
  },
  climactic: {
    masterGain: 0.22,
    reverbGain: 0.45,
    layers: [
      { type: 'sawtooth', frequency: 130.81, gain: 0.35, filterFreq: 1200, filterQ: 1.5, lfoRate: 0.15, lfoDepth: 0.2 },
      { type: 'square', frequency: 196, gain: 0.2, detune: 6, lfoRate: 0.2, lfoDepth: 0.15 },
      { type: 'triangle', frequency: 392, gain: 0.12, lfoRate: 0.1, lfoDepth: 0.1 },
    ],
  },
  silent: {
    masterGain: 0,
    reverbGain: 0,
    layers: [],
  },
};

interface ActiveLayer {
  oscillator: OscillatorNode;
  lfo: OscillatorNode;
  lfoGain: GainNode;
  gainNode: BiquadFilterNode;
}

export class MysteryAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private convolver: ConvolverNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private noiseSource: AudioBufferSourceNode | null = null;
  private noiseGain: GainNode | null = null;
  private activeLayers: ActiveLayer[] = [];
  private _mood: MoodType = 'silent';
  private _volume = 0.7;
  private _isPlaying = false;
  private _isInitialized = false;

  get isPlaying(): boolean {
    return this._isPlaying;
  }

  get mood(): MoodType {
    return this._mood;
  }

  get volume(): number {
    return this._volume;
  }

  /** 初始化音频上下文（必须由用户手势触发） */
  async init(): Promise<void> {
    if (this._isInitialized) return;
    try {
      this.ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      if (this.ctx.state === 'suspended') {
        await this.ctx.resume();
      }
      this._isInitialized = true;
      this.buildGraph();
    } catch {
      this._isInitialized = false;
    }
  }

  /** 构建音频图：主输出 + 卷积混响 + 环境噪音 */
  private buildGraph(): void {
    if (!this.ctx) return;
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this._volume;
    this.masterGain.connect(this.ctx.destination);

    // 简单卷积混响（用生成的脉冲响应）
    this.convolver = this.ctx.createConvolver();
    this.convolver.buffer = this.createImpulseResponse(2.5, 2.0);
    const reverbGain = this.ctx.createGain();
    reverbGain.gain.value = MOOD_PRESETS[this._mood]?.reverbGain ?? 0.3;
    this.convolver.connect(reverbGain);
    reverbGain.connect(this.masterGain);

    // 环境噪音层（模拟空气感/底噪）
    this.noiseBuffer = this.createNoiseBuffer(4);
    this.noiseSource = this.ctx.createBufferSource();
    this.noiseSource.buffer = this.noiseBuffer;
    this.noiseSource.loop = true;
    this.noiseGain = this.ctx.createGain();
    this.noiseGain.gain.value = 0.015;
    this.noiseSource.connect(this.noiseGain);
    this.noiseGain.connect(this.masterGain);
    this.noiseSource.start();
  }

  /** 生成混响脉冲响应 */
  private createImpulseResponse(duration: number, decay: number): AudioBuffer {
    if (!this.ctx) throw new Error('No audio context');
    const sampleRate = this.ctx.sampleRate;
    const length = sampleRate * duration;
    const impulse = this.ctx.createBuffer(2, length, sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
      }
    }
    return impulse;
  }

  /** 生成白噪音缓冲 */
  private createNoiseBuffer(duration: number): AudioBuffer {
    if (!this.ctx) throw new Error('No audio context');
    const sampleRate = this.ctx.sampleRate;
    const length = sampleRate * duration;
    const buffer = this.ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  /** 停止并清理所有活跃音层 */
  private clearLayers(): void {
    for (const layer of this.activeLayers) {
      try {
        layer.lfo.stop();
        layer.oscillator.stop();
      } catch {
        // 已停止则忽略
      }
      layer.lfo.disconnect();
      layer.lfoGain.disconnect();
      layer.gainNode.disconnect();
      layer.oscillator.disconnect();
    }
    this.activeLayers = [];
  }

  /** 创建单个音层 */
  private createLayer(config: LayerConfig): ActiveLayer | null {
    if (!this.ctx || !this.masterGain || !this.convolver) return null;

    const oscillator = this.ctx.createOscillator();
    oscillator.type = config.type;
    oscillator.frequency.value = config.frequency;
    if (config.detune !== undefined) oscillator.detune.value = config.detune;

    // 滤波器
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = config.filterFreq ?? 2000;
    filter.Q.value = config.filterQ ?? 1;

    // LFO 调制（颤音/震音效果）
    const lfo = this.ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = config.lfoRate ?? 0.1;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = config.lfoDepth ?? 0.2;

    // 包络增益
    const envelopeGain = this.ctx.createGain();
    envelopeGain.gain.value = 0;

    // 连接图
    lfo.connect(lfoGain);
    lfoGain.connect(envelopeGain.gain);
    oscillator.connect(filter);
    filter.connect(envelopeGain);
    envelopeGain.connect(this.masterGain);
    envelopeGain.connect(this.convolver);

    // 启动并做渐入
    const now = this.ctx.currentTime;
    lfo.start(now);
    oscillator.start(now);
    envelopeGain.gain.setValueAtTime(0, now);
    envelopeGain.gain.linearRampToValueAtTime(config.gain, now + 1.5);

    return { oscillator, lfo, lfoGain, gainNode: filter };
  }

  /** 切换情绪音景 */
  setMood(mood: MoodType): void {
    if (!this._isInitialized || !this.ctx || !this.masterGain) {
      this._mood = mood;
      return;
    }
    if (mood === this._mood && this._isPlaying) return;

    this._mood = mood;
    const preset = MOOD_PRESETS[mood];
    const now = this.ctx.currentTime;

    // 更新主音量
    this.masterGain.gain.linearRampToValueAtTime(this._volume * preset.masterGain, now + 0.8);

    // 更新混响量
    if (this.convolver) {
      const reverbInput = this.convolver;
      // 找到连接到 convolver 的 gain（需要遍历，这里简化处理：直接重建）
      void reverbInput;
    }

    // 如果是静音模式，清理所有音层
    if (mood === 'silent') {
      this.fadeOutLayers();
      return;
    }

    // 重建音层
    this.clearLayers();
    for (const layerConfig of preset.layers) {
      const layer = this.createLayer(layerConfig);
      if (layer) this.activeLayers.push(layer);
    }

    if (!this._isPlaying) {
      this._isPlaying = true;
    }
  }

  /** 淡出所有音层 */
  private fadeOutLayers(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const layer of this.activeLayers) {
      try {
        layer.gainNode.gain.setValueAtTime(layer.gainNode.gain.value, now);
        layer.gainNode.gain.linearRampToValueAtTime(0, now + 0.5);
      } catch {
        // ignore
      }
    }
    setTimeout(() => this.clearLayers(), 600);
  }

  /** 设置音量 */
  setVolume(vol: number): void {
    this._volume = Math.max(0, Math.min(1, vol));
    if (this.masterGain && this.ctx) {
      const preset = MOOD_PRESETS[this._mood];
      this.masterGain.gain.linearRampToValueAtTime(
        this._volume * (preset?.masterGain ?? 0.15),
        this.ctx.currentTime + 0.1,
      );
    }
  }

  /** 开始播放当前情绪 */
  play(): void {
    if (!this._isInitialized || !this.ctx) return;
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    if (this._mood !== 'silent') {
      this.setMood(this._mood);
    }
    this._isPlaying = true;
  }

  /** 暂停 */
  pause(): void {
    this._isPlaying = false;
    this.fadeOutLayers();
    if (this.ctx && this.ctx.state === 'running') {
      void this.ctx.suspend();
    }
  }

  /** 恢复 */
  resume(): void {
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    this._isPlaying = true;
    if (this._mood !== 'silent') {
      this.setMood(this._mood);
    }
  }

  /** 播放短促音效（stiger）用于关键事件提醒 */
  playStinger(type: StingerType): void {
    if (!this.ctx || !this.masterGain || !this._isInitialized) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    switch (type) {
      case 'phase_change': {
        // 庄严钟声 — 阶段切换
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 220;
        const osc2 = ctx.createOscillator();
        osc2.type = 'sine';
        osc2.frequency.value = 330;
        const gain2 = ctx.createGain();
        gain2.gain.value = 0.5;
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.18, now + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
        gain2.gain.setValueAtTime(0, now);
        gain2.gain.linearRampToValueAtTime(0.12, now + 0.02);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 1.0);
        osc.connect(gain);
        osc2.connect(gain2);
        gain.connect(this.masterGain);
        gain2.connect(this.masterGain);
        osc.start(now);
        osc2.start(now);
        osc.stop(now + 1.3);
        osc2.stop(now + 1.1);
        break;
      }
      case 'clue_found': {
        // 清脆提示音 — 线索发现
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(660, now);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.08);
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.15, now + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start(now);
        osc.stop(now + 0.35);
        break;
      }
      case 'accusation': {
        // 紧张低音 — 指控时刻
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const filter = ctx.createBiquadFilter();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(120, now);
        osc.frequency.exponentialRampToValueAtTime(80, now + 0.3);
        filter.type = 'lowpass';
        filter.frequency.value = 600;
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.2, now + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.masterGain);
        osc.start(now);
        osc.stop(now + 0.55);
        break;
      }
      case 'vote_cast': {
        // 短促敲击声 — 投票
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 440;
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.14, now + 0.005);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start(now);
        osc.stop(now + 0.18);
        break;
      }
      case 'reveal': {
        // 高潮揭晓 — 铜管齐奏感
        const freqs = [261.63, 329.63, 392, 523.25];
        for (let i = 0; i < freqs.length; i++) {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sawtooth';
          const start = now + i * 0.06;
          osc.frequency.value = freqs[i];
          const filter = ctx.createBiquadFilter();
          filter.type = 'lowpass';
          filter.frequency.value = 2000;
          gain.gain.setValueAtTime(0, start);
          gain.gain.linearRampToValueAtTime(0.1 * (1 - i * 0.15), start + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.001, start + 1.0);
          osc.connect(filter);
          filter.connect(gain);
          gain.connect(this.masterGain);
          osc.start(start);
          osc.stop(start + 1.1);
        }
        break;
      }
      case 'death': {
        // 低沉下行 — 死亡/出局
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(200, now);
        osc.frequency.exponentialRampToValueAtTime(60, now + 0.6);
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.22, now + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start(now);
        osc.stop(now + 0.85);
        break;
      }
      case 'whisper': {
        // 风声/低语感 — 神秘氛围
        const bufferSize = ctx.sampleRate * 0.6;
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
          data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 2);
        }
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 800;
        filter.Q.value = 2;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.08, now + 0.1);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
        source.connect(filter);
        filter.connect(gain);
        gain.connect(this.masterGain);
        source.start(now);
        source.stop(now + 0.65);
        break;
      }
    }
  }

  /** 完全停止并清理 */
  dispose(): void {
    this.clearLayers();
    if (this.noiseSource) {
      try {
        this.noiseSource.stop();
      } catch {
        // ignore
      }
      this.noiseSource.disconnect();
    }
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
    this._isPlaying = false;
    this._isInitialized = false;
  }
}
