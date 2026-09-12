import type { VoiceProfile } from '../../../ai-worker/src/game/speech-generator';

/**
 * TTS 语音选择器
 *
 * 问题背景：
 * 浏览器 SpeechSynthesis API 默认中文音色几乎全是女声。
 * 仅靠 pitch 微调不足以产生可信的男女声差异。
 *
 * 策略：
 * 1. 从系统可用语音中按性别偏好选择最佳匹配
 * 2. 男声候选：名称含男/低/Male 的 zh 语音
 * 3. 女声候选：名称含女/高/Female 的 zh 语音
 * 4. 年龄/身高/体重影响排序（年幼→偏高 pitch 音色，年长→偏低 pitch 音色）
 * 5. 默认兜底：任意 zh 语音
 */

interface VoiceCandidate {
  voice: SpeechSynthesisVoice;
  score: number;
  gender: 'male' | 'female' | 'neutral';
  pitchHint: number; // 音色本身的相对音高倾向（1.0 为中性）
}

let cachedVoices: SpeechSynthesisVoice[] | null = null;
let lastFetchTime = 0;
const CACHE_TTL = 5000;

function getAvailableVoices(): SpeechSynthesisVoice[] {
  if (typeof window === 'undefined' || !window.speechSynthesis) return [];

  const now = Date.now();
  if (cachedVoices && now - lastFetchTime < CACHE_TTL) {
    return cachedVoices;
  }

  cachedVoices = window.speechSynthesis.getVoices();
  lastFetchTime = now;
  return cachedVoices;
}

function classifyVoice(voice: SpeechSynthesisVoice): VoiceCandidate {
  const name = (voice.name + ' ' + voice.voiceURI).toLowerCase();
  const lang = voice.lang.toLowerCase();

  if (!lang.startsWith('zh') && lang !== 'cmn-hans' && lang !== 'cmn-hant') {
    return { voice, score: 0, gender: 'neutral', pitchHint: 1.0 };
  }

  let score = 50;
  let gender: 'male' | 'female' | 'neutral' = 'neutral';
  let pitchHint = 1.0;

  if (/男|低|male|deep|baritone|bass|t[ _]?s[ _]?ms[ _]?male|kangkang|yunxi|yunjian|dawei/.test(name)) {
    gender = 'male';
    score = 90;
    pitchHint = 0.85;
  } else if (/女|高|female|soprano|alto|t[ _]?s[ _]?ms[ _]?female|xiaoxiao|yaoyao|huihui|lili/.test(name)) {
    gender = 'female';
    score = 90;
    pitchHint = 1.15;
  } else if (/kid|child|小孩|儿童|少年|小/.test(name)) {
    gender = 'neutral';
    score = 60;
    pitchHint = 1.3;
  } else if (/老|elder|长者|爷爷|奶奶/.test(name)) {
    gender = 'neutral';
    score = 60;
    pitchHint = 0.7;
  }

  if (lang === 'zh-cn' || lang === 'zh-hans' || lang === 'cmn-hans-cn') {
    score += 10;
  }

  if (voice.localService) {
    score += 5;
  }

  return { voice, score, gender, pitchHint };
}

export function selectVoiceForProfile(
  profile: VoiceProfile | undefined,
): SpeechSynthesisVoice | null {
  const voices = getAvailableVoices();
  if (voices.length === 0) return null;

  const candidates = voices
    .filter((v) => {
      const lang = v.lang.toLowerCase();
      return lang.startsWith('zh') || lang === 'cmn-hans' || lang === 'cmn-hant';
    })
    .map(classifyVoice)
    .filter((c) => c.score > 0);

  if (candidates.length === 0) {
    return voices.find((v) => {
      const lang = v.lang.toLowerCase();
      return lang.startsWith('zh');
    }) ?? null;
  }

  const genderKey = profile?.gender === 'male' ? 'male' : profile?.gender === 'female' ? 'female' : 'neutral';

  // 按性别筛选
  let filtered = candidates.filter((c) => c.gender === genderKey);
  if (filtered.length === 0) {
    filtered = candidates;
  }

  // 如果有多于一个候选，用年龄/身高/体重进一步排序
  if (filtered.length > 1 && profile) {
    const { age, height, weight } = profile;

    // 计算目标 pitchHint（基于生理特征推断期望音色）
    let targetPitchHint = 1.0;
    if (age !== undefined && !isNaN(age)) {
      if (age < 18) targetPitchHint += 0.15;
      else if (age < 30) targetPitchHint += 0.05;
      else if (age > 60) targetPitchHint -= 0.15;
      else if (age > 50) targetPitchHint -= 0.08;
      else if (age > 40) targetPitchHint -= 0.04;
    }
    if (height !== undefined && !isNaN(height)) {
      if (height > 180) targetPitchHint -= 0.06;
      else if (height > 175) targetPitchHint -= 0.03;
      else if (height < 160) targetPitchHint += 0.05;
      else if (height < 165) targetPitchHint += 0.03;
    }
    if (weight !== undefined && !isNaN(weight)) {
      if (weight > 85) targetPitchHint -= 0.04;
      else if (weight > 75) targetPitchHint -= 0.02;
      else if (weight < 50) targetPitchHint += 0.04;
      else if (weight < 55) targetPitchHint += 0.02;
    }

    // 按与目标 pitchHint 的距离排序（距离越小越匹配）
    filtered.sort((a, b) => {
      const distA = Math.abs(a.pitchHint - targetPitchHint);
      const distB = Math.abs(b.pitchHint - targetPitchHint);
      if (Math.abs(distA - distB) > 0.05) return distA - distB;
      return b.score - a.score;
    });

    return filtered[0].voice;
  }

  // 只有一个候选或没有生理特征时按分数排序
  filtered.sort((a, b) => b.score - a.score);
  return filtered[0]?.voice ?? null;
}

/** 旧版兼容入口 */
export function selectVoiceForGender(
  gender: 'male' | 'female' | 'unknown' | undefined,
): SpeechSynthesisVoice | null {
  return selectVoiceForProfile({ gender });
}

export function hasMaleVoice(): boolean {
  const voices = getAvailableVoices();
  return voices.some((v) => {
    const name = (v.name + ' ' + v.voiceURI).toLowerCase();
    const lang = v.lang.toLowerCase();
    return lang.startsWith('zh') && /男|male|deep|baritone/.test(name);
  });
}

export function refreshVoices(): void {
  cachedVoices = null;
  lastFetchTime = 0;
}
