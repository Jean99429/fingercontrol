import React, { useState, useEffect, useCallback } from 'react';
import { FingercontrolConfig, GestureEvent, VideoAnalysisFrame } from './types/config';
import { loadConfig, saveConfig } from './utils/storage';
import { SetupScreen } from './components/SetupScreen';
import { PerformanceScreen } from './components/PerformanceScreen';
import { gestureRecognizer } from './vision/gestureRecognizer';
import { audioManager } from './utils/audio';

export const App: React.FC = () => {
  const [currentScreen, setCurrentScreen] = useState<'SETUP' | 'PERFORMANCE'>('SETUP');
  const [inputMode, setInputMode] = useState<'CAMERA' | 'UPLOAD_VIDEO'>('CAMERA');
  const [config, setConfig] = useState<FingercontrolConfig>(() => loadConfig());

  // Camera State
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');

  // Upload Video State
  const [displayVideoFile, setDisplayVideoFile] = useState<File | null>(null);
  const [trackingVideoFile, setTrackingVideoFile] = useState<File | null>(null);
  const [displayVideoUrl, setDisplayVideoUrl] = useState<string | null>(null);
  const [trackingVideoUrl, setTrackingVideoUrl] = useState<string | null>(null);
  const [displayVideoMeta, setDisplayVideoMeta] = useState<{ duration: number; width: number; height: number } | null>(null);
  const [trackingVideoMeta, setTrackingVideoMeta] = useState<{ duration: number; width: number; height: number } | null>(null);

  // Video Analysis State
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [analysisProgress, setAnalysisProgress] = useState<number>(0);
  const [analysisStatus, setAnalysisStatus] = useState<string>('');
  const [gestureEvents, setGestureEvents] = useState<GestureEvent[]>([]);
  const [analysisFrames, setAnalysisFrames] = useState<VideoAnalysisFrame[]>([]);

  // Errors & Notifications
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Enumerate camera devices
  const refreshDevices = useCallback(async () => {
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const vDevices = devices.filter((d) => d.kind === 'videoinput');
        setVideoDevices(vDevices);
        if (vDevices.length > 0 && !selectedDeviceId) {
          setSelectedDeviceId(vDevices[0].deviceId);
        }
      }
    } catch (e) {
      console.warn('Error enumerating devices:', e);
    }
  }, [selectedDeviceId]);

  useEffect(() => {
    refreshDevices();
  }, [refreshDevices]);

  // Persist config changes
  const handleUpdateConfig = (newConfig: FingercontrolConfig) => {
    setConfig(newConfig);
    saveConfig(newConfig);
  };

  // Manage Display Video file selection & metadata extraction
  const handleSelectDisplayVideo = (file: File) => {
    if (displayVideoUrl) {
      URL.revokeObjectURL(displayVideoUrl);
    }
    const url = URL.createObjectURL(file);
    setDisplayVideoFile(file);
    setDisplayVideoUrl(url);
    setErrorMessage(null);

    const tempVideo = document.createElement('video');
    tempVideo.src = url;
    tempVideo.preload = 'metadata';
    tempVideo.onloadedmetadata = () => {
      setDisplayVideoMeta({
        duration: tempVideo.duration,
        width: tempVideo.videoWidth,
        height: tempVideo.videoHeight,
      });
    };
    tempVideo.onerror = () => {
      setErrorMessage('Could not decode display video. Please select a valid MP4 or WebM file.');
    };
  };

  // Manage Tracking Video file selection & metadata extraction
  const handleSelectTrackingVideo = (file: File | null) => {
    if (trackingVideoUrl) {
      URL.revokeObjectURL(trackingVideoUrl);
    }
    if (!file) {
      setTrackingVideoFile(null);
      setTrackingVideoUrl(null);
      setTrackingVideoMeta(null);
      return;
    }

    const url = URL.createObjectURL(file);
    setTrackingVideoFile(file);
    setTrackingVideoUrl(url);

    const tempVideo = document.createElement('video');
    tempVideo.src = url;
    tempVideo.preload = 'metadata';
    tempVideo.onloadedmetadata = () => {
      setTrackingVideoMeta({
        duration: tempVideo.duration,
        width: tempVideo.videoWidth,
        height: tempVideo.videoHeight,
      });
    };
  };

  // Launch Camera Mode
  const handleStartCamera = async () => {
    setErrorMessage(null);

    // 1. Initialize Audio Context on user click
    try {
      audioManager.initAudioContext();
    } catch (e) {
      console.warn('AudioContext init error:', e);
    }

    // 2. Request Camera access
    try {
      const constraints: MediaStreamConstraints = {
        video: selectedDeviceId
          ? { deviceId: { exact: selectedDeviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
          : { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      setCameraStream(stream);
      refreshDevices();
    } catch (err: unknown) {
      console.warn('Camera access denied or failed:', err);
      setErrorMessage(
        'Camera permission was denied or camera is inaccessible. Please allow camera access in your browser settings to continue.'
      );
      return;
    }

    // 3. Initialize Vision Model
    await gestureRecognizer.initialize();

    setCurrentScreen('PERFORMANCE');
  };

  // Analyze Uploaded Video Frame by Frame
  const handleStartAnalyzeVideo = async () => {
    if (!displayVideoFile || !displayVideoUrl) {
      setErrorMessage('Please select a display video first.');
      return;
    }

    setErrorMessage(null);
    setIsAnalyzing(true);
    setAnalysisProgress(0);
    setAnalysisStatus('INITIALIZING VISION TRACKER...');

    // 1. Initialize Audio Context
    try {
      audioManager.initAudioContext();
    } catch (e) {
      console.warn('AudioContext init error:', e);
    }

    try {
      // 2. Create offscreen video element for analysis
      // Use tracking video if provided, otherwise display video
      const targetUrl = trackingVideoUrl || displayVideoUrl;
      const analysisVideo = document.createElement('video');
      analysisVideo.src = targetUrl;
      analysisVideo.muted = true;
      analysisVideo.playsInline = true;

      await new Promise<void>((resolve, reject) => {
        analysisVideo.onloadedmetadata = () => resolve();
        analysisVideo.onerror = () => reject(new Error('Failed to load video for analysis'));
      });

      // 3. Perform frame-by-frame MediaPipe Hand Landmarker analysis
      const result = await gestureRecognizer.analyzeVideo(
        analysisVideo,
        config.slots,
        config.mirroredVideo,
        (progress, status) => {
          setAnalysisProgress(progress);
          setAnalysisStatus(status);
        }
      );

      setGestureEvents(result.events);
      setAnalysisFrames(result.frames);
      setIsAnalyzing(false);
      setCurrentScreen('PERFORMANCE');
    } catch (err: unknown) {
      console.error('Video analysis error:', err);
      setIsAnalyzing(false);
      setErrorMessage(
        'An error occurred during video analysis. Please ensure the video format is supported by your browser.'
      );
    }
  };

  // Back to Setup Screen
  const handleBackToSetup = () => {
    // Stop camera stream if active
    if (cameraStream) {
      cameraStream.getTracks().forEach((t) => t.stop());
      setCameraStream(null);
    }
    audioManager.stopAll();
    setCurrentScreen('SETUP');
  };

  // Re-run analysis
  const handleReanalyze = () => {
    handleBackToSetup();
    // Re-trigger analysis after returning
    setTimeout(() => {
      handleStartAnalyzeVideo();
    }, 100);
  };

  return (
    <div className="w-full min-h-screen bg-[#07111F]">
      {currentScreen === 'SETUP' ? (
        <SetupScreen
          config={config}
          onUpdateConfig={handleUpdateConfig}
          inputMode={inputMode}
          onChangeInputMode={setInputMode}
          videoDevices={videoDevices}
          selectedDeviceId={selectedDeviceId}
          onSelectDeviceId={setSelectedDeviceId}
          onStartCamera={handleStartCamera}
          displayVideoFile={displayVideoFile}
          trackingVideoFile={trackingVideoFile}
          displayVideoMeta={displayVideoMeta}
          trackingVideoMeta={trackingVideoMeta}
          onSelectDisplayVideo={handleSelectDisplayVideo}
          onSelectTrackingVideo={handleSelectTrackingVideo}
          onStartAnalyzeVideo={handleStartAnalyzeVideo}
          isAnalyzing={isAnalyzing}
          analysisProgress={analysisProgress}
          analysisStatus={analysisStatus}
          errorMessage={errorMessage}
        />
      ) : (
        <PerformanceScreen
          inputMode={inputMode}
          config={config}
          onUpdateConfig={handleUpdateConfig}
          onBackToSetup={handleBackToSetup}
          cameraStream={cameraStream}
          displayVideoUrl={displayVideoUrl}
          gestureEvents={gestureEvents}
          onUpdateGestureEvents={setGestureEvents}
          analysisFrames={analysisFrames}
          onReanalyze={handleReanalyze}
        />
      )}
    </div>
  );
};

export default App;
