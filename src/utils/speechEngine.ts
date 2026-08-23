/**
 * Pure Real-Human Speech Synthesis Engine
 * Exact implementation matching the reference:
 * - window.speechSynthesis & SpeechSynthesisUtterance
 * - Curated real female & male voice pools
 * - Alternates female / male in display order
 * - Real human vocal pitch / rate curves
 * - Automatic "newjeans" -> "new jeans" phonetic replacement
 * - 450ms word cooldown & cancel-and-speak flow
 * - Two-Hand Heart sequential phrase speech
 * - Solid Chrome/Safari/Edge compatibility (fixes cancel race-condition & utterance GC)
 * - Zero instruments, zero oscillators, 100% real human voices
 */

import { ContentSlot } from '../types/config';

// Preferred Natural Human Voice Pools
export const PREFERRED_FEMALE_VOICES = [
  'Samantha',
  'Karen',
  'Moira',
  'Tessa',
  'Victoria',
  'Allison',
  'Ava',
  'Susan',
  'Zoe',
  'Kate',
  'Serena',
  'Fiona',
  'Google US English',
  'Microsoft Zira',
  'Microsoft Jenny',
];

export const PREFERRED_MALE_VOICES = [
  'Alex',
  'Daniel',
  'Aaron',
  'Fred',
  'Tom',
  'Arthur',
  'Oliver',
  'Gordon',
  'Nathan',
  'Rishi',
  'Lee',
  'Google UK English Male',
  'Microsoft David',
  'Microsoft Guy',
];

// Excluded Novelty Voice Substrings
export const NOVELTY_VOICE_EXCLUSIONS = [
  'bad news',
  'good news',
  'bahh',
  'bells',
  'boing',
  'bubbles',
  'cellos',
  'deranged',
  'jester',
  'organ',
  'superstar',
  'trinoids',
  'whisper',
  'wobble',
  'zarvox',
  'albert',
  'flo',
  'grandma',
  'grandpa',
  'eddy',
  'reed',
  'rocko',
  'sandy',
  'shelley',
  'junior',
];

export interface AssignedVoiceConfig {
  voiceName: string;
  isFemale: boolean;
  pitch: number;
  rate: number;
  volume: number;
}

export class SpeechEngine {
  private voices: SpeechSynthesisVoice[] = [];
  private voiceAssignments: Map<string, AssignedVoiceConfig> = new Map();

  // Strong utterance retention to prevent garbage-collection cutoffs
  private activeUtterances: Set<SpeechSynthesisUtterance> = new Set();

  // Cooldowns & state
  private lastSpoke: Map<string, number> = new Map();
  private phraseSpeaking: boolean = false;
  private lastHeartPhraseTime: number = 0;
  private heartPhraseTimeoutId: number | null = null;
  private isUnlocked: boolean = false;

  constructor() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      this.loadVoices();

      if (window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = () => {
          this.loadVoices();
        };
      }

      // Add user-gesture listeners to unlock audio/speech permissions
      const unlock = () => {
        this.unlockSpeech();
      };
      window.addEventListener('click', unlock, { passive: true });
      window.addEventListener('touchstart', unlock, { passive: true });
      window.addEventListener('keydown', unlock, { passive: true });
    }
  }

  /**
   * Load browser voices and filter out novelty/robotic novelty presets
   */
  public loadVoices(): SpeechSynthesisVoice[] {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return [];
    }

    try {
      const allVoices = window.speechSynthesis.getVoices();
      if (!allVoices || allVoices.length === 0) {
        return [];
      }

      // Filter: English language and not novelty
      const cleanEnglish = allVoices.filter((v) => {
        const langLower = (v.lang || '').toLowerCase();
        if (!langLower.startsWith('en')) return false;

        const nameLower = (v.name || '').toLowerCase();
        for (const bad of NOVELTY_VOICE_EXCLUSIONS) {
          if (nameLower.includes(bad)) return false;
        }
        return true;
      });

      if (cleanEnglish.length > 0) {
        this.voices = cleanEnglish;
      } else {
        const anyEnglish = allVoices.filter((v) => (v.lang || '').toLowerCase().startsWith('en'));
        this.voices = anyEnglish.length > 0 ? anyEnglish : allVoices;
      }

      return this.voices;
    } catch {
      return [];
    }
  }

  /**
   * Unlock speech synthesis on user interaction (Click / Touch)
   */
  public async unlockSpeech(): Promise<void> {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    try {
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
      this.loadVoices();
      this.isUnlocked = true;
    } catch (e) {
      console.warn('Speech unlock:', e);
    }
  }

  /**
   * Assign voices to slots in display order:
   * - even word index: female pool
   * - odd word index: male pool
   * - cycle through each pool
   * - prevent same voice consecutively
   * - calculate pitch/rate matching reference
   */
  public updateVoiceAssignments(slots: ContentSlot[]): void {
    if (this.voices.length === 0) {
      this.loadVoices();
    }

    const allVoices = this.voices.length > 0 ? this.voices : (typeof window !== 'undefined' && window.speechSynthesis?.getVoices()) || [];

    const availableFemale = allVoices.filter((v) =>
      PREFERRED_FEMALE_VOICES.some((pref) => v.name.toLowerCase().includes(pref.toLowerCase()))
    );
    const availableMale = allVoices.filter((v) =>
      PREFERRED_MALE_VOICES.some((pref) => v.name.toLowerCase().includes(pref.toLowerCase()))
    );

    const femalePool = availableFemale.length > 0 ? availableFemale : allVoices;
    const malePool = availableMale.length > 0 ? availableMale : allVoices;

    let lastAssignedName = '';
    let femaleIndex = 0;
    let maleIndex = 0;

    slots.forEach((slot, index) => {
      const isEven = index % 2 === 0;
      const isFemale = isEven;
      const targetPool = isFemale ? femalePool : malePool;

      let chosenVoice: SpeechSynthesisVoice | null = null;

      if (targetPool.length > 0) {
        let poolIdx = (isFemale ? femaleIndex : maleIndex) % targetPool.length;
        chosenVoice = targetPool[poolIdx];

        if (chosenVoice.name === lastAssignedName && targetPool.length > 1) {
          poolIdx = (poolIdx + 1) % targetPool.length;
          chosenVoice = targetPool[poolIdx];
        }

        if (isFemale) {
          femaleIndex++;
        } else {
          maleIndex++;
        }
      } else if (allVoices.length > 0) {
        chosenVoice = allVoices[index % allVoices.length];
      }

      lastAssignedName = chosenVoice?.name || '';

      // Female pitch: 1.08 + (index % 3) * 0.14
      // Male pitch:   0.80 + (index % 3) * 0.12
      const pitch = isFemale
        ? 1.08 + (index % 3) * 0.14
        : 0.80 + (index % 3) * 0.12;

      // Rate: 0.93 + (index % 2) * 0.06
      const rate = 0.93 + (index % 2) * 0.06;

      const assignment: AssignedVoiceConfig = {
        voiceName: chosenVoice?.name || '',
        isFemale,
        pitch,
        rate,
        volume: 1.0,
      };

      this.voiceAssignments.set(slot.id, assignment);
      this.voiceAssignments.set(`${slot.hand}-${slot.finger}`, assignment);
      this.voiceAssignments.set(String(index), assignment);
    });
  }

  /**
   * Replace "newjeans" with "new jeans" for accurate phonetic pronunciation
   */
  public normalizeSpeechText(text: string): string {
    if (!text) return '';
    return text.replace(/newjeans/gi, 'new jeans').trim();
  }

  /**
   * Resolve live voice instance from voice name
   */
  private resolveLiveVoice(voiceName: string): SpeechSynthesisVoice | null {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
    const all = window.speechSynthesis.getVoices();
    if (!all || all.length === 0) return null;

    if (voiceName) {
      const found = all.find((v) => v.name === voiceName);
      if (found) return found;
    }

    // Default to clean English voice if specific voice not found
    const en = all.find((v) => (v.lang || '').toLowerCase().startsWith('en'));
    return en || all[0] || null;
  }

  /**
   * Direct Pinch Trigger for single word:
   * - Enforces 450ms cooldown per slot
   * - Cancels previous speech
   * - Speaks human utterance immediately with real voice
   */
  public triggerWord(
    slotId: string,
    rawText: string,
    slotIndex: number = 0
  ): boolean {
    if (this.phraseSpeaking) {
      // Ignore individual pinch triggers while two-hand heart phrase is playing
      return false;
    }

    const text = this.normalizeSpeechText(rawText);
    if (!text) return false;

    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return false;
    }

    const now = performance.now();
    const lastTime = this.lastSpoke.get(slotId) || 0;
    if (now - lastTime < 450) {
      return false;
    }
    this.lastSpoke.set(slotId, now);

    // Cancel prior speech safely
    try {
      window.speechSynthesis.cancel();
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
    } catch (e) {
      console.warn('SpeechSynthesis cancel error:', e);
    }

    // Retrieve assigned human voice config
    let config = this.voiceAssignments.get(slotId);
    if (!config) {
      const isFemale = slotIndex % 2 === 0;
      config = {
        voiceName: '',
        isFemale,
        pitch: isFemale ? 1.08 + (slotIndex % 3) * 0.14 : 0.80 + (slotIndex % 3) * 0.12,
        rate: 0.93 + (slotIndex % 2) * 0.06,
        volume: 1.0,
      };
    }

    // Small micro-delay prevents Chrome bug where cancel() immediately cancels a synchronous speak()
    setTimeout(() => {
      try {
        if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
        }

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'en-US';

        const liveVoice = this.resolveLiveVoice(config.voiceName);
        if (liveVoice) {
          utterance.voice = liveVoice;
          if (liveVoice.lang) {
            utterance.lang = liveVoice.lang;
          }
        }

        utterance.pitch = config.pitch;
        utterance.rate = config.rate;
        utterance.volume = 1.0;

        // Keep reference in Set to prevent Chrome Garbage Collection mid-speech
        this.activeUtterances.add(utterance);

        utterance.onend = () => {
          this.activeUtterances.delete(utterance);
        };

        utterance.onerror = () => {
          this.activeUtterances.delete(utterance);
        };

        window.speechSynthesis.speak(utterance);

        // Resume check for Safari / Chrome background throttling
        if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
        }
      } catch (err) {
        console.warn('Speech speak error:', err);
      }
    }, 10);

    return true;
  }

  /**
   * Two-Hand Heart Gesture: Speak sequential phrase (all configured words in order)
   */
  public triggerHeartPhrase(slots: ContentSlot[], onCompleted?: () => void): boolean {
    const now = performance.now();
    if (this.phraseSpeaking) return false;
    if (now - this.lastHeartPhraseTime < 3500) return false;

    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return false;
    }

    const nonEmpties = slots
      .map((s, idx) => ({ slot: s, index: idx, text: this.normalizeSpeechText(s.text) }))
      .filter((item) => item.text.length > 0);

    if (nonEmpties.length === 0) return false;

    this.lastHeartPhraseTime = now;
    this.phraseSpeaking = true;

    // Safety timeout (9000ms)
    if (this.heartPhraseTimeoutId !== null) {
      clearTimeout(this.heartPhraseTimeoutId);
    }
    this.heartPhraseTimeoutId = window.setTimeout(() => {
      this.phraseSpeaking = false;
      this.heartPhraseTimeoutId = null;
      onCompleted?.();
    }, 9000);

    try {
      window.speechSynthesis.cancel();
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
    } catch {
      // ignore
    }

    let currentIndex = 0;

    const speakNext = () => {
      if (!this.phraseSpeaking || currentIndex >= nonEmpties.length) {
        this.phraseSpeaking = false;
        if (this.heartPhraseTimeoutId !== null) {
          clearTimeout(this.heartPhraseTimeoutId);
          this.heartPhraseTimeoutId = null;
        }
        onCompleted?.();
        return;
      }

      const item = nonEmpties[currentIndex];
      currentIndex++;

      const config = this.voiceAssignments.get(item.slot.id) || {
        voiceName: '',
        isFemale: item.index % 2 === 0,
        pitch: item.index % 2 === 0 ? 1.08 : 0.80,
        rate: 0.96,
        volume: 1.0,
      };

      try {
        if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
        }

        const utterance = new SpeechSynthesisUtterance(item.text);
        utterance.lang = 'en-US';

        const liveVoice = this.resolveLiveVoice(config.voiceName);
        if (liveVoice) {
          utterance.voice = liveVoice;
          if (liveVoice.lang) utterance.lang = liveVoice.lang;
        }

        utterance.pitch = config.pitch;
        utterance.rate = config.rate;
        utterance.volume = 1.0;

        this.activeUtterances.add(utterance);

        utterance.onend = () => {
          this.activeUtterances.delete(utterance);
          setTimeout(speakNext, 80);
        };

        utterance.onerror = () => {
          this.activeUtterances.delete(utterance);
          setTimeout(speakNext, 80);
        };

        window.speechSynthesis.speak(utterance);
      } catch {
        setTimeout(speakNext, 400);
      }
    };

    setTimeout(speakNext, 20);
    return true;
  }

  public isPhraseSpeaking(): boolean {
    return this.phraseSpeaking;
  }

  public stop(): void {
    this.phraseSpeaking = false;
    if (this.heartPhraseTimeoutId !== null) {
      clearTimeout(this.heartPhraseTimeoutId);
      this.heartPhraseTimeoutId = null;
    }
    this.activeUtterances.clear();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
    }
  }
}

export const speechEngine = new SpeechEngine();
