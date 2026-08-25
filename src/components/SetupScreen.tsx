import React, { useRef } from 'react';
import { FingercontrolConfig, Finger, Hand } from '../types/config';
import { Upload, Video, Camera, AlertCircle, CheckCircle2, RefreshCw, Volume2 } from 'lucide-react';
import { speechEngine } from '../utils/speechEngine';

interface SetupScreenProps {
  config: FingercontrolConfig;
  onUpdateConfig: (newConfig: FingercontrolConfig) => void;
  inputMode: 'CAMERA' | 'UPLOAD_VIDEO';
  onChangeInputMode: (mode: 'CAMERA' | 'UPLOAD_VIDEO') => void;
  // Camera state
  videoDevices: MediaDeviceInfo[];
  selectedDeviceId: string;
  onSelectDeviceId: (id: string) => void;
  onStartCamera: () => void;
  // Upload video state
  displayVideoFile: File | null;
  trackingVideoFile: File | null;
  displayVideoMeta: { duration: number; width: number; height: number } | null;
  trackingVideoMeta: { duration: number; width: number; height: number } | null;
  onSelectDisplayVideo: (file: File) => void;
  onSelectTrackingVideo: (file: File | null) => void;
  onStartAnalyzeVideo: () => void;
  // Loading & Progress
  isAnalyzing: boolean;
  analysisProgress: number;
  analysisStatus: string;
  errorMessage: string | null;
}

const FINGERS: Finger[] = ['index', 'middle', 'ring', 'pinky'];

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

  // Slot helper
  const getSlotText = (hand: Hand, finger: Finger): string => {
    const found = config.slots.find((s) => s.hand === hand && s.finger === finger);
    return found ? found.text : finger.toUpperCase();
  };

  const updateSlotText = (hand: Hand, finger: Finger, text: string) => {
    const newSlots = config.slots.map((slot) => {
      if (slot.hand === hand && slot.finger === finger) {
        return { ...slot, text };
      }
      return slot;
    });
    onUpdateConfig({ ...config, slots: newSlots });
  };

  // Validation between display and tracking video
  const getTrackingVideoMismatchWarning = (): string | null => {
    if (!displayVideoMeta || !trackingVideoMeta) return null;
    const durDiff = Math.abs(displayVideoMeta.duration - trackingVideoMeta.duration);
    if (durDiff > 0.1) {
      return `Duration mismatch: ${displayVideoMeta.duration.toFixed(2)}s vs ${trackingVideoMeta.duration.toFixed(2)}s (diff > 100ms)`;
    }
    const displayAspect = displayVideoMeta.width / displayVideoMeta.height;
    const trackingAspect = trackingVideoMeta.width / trackingVideoMeta.height;
    if (Math.abs(displayAspect - trackingAspect) > 0.05) {
      return `Aspect ratio mismatch: ${displayVideoMeta.width}x${displayVideoMeta.height} vs ${trackingVideoMeta.width}x${trackingVideoMeta.height}`;
    }
    return null;
  };

  const trackingMismatch = getTrackingVideoMismatchWarning();

  return (
    <div className="min-h-screen bg-[#07111F] text-[#E0E6ED] flex flex-col justify-center items-center px-4 py-8 font-mono select-none">
      <div className="w-full max-w-4xl flex flex-col space-y-6">
        
        {/* Header */}
        <div className="text-center space-y-1.5">
          <h1 className="text-2xl font-bold tracking-widest text-white uppercase flex items-center justify-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#FF0000] inline-block animate-pulse"></span>
            fingercontrol
          </h1>
          <p className="text-xs text-[#8A9BA8] tracking-wider uppercase">
            Two-Hand Fingertip & Pinch Synthesizer // Gesture Speech Overlay
          </p>
        </div>

        {/* Input Mode Selector */}
        <div className="flex justify-center">
          <div className="inline-flex rounded border border-[#1E2E42] bg-[#0C1929] p-1 gap-1">
            <button
              onClick={() => onChangeInputMode('CAMERA')}
              className={`px-5 py-2 text-xs font-semibold uppercase tracking-wider rounded transition-colors flex items-center gap-2 ${
                inputMode === 'CAMERA'
                  ? 'bg-[#1D3557] text-white shadow-sm'
                  : 'text-[#8A9BA8] hover:text-white'
              }`}
            >
              <Camera className="w-3.5 h-3.5" />
              CAMERA
            </button>
            <button
              onClick={() => onChangeInputMode('UPLOAD_VIDEO')}
              className={`px-5 py-2 text-xs font-semibold uppercase tracking-wider rounded transition-colors flex items-center gap-2 ${
                inputMode === 'UPLOAD_VIDEO'
                  ? 'bg-[#1D3557] text-white shadow-sm'
                  : 'text-[#8A9BA8] hover:text-white'
              }`}
            >
              <Video className="w-3.5 h-3.5" />
              UPLOAD VIDEO
            </button>
          </div>
        </div>

        {/* Mode Specific Configuration Bar */}
        <div className="bg-[#0C1929] border border-[#1E2E42] rounded-md p-4 space-y-3">
          {inputMode === 'CAMERA' ? (
            <div className="flex flex-wrap items-center justify-between gap-4 text-xs">
              <div className="flex items-center gap-3">
                <span className="text-[#8A9BA8] uppercase text-[11px]">CAMERA DEVICE:</span>
                <select
                  value={selectedDeviceId}
                  onChange={(e) => onSelectDeviceId(e.target.value)}
                  className="bg-[#07111F] border border-[#1E2E42] text-white text-xs rounded px-3 py-1.5 focus:outline-none focus:border-[#FF0000]"
                >
                  {videoDevices.length === 0 ? (
                    <option value="">Default Webcam</option>
                  ) : (
                    videoDevices.map((dev, idx) => (
                      <option key={dev.deviceId || idx} value={dev.deviceId}>
                        {dev.label || `Camera ${idx + 1}`}
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.mirroredVideo}
                    onChange={(e) => onUpdateConfig({ ...config, mirroredVideo: e.target.checked })}
                    className="accent-[#FF0000] cursor-pointer"
                  />
                  <span className="text-[#C5D1DE] text-xs uppercase">MIRRORED</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.trackingVisible}
                    onChange={(e) => onUpdateConfig({ ...config, trackingVisible: e.target.checked })}
                    className="accent-[#FF0000] cursor-pointer"
                  />
                  <span className="text-[#C5D1DE] text-xs uppercase">SHOW TRACKING</span>
                </label>
              </div>
            </div>
          ) : (
            <div className="space-y-3 text-xs">
              {/* Upload row */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* Display Video (Required) */}
                <div className="border border-[#1E2E42] bg-[#07111F] p-3 rounded flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-semibold text-white uppercase text-[11px] flex items-center gap-1.5">
                        <Video className="w-3.5 h-3.5 text-[#FF0000]" />
                        DISPLAY VIDEO (REQUIRED)
                      </span>
                      {displayVideoFile && (
                        <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" /> READY
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-[#8A9BA8] mb-2">
                      Local browser-decodable video for preview & export.
                    </p>
                  </div>

                  {displayVideoFile ? (
                    <div className="flex items-center justify-between bg-[#0C1929] border border-[#1E2E42] px-2.5 py-1.5 rounded">
                      <div className="truncate mr-2">
                        <div className="text-white text-xs truncate font-medium">{displayVideoFile.name}</div>
                        {displayVideoMeta && (
                          <div className="text-[10px] text-[#8A9BA8]">
                            {displayVideoMeta.duration.toFixed(1)}s • {displayVideoMeta.width}x{displayVideoMeta.height}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => displayFileInputRef.current?.click()}
                        className="text-[10px] text-[#8A9BA8] hover:text-white underline uppercase shrink-0 cursor-pointer"
                      >
                        REPLACE
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => displayFileInputRef.current?.click()}
                      className="w-full py-2.5 border border-dashed border-[#2A4365] hover:border-[#FF0000] text-[#A0AEC0] hover:text-white rounded text-center transition-colors flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      SELECT DISPLAY VIDEO
                    </button>
                  )}
                  <input
                    ref={displayFileInputRef}
                    type="file"
                    accept="video/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) onSelectDisplayVideo(file);
                    }}
                  />
                </div>

                {/* Clean Tracking Video (Optional) */}
                <div className="border border-[#1E2E42] bg-[#07111F] p-3 rounded flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-semibold text-[#CBD5E1] uppercase text-[11px]">
                        CLEAN TRACKING VIDEO (OPTIONAL)
                      </span>
                      {trackingVideoFile && (
                        <button
                          onClick={() => onSelectTrackingVideo(null)}
                          className="text-[10px] text-[#8A9BA8] hover:text-[#FF0000] flex items-center gap-1 cursor-pointer"
                        >
                          X REMOVE
                        </button>
                      )}
                    </div>
                    <p className="text-[10px] text-[#8A9BA8] mb-2">
                      Use if display video is heavily stylized/distorted.
                    </p>
                  </div>

                  {trackingVideoFile ? (
                    <div className="flex items-center justify-between bg-[#0C1929] border border-[#1E2E42] px-2.5 py-1.5 rounded">
                      <div className="truncate mr-2">
                        <div className="text-white text-xs truncate font-medium">{trackingVideoFile.name}</div>
                        {trackingVideoMeta && (
                          <div className="text-[10px] text-[#8A9BA8]">
                            {trackingVideoMeta.duration.toFixed(1)}s • {trackingVideoMeta.width}x{trackingVideoMeta.height}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => trackingFileInputRef.current?.click()}
                        className="text-[10px] text-[#8A9BA8] hover:text-white underline uppercase shrink-0 cursor-pointer"
                      >
                        REPLACE
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => trackingFileInputRef.current?.click()}
                      className="w-full py-2.5 border border-dashed border-[#1E2E42] hover:border-[#2A4365] text-[#718096] hover:text-[#CBD5E1] rounded text-center transition-colors flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      SELECT TRACKING VIDEO
                    </button>
                  )}
                  <input
                    ref={trackingFileInputRef}
                    type="file"
                    accept="video/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) onSelectTrackingVideo(file);
                    }}
                  />
                </div>
              </div>

              {/* Warnings or Video Config */}
              <div className="flex flex-wrap items-center justify-between pt-1 text-xs border-t border-[#1E2E42]/60">
                <div className="flex items-center gap-6">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.mirroredVideo}
                      onChange={(e) => onUpdateConfig({ ...config, mirroredVideo: e.target.checked })}
                      className="accent-[#FF0000] cursor-pointer"
                    />
                    <span className="text-[#C5D1DE] text-xs uppercase">MIRRORED VIDEO</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.trackingVisible}
                      onChange={(e) => onUpdateConfig({ ...config, trackingVisible: e.target.checked })}
                      className="accent-[#FF0000] cursor-pointer"
                    />
                    <span className="text-[#C5D1DE] text-xs uppercase">SHOW TRACKING</span>
                  </label>

                  <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#0A1626] border border-[#1E2E42] text-[11px] text-[#A0AEC0]">
                    <CheckCircle2 className="w-3 h-3 text-[#FF0000]" />
                    <span className="uppercase text-[10px] tracking-wide">AUTO CRT & BORDER ALIGNMENT</span>
                  </div>
                </div>

                {trackingMismatch && (
                  <div className="text-amber-400 text-[11px] flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5" />
                    {trackingMismatch}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Error Notification */}
        {errorMessage && (
          <div className="bg-[#2D1517] border border-[#FF0000]/40 text-[#FFA8A8] text-xs p-3 rounded flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 text-[#FF0000] shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Side-by-side LEFT HAND and RIGHT HAND Panels */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          
          {/* LEFT HAND PANEL */}
          <div className="bg-[#0C1929] border border-[#1E2E42] rounded-md p-4 flex flex-col space-y-3">
            <div className="flex items-center justify-between border-b border-[#1E2E42] pb-2">
              <span className="font-bold text-white tracking-wider text-xs uppercase flex items-center gap-1.5">
                <span className="w-2 h-2 bg-[#FF0000] inline-block"></span>
                LEFT HAND
              </span>
              <span className="text-[10px] text-[#8A9BA8] uppercase">THUMB + 4 FINGERS</span>
            </div>

            <div className="space-y-2.5">
              {FINGERS.map((finger, idx) => {
                const text = getSlotText('left', finger);
                const slotKey = `left-${finger}`;

                return (
                  <div
                    key={slotKey}
                    className="flex items-center gap-3 bg-[#07111F] border border-[#1E2E42] px-3 py-2 rounded"
                  >
                    {/* Finger Label */}
                    <span className="w-16 text-[11px] font-semibold text-[#8A9BA8] uppercase shrink-0">
                      {finger}
                    </span>

                    {/* Direct Text Input */}
                    <input
                      type="text"
                      value={text}
                      onChange={(e) => updateSlotText('left', finger, e.target.value)}
                      placeholder={finger.toUpperCase()}
                      className="flex-1 bg-[#0C1929] border border-[#1E2E42] rounded px-3 py-1.5 text-xs text-white uppercase focus:outline-none focus:border-[#FF0000] transition-colors min-w-0"
                    />

                    {/* Test Audio Button */}
                    <button
                      type="button"
                      onClick={() => {
                        speechEngine.unlockSpeech();
                        speechEngine.triggerWord(slotKey, text || finger.toUpperCase(), idx);
                      }}
                      className="p-1.5 rounded hover:bg-[#1E2E42] text-[#8A9BA8] hover:text-[#FF0000] transition-colors cursor-pointer"
                      title={`Test sound for ${finger}`}
                    >
                      <Volume2 className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* RIGHT HAND PANEL */}
          <div className="bg-[#0C1929] border border-[#1E2E42] rounded-md p-4 flex flex-col space-y-3">
            <div className="flex items-center justify-between border-b border-[#1E2E42] pb-2">
              <span className="font-bold text-white tracking-wider text-xs uppercase flex items-center gap-1.5">
                <span className="w-2 h-2 bg-[#FF0000] inline-block"></span>
                RIGHT HAND
              </span>
              <span className="text-[10px] text-[#8A9BA8] uppercase">THUMB + 4 FINGERS</span>
            </div>

            <div className="space-y-2.5">
              {FINGERS.map((finger, idx) => {
                const text = getSlotText('right', finger);
                const slotKey = `right-${finger}`;

                return (
                  <div
                    key={slotKey}
                    className="flex items-center gap-3 bg-[#07111F] border border-[#1E2E42] px-3 py-2 rounded"
                  >
                    {/* Finger Label */}
                    <span className="w-16 text-[11px] font-semibold text-[#8A9BA8] uppercase shrink-0">
                      {finger}
                    </span>

                    {/* Direct Text Input */}
                    <input
                      type="text"
                      value={text}
                      onChange={(e) => updateSlotText('right', finger, e.target.value)}
                      placeholder={finger.toUpperCase()}
                      className="flex-1 bg-[#0C1929] border border-[#1E2E42] rounded px-3 py-1.5 text-xs text-white uppercase focus:outline-none focus:border-[#FF0000] transition-colors min-w-0"
                    />

                    {/* Test Audio Button */}
                    <button
                      type="button"
                      onClick={() => {
                        speechEngine.unlockSpeech();
                        speechEngine.triggerWord(slotKey, text || finger.toUpperCase(), 4 + idx);
                      }}
                      className="p-1.5 rounded hover:bg-[#1E2E42] text-[#8A9BA8] hover:text-[#FF0000] transition-colors cursor-pointer"
                      title={`Test sound for ${finger}`}
                    >
                      <Volume2 className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Primary Bottom Action Button & Progress */}
        <div className="pt-2 flex flex-col items-center">
          {isAnalyzing ? (
            <div className="w-full max-w-md space-y-2 text-center">
              <div className="flex justify-between text-xs text-[#8A9BA8]">
                <span className="flex items-center gap-1.5 text-white font-medium">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#FF0000]" />
                  {analysisStatus || 'ANALYZING VIDEO...'}
                </span>
                <span className="font-bold text-white">{analysisProgress}%</span>
              </div>
              <div className="w-full h-2 bg-[#0C1929] border border-[#1E2E42] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#FF0000] transition-all duration-150"
                  style={{ width: `${analysisProgress}%` }}
                />
              </div>
            </div>
          ) : (
            <button
              onClick={inputMode === 'CAMERA' ? onStartCamera : onStartAnalyzeVideo}
              disabled={inputMode === 'UPLOAD_VIDEO' && (!displayVideoFile || !!trackingMismatch)}
              className={`w-full max-w-md py-3.5 px-6 rounded font-bold text-sm tracking-widest uppercase transition-all shadow-md flex items-center justify-center gap-2 ${
                inputMode === 'UPLOAD_VIDEO' && (!displayVideoFile || !!trackingMismatch)
                  ? 'bg-[#152336] text-[#4A5D73] cursor-not-allowed border border-[#1E2E42]'
                  : 'bg-[#FF0000] hover:bg-[#E60000] text-white hover:shadow-lg active:scale-[0.99] cursor-pointer'
              }`}
            >
              {inputMode === 'CAMERA' ? 'START CAMERA →' : 'ANALYZE VIDEO →'}
            </button>
          )}
        </div>

      </div>
    </div>
  );
};
