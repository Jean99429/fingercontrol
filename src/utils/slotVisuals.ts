import { Finger, Hand } from '../types/config';

export interface SlotVisual {
  color: string;
  className: string;
  fontFamily: string;
  fontWeight: number;
  fontStyle: 'normal' | 'italic';
}

export const SLOT_VISUALS: Record<Hand, Record<Finger, SlotVisual>> = {
  left: {
    pinky: { color: '#C77CFF', className: 'finger-type-instrument-serif', fontFamily: 'Instrument Serif', fontWeight: 400, fontStyle: 'italic' },
    ring: { color: '#E65100', className: 'finger-type-unbounded', fontFamily: 'Unbounded', fontWeight: 800, fontStyle: 'normal' },
    middle: { color: '#3CD9FF', className: 'finger-type-caveat', fontFamily: 'Caveat', fontWeight: 700, fontStyle: 'normal' },
    index: { color: '#FF5A5A', className: 'finger-type-archivo-black', fontFamily: 'Archivo Black', fontWeight: 900, fontStyle: 'normal' },
  },
  right: {
    index: { color: '#FF5A5A', className: 'finger-type-dm-mono', fontFamily: 'DM Mono', fontWeight: 500, fontStyle: 'normal' },
    middle: { color: '#FFB300', className: 'finger-type-space-grotesk', fontFamily: 'Space Grotesk', fontWeight: 700, fontStyle: 'normal' },
    ring: { color: '#3CD9FF', className: 'finger-type-bricolage', fontFamily: 'Bricolage Grotesque', fontWeight: 800, fontStyle: 'normal' },
    pinky: { color: '#5CFFB0', className: 'finger-type-playfair', fontFamily: 'Playfair Display', fontWeight: 600, fontStyle: 'italic' },
  },
};
