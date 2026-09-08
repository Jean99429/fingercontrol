import React, { useRef } from 'react';
import { AlertCircle, Camera, Check, LoaderCircle, Play, Upload, Video, Volume2, X } from 'lucide-react';
import { FingercontrolConfig, Finger, Hand } from '../types/config';
import { speechEngine } from '../utils/speechEngine';
import { SLOT_VISUALS } from '../utils/slotVisuals';

interface SetupScreenProps {
  config: FingercontrolConfig;
  onUpdateConfig: (newConfig: FingercontrolConfig) => void;
  inputMode: 'CAMERA' | 'UPLOAD_VIDEO';
  onChangeInputMode: (mode: 'CAMERA' | 'UPLOAD_VIDEO') => void;
  videoDevices: MediaDeviceInfo[];
  selectedDeviceId: string;
  onSelectDeviceId: (id: string) => void;
  onStartCamera: () => void;
  displayVideoFile: File | null;
  trackingVideoFile: File | null;
  displayVideoMeta: { duration: number; width: number; height: number } | null;
  trackingVideoMeta: { duration: number; width: number; height: number } | null;
  onSelectDisplayVideo: (file: File) => void;
  onSelectTrackingVideo: (file: File | null) => void;
  onStartAnalyzeVideo: () => void;
  isAnalyzing: boolean;
  analysisProgress: number;
  analysisStatus: string;
  errorMessage: string | null;
}

const FINGERS: Finger[] = ['pinky', 'ring', 'middle', 'index'];

const FINGER_LABELS: Record<Finger, string> = { pinky: 'Pinky', ring: 'Ring', middle: 'Middle', index: 'Index' };

const getSlotText = (config: FingercontrolConfig, hand: Hand, finger: Finger) =>
  config.slots.find((slot) => slot.hand === hand && slot.finger === finger)?.text ?? '';

interface HandEditorProps {
  hand: Hand;
  config: FingercontrolConfig;
  onUpdateSlot: (hand: Hand, finger: Finger, text: string) => void;
}

const HandEditor: React.FC<HandEditorProps> = ({ hand, config, onUpdateSlot }) => {
  const isRight = hand === 'right';

  return (
    <section className={`hand-editor ${isRight ? 'hand-editor--right' : ''}`} aria-label={`${hand} hand text controls`}>
      <div className="hand-caption">
        <span>{isRight ? 'R' : 'L'}</span>
        {isRight ? 'RIGHT HAND' : 'LEFT HAND'}
      </div>

      <div className="hand-stage">
        <img
          className="hand-emoji"
          src="/assets/hand-right.svg"
          alt=""
          aria-hidden="true"
        />
        <div className="thumb-dot" aria-hidden="true" />

        {FINGERS.map((finger, index) => {
          const visual = SLOT_VISUALS[hand][finger];
          const label = FINGER_LABELS[finger];
          const text = getSlotText(config, hand, finger);
          const audioIndex = (isRight ? 4 : 0) + (3 - index);

          return (
            <div key={finger} className={`finger-editor finger-editor--${finger}`} style={{ '--finger-color': visual.color } as React.CSSProperties}>
              <span className="finger-name">{label}</span>
              <div className="finger-input-row">
                <input
                  aria-label={`${isRight ? 'Right' : 'Left'} ${label} text`}
                  className={visual.className}
                  type="text"
                  value={text}
                  maxLength={18}
                  spellCheck={false}
                  onFocus={(event) => event.currentTarget.select()}
                  onChange={(event) => onUpdateSlot(hand, finger, event.target.value)}
                  placeholder="TYPE"
                />
                <button
                  type="button"
                  aria-label={`Play ${label} text`}
                  title="Preview voice"
                  onClick={() => {
                    speechEngine.unlockSpeech();
                    speechEngine.triggerWord(`${hand}-${finger}`, text || finger.toUpperCase(), audioIndex);
                  }}
                >
                  <Volume2 aria-hidden="true" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};

export const SetupScreen: React.FC<SetupScreenProps> = ({
  config,
  onUpdateConfig,
  inputMode,
  onChangeInputMode,
  videoDevices,
  selectedDeviceId,
  onSelectDeviceId,
  onStartCamera,
  displayVideoFile,
  trackingVideoFile,
  displayVideoMeta,
  trackingVideoMeta,
  onSelectDisplayVideo,
  onSelectTrackingVideo,
  onStartAnalyzeVideo,
  isAnalyzing,
  analysisProgress,
  analysisStatus,
  errorMessage,
}) => {
  const displayFileInputRef = useRef<HTMLInputElement | null>(null);
  const trackingFileInputRef = useRef<HTMLInputElement | null>(null);

  const updateSlotText = (hand: Hand, finger: Finger, text: string) => {
    onUpdateConfig({
      ...config,
      slots: config.slots.map((slot) => (slot.hand === hand && slot.finger === finger ? { ...slot, text } : slot)),
    });
  };

  const canStartUpload = Boolean(displayVideoFile);

  return (
    <main className="setup-page">
      <header className="setup-header">
        <a className="wordmark" href="#top" aria-label="Fingercontrol home">
          <span className="wordmark-dot" />
          FINGERCONTROL
        </a>
        <div className="mode-switch" aria-label="Input source">
          <button className={inputMode === 'CAMERA' ? 'active' : ''} onClick={() => onChangeInputMode('CAMERA')}>
            <Camera aria-hidden="true" /> Camera
          </button>
          <button className={inputMode === 'UPLOAD_VIDEO' ? 'active' : ''} onClick={() => onChangeInputMode('UPLOAD_VIDEO')}>
            <Video aria-hidden="true" /> Video
          </button>
        </div>
      </header>

      <div className="setup-intro" id="top">
        <p className="eyebrow">THUMB + FINGER = VOICE</p>
        <h1>Pinch a finger.<br />Make it speak.</h1>
        <p className="intro-note">Assign a word to each finger, then touch it with your thumb to trigger the voice.</p>
      </div>

      <div className="hands-layout">
        <HandEditor hand="left" config={config} onUpdateSlot={updateSlotText} />
        <HandEditor hand="right" config={config} onUpdateSlot={updateSlotText} />
      </div>

      <div className="thumb-legend">
        <span className="legend-dot" />
        Thumbs are triggers, so they stay wordless.
      </div>

      {errorMessage && (
        <div className="setup-error" role="alert">
          <AlertCircle aria-hidden="true" />
          <span>{errorMessage}</span>
        </div>
      )}

      <section className="launch-dock" aria-label="Start settings">
        {inputMode === 'CAMERA' ? (
          <div className="source-settings camera-settings">
            <label>
              <span>Camera</span>
              <select value={selectedDeviceId} onChange={(event) => onSelectDeviceId(event.target.value)}>
                {videoDevices.length === 0 ? (
                  <option value="">Default camera</option>
                ) : (
                  videoDevices.map((device, index) => (
                    <option key={device.deviceId || index} value={device.deviceId}>
                      {device.label || `Camera ${index + 1}`}
                    </option>
                  ))
                )}
              </select>
            </label>
          </div>
        ) : (
          <div className="source-settings upload-settings">
            <button className={`file-picker ${displayVideoFile ? 'has-file' : ''}`} onClick={() => displayFileInputRef.current?.click()}>
              {displayVideoFile ? <Check aria-hidden="true" /> : <Upload aria-hidden="true" />}
              <span>
                <strong>{displayVideoFile ? displayVideoFile.name : 'Choose display video'}</strong>
                <small>
                  {displayVideoMeta
                    ? `${displayVideoMeta.duration.toFixed(1)}s · ${displayVideoMeta.width}×${displayVideoMeta.height}`
                    : 'Required'}
                </small>
              </span>
            </button>
            <input
              ref={displayFileInputRef}
              type="file"
              accept="video/*"
              hidden
              onChange={(event) => event.target.files?.[0] && onSelectDisplayVideo(event.target.files[0])}
            />

            <button className={`file-picker file-picker--quiet ${trackingVideoFile ? 'has-file' : ''}`} onClick={() => trackingFileInputRef.current?.click()}>
              <Upload aria-hidden="true" />
              <span>
                <strong>{trackingVideoFile ? trackingVideoFile.name : 'Add clean tracking video'}</strong>
                <small>
                  {trackingVideoMeta
                    ? `${trackingVideoMeta.duration.toFixed(1)}s · ${trackingVideoMeta.width}×${trackingVideoMeta.height}`
                    : 'Optional'}
                </small>
              </span>
              {trackingVideoFile && (
                <span
                  className="remove-file"
                  role="button"
                  tabIndex={0}
                  aria-label="Remove tracking video"
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelectTrackingVideo(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') onSelectTrackingVideo(null);
                  }}
                >
                  <X aria-hidden="true" />
                </span>
              )}
            </button>
            <input
              ref={trackingFileInputRef}
              type="file"
              accept="video/*"
              hidden
              onChange={(event) => event.target.files?.[0] && onSelectTrackingVideo(event.target.files[0])}
            />
          </div>
        )}

        <div className="dock-actions">
          <label className="compact-toggle">
            <input
              type="checkbox"
              checked={config.mirroredVideo}
              onChange={(event) => onUpdateConfig({ ...config, mirroredVideo: event.target.checked })}
            />
            <span>Mirror</span>
          </label>
          <label className="compact-toggle">
            <input
              type="checkbox"
              checked={config.trackingVisible}
              onChange={(event) => onUpdateConfig({ ...config, trackingVisible: event.target.checked })}
            />
            <span>Tracking</span>
          </label>

          {isAnalyzing ? (
            <div className="analyzing-state">
              <LoaderCircle aria-hidden="true" />
              <span>{analysisStatus || 'Analyzing'}</span>
              <strong>{analysisProgress}%</strong>
              <i style={{ width: `${analysisProgress}%` }} />
            </div>
          ) : (
            <button
              className="start-button"
              disabled={inputMode === 'UPLOAD_VIDEO' && !canStartUpload}
              onClick={inputMode === 'CAMERA' ? onStartCamera : onStartAnalyzeVideo}
            >
              <Play aria-hidden="true" fill="currentColor" />
              {inputMode === 'CAMERA' ? 'Start performing' : 'Analyze video'}
            </button>
          )}
        </div>
      </section>
    </main>
  );
};
