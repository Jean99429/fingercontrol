import { FingercontrolConfig } from '../types/config';

const STORAGE_KEY = 'fingercontrol_config_v1';

export const DEFAULT_CONFIG: FingercontrolConfig = {
  version: 1,
  leftSlots: [
    {
      id: 'left-slot-1',
      enabled: true,
      finger: 'index',
      text: 'TEXT 01',
      audioMode: 'tts',
      ttsRate: 1.0,
      ttsVolume: 0.9,
      ttsPitch: 1.0,
    },
    {
      id: 'left-slot-2',
      enabled: true,
      finger: 'middle',
      text: 'TEXT 02',
      audioMode: 'tts',
      ttsRate: 1.0,
      ttsVolume: 0.9,
      ttsPitch: 1.0,
    },
    {
      id: 'left-slot-3',
      enabled: true,
      finger: 'ring',
      text: 'TEXT 03',
      audioMode: 'tts',
      ttsRate: 1.0,
      ttsVolume: 0.9,
      ttsPitch: 1.0,
    },
    {
      id: 'left-slot-4',
      enabled: true,
      finger: 'pinky',
      text: 'TEXT 04',
      audioMode: 'tts',
      ttsRate: 1.0,
      ttsVolume: 0.9,
      ttsPitch: 1.0,
    },
  ],
  rightSlots: [
    {
      id: 'right-slot-1',
      enabled: true,
      finger: 'index',
      effectId: 'particle-disassembly',
    },
    {
      id: 'right-slot-2',
      enabled: true,
      finger: 'middle',
      effectId: 'ascii-dither',
    },
    {
      id: 'right-slot-3',
      enabled: true,
      finger: 'ring',
      effectId: 'rgb-time-echo',
    },
    {
      id: 'right-slot-4',
      enabled: true,
      finger: 'pinky',
      effectId: 'glyph-dissolve',
    },
  ],
  soundEnabled: true,
  trackingVisible: true,
};

export function loadConfig(): FingercontrolConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.version === 1 && Array.isArray(parsed.leftSlots) && Array.isArray(parsed.rightSlots)) {
      return parsed as FingercontrolConfig;
    }
  } catch (err) {
    console.warn('Failed to load configuration from localStorage, falling back to defaults:', err);
  }
  return DEFAULT_CONFIG;
}

export function saveConfig(config: FingercontrolConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch (err) {
    console.warn('Failed to save configuration to localStorage:', err);
  }
}
