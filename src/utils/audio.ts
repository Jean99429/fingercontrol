// Web Audio API manager for decoding, previewing, triggering, and mixing real audio files.

class AudioManager {
  private ctx: AudioContext | null = null;
  private previewSource: AudioBufferSourceNode | null = null;
  private destinationNode: MediaStreamAudioDestinationNode | null = null;
  private activeSources: Set<AudioBufferSourceNode> = new Set();

  public initAudioContext(): AudioContext {
    if (!this.ctx) {
      const AudioCtxClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtxClass();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    if (!this.destinationNode && this.ctx) {
      this.destinationNode = this.ctx.createMediaStreamDestination();
    }
    return this.ctx;
  }

  public async resumeIfNeeded(): Promise<void> {
    const ctx = this.initAudioContext();
    if (ctx.state === 'suspended') {
      await ctx.resume().catch(() => {});
    }
  }

  public getAudioContext(): AudioContext {
    return this.initAudioContext();
  }

  public getMediaStream(): MediaStream | null {
    if (this.destinationNode) {
      return this.destinationNode.stream;
    }
    return null;
  }

  /**
   * Decode an uploaded File or ArrayBuffer into an AudioBuffer using Web Audio API
   */
  public async decodeAudioFile(file: File | ArrayBuffer): Promise<AudioBuffer> {
    const ctx = this.initAudioContext();
    if (ctx.state === 'suspended') {
      await ctx.resume().catch(() => {});
    }
    let arrayBuffer: ArrayBuffer;

    if (file instanceof File) {
      arrayBuffer = await file.arrayBuffer();
    } else {
      arrayBuffer = file;
    }

    // decodeAudioData consumes the buffer, so slice a copy to be safe
    const copy = arrayBuffer.slice(0);
    return await ctx.decodeAudioData(copy);
  }

  /**
   * Generate a clean synthetic sample AudioBuffer for testing
   */
  public createSampleAudioBuffer(pitchHz: number, durationSec: number = 0.45, type: 'synth' | 'punch' = 'synth'): AudioBuffer {
    const ctx = this.initAudioContext();
    const sampleRate = ctx.sampleRate;
    const numSamples = Math.floor(sampleRate * durationSec);
    const buffer = ctx.createBuffer(1, numSamples, sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      const env = Math.exp(-t * (type === 'punch' ? 9 : 5));
      const osc1 = Math.sin(2 * Math.PI * pitchHz * t);
      const osc2 = 0.4 * Math.sin(2 * Math.PI * (pitchHz * 1.5) * t);
      const osc3 = 0.2 * Math.sin(2 * Math.PI * (pitchHz * 2.0) * t);
      data[i] = (osc1 + osc2 + osc3) * env * 0.7;
    }

    return buffer;
  }

  /**
   * Play an AudioBuffer for preview in the setup UI
   */
  public playBuffer(buffer: AudioBuffer, onEnded?: () => void): void {
    this.stopPreview();
    const ctx = this.initAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const gainNode = ctx.createGain();
    gainNode.gain.value = 1.0;

    source.connect(gainNode);
    gainNode.connect(ctx.destination);

    source.onended = () => {
      if (this.previewSource === source) {
        this.previewSource = null;
      }
      onEnded?.();
    };

    this.previewSource = source;
    source.start(0);
  }

  /**
   * Stop any active setup preview audio
   */
  public stopPreview(): void {
    if (this.previewSource) {
      try {
        this.previewSource.stop();
        this.previewSource.disconnect();
      } catch {
        // Ignore if already stopped
      }
      this.previewSource = null;
    }
  }

  /**
   * Trigger a slot's audio once during real-time performance or video playback.
   * Outputs to both system speakers and MediaStreamDestination (for recording).
   */
  public triggerAudio(buffer: AudioBuffer, when: number = 0): AudioBufferSourceNode {
    const ctx = this.initAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const gainNode = ctx.createGain();
    gainNode.gain.value = 1.0;

    source.connect(gainNode);
    gainNode.connect(ctx.destination);

    if (this.destinationNode) {
      gainNode.connect(this.destinationNode);
    }

    this.activeSources.add(source);
    source.onended = () => {
      this.activeSources.delete(source);
      try {
        source.disconnect();
        gainNode.disconnect();
      } catch {
        // Ignore
      }
    };

    const startTime = when > 0 ? when : ctx.currentTime;
    source.start(startTime);
    return source;
  }

  /**
   * Speak text out loud using Web Speech Synthesis API
   */
  public speakText(text: string, onEnded?: () => void): void {
    if (!text || !text.trim()) return;

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel(); // Cancel queue to ensure instant response
        const utterance = new SpeechSynthesisUtterance(text.trim());
        utterance.rate = 1.1; // crisp and responsive
        utterance.pitch = 1.0;
        utterance.volume = 1.0;

        const voices = window.speechSynthesis.getVoices();
        if (voices && voices.length > 0) {
          const preferred =
            voices.find((v) => v.lang.startsWith('en') && !v.name.includes('Google')) ||
            voices.find((v) => v.lang.startsWith('en')) ||
            voices.find((v) => v.default) ||
            voices[0];
          if (preferred) utterance.voice = preferred;
        }

        if (onEnded) {
          utterance.onend = () => onEnded();
          utterance.onerror = () => onEnded();
        }

        window.speechSynthesis.speak(utterance);
      } catch (err) {
        console.warn('SpeechSynthesis error:', err);
        onEnded?.();
      }
    }
  }

  /**
   * Universal word trigger sound:
   * - If an audio buffer is present, play it through Web Audio API
   * - If not, speak out the word with SpeechSynthesis and play an acoustic synth chime
   */
  public triggerWordSound(text: string, buffer?: AudioBuffer, pitchHint: number = 440): void {
    if (buffer) {
      this.triggerAudio(buffer);
    } else {
      // Speak the word directly
      this.speakText(text);

      // Also generate instant harmonic click/tone into Web Audio graph & recording stream
      try {
        const toneBuffer = this.createSampleAudioBuffer(pitchHint, 0.25, 'punch');
        this.triggerAudio(toneBuffer);
      } catch (e) {
        console.warn('Tone trigger error:', e);
      }
    }
  }

  /**
   * Stop all currently playing audio sources
   */
  public stopAll(): void {
    this.stopPreview();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Ignore
      }
    }
    this.activeSources.forEach((src) => {
      try {
        src.stop();
        src.disconnect();
      } catch {
        // Ignore
      }
    });
    this.activeSources.clear();
  }
}

export const audioManager = new AudioManager();
