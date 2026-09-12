import type { CharacterGender } from '../../../ai-worker/src/game/speech-generator';

/**
 * TTS 语音选择器
 *
 * 问题背景：
 * 浏览器 SpeechSynthesis API 默认中文音色几乎全是女声。
 * 仅靠 pitch 微调（0.9 vs 1.2）不足以产生可信的男女声差异。
 *
 * 策略：
 * 1. 从系统可用语音中按性别偏好选择最佳匹配
 * 2. 男声候选：名称含男/低/Male/TTS_MS_zh-CN_MALE 的 zh 语音
 * 3. 女声候选：名称含女/高/Female/TTS_MS_zh-CN_FEMALE 的 zh 语音
 * 4. 默认兜底：任意 zh/zh-CN/zh-Hans 语音
 */

interface VoiceCandidate {
  voice: SpeechSynthesisVoice;
  score: number;
  gender: 'male' | 'female' | 'neutral';
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
    return { voice, score: 0, gender: 'neutral' };
  }

  let score = 50;
  let gender: 'male' | 'female' | 'neutral' = 'neutral';

  if (/男|低|male|deep|baritone|bass|t[ _]?s[ _]?ms[ _]?male|kangkang|yunxi|yunjian|xiaoxiao.*male|dawei/.test(name)) {
    gender = 'male';
    score = 90;
  } else if (/女|高|female|soprano|alto|t[ _]?s[ _]?ms[ _]?female|xiaoxiao|yaoyao|huihui|lili/.test(name)) {
    gender = 'female';
    score = 90;
  }

  if (lang === 'zh-cn' || lang === 'zh-hans' || lang === 'cmn-hans-cn') {
    score += 10;
  }

  if (voice.localService) {
    score += 5;
  }

  return { voice, score, gender };
}

export function selectVoiceForGender(
  gender: CharacterGender | undefined,
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

  const genderKey = gender === 'male' ? 'male' : gender === 'female' ? 'female' : 'neutral';

  const primary = candidates
    .filter((c) => c.gender === genderKey)
    .sort((a, b) => b.score - a.score);

  if (primary.length > 0) {
    return primary[0].voice;
  }

  const any = candidates.sort((a, b) => b.score - a.score);
  return any[0]?.voice ?? null;
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
