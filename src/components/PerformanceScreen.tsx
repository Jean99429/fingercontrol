import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  FingercontrolConfig,
  ContentSlot,
  GestureEvent,
  VideoAnalysisFrame,
  Hand,
  HandGestureData,
} from '../types/config';
import { gestureRecognizer } from '../vision/gestureRecognizer';
import { visualRenderer } from '../renderer/visualRenderer';
import { speechEngine } from '../utils/speechEngine';
import { audioManager } from '../utils/audio';
import {
  ArrowLeft,
  Play,
  Pause,
  RotateCcw,
  Circle,
  Eye,
  EyeOff,
  FlipHorizontal,
  Trash2,
  Clock,
  Heart,
  Info,
  Volume2,
  Download,
} from 'lucide-react';

interface PerformanceScreenProps {
  inputMode: 'CAMERA' | 'UPLOAD_VIDEO';
  config: FingercontrolConfig;
  onUpdateConfig: (newConfig: FingercontrolConfig) => void;
  onBackToSetup: () => void;
  // Camera mode props
  cameraStream: MediaStream | null;
  // Video mode props
  displayVideoUrl: string | null;
  gestureEvents: GestureEvent[];
  onUpdateGestureEvents: (events: GestureEvent[]) => void;
  analysisFrames: VideoAnalysisFrame[];
  onReanalyze: () => void;
}

const FINGER_LIST = ['index', 'middle', 'ring', 'pinky'];

export const PerformanceScreen: React.FC<PerformanceScreenProps> = ({
  inputMode,
  config,
  onUpdateConfig,
  onBackToSetup,
  cameraStream,
  displayVideoUrl,
  gestureEvents,
  onUpdateGestureEvents,
  analysisFrames,
  onReanalyze,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hiddenVideoRef = useRef<HTMLVideoElement | null>(null);

  // Playback state (for video mode)
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);

  // Recording state
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [recordingSeconds, setRecordingSeconds] = useState<number>(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const [isExporting, setIsExporting] = useState<boolean>(false);

  // Selected event in timeline (for inspection or deletion)
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  // Speech triggering tracker to avoid duplicate triggers during playback
  const triggeredEventIdsRef = useRef<Set<string>>(new Set());
  const previousVideoTimeRef = useRef<number>(0);

  // Heart gesture visual feedback banner
  const [heartDetected, setHeartDetected] = useState<boolean>(false);
  const heartBannerTimerRef = useRef<number | null>(null);

  // Slot lookup helper
  const getSlot = useCallback(
    (hand: Hand, finger: string): ContentSlot | undefined => {
      return config.slots.find((s) => s.hand === hand && s.finger === finger);
    },
    [config.slots]
  );

  const getSlotIndex = useCallback((hand: Hand, finger: string): number => {
    const fIndex = FINGER_LIST.indexOf(finger);
    return hand === 'left' ? fIndex : 4 + fIndex;
  }, []);

  // Update speech engine voice assignments
  useEffect(() => {
    speechEngine.updateVoiceAssignments(config.slots);
  }, [config.slots]);

  // ==========================================
  // CAMERA MODE LOOP
  // ==========================================
  useEffect(() => {
    if (inputMode !== 'CAMERA') return;

    const canvas = canvasRef.current;
    const video = hiddenVideoRef.current;
    if (!canvas || !video) return;

    visualRenderer.init(canvas);
    visualRenderer.reset();
    gestureRecognizer.reset();

    // Set real-time gesture triggers
    gestureRecognizer.setCallbacks(
      (hand, finger, pinchPos) => {
        const slot = getSlot(hand, finger);
        const text = slot?.text || finger.toUpperCase();
        const slotId = `${hand}-${finger}`;
        const slotIdx = getSlotIndex(hand, finger);

        visualRenderer.spawnFloatingText(slotId, hand, text, pinchPos.x, pinchPos.y);

        // DIRECT PINCH TRIGGER: cancel previous speech & speak selected word immediately
        speechEngine.triggerWord(slotId, text, slotIdx);
      },
      (hand, finger) => {
        const slotId = `${hand}-${finger}`;
        visualRenderer.releaseFloatingText(slotId);
      },
      () => {
        // TWO-HAND HEART GESTURE DETECTED (>350ms hold)
        setHeartDetected(true);
        if (heartBannerTimerRef.current !== null) {
          clearTimeout(heartBannerTimerRef.current);
        }
        heartBannerTimerRef.current = window.setTimeout(() => {
          setHeartDetected(false);
          heartBannerTimerRef.current = null;
        }, 3000);

        speechEngine.triggerHeartPhrase(config.slots, () => {
          setHeartDetected(false);
        });
      }
    );

    let animationFrameId: number;

    const renderLoop = (time: number) => {
      if (video.readyState >= 2) {
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
          canvas.width = video.videoWidth || 1280;
          canvas.height = video.videoHeight || 720;
        }

        // Process hand landmarks & gestures
        const gestureData = gestureRecognizer.processVideoFrame(video, time, config.mirroredVideo);

        // Update target positions for active pinches
        for (const handKey of ['left', 'right'] as Hand[]) {
          const handData = gestureData[handKey];
          if (handData.state === 'ACTIVE' && handData.activeFinger && handData.pinchCenter) {
            const slotId = `${handKey}-${handData.activeFinger}`;
            visualRenderer.updateFloatingTextTarget(slotId, handData.pinchCenter.x, handData.pinchCenter.y);
          }
        }

        // Draw composite frame
        visualRenderer.renderFrame(video, gestureData, config.trackingVisible, time, config.mirroredVideo);
      }

      animationFrameId = requestAnimationFrame(renderLoop);
    };

    animationFrameId = requestAnimationFrame(renderLoop);

    return () => {
      cancelAnimationFrame(animationFrameId);
      speechEngine.stop();
    };
  }, [inputMode, config.mirroredVideo, config.trackingVisible, config.slots, getSlot, getSlotIndex]);

  // Set camera stream source
  useEffect(() => {
    if (inputMode === 'CAMERA' && hiddenVideoRef.current && cameraStream) {
      hiddenVideoRef.current.srcObject = cameraStream;
      hiddenVideoRef.current.play().catch(console.warn);
    }
  }, [inputMode, cameraStream]);

  // Recording timer
  useEffect(() => {
    let timer: number;
    if (isRecording) {
      setRecordingSeconds(0);
      timer = window.setInterval(() => {
        setRecordingSeconds((s) => s + 1);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [isRecording]);

  // Start Tab & Audio Recording via getDisplayMedia
  const handleStartRecording = async () => {
    try {
      // Prompt displayMedia with audio capture to record browser SpeechSynthesis
      let stream: MediaStream;
      if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
        try {
          stream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: true,
            // @ts-ignore - Chrome standard surface hints
            preferCurrentTab: true,
            selfBrowserSurface: 'include',
            systemAudio: 'include',
          });
        } catch (displayErr) {
          console.warn('getDisplayMedia prompt closed or rejected, falling back to canvas capture:', displayErr);
          const canvas = canvasRef.current;
          if (!canvas) return;
          stream = canvas.captureStream(30);
        }
      } else {
        const canvas = canvasRef.current;
        if (!canvas) return;
        stream = canvas.captureStream(30);
      }

      screenStreamRef.current = stream;

      // Handle user stopping screen share from browser banner
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          handleStopRecording();
        };
      }

      let mimeType = 'video/webm;codecs=vp9,opus';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/webm;codecs=vp8,opus';
      }
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/webm';
      }

      recordedChunksRef.current = [];
      const recorder = new MediaRecorder(stream, { mimeType });

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          recordedChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `fingercontrol-performance-${Date.now()}.webm`;
        a.click();
        URL.revokeObjectURL(url);

        // Stop all tracks
        if (screenStreamRef.current) {
          screenStreamRef.current.getTracks().forEach((t) => t.stop());
          screenStreamRef.current = null;
        }
      };

      recorder.start(250);
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
    } catch (err) {
      console.error('Failed to start recording:', err);
    }
  };

  // Stop Recording
  const handleStopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
    }
    setIsRecording(false);
  };

  // Export upload-mode composition directly from the canvas. This does not
  // ask the user to record a tab; it plays the display master once, captures
  // the rendered overlay, then downloads the resulting WebM automatically.
  const handleExportVideo = async () => {
    const canvas = canvasRef.current;
    const video = hiddenVideoRef.current;
    if (!canvas || !video || isExporting) return;

    try {
      speechEngine.stop();
      triggeredEventIdsRef.current.clear();
      visualRenderer.reset();
      speechEngine.setUseNeuralAudio(true);
      await speechEngine.prepare(config.slots);

      const canvasStream = canvas.captureStream(30);
      const exportTracks: MediaStreamTrack[] = [...canvasStream.getVideoTracks()];
      const sourceWithCapture = video as HTMLVideoElement & { captureStream?: () => MediaStream };
      const sourceStream = sourceWithCapture.captureStream?.();
      await audioManager.resumeIfNeeded();
      const audioContext = audioManager.getAudioContext();
      const audioMixDestination = audioContext.createMediaStreamDestination();
      const audioMixSources: MediaStreamAudioSourceNode[] = [];

      const connectToExportMix = (stream: MediaStream | null | undefined) => {
        const audioTracks = stream?.getAudioTracks() || [];
        if (audioTracks.length === 0) return;
        const source = audioContext.createMediaStreamSource(new MediaStream(audioTracks));
        source.connect(audioMixDestination);
        audioMixSources.push(source);
      };

      // Mix original video audio and offline trigger speech into one Opus track.
      connectToExportMix(sourceStream);
      connectToExportMix(audioManager.getMediaStream());
      exportTracks.push(...audioMixDestination.stream.getAudioTracks());
      const exportStream = new MediaStream(exportTracks);
      screenStreamRef.current = exportStream;

      let mimeType = 'video/webm;codecs=vp9,opus';
      if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'video/webm;codecs=vp8,opus';
      if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'video/webm';

      recordedChunksRef.current = [];
      const recorder = new MediaRecorder(exportStream, { mimeType });
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordedChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: mimeType });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `fingercontrol-export-${Date.now()}.webm`;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        exportStream.getTracks().forEach((track) => track.stop());
        audioMixSources.forEach((source) => source.disconnect());
        audioMixDestination.stream.getTracks().forEach((track) => track.stop());
        screenStreamRef.current = null;
        mediaRecorderRef.current = null;
        setIsExporting(false);
        setIsPlaying(false);
        speechEngine.setUseNeuralAudio(false);
      };

      const finishExport = () => {
        if (recorder.state !== 'inactive') recorder.stop();
      };
      video.addEventListener('ended', finishExport, { once: true });
      video.loop = false;
      video.currentTime = 0;
      setCurrentTime(0);
      setIsExporting(true);
      setIsPlaying(true);
      recorder.start(250);
      await video.play();
    } catch (error) {
      console.error('Failed to export processed video:', error);
      screenStreamRef.current?.getTracks().forEach((track) => track.stop());
      screenStreamRef.current = null;
      mediaRecorderRef.current = null;
      setIsExporting(false);
      speechEngine.setUseNeuralAudio(false);
    }
  };

  // ==========================================
  // UPLOAD VIDEO MODE PLAYBACK & PREVIEW LOOP
  // ==========================================
  useEffect(() => {
    if (inputMode !== 'UPLOAD_VIDEO') return;

    const canvas = canvasRef.current;
    const video = hiddenVideoRef.current;
    if (!canvas || !video) return;

    visualRenderer.init(canvas);
    visualRenderer.reset();

    let animationFrameId: number;

    const previewLoop = (time: number) => {
      if (video.readyState >= 2) {
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
          canvas.width = video.videoWidth || 1280;
          canvas.height = video.videoHeight || 720;
        }

        const vTime = video.currentTime;
        if (vTime + 0.05 < previousVideoTimeRef.current) {
          triggeredEventIdsRef.current.clear();
          visualRenderer.reset();
        }
        previousVideoTimeRef.current = vTime;
        setCurrentTime(vTime);

        // Find closest analysis frame
        let closestFrame: VideoAnalysisFrame | null = null;
        if (analysisFrames.length > 0) {
          let minDiff = Infinity;
          for (const f of analysisFrames) {
            const diff = Math.abs(f.timestamp - vTime);
            if (diff < minDiff) {
              minDiff = diff;
              closestFrame = f;
            }
            if (diff > minDiff && minDiff < 0.1) break;
          }
        }

        const defaultHand = (hand: Hand): HandGestureData => ({
          hand,
          detected: false,
          fingertips: {
            thumb: { x: 0, y: 0 },
            index: { x: 0, y: 0 },
            middle: { x: 0, y: 0 },
            ring: { x: 0, y: 0 },
            pinky: { x: 0, y: 0 },
          },
          state: 'IDLE',
          activeFinger: null,
          proximityDistance: 1.0,
          pinchCenter: null,
          dragOffset: { dx: 0, dy: 0 },
          holdDurationMs: 0,
          triggerTimestamp: 0,
        });

        const gestureData = {
          left: closestFrame?.leftHand || defaultHand('left'),
          right: closestFrame?.rightHand || defaultHand('right'),
        };

        // Check active events at this timestamp
        for (const ev of gestureEvents) {
          const isActive = vTime >= ev.startTime && vTime <= ev.releaseTime;
          const slotId = `${ev.hand}-${ev.finger}`;

          if (isActive) {
            const currentPinch = gestureData[ev.hand].pinchCenter;
            const triggerX = currentPinch?.x ?? ev.x;
            const triggerY = currentPinch?.y ?? ev.y;
            // Spawn / update floating text
            visualRenderer.spawnFloatingText(slotId, ev.hand, ev.text, triggerX, triggerY);

            // Trigger speech once per event
            if (!triggeredEventIdsRef.current.has(ev.id)) {
              triggeredEventIdsRef.current.add(ev.id);
              const slotIdx = getSlotIndex(ev.hand, ev.finger);
              speechEngine.triggerWord(slotId, ev.text, slotIdx);
            }
          } else {
            // Release if previously active
            if (vTime > ev.releaseTime && vTime < ev.releaseTime + 0.6) {
              visualRenderer.releaseFloatingText(slotId);
            }
          }
        }

        // Draw composite frame
        visualRenderer.renderFrame(video, gestureData, config.trackingVisible, time, config.mirroredVideo);
      }

      animationFrameId = requestAnimationFrame(previewLoop);
    };

    animationFrameId = requestAnimationFrame(previewLoop);

    return () => {
      cancelAnimationFrame(animationFrameId);
      speechEngine.stop();
    };
  }, [inputMode, analysisFrames, gestureEvents, config.trackingVisible, config.mirroredVideo, getSlotIndex]);

  // Video metadata load
  const handleVideoLoadedMetadata = () => {
    if (hiddenVideoRef.current) {
      setDuration(hiddenVideoRef.current.duration || 0);
      if (inputMode === 'UPLOAD_VIDEO') {
        hiddenVideoRef.current.pause();
        hiddenVideoRef.current.currentTime = 0;
        previousVideoTimeRef.current = 0;
        triggeredEventIdsRef.current.clear();
        setIsPlaying(false);
      } else if (isPlaying) {
        hiddenVideoRef.current.play().catch(console.warn);
      }
    }
  };

  // Play / Pause toggle
  const togglePlayPause = async () => {
    if (!hiddenVideoRef.current) return;
    if (isPlaying) {
      hiddenVideoRef.current.pause();
      setIsPlaying(false);
    } else {
      speechEngine.resetForPlayback();
      await speechEngine.unlockSpeech();
      if (hiddenVideoRef.current.currentTime >= hiddenVideoRef.current.duration - 0.05) {
        hiddenVideoRef.current.currentTime = 0;
        previousVideoTimeRef.current = 0;
        triggeredEventIdsRef.current.clear();
        visualRenderer.reset();
      }
      hiddenVideoRef.current.play().catch(console.warn);
      setIsPlaying(true);
    }
  };

  // Seek handler
  const handleSeek = (newTime: number) => {
    if (hiddenVideoRef.current) {
      hiddenVideoRef.current.currentTime = newTime;
      setCurrentTime(newTime);
      // Reset triggered events cache beyond current time
      triggeredEventIdsRef.current.clear();
      for (const ev of gestureEvents) {
        if (ev.startTime < newTime) {
          triggeredEventIdsRef.current.add(ev.id);
        }
      }
    }
  };

  // Delete an event
  const handleDeleteEvent = (id: string) => {
    const nextEvents = gestureEvents.filter((ev) => ev.id !== id);
    onUpdateGestureEvents(nextEvents);
    if (selectedEventId === id) {
      setSelectedEventId(null);
    }
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    const ms = Math.floor((secs % 1) * 10);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms}`;
  };

  return (
    <div className="min-h-screen bg-[#07111F] text-[#E0E6ED] flex flex-col font-mono select-none">
      
      {/* Top Bar */}
      <header className="h-14 border-b border-[#1E2E42] bg-[#0C1929] px-4 flex items-center justify-between z-10">
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              speechEngine.stop();
              onBackToSetup();
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#07111F] hover:bg-[#152336] border border-[#1E2E42] text-xs uppercase font-medium text-white transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            BACK TO SETUP
          </button>

          <div className="h-4 w-px bg-[#1E2E42]" />

          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#FF0000] inline-block"></span>
            <span className="font-bold text-xs uppercase text-white tracking-widest">
              FINGERCONTROL
            </span>
            <span className="text-[10px] text-[#8A9BA8] bg-[#07111F] border border-[#1E2E42] px-2 py-0.5 rounded uppercase">
              {inputMode === 'CAMERA' ? 'LIVE CAMERA' : 'VIDEO PREVIEW'}
            </span>
          </div>
        </div>

        {/* Right Header Controls */}
        <div className="flex items-center gap-3">
          {/* Test Speech Button */}
          <button
            onClick={() => {
              speechEngine.unlockSpeech();
              const firstSlot = config.slots[0];
              if (firstSlot) {
                speechEngine.triggerWord(firstSlot.id, firstSlot.text || 'TEST', 0);
              }
            }}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-[#07111F] hover:bg-[#152336] border border-[#1E2E42] text-xs uppercase font-medium text-[#C5D1DE] hover:text-white transition-colors cursor-pointer"
            title="Click to test speech synthesis sound"
          >
            <Volume2 className="w-3.5 h-3.5 text-[#FF0000]" />
            <span className="hidden sm:inline">TEST SOUND</span>
          </button>

          {/* Tracking toggle */}
          <button
            onClick={() => onUpdateConfig({ ...config, trackingVisible: !config.trackingVisible })}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs uppercase font-medium border transition-colors cursor-pointer ${
              config.trackingVisible
                ? 'bg-[#152336] border-[#FF0000]/50 text-white'
                : 'bg-[#07111F] border-[#1E2E42] text-[#8A9BA8]'
            }`}
            title="Toggle Tracking Overlay"
          >
            {config.trackingVisible ? <Eye className="w-3.5 h-3.5 text-[#FF0000]" /> : <EyeOff className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">TRACKING</span>
          </button>

          {/* Mirror toggle */}
          <button
            onClick={() => onUpdateConfig({ ...config, mirroredVideo: !config.mirroredVideo })}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs uppercase font-medium border transition-colors cursor-pointer ${
              config.mirroredVideo
                ? 'bg-[#152336] border-[#2A4365] text-white'
                : 'bg-[#07111F] border-[#1E2E42] text-[#8A9BA8]'
            }`}
            title="Toggle Mirror"
          >
            <FlipHorizontal className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">MIRROR</span>
          </button>

          {/* Upload Video Mode: Reanalyze */}
          {inputMode === 'UPLOAD_VIDEO' && (
            <button
              onClick={onReanalyze}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#07111F] hover:bg-[#152336] border border-[#1E2E42] text-xs uppercase font-medium text-white transition-colors cursor-pointer"
              title="Re-run Hand Detection Analysis"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">REANALYZE</span>
            </button>
          )}

          {inputMode === 'CAMERA' ? (
            <button
              onClick={isRecording ? handleStopRecording : handleStartRecording}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded text-xs font-bold uppercase tracking-wider transition-colors shadow-sm cursor-pointer ${
                isRecording
                  ? 'bg-[#FF0000] text-white animate-pulse'
                  : 'bg-[#FF0000] hover:bg-[#E60000] text-white'
              }`}
              title="Record Live Camera Performance"
            >
              <Circle className="w-3.5 h-3.5 fill-current" />
              {isRecording ? `REC (${recordingSeconds}s)` : 'RECORD'}
            </button>
          ) : (
            <button
              onClick={handleExportVideo}
              disabled={isExporting}
              className="flex items-center gap-2 px-3.5 py-1.5 rounded text-xs font-bold uppercase tracking-wider bg-[#FF0000] hover:bg-[#E60000] disabled:opacity-60 text-white transition-colors shadow-sm cursor-pointer"
              title="Render and download the processed display video"
            >
              <Download className="w-3.5 h-3.5" />
              {isExporting ? `EXPORTING ${formatTime(currentTime)} / ${formatTime(duration)}` : 'DOWNLOAD VIDEO'}
            </button>
          )}
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col items-center justify-center p-4 bg-[#050C16] relative overflow-hidden">
        
        {/* Hidden video element for feed decoding */}
        <video
          ref={hiddenVideoRef}
          src={inputMode === 'UPLOAD_VIDEO' ? displayVideoUrl || undefined : undefined}
          onLoadedMetadata={handleVideoLoadedMetadata}
          playsInline
          muted
          loop={inputMode === 'UPLOAD_VIDEO' && !isExporting}
          className="hidden"
        />

        {/* Master Composition Canvas */}
        <div className="relative max-w-full max-h-[75vh] flex items-center justify-center rounded-lg border border-[#1E2E42] bg-[#000000] shadow-2xl overflow-hidden">
          <canvas
            ref={canvasRef}
            className="max-w-full max-h-[75vh] object-contain block"
          />

          {/* Two-Hand Heart Detected Overlay Badge */}
          {heartDetected && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-[#FF0000]/90 backdrop-blur-md text-white px-4 py-2 rounded-full shadow-lg flex items-center gap-2 animate-bounce z-20">
              <Heart className="w-4 h-4 fill-white" />
              <span className="text-xs font-bold tracking-wider uppercase">
                TWO-HAND HEART // FULL PHRASE SPEAKING
              </span>
            </div>
          )}
        </div>

        {/* Recording Hint Notice */}
        {inputMode === 'CAMERA' && (
          <div className="mt-2 text-[10px] text-[#8A9BA8] flex items-center gap-1.5">
            <Info className="w-3 h-3 text-[#FF0000]" />
            <span>
              Recording: Select "This Tab" and enable "Also share tab audio" in the browser popup to record browser speech synthesis.
            </span>
          </div>
        )}

        {/* Upload Mode: Interactive Playback & Event Timeline */}
        {inputMode === 'UPLOAD_VIDEO' && (
          <div className="w-full max-w-4xl mt-3 bg-[#0C1929] border border-[#1E2E42] rounded-md p-3 space-y-2 text-xs">
            {/* Timeline Controls */}
            <div className="flex items-center gap-3">
              <button
                onClick={togglePlayPause}
                className="p-2 rounded bg-[#07111F] hover:bg-[#152336] border border-[#1E2E42] text-white transition-colors cursor-pointer"
                title={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              </button>

              <span className="text-[11px] font-mono text-[#8A9BA8] shrink-0">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>

              {/* Progress Slider with Events */}
              <div className="relative flex-1 flex items-center h-6">
                <input
                  type="range"
                  min={0}
                  max={duration || 1}
                  step={0.01}
                  value={currentTime}
                  onChange={(e) => handleSeek(parseFloat(e.target.value))}
                  className="w-full h-1.5 bg-[#07111F] rounded-lg appearance-none cursor-pointer accent-[#FF0000]"
                />

                {/* Event Markers along Timeline */}
                {duration > 0 &&
                  gestureEvents.map((ev) => {
                    const leftPct = (ev.startTime / duration) * 100;
                    const isSelected = selectedEventId === ev.id;
                    return (
                      <div
                        key={ev.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedEventId(ev.id);
                          handleSeek(ev.startTime);
                        }}
                        style={{ left: `${leftPct}%` }}
                        className={`absolute top-0 w-2 h-6 -ml-1 cursor-pointer transition-all ${
                          isSelected
                            ? 'bg-white z-10 ring-2 ring-[#FF0000]'
                            : 'bg-[#FF0000] hover:bg-white hover:scale-125 opacity-80'
                        }`}
                        title={`${ev.hand.toUpperCase()} ${ev.finger.toUpperCase()}: "${ev.text}" at ${ev.startTime.toFixed(2)}s`}
                      />
                    );
                  })}
              </div>

              <span className="text-[10px] text-[#8A9BA8] uppercase shrink-0">
                {gestureEvents.length} DETECTED EVENTS
              </span>
            </div>

            {/* Selected Event Details & Deletion */}
            {selectedEventId && (
              <div className="flex items-center justify-between bg-[#07111F] border border-[#1E2E42] px-3 py-1.5 rounded text-[11px]">
                {(() => {
                  const ev = gestureEvents.find((e) => e.id === selectedEventId);
                  if (!ev) return null;
                  return (
                    <>
                      <div className="flex items-center gap-3">
                        <span className="text-[#FF0000] font-bold uppercase">
                          [{ev.hand.toUpperCase()} {ev.finger.toUpperCase()}]
                        </span>
                        <span className="text-white font-medium">"{ev.text}"</span>
                        <span className="text-[#8A9BA8] flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {ev.startTime.toFixed(2)}s - {ev.releaseTime.toFixed(2)}s
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleDeleteEvent(ev.id)}
                          className="text-[#8A9BA8] hover:text-[#FF0000] flex items-center gap-1 transition-colors cursor-pointer"
                          title="Delete False Trigger"
                        >
                          <Trash2 className="w-3 h-3" /> DELETE EVENT
                        </button>
                      </div>
                    </>
                  );
                })()}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
};
