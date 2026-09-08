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

const getMp4MimeType = (): string => {
  const candidates = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4;codecs=avc1.42E01E,opus',
    'video/mp4;codecs=avc1.42E01E',
    'video/mp4',
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
};

const normalizeFrameRate = (fps: number): number => {
  const commonRates = [24, 25, 30, 50, 60];
  if (!Number.isFinite(fps) || fps < 10 || fps > 120) return 30;
  return commonRates.reduce((best, candidate) =>
    Math.abs(candidate - fps) < Math.abs(best - fps) ? candidate : best
  );
};

const getHighQualityRecorderOptions = (
  mimeType: string,
  width: number,
  height: number,
  frameRate: number
): MediaRecorderOptions => {
  const pixels = Math.max(1, width * height);
  let videoBitsPerSecond = 8_000_000;
  if (pixels >= 3840 * 2160) videoBitsPerSecond = 36_000_000;
  else if (pixels >= 2560 * 1440) videoBitsPerSecond = 22_000_000;
  else if (pixels >= 1920 * 1080) videoBitsPerSecond = 14_000_000;
  else if (pixels >= 1280 * 720) videoBitsPerSecond = 9_000_000;
  if (frameRate > 30) videoBitsPerSecond = Math.round(videoBitsPerSecond * 1.5);
  return { mimeType, videoBitsPerSecond, audioBitsPerSecond: 192_000 };
};

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
  const sourceFrameRateRef = useRef<number>(30);

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
  const [exportStage, setExportStage] = useState<'idle' | 'preparing' | 'rendering'>('idle');
  const [completedExport, setCompletedExport] = useState<{ url: string; fileName: string } | null>(null);

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

  // Estimate the display master's native cadence from decoded frames. This
  // keeps 24/25/30/50/60fps sources at their nearest original frame rate.
  useEffect(() => {
    const video = hiddenVideoRef.current;
    if (inputMode !== 'UPLOAD_VIDEO' || !video || !video.requestVideoFrameCallback) return;
    let callbackId = 0;
    let previousMediaTime: number | null = null;
    const deltas: number[] = [];
    const sampleFrame = (_now: number, metadata: VideoFrameCallbackMetadata) => {
      if (previousMediaTime !== null) {
        const delta = metadata.mediaTime - previousMediaTime;
        if (delta > 0.005 && delta < 0.2) {
          deltas.push(delta);
          if (deltas.length > 90) deltas.shift();
          const sorted = [...deltas].sort((a, b) => a - b);
          const median = sorted[Math.floor(sorted.length / 2)];
          sourceFrameRateRef.current = normalizeFrameRate(1 / median);
        }
      }
      previousMediaTime = metadata.mediaTime;
      callbackId = video.requestVideoFrameCallback(sampleFrame);
    };
    callbackId = video.requestVideoFrameCallback(sampleFrame);
    return () => video.cancelVideoFrameCallback(callbackId);
  }, [displayVideoUrl, inputMode]);

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
        visualRenderer.renderFrame(video, gestureData, config.trackingVisible, time, config.mirroredVideo, config.slots);
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

      const mimeType = getMp4MimeType();
      if (!mimeType) throw new Error('This browser cannot export MP4.');

      recordedChunksRef.current = [];
      const recordingTrackSettings = stream.getVideoTracks()[0]?.getSettings();
      const recordingFps = normalizeFrameRate(recordingTrackSettings?.frameRate || 30);
      const recorder = new MediaRecorder(
        stream,
        getHighQualityRecorderOptions(
          mimeType,
          recordingTrackSettings?.width || canvasRef.current?.width || 1920,
          recordingTrackSettings?.height || canvasRef.current?.height || 1080,
          recordingFps
        )
      );

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
        a.download = `fingercontrol-performance-${Date.now()}.mp4`;
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
      // Give immediate feedback. Neural speech preparation can take a while on
      // first use while the model is loaded, so never leave the button looking
      // as though the click was ignored.
      setIsExporting(true);
      setExportStage('preparing');
      if (completedExport) {
        URL.revokeObjectURL(completedExport.url);
        setCompletedExport(null);
      }
      speechEngine.stop();
      triggeredEventIdsRef.current.clear();
      visualRenderer.reset();
      speechEngine.setUseNeuralAudio(true);
      const usedSlots = config.slots.filter((slot) =>
        gestureEvents.some(
          (event) =>
            event.hand === slot.hand &&
            event.finger === slot.finger &&
            event.releaseTime - event.startTime >= 0.12
        )
      );
      await speechEngine.prepare(usedSlots);

      const exportFrameRate = sourceFrameRateRef.current;
      const canvasStream = canvas.captureStream(exportFrameRate);
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

      const mimeType = getMp4MimeType();
      if (!mimeType) throw new Error('This browser cannot export MP4.');

      recordedChunksRef.current = [];
      const recorder = new MediaRecorder(
        exportStream,
        getHighQualityRecorderOptions(mimeType, canvas.width, canvas.height, exportFrameRate)
      );
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordedChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: mimeType });
        const url = URL.createObjectURL(blob);
        const fileName = `fingercontrol-export-${Date.now()}.mp4`;
        setCompletedExport({ url, fileName });
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        exportStream.getTracks().forEach((track) => track.stop());
        audioMixSources.forEach((source) => source.disconnect());
        audioMixDestination.stream.getTracks().forEach((track) => track.stop());
        screenStreamRef.current = null;
        mediaRecorderRef.current = null;
        setIsExporting(false);
        setExportStage('idle');
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
      setExportStage('rendering');
      setIsPlaying(true);
      recorder.start(250);
      await video.play();
    } catch (error) {
      console.error('Failed to export processed video:', error);
      screenStreamRef.current?.getTracks().forEach((track) => track.stop());
      screenStreamRef.current = null;
      mediaRecorderRef.current = null;
      setIsExporting(false);
      setExportStage('idle');
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
          if (ev.releaseTime - ev.startTime < 0.12) continue;
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
        visualRenderer.renderFrame(video, gestureData, config.trackingVisible, time, config.mirroredVideo, config.slots);
      }

      animationFrameId = requestAnimationFrame(previewLoop);
    };

    animationFrameId = requestAnimationFrame(previewLoop);

    return () => {
      cancelAnimationFrame(animationFrameId);
      speechEngine.stop();
    };
  }, [inputMode, analysisFrames, gestureEvents, config.trackingVisible, config.mirroredVideo, config.slots, getSlotIndex]);

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
    <div className="min-h-screen bg-[#101217] text-[#F6F1E8] flex flex-col font-sans select-none">
      
      {/* Top Bar */}
      <header className="h-16 border-b border-[#303239] bg-[#15171C] px-5 flex items-center justify-between z-10">
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              speechEngine.stop();
              onBackToSetup();
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#15171C] hover:bg-[#272A31] border border-[#303239] text-xs uppercase font-medium text-white transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            BACK TO SETUP
          </button>

          <div className="h-4 w-px bg-[#303239]" />

          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#5CFFB0] inline-block"></span>
            <span className="font-bold text-xs uppercase text-white tracking-widest">
              FINGERCONTROL
            </span>
            <span className="text-[10px] text-[#92949A] bg-[#15171C] border border-[#303239] px-2 py-0.5 rounded uppercase">
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
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-[#15171C] hover:bg-[#272A31] border border-[#303239] text-xs uppercase font-medium text-[#D8D3CA] hover:text-white transition-colors cursor-pointer"
            title="Click to test speech synthesis sound"
          >
            <Volume2 className="w-3.5 h-3.5 text-[#5CFFB0]" />
            <span className="hidden sm:inline">TEST SOUND</span>
          </button>

          {/* Tracking toggle */}
          <button
            onClick={() => onUpdateConfig({ ...config, trackingVisible: !config.trackingVisible })}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs uppercase font-medium border transition-colors cursor-pointer ${
              config.trackingVisible
                ? 'bg-[#272A31] border-[#5CFFB0]/50 text-white'
                : 'bg-[#15171C] border-[#303239] text-[#92949A]'
            }`}
            title="Toggle Tracking Overlay"
          >
            {config.trackingVisible ? <Eye className="w-3.5 h-3.5 text-[#5CFFB0]" /> : <EyeOff className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">TRACKING</span>
          </button>

          {/* Mirror toggle */}
          <button
            onClick={() => onUpdateConfig({ ...config, mirroredVideo: !config.mirroredVideo })}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs uppercase font-medium border transition-colors cursor-pointer ${
              config.mirroredVideo
                ? 'bg-[#272A31] border-[#5CFFB0] text-white'
                : 'bg-[#15171C] border-[#303239] text-[#92949A]'
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
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#15171C] hover:bg-[#272A31] border border-[#303239] text-xs uppercase font-medium text-white transition-colors cursor-pointer"
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
                  ? 'bg-[#5CFFB0] text-[#101217] animate-pulse'
                  : 'bg-[#5CFFB0] hover:bg-[#42E69A] text-[#101217]'
              }`}
              title="Record Live Camera Performance"
            >
              <Circle className="w-3.5 h-3.5 fill-current" />
              {isRecording ? `REC (${recordingSeconds}s)` : 'RECORD'}
            </button>
          ) : completedExport ? (
            <a
              href={completedExport.url}
              download={completedExport.fileName}
              className="flex items-center gap-2 px-3.5 py-1.5 rounded text-xs font-bold uppercase tracking-wider bg-[#5CFFB0] hover:bg-[#42E69A] text-[#101217] transition-colors shadow-sm cursor-pointer"
              title="Save the completed processed video"
            >
              <Download className="w-3.5 h-3.5" />
              SAVE VIDEO
            </a>
          ) : (
            <button
              onClick={handleExportVideo}
              disabled={isExporting}
              className="flex items-center gap-2 px-3.5 py-1.5 rounded text-xs font-bold uppercase tracking-wider bg-[#5CFFB0] hover:bg-[#42E69A] disabled:opacity-60 text-[#101217] transition-colors shadow-sm cursor-pointer"
              title="Render and download the processed display video"
            >
              <Download className="w-3.5 h-3.5" />
              {exportStage === 'preparing'
                ? 'PREPARING AUDIO…'
                : exportStage === 'rendering'
                  ? `EXPORTING ${formatTime(currentTime)} / ${formatTime(duration)}`
                  : 'DOWNLOAD VIDEO'}
            </button>
          )}
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col items-center justify-center p-4 bg-[#101217] relative overflow-hidden">
        
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
        <div className="relative max-w-full max-h-[75vh] flex items-center justify-center rounded-lg border border-[#303239] bg-[#000000] shadow-2xl overflow-hidden">
          <canvas
            ref={canvasRef}
            className="max-w-full max-h-[75vh] object-contain block"
          />

          {/* Two-Hand Heart Detected Overlay Badge */}
          {heartDetected && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-[#5CFFB0]/90 backdrop-blur-md text-[#101217] px-4 py-2 rounded-full shadow-lg flex items-center gap-2 animate-bounce z-20">
              <Heart className="w-4 h-4 fill-[#101217]" />
              <span className="text-xs font-bold tracking-wider uppercase">
                TWO-HAND HEART // FULL PHRASE SPEAKING
              </span>
            </div>
          )}
        </div>

        {/* Recording Hint Notice */}
        {inputMode === 'CAMERA' && (
          <div className="mt-2 text-[10px] text-[#92949A] flex items-center gap-1.5">
            <Info className="w-3 h-3 text-[#5CFFB0]" />
            <span>
              Recording: Select "This Tab" and enable "Also share tab audio" in the browser popup to record browser speech synthesis.
            </span>
          </div>
        )}

        {/* Upload Mode: Interactive Playback & Event Timeline */}
        {inputMode === 'UPLOAD_VIDEO' && (
          <div className="w-full max-w-4xl mt-3 bg-[#1C1E24] border border-[#303239] rounded-md p-3 space-y-2 text-xs">
            {/* Timeline Controls */}
            <div className="flex items-center gap-3">
              <button
                onClick={togglePlayPause}
                className="p-2 rounded bg-[#15171C] hover:bg-[#272A31] border border-[#303239] text-white transition-colors cursor-pointer"
                title={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              </button>

              <span className="text-[11px] font-mono text-[#92949A] shrink-0">
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
                  className="w-full h-1.5 bg-[#15171C] rounded-lg appearance-none cursor-pointer accent-[#5CFFB0]"
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
                            ? 'bg-white z-10 ring-2 ring-[#5CFFB0]'
                            : 'bg-[#5CFFB0] hover:bg-white hover:scale-125 opacity-80'
                        }`}
                        title={`${ev.hand.toUpperCase()} ${ev.finger.toUpperCase()}: "${ev.text}" at ${ev.startTime.toFixed(2)}s`}
                      />
                    );
                  })}
              </div>

              <span className="text-[10px] text-[#92949A] uppercase shrink-0">
                {gestureEvents.length} DETECTED EVENTS
              </span>
            </div>

            {/* Selected Event Details & Deletion */}
            {selectedEventId && (
              <div className="flex items-center justify-between bg-[#15171C] border border-[#303239] px-3 py-1.5 rounded text-[11px]">
                {(() => {
                  const ev = gestureEvents.find((e) => e.id === selectedEventId);
                  if (!ev) return null;
                  return (
                    <>
                      <div className="flex items-center gap-3">
                        <span className="text-[#5CFFB0] font-bold uppercase">
                          [{ev.hand.toUpperCase()} {ev.finger.toUpperCase()}]
                        </span>
                        <span className="text-white font-medium">"{ev.text}"</span>
                        <span className="text-[#92949A] flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {ev.startTime.toFixed(2)}s - {ev.releaseTime.toFixed(2)}s
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleDeleteEvent(ev.id)}
                          className="text-[#92949A] hover:text-[#5CFFB0] flex items-center gap-1 transition-colors cursor-pointer"
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
