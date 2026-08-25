import { KokoroTTS } from 'kokoro-js';
import { ContentSlot } from '../types/config';
import { audioManager } from './audio';

type KokoroVoice =
  | 'af_heart'
  | 'af_bella'
  | 'af_nicole'
  | 'af_sarah'
  | 'am_michael'
  | 'am_fenrir'
  | 'am_puck'
  | 'bm_fable';

interface AssignedVoiceConfig {
  voice: KokoroVoice;
  speed: number;
}

const FEMALE_VOICES: KokoroVoice[] = ['af_heart', 'af_bella', 'af_nicole', 'af_sarah'];
const MALE_VOICES: KokoroVoice[] = ['am_michael', 'am_fenrir', 'am_puck', 'bm_fable'];
const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';

/** Natural neural TTS whose generated buffers are audible and exportable. */
export class SpeechEngine {
  private modelPromise: Promise<KokoroTTS> | null = null;
  private assignments = new Map<string, AssignedVoiceConfig>();
  private audioCache = new Map<string, Promise<AudioBuffer>>();
  private lastSpoke = new Map<string, number>();
  private phraseSpeaking = false;
  private phraseTimeout: number | null = null;
  private playbackEpoch = 0;
  private modelReady = false;
  private useNeuralAudio = false;

  public loadVoices(): SpeechSynthesisVoice[] {
    void this.loadModel();
    return [];
  }

  private loadModel(): Promise<KokoroTTS> {
    if (!this.modelPromise) {
      this.modelPromise = KokoroTTS.from_pretrained(MODEL_ID, {
        dtype: 'q8',
        device: 'wasm',
      }).then((model) => {
        this.modelReady = true;
        return model;
      }).catch((error) => {
        this.modelPromise = null;
        this.modelReady = false;
        throw error;
      });
    }
    return this.modelPromise;
  }

  public async unlockSpeech(): Promise<void> {
    await audioManager.resumeIfNeeded();
    if ('speechSynthesis' in window) {
      window.speechSynthesis.resume();
      const unlock = new SpeechSynthesisUtterance(' ');
      unlock.volume = 0;
      window.speechSynthesis.speak(unlock);
    }
    void this.loadModel();
  }

  private speakSystem(text: string, slotIndex: number): void {
    if (!('speechSynthesis' in window)) return;
    const femaleNames = ['Samantha', 'Karen', 'Moira', 'Tessa', 'Victoria', 'Ava'];
    const maleNames = ['Alex', 'Daniel', 'Aaron', 'Fred', 'Tom', 'Arthur', 'Oliver'];
    const wanted = slotIndex % 2 === 0 ? femaleNames : maleNames;
    const voices = window.speechSynthesis.getVoices().filter((voice) => /^en/i.test(voice.lang));
    const voice = wanted
      .map((name) => voices.find((candidate) => candidate.name.toLowerCase().startsWith(name.toLowerCase())))
      .find(Boolean) || voices[slotIndex % Math.max(1, voices.length)];
    const utterance = new SpeechSynthesisUtterance(text);
    if (voice) utterance.voice = voice;
    utterance.lang = voice?.lang || 'en-US';
    utterance.pitch = slotIndex % 2 === 0 ? 1.08 + (slotIndex % 3) * 0.14 : 0.8 + (slotIndex % 3) * 0.12;
    utterance.rate = 0.93 + (slotIndex % 2) * 0.06;
    utterance.volume = 1;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }

  public updateVoiceAssignments(slots: ContentSlot[]): void {
    slots.forEach((slot, index) => {
      const female = index % 2 === 0;
      const pool = female ? FEMALE_VOICES : MALE_VOICES;
      const assignment = { voice: pool[Math.floor(index / 2) % pool.length], speed: female ? 1.02 : 0.98 };
      this.assignments.set(slot.id, assignment);
      this.assignments.set(`${slot.hand}-${slot.finger}`, assignment);
      this.assignments.set(String(index), assignment);
    });
    void this.prewarm(slots);
  }

  public normalizeSpeechText(text: string): string {
    return text ? text.replace(/newjeans/gi, 'new jeans').trim() : '';
  }

  private getAssignment(slotId: string, index: number): AssignedVoiceConfig {
    return this.assignments.get(slotId) || {
      voice: index % 2 === 0 ? 'af_heart' : 'am_michael',
      speed: index % 2 === 0 ? 1.02 : 0.98,
    };
  }

  private synthesize(text: string, assignment: AssignedVoiceConfig): Promise<AudioBuffer> {
    const key = `${text.toLowerCase()}|${assignment.voice}|${assignment.speed}`;
    const cached = this.audioCache.get(key);
    if (cached) return cached;

    const generated = (async () => {
      const tts = await this.loadModel();
      const raw = await tts.generate(text, { voice: assignment.voice, speed: assignment.speed });
      const ctx = audioManager.getAudioContext();
      const buffer = ctx.createBuffer(1, raw.audio.length, raw.sampling_rate);
      buffer.copyToChannel(new Float32Array(raw.audio), 0);
      return buffer;
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
        await this.synthesize(text, this.getAssignment(slot.id, index));
      } catch (error) {
        console.error('Kokoro preload failed:', error);
        return;
      }
    }
  }

  public async prepare(slots: ContentSlot[]): Promise<void> {
    await this.prewarm(slots);
  }

  public setUseNeuralAudio(enabled: boolean): void {
    this.useNeuralAudio = enabled;
  }

  public triggerWord(slotId: string, rawText: string, slotIndex = 0): boolean {
    if (this.phraseSpeaking) return false;
    const text = this.normalizeSpeechText(rawText);
    if (!text) return false;
    const now = performance.now();
    if (now - (this.lastSpoke.get(slotId) || 0) < 450) return false;
    this.lastSpoke.set(slotId, now);
    const epoch = this.playbackEpoch;

    // Preview and setup always mirror the reference site's immediate system
    // voices. Neural buffers are reserved for the downloadable video mix.
    if (!this.useNeuralAudio) {
      this.speakSystem(text, slotIndex);
      return true;
    }

    void (async () => {
      try {
        await audioManager.resumeIfNeeded();
        const buffer = await this.synthesize(text, this.getAssignment(slotId, slotIndex));
        if (epoch === this.playbackEpoch) audioManager.triggerAudio(buffer);
      } catch (error) {
        console.error('Kokoro speech failed:', error);
      }
    })();
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
    const epoch = this.playbackEpoch;

    void (async () => {
      try {
        await audioManager.resumeIfNeeded();
        const ctx = audioManager.getAudioContext();
        let startAt = ctx.currentTime;
        for (const item of words) {
          const buffer = await this.synthesize(item.text, this.getAssignment(item.slot.id, item.index));
          if (epoch !== this.playbackEpoch) return;
          audioManager.triggerAudio(buffer, startAt);
          startAt += buffer.duration + 0.08;
        }
        this.phraseTimeout = window.setTimeout(() => {
          this.phraseSpeaking = false;
          this.phraseTimeout = null;
          onCompleted?.();
        }, Math.max(0, (startAt - ctx.currentTime) * 1000));
      } catch (error) {
        console.error('Kokoro phrase failed:', error);
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
    this.playbackEpoch++;
    this.phraseSpeaking = false;
    if (this.phraseTimeout !== null) window.clearTimeout(this.phraseTimeout);
    this.phraseTimeout = null;
    audioManager.stopAll();
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }
}

export const speechEngine = new SpeechEngine();
