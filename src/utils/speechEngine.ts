import meSpeak from 'mespeak';
import meSpeakConfig from 'mespeak/src/mespeak_config.json';
import enUsVoice from 'mespeak/voices/en/en-us.json';
import { ContentSlot } from '../types/config';
import { audioManager } from './audio';

export interface AssignedVoiceConfig {
  pitch: number;
  speed: number;
}

/** Generates offline WAV speech and routes it through the app's Web Audio graph. */
export class SpeechEngine {
  private voiceAssignments = new Map<string, AssignedVoiceConfig>();
  private audioCache = new Map<string, Promise<AudioBuffer>>();
  private lastSpoke = new Map<string, number>();
  private phraseSpeaking = false;
  private heartPhraseTimeoutId: number | null = null;
  private initialized = false;

  constructor() {
    this.initializeOfflineVoice();
  }

  private initializeOfflineVoice(): void {
    if (this.initialized) return;
    try {
      meSpeak.loadConfig(meSpeakConfig);
      meSpeak.loadVoice(enUsVoice);
      this.initialized = true;
    } catch (error) {
      console.error('Offline voice initialization failed:', error);
    }
  }

  public loadVoices(): SpeechSynthesisVoice[] {
    this.initializeOfflineVoice();
    return [];
  }

  public async unlockSpeech(): Promise<void> {
    this.initializeOfflineVoice();
    await audioManager.resumeIfNeeded();
  }

  public updateVoiceAssignments(slots: ContentSlot[]): void {
    slots.forEach((slot, index) => {
      const assignment = {
        pitch: index % 2 === 0 ? 58 + (index % 3) * 4 : 38 + (index % 3) * 4,
        speed: 168 + (index % 2) * 8,
      };
      this.voiceAssignments.set(slot.id, assignment);
      this.voiceAssignments.set(`${slot.hand}-${slot.finger}`, assignment);
      this.voiceAssignments.set(String(index), assignment);
    });
    void this.prewarm(slots);
  }

  public normalizeSpeechText(text: string): string {
    return text ? text.replace(/newjeans/gi, 'new jeans').trim() : '';
  }

  private getConfig(slotId: string, slotIndex: number): AssignedVoiceConfig {
    return this.voiceAssignments.get(slotId) || {
      pitch: slotIndex % 2 === 0 ? 58 : 38,
      speed: 172,
    };
  }

  private synthesize(text: string, config: AssignedVoiceConfig): Promise<AudioBuffer> {
    this.initializeOfflineVoice();
    const key = `${text.toLowerCase()}|${config.pitch}|${config.speed}`;
    const cached = this.audioCache.get(key);
    if (cached) return cached;

    const generated = (async () => {
      const wav = meSpeak.speak(text, {
        amplitude: 115,
        pitch: config.pitch,
        speed: config.speed,
        wordgap: 0,
        rawdata: true,
      });
      if (!(wav instanceof ArrayBuffer)) throw new Error('No WAV data returned');
      return audioManager.decodeAudioFile(wav);
    })();
    this.audioCache.set(key, generated);
    generated.catch(() => this.audioCache.delete(key));
    return generated;
  }

  private async prewarm(slots: ContentSlot[]): Promise<void> {
    for (let index = 0; index < slots.length; index++) {
      const slot = slots[index];
      const text = this.normalizeSpeechText(slot.text);
      if (!text) continue;
      try {
        await this.synthesize(text, this.getConfig(slot.id, index));
      } catch (error) {
        console.warn('Speech cache failed:', error);
      }
    }
  }

  private async playOffline(text: string, config: AssignedVoiceConfig): Promise<void> {
    await audioManager.resumeIfNeeded();
    audioManager.triggerAudio(await this.synthesize(text, config));
  }

  public triggerWord(slotId: string, rawText: string, slotIndex = 0): boolean {
    if (this.phraseSpeaking) return false;
    const text = this.normalizeSpeechText(rawText);
    if (!text) return false;
    const now = performance.now();
    const lastTime = this.lastSpoke.get(slotId) || 0;
    if (now - lastTime < 450) return false;
    this.lastSpoke.set(slotId, now);
    void this.playOffline(text, this.getConfig(slotId, slotIndex)).catch((error) => {
      console.error('Offline speech playback failed:', error);
    });
    return true;
  }

  public resetForPlayback(): void {
    this.stop();
    this.lastSpoke.clear();
  }

  public triggerHeartPhrase(slots: ContentSlot[], onCompleted?: () => void): boolean {
    const words = slots
      .map((slot, index) => ({ slot, index, text: this.normalizeSpeechText(slot.text) }))
      .filter((item) => item.text.length > 0);
    if (this.phraseSpeaking || words.length === 0) return false;
    this.phraseSpeaking = true;

    void (async () => {
      try {
        await audioManager.resumeIfNeeded();
        const ctx = audioManager.getAudioContext();
        let startAt = ctx.currentTime;
        for (const item of words) {
          if (!this.phraseSpeaking) return;
          const buffer = await this.synthesize(item.text, this.getConfig(item.slot.id, item.index));
          audioManager.triggerAudio(buffer, startAt);
          startAt += buffer.duration + 0.08;
        }
        this.heartPhraseTimeoutId = window.setTimeout(() => {
          this.phraseSpeaking = false;
          this.heartPhraseTimeoutId = null;
          onCompleted?.();
        }, Math.max(0, (startAt - ctx.currentTime) * 1000));
      } catch (error) {
        console.error('Offline phrase playback failed:', error);
        this.phraseSpeaking = false;
        onCompleted?.();
      }
    })();
    return true;
  }

  public isPhraseSpeaking(): boolean {
    return this.phraseSpeaking;
  }

  public stop(): void {
    this.phraseSpeaking = false;
    if (this.heartPhraseTimeoutId !== null) {
      window.clearTimeout(this.heartPhraseTimeoutId);
      this.heartPhraseTimeoutId = null;
    }
    audioManager.stopAll();
    try {
      meSpeak.resetQueue();
      meSpeak.stop();
    } catch {
      // Web Audio is the authoritative playback path.
    }
  }
}

export const speechEngine = new SpeechEngine();
