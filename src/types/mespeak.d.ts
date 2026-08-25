declare module 'mespeak' {
  interface SpeakOptions {
    amplitude?: number;
    pitch?: number;
    speed?: number;
    wordgap?: number;
    rawdata?: boolean | string;
  }
  interface MeSpeak {
    loadConfig(data: unknown): void;
    loadVoice(data: unknown): void;
    speak(text: string, options?: SpeakOptions): ArrayBuffer | string | number[] | void;
    resetQueue(): void;
    stop(): void;
  }
  const meSpeak: MeSpeak;
  export default meSpeak;
}

declare module 'mespeak/src/mespeak_config.json' {
  const config: unknown;
  export default config;
}

declare module 'mespeak/voices/en/en-us.json' {
  const voice: unknown;
  export default voice;
}
