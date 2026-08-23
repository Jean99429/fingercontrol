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
      this.ctx.resume();
    }
    if (!this.destinationNode && this.ctx) {
      this.destinationNode = this.ctx.createMediaStreamDestination();
    }
    return this.ctx;
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
   * Play an AudioBuffer for preview in the setup UI
   */
  public playBuffer(buffer: AudioBuffer, onEnded?: () => void): void {
    this.stopPreview();
    const ctx = this.initAudioContext();

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
   * Stop all currently playing audio sources
   */
  public stopAll(): void {
    this.stopPreview();
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
