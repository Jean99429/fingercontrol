import { FingercontrolConfig } from '../types/config';

const STORAGE_KEY = 'fingercontrol_config_v2';

export const DEFAULT_CONFIG: FingercontrolConfig = {
  version: 2,
  mirroredVideo: true,
  trackingVisible: true,
  slots: [
    // Left Hand (4 fixed fingers)
    {
      id: 'left-index',
      hand: 'left',
      finger: 'index',
      enabled: true,
      text: 'SIGNAL',
    },
    {
      id: 'left-middle',
      hand: 'left',
      finger: 'middle',
      enabled: true,
      text: 'VECTOR',
    },
    {
      id: 'left-ring',
      hand: 'left',
      finger: 'ring',
      enabled: true,
      text: 'PULSE',
    },
    {
      id: 'left-pinky',
      hand: 'left',
      finger: 'pinky',
      enabled: true,
      text: 'FLOW',
    },
    // Right Hand (4 fixed fingers)
    {
      id: 'right-index',
      hand: 'right',
      finger: 'index',
      enabled: true,
      text: 'OBJECT',
    },
    {
      id: 'right-middle',
      hand: 'right',
      finger: 'middle',
      enabled: true,
      text: 'MOTION',
    },
    {
      id: 'right-ring',
      hand: 'right',
      finger: 'ring',
      enabled: true,
      text: 'SPACE',
    },
    {
      id: 'right-pinky',
      hand: 'right',
      finger: 'pinky',
      enabled: true,
      text: 'TIME',
    },
  ],
};

export function loadConfig(): FingercontrolConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.version === 2 && Array.isArray(parsed.slots) && parsed.slots.length === 8) {
      return parsed as FingercontrolConfig;
    }
  } catch (err) {
    console.warn('Failed to load configuration from localStorage, falling back to defaults:', err);
  }
  return DEFAULT_CONFIG;
}

export function saveConfig(config: FingercontrolConfig): void {
  try {
    // Only save serializable fields (strip File & AudioBuffer)
    const serializableSlots = config.slots.map((slot) => ({
      id: slot.id,
      hand: slot.hand,
      finger: slot.finger,
      enabled: slot.enabled,
      text: slot.text,
      audioFileName: slot.audioFileName,
    }));

    const serializableConfig = {
      version: 2,
      mirroredVideo: config.mirroredVideo,
      trackingVisible: config.trackingVisible,
      slots: serializableSlots,
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializableConfig));
  } catch (err) {
    console.warn('Failed to save configuration to localStorage:', err);
  }
}
