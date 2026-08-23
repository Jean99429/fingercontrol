class AudioManager {
  private ctx: AudioContext | null = null;
  private voices: SpeechSynthesisVoice[] = [];
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private currentAudioElement: HTMLAudioElement | null = null;
  private destinationNode: MediaStreamAudioDestinationNode | null = null;

  constructor() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      this.loadVoices();
      window.speechSynthesis.onvoiceschanged = () => this.loadVoices();
    }
  }

  private loadVoices() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      this.voices = window.speechSynthesis.getVoices();
    }
  }

  public getVoices(): SpeechSynthesisVoice[] {
    if (this.voices.length === 0 && typeof window !== 'undefined' && 'speechSynthesis' in window) {
      this.voices = window.speechSynthesis.getVoices();
    }
    return this.voices;
  }

  public initAudioContext(): AudioContext {
    if (!this.ctx) {
      const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtxClass();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    if (!this.destinationNode && this.ctx) {
      this.destinationNode = this.ctx.createMediaStreamDestination();
    }
    return this.ctx;
  }

  public getMediaStream(): MediaStream | null {
    if (this.destinationNode) {
      return this.destinationNode.stream;
    }
    return null;
  }

  // Play subtle minimalist interface sound effects
  public playFeedbackSound(type: 'approach' | 'arm' | 'activate' | 'release' | 'countdown' | 'shutter' | 'reset') {
    try {
      const ctx = this.initAudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.connect(gain);
      gain.connect(ctx.destination);
      if (this.destinationNode) {
        gain.connect(this.destinationNode);
      }

      const now = ctx.currentTime;

      if (type === 'activate') {
        // High-tech crisp sine blip
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.exponentialRampToValueAtTime(1320, now + 0.08);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        osc.start(now);
        osc.stop(now + 0.12);
      } else if (type === 'arm') {
        // Subtle soft low tick
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(440, now);
        gain.gain.setValueAtTime(0.04, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
        osc.start(now);
        osc.stop(now + 0.05);
      } else if (type === 'countdown') {
        // Precise countdown tick
        osc.type = 'sine';
        osc.frequency.setValueAtTime(990, now);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
        osc.start(now);
        osc.stop(now + 0.09);
      } else if (type === 'shutter') {
        // Shutter snap sound
        osc.type = 'square';
        osc.frequency.setValueAtTime(1200, now);
        osc.frequency.exponentialRampToValueAtTime(300, now + 0.15);
        gain.gain.setValueAtTime(0.25, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc.start(now);
        osc.stop(now + 0.18);
      } else if (type === 'reset') {
        // Descending low tone
        osc.type = 'sine';
        osc.frequency.setValueAtTime(520, now);
        osc.frequency.exponentialRampToValueAtTime(180, now + 0.16);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
        osc.start(now);
        osc.stop(now + 0.16);
      }
    } catch (e) {
      console.warn('Audio playback error:', e);
    }
  }

  // Play SpeechSynthesis TTS with controls
  public speakText(
    text: string,
    options: {
      voiceURI?: string;
      rate?: number;
      volume?: number;
      pitch?: number;
    } = {}
  ): Promise<void> {
    return new Promise((resolve) => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window) || !text.trim()) {
        resolve();
        return;
      }

      // Cancel previous utterance
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = options.rate ?? 1.0;
      utterance.volume = options.volume ?? 0.9;
      utterance.pitch = options.pitch ?? 1.0;

      if (options.voiceURI) {
        const matchingVoice = this.voices.find((v) => v.voiceURI === options.voiceURI);
        if (matchingVoice) {
          utterance.voice = matchingVoice;
        }
      }

      utterance.onend = () => {
        this.currentUtterance = null;
        resolve();
      };
      utterance.onerror = () => {
        this.currentUtterance = null;
        resolve();
      };

      this.currentUtterance = utterance;
      window.speechSynthesis.speak(utterance);
    });
  }

  // Play local audio data URL
  public playAudioFile(dataUrl: string, volume: number = 0.9): Promise<void> {
    return new Promise((resolve) => {
      if (!dataUrl) {
        resolve();
        return;
      }
      this.stopAudio();
      try {
        const audio = new Audio(dataUrl);
        audio.volume = Math.max(0, Math.min(1, volume));
        this.currentAudioElement = audio;

        audio.onended = () => {
          this.currentAudioElement = null;
          resolve();
        };
        audio.onerror = () => {
          this.currentAudioElement = null;
          resolve();
        };
        audio.play().catch(() => resolve());
      } catch {
        resolve();
      }
    });
  }

  public stopAudio(): void {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    this.currentUtterance = null;
    if (this.currentAudioElement) {
      this.currentAudioElement.pause();
      this.currentAudioElement.currentTime = 0;
      this.currentAudioElement = null;
    }
  }
}

export const audioManager = new AudioManager();
