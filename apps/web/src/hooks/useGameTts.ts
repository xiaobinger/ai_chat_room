import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import {
  computeVoiceParams,
  type VoiceContext,
  type VoiceProfile,
} from '../../../ai-worker/src/game/speech-generator';
import { selectVoiceForProfile } from '../components/tts-voice-selector';
import type { GameViewState } from '../components/game-parts';

export interface SpeechEntry {
  playerId: string;
  content: string;
}

export interface UseGameTtsOptions {
  view: GameViewState;
  myPlayerId: string | null;
  speechLog: SpeechEntry[];
  phaseContextMap: Record<string, VoiceContext>;
}

export interface UseGameTtsReturn {
  autoPlay: boolean;
  toggleAutoPlay: () => void;
  ttsText: string | null;
  isSpeaking: boolean;
  playTts: (text: string, profile: VoiceProfile, e?: MouseEvent) => void;
  stopSpeaking: () => void;
  getCharacterInfo: (playerId: string) => VoiceProfile;
  currentContext: VoiceContext;
}

function speakText(
  text: string,
  profile: VoiceProfile | undefined,
  context: VoiceContext | undefined,
  onEnd?: () => void,
): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'zh-CN';
  const selectedVoice = selectVoiceForProfile(profile);
  if (selectedVoice) {
    utterance.voice = selectedVoice;
  }
  const { pitch, rate, volume } = computeVoiceParams(profile, context);
  utterance.pitch = pitch;
  utterance.rate = rate;
  utterance.volume = volume;
  if (onEnd) {
    utterance.onend = onEnd;
    utterance.onerror = onEnd;
  }
  window.speechSynthesis.speak(utterance);
}

function doStopSpeaking(): void {
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}

export function useGameTts({ view, myPlayerId, speechLog, phaseContextMap }: UseGameTtsOptions): UseGameTtsReturn {
  const [ttsText, setTtsText] = useState<string | null>(null);
  const isSpeaking = ttsText !== null;
  const [autoPlay, setAutoPlay] = useState(true);
  const autoPlayedRef = useRef<Set<number>>(new Set());

  const currentContext: VoiceContext = phaseContextMap[view.phase] ?? 'calm';

  const getCharacterInfo = useCallback((playerId: string): VoiceProfile => {
    const player = view.players.find((p) => p.playerId === playerId);
    return {
      gender: player?.character?.gender,
      age: player?.character?.age,
      height: player?.character?.height,
      weight: player?.character?.weight,
      personality: player?.character?.personality ?? '',
    };
  }, [view.players]);

  const stopSpeaking = useCallback(() => {
    doStopSpeaking();
    setTtsText(null);
  }, []);

  const playTts = useCallback((text: string, profile: VoiceProfile, e?: MouseEvent) => {
    e?.stopPropagation();
    if (isSpeaking) {
      stopSpeaking();
      return;
    }
    setTtsText(text);
    speakText(text, profile, currentContext, () => setTtsText(null));
  }, [isSpeaking, stopSpeaking, currentContext]);

  useEffect(() => {
    if (!autoPlay) return;
    if (speechLog.length === 0) return;
    const lastEntry = speechLog[speechLog.length - 1];
    const lastIndex = speechLog.length - 1;
    if (autoPlayedRef.current.has(lastIndex)) return;
    if (lastEntry.playerId === myPlayerId) return;
    autoPlayedRef.current.add(lastIndex);
    const profile = getCharacterInfo(lastEntry.playerId);
    setTtsText(lastEntry.content);
    speakText(lastEntry.content, profile, currentContext, () => setTtsText(null));
  }, [speechLog, autoPlay, myPlayerId, currentContext, getCharacterInfo]);

  const toggleAutoPlay = useCallback(() => {
    setAutoPlay((prev) => {
      const next = !prev;
      if (next) {
        autoPlayedRef.current.clear();
      } else {
        doStopSpeaking();
        setTtsText(null);
      }
      return next;
    });
  }, []);

  useEffect(() => () => doStopSpeaking(), []);

  return {
    autoPlay,
    toggleAutoPlay,
    ttsText,
    isSpeaking,
    playTts,
    stopSpeaking,
    getCharacterInfo,
    currentContext,
  };
}
