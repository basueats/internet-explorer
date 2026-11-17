import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  ExternalLink,
  FolderOpen,
  Mic,
  RefreshCw,
  RotateCcw,
  Send,
  Square,
  SwitchCamera,
  Video,
  X,
} from 'lucide-react';
import { readFileAsDataUrl } from '../lib/device';
import { formatDuration, scrubAndCompressImage } from '../lib/media';

interface CameraModalProps {
  onSendPhoto: (photo: {
    dataUrl: string;
    width: number;
    height: number;
    caption?: string;
  }) => void;
  onSendVideo: (video: {
    dataUrl: string;
    mime: string;
    size: number;
    caption?: string;
  }) => void;
  onFallbackUpload?: () => void;
  onClose: () => void;
}

export const CameraModal: React.FC<CameraModalProps> = ({
  onSendPhoto,
  onSendVideo,
  onFallbackUpload,
  onClose,
}) => {
  const [captureMode, setCaptureMode] = useState<'photo' | 'video'>('photo');
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('user');
  const [includeAudio, setIncludeAudio] = useState(true);
  const [isStreamReady, setIsStreamReady] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSec, setRecordingSec] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [captureActionError, setCaptureActionError] = useState<string | null>(null);
  const [audioFallbackNotice, setAudioFallbackNotice] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  const [capturedPhoto, setCapturedPhoto] = useState<{
    dataUrl: string;
    width: number;
    height: number;
  } | null>(null);

  const [capturedVideo, setCapturedVideo] = useState<{
    dataUrl: string;
    mime: string;
    size: number;
  } | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const nativePhotoInputRef = useRef<HTMLInputElement | null>(null);
  const nativeVideoInputRef = useRef<HTMLInputElement | null>(null);

  const stopStream = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setIsStreamReady(false);
  };

  useEffect(() => {
    if (capturedPhoto || capturedVideo) {
      stopStream();
      return;
    }

    let cancelled = false;
    async function openCamera() {
      stopStream();
      setErrorMsg(null);
      setCaptureActionError(null);
      setAudioFallbackNotice(false);

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setErrorMsg(
          'Live viewfinder is unavailable in this browser context. Use your device camera or choose a photo/video file below.'
        );
        return;
      }

      const wantAudio = captureMode === 'video' && includeAudio;

      const attempts: MediaStreamConstraints[] = [
        {
          video: { facingMode: { ideal: facingMode }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: wantAudio,
        },
        { video: { facingMode }, audio: wantAudio },
        { video: true, audio: wantAudio },
      ];
      if (wantAudio) {
        attempts.push({ video: true, audio: false });
      }

      let lastErr: unknown = null;
      for (let i = 0; i < attempts.length; i++) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia(attempts[i]);
          if (cancelled) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          if (wantAudio && attempts[i].audio === false) {
            setAudioFallbackNotice(true);
          }
          streamRef.current = stream;
          const videoEl = videoRef.current;
          if (videoEl) {
            videoEl.srcObject = stream;
            try {
              await videoEl.play();
            } catch {
              // Autoplay handled on metadata load
            }
          }
          return;
        } catch (err) {
          lastErr = err;
        }
      }

      const errName = lastErr instanceof Error ? lastErr.name : '';
      if (errName === 'NotAllowedError' || errName === 'SecurityError') {
        setErrorMsg(
          'Live camera is blocked in this embedded preview. Allow camera access in your browser, open Internet Edge in a new tab for live viewfinder, or capture directly with your device camera below.'
        );
      } else if (errName === 'NotReadableError' || errName === 'AbortError') {
        setErrorMsg(
          'Your camera is currently busy in another app or tab. Close other camera apps and click Retry Camera, or capture/upload below.'
        );
      } else {
        setErrorMsg(
          'No live camera detected in this view. Use your device camera capture or upload a photo/video file below.'
        );
      }
    }

    openCamera();

    return () => {
      cancelled = true;
      stopStream();
    };
  }, [facingMode, captureMode, includeAudio, capturedPhoto, capturedVideo, retryNonce]);

  const handleTakePhoto = () => {
    setCaptureActionError(null);
    const videoEl = videoRef.current;
    if (!videoEl || videoEl.videoWidth === 0 || videoEl.videoHeight === 0) {
      setCaptureActionError('Camera feed is still warming up. Wait a moment and try again.');
      return;
    }

    try {
      const maxDim = 1920;
      const scale = Math.min(1, maxDim / Math.max(videoEl.videoWidth, videoEl.videoHeight));
      const targetW = Math.max(1, Math.round(videoEl.videoWidth * scale));
      const targetH = Math.max(1, Math.round(videoEl.videoHeight * scale));

      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        setCaptureActionError('Could not initialize photo canvas.');
        return;
      }

      if (facingMode === 'user') {
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);

      const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
      setCapturedPhoto({
        dataUrl,
        width: canvas.width,
        height: canvas.height,
      });
    } catch {
      setCaptureActionError('Unable to capture photo frame. Try again or use device capture.');
    }
  };

  const handleStartVideoRecording = () => {
    setCaptureActionError(null);
    const stream = streamRef.current;
    if (!stream) {
      setCaptureActionError('Camera stream is not ready yet.');
      return;
    }

    if (typeof MediaRecorder === 'undefined') {
      setCaptureActionError('In-browser video recording is unsupported here. Use Device Video below.');
      return;
    }

    const hasAudioTrack = stream.getAudioTracks().length > 0;
    const candidateMimes = hasAudioTrack
      ? ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm', 'video/mp4']
      : ['video/webm;codecs=vp8', 'video/webm;codecs=vp9', 'video/webm', 'video/mp4'];

    const preferredMime = candidateMimes.find((m) => MediaRecorder.isTypeSupported(m)) || '';

    let recorder: MediaRecorder;
    try {
      recorder = preferredMime
        ? new MediaRecorder(stream, { mimeType: preferredMime, videoBitsPerSecond: 1_200_000 })
        : new MediaRecorder(stream);
    } catch {
      try {
        recorder = new MediaRecorder(stream);
      } catch {
        setCaptureActionError('Could not start video recorder on this device.');
        return;
      }
    }

    recorderRef.current = recorder;
    chunksRef.current = [];
    setRecordingSec(0);

    recorder.ondataavailable = (ev) => {
      if (ev.data.size > 0) chunksRef.current.push(ev.data);
    };

    recorder.onstop = () => {
      setIsRecording(false);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      const mime = recorder.mimeType || 'video/webm';
      const blob = new Blob(chunksRef.current, { type: mime });
      if (blob.size === 0) {
        setCaptureActionError('Recorded video was empty. Please try recording again.');
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setCapturedVideo({
          dataUrl: reader.result as string,
          mime,
          size: blob.size,
        });
      };
      reader.readAsDataURL(blob);
    };

    try {
      recorder.start(250);
      setIsRecording(true);
      const startMs = Date.now();
      timerRef.current = setInterval(() => {
        const secs = Math.floor((Date.now() - startMs) / 1000);
        setRecordingSec(secs);
        if (secs >= 45 && recorder.state === 'recording') {
          recorder.stop();
        }
      }, 250);
    } catch {
      setCaptureActionError('Failed to start video recording.');
    }
  };

  const handleStopVideoRecording = () => {
    if (recorderRef.current && recorderRef.current.state === 'recording') {
      recorderRef.current.stop();
    }
  };

  const handleNativePhotoFile = async (file: File) => {
    setCaptureActionError(null);
    try {
      const scrubbed = await scrubAndCompressImage(file);
      setCapturedPhoto({
        dataUrl: scrubbed.dataUrl,
        width: scrubbed.width,
        height: scrubbed.height,
      });
      setErrorMsg(null);
    } catch (err) {
      setCaptureActionError(
        err instanceof Error ? err.message : 'Could not process captured photo.'
      );
    }
  };

  const handleNativeVideoFile = async (file: File) => {
    setCaptureActionError(null);
    try {
      const dataUrl = await readFileAsDataUrl(file, 16 * 1024 * 1024);
      setCapturedVideo({
        dataUrl,
        mime: file.type || 'video/mp4',
        size: file.size,
      });
      setErrorMsg(null);
    } catch (err) {
      setCaptureActionError(
        err instanceof Error ? err.message : 'Could not process captured video.'
      );
    }
  };

  const handleRetake = () => {
    setCapturedPhoto(null);
    setCapturedVideo(null);
    setCaptureActionError(null);
  };

  const handleSend = () => {
    if (capturedPhoto) {
      onSendPhoto(capturedPhoto);
      return;
    }
    if (capturedVideo) {
      onSendVideo(capturedVideo);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Camera capture"
      className="fixed inset-0 z-50 bg-black/92 backdrop-blur-md flex flex-col text-white"
    >
      {/* Hidden native OS camera inputs for fallback when live viewfinder is blocked */}
      <input
        ref={nativePhotoInputRef}
        type="file"
        accept="image/*"
        capture={facingMode}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleNativePhotoFile(f);
          e.target.value = '';
        }}
      />
      <input
        ref={nativeVideoInputRef}
        type="file"
        accept="video/*"
        capture={facingMode}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleNativeVideoFile(f);
          e.target.value = '';
        }}
      />

      {/* Top Controls */}
      <div className="flex items-center justify-between gap-4 px-4 sm:px-6 py-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold">Camera</span>
          <span className="text-xs text-slate-400">
            {facingMode === 'user' ? 'Front Camera' : 'Back Camera'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {!capturedPhoto && !capturedVideo && (
            <button
              type="button"
              onClick={() =>
                setFacingMode((prev) => (prev === 'user' ? 'environment' : 'user'))
              }
              disabled={isRecording}
              aria-label="Switch between front and back camera"
              className="min-h-[44px] px-3.5 rounded-xl bg-white/10 hover:bg-white/20 disabled:opacity-40 text-xs font-medium flex items-center gap-2 transition-colors"
            >
              <SwitchCamera className="w-4 h-4" />
              <span>{facingMode === 'user' ? 'Back' : 'Front'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              stopStream();
              onClose();
            }}
            aria-label="Close camera"
            className="min-h-[44px] min-w-[44px] rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Viewfinder or Captured Preview */}
      <div className="flex-1 min-h-0 flex items-center justify-center p-4 relative">
        {errorMsg ? (
          <div className="max-w-lg w-full p-6 rounded-2xl bg-slate-900 border border-slate-800 text-center space-y-4">
            <p className="text-sm text-red-300 leading-relaxed">{errorMsg}</p>
            {captureActionError && (
              <p className="text-xs text-amber-300">{captureActionError}</p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => nativePhotoInputRef.current?.click()}
                className="min-h-[44px] px-4 py-2 rounded-xl bg-[#2C6BED] hover:bg-[#2359C9] text-white text-xs font-semibold flex items-center justify-center gap-2"
              >
                <Camera className="w-4 h-4" />
                <span>Capture Photo (Device)</span>
              </button>

              <button
                type="button"
                onClick={() => nativeVideoInputRef.current?.click()}
                className="min-h-[44px] px-4 py-2 rounded-xl bg-white/12 hover:bg-white/20 text-white text-xs font-semibold flex items-center justify-center gap-2"
              >
                <Video className="w-4 h-4" />
                <span>Record Video (Device)</span>
              </button>

              <a
                href={typeof window !== 'undefined' ? window.location.href : '/'}
                target="_blank"
                rel="noopener noreferrer"
                className="min-h-[44px] px-4 py-2 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-200 text-xs font-semibold flex items-center justify-center gap-2"
              >
                <ExternalLink className="w-4 h-4" />
                <span>Open in New Tab</span>
              </a>

              <button
                type="button"
                onClick={() => setRetryNonce((n) => n + 1)}
                className="min-h-[44px] px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-semibold flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Retry Live Camera</span>
              </button>
            </div>

            {onFallbackUpload && (
              <button
                type="button"
                onClick={() => {
                  stopStream();
                  onClose();
                  onFallbackUpload();
                }}
                className="w-full min-h-[42px] px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-200 text-xs font-medium flex items-center justify-center gap-2"
              >
                <FolderOpen className="w-4 h-4" />
                <span>Choose Existing Photo / Video File</span>
              </button>
            )}
          </div>
        ) : capturedPhoto ? (
          <img
            src={capturedPhoto.dataUrl}
            alt="Captured photo preview"
            className="max-h-full max-w-full object-contain rounded-2xl"
          />
        ) : capturedVideo ? (
          <video
            src={capturedVideo.dataUrl}
            controls
            autoPlay
            playsInline
            className="max-h-full max-w-full rounded-2xl bg-black"
          />
        ) : (
          <div className="relative max-h-full max-w-3xl w-full flex flex-col items-center justify-center gap-2">
            {audioFallbackNotice && (
              <div className="px-3 py-1 rounded-lg bg-amber-500/20 text-amber-200 text-xs">
                Microphone unavailable — recording video without audio
              </div>
            )}
            {captureActionError && (
              <div className="px-3 py-1.5 rounded-lg bg-red-500/25 border border-red-400/40 text-red-200 text-xs">
                {captureActionError}
              </div>
            )}
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              onLoadedMetadata={() => setIsStreamReady(true)}
              onPlaying={() => setIsStreamReady(true)}
              className={`max-h-[66dvh] w-auto rounded-2xl bg-slate-950 object-contain ${
                facingMode === 'user' ? '-scale-x-100' : ''
              }`}
            />
            {isRecording && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 px-3.5 py-1.5 rounded-xl bg-red-600 text-white font-mono tabular-nums text-xs font-semibold flex items-center gap-2">
                <span>REC</span>
                <span>{formatDuration(recordingSec)}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom Controls */}
      <div className="px-4 sm:px-6 py-4 border-t border-white/10 space-y-3">
        {capturedPhoto || capturedVideo ? (
          <div className="max-w-md mx-auto flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={handleRetake}
              className="min-h-[46px] px-5 rounded-xl bg-white/10 hover:bg-white/20 text-sm font-medium flex items-center gap-2 shrink-0"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Retake</span>
            </button>

            <button
              type="button"
              onClick={handleSend}
              className="flex-1 min-h-[46px] px-6 rounded-xl bg-[#2C6BED] hover:bg-[#2359C9] text-white text-sm font-semibold flex items-center justify-center gap-2 shrink-0"
            >
              <Send className="w-4 h-4" />
              <span>Send</span>
            </button>
          </div>
        ) : (
          <div className="max-w-md mx-auto flex flex-col items-center gap-3">
            <div className="flex items-center gap-3">
              <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-white/10">
                <button
                  type="button"
                  disabled={isRecording}
                  onClick={() => setCaptureMode('photo')}
                  className={`min-h-[38px] px-4 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                    captureMode === 'photo' ? 'bg-white text-slate-900' : 'text-slate-200'
                  }`}
                >
                  <Camera className="w-3.5 h-3.5" />
                  <span>Photo</span>
                </button>
                <button
                  type="button"
                  disabled={isRecording}
                  onClick={() => setCaptureMode('video')}
                  className={`min-h-[38px] px-4 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                    captureMode === 'video' ? 'bg-white text-slate-900' : 'text-slate-200'
                  }`}
                >
                  <Video className="w-3.5 h-3.5" />
                  <span>Video</span>
                </button>
              </div>

              {captureMode === 'video' && (
                <button
                  type="button"
                  disabled={isRecording}
                  onClick={() => setIncludeAudio((v) => !v)}
                  className={`min-h-[38px] px-3 rounded-xl border text-xs font-medium flex items-center gap-1.5 transition-colors ${
                    includeAudio
                      ? 'border-blue-400/60 bg-blue-500/20 text-blue-200'
                      : 'border-white/20 bg-white/5 text-slate-400'
                  }`}
                >
                  <Mic className="w-3.5 h-3.5" />
                  <span>{includeAudio ? 'Audio On' : 'Muted'}</span>
                </button>
              )}
            </div>

            {captureMode === 'photo' ? (
              <button
                type="button"
                disabled={Boolean(errorMsg) || !isStreamReady}
                onClick={handleTakePhoto}
                aria-label="Capture photo"
                className="w-16 h-16 rounded-full border-4 border-white bg-white/20 hover:bg-white/30 disabled:opacity-30 flex items-center justify-center transition-transform active:scale-95"
              >
                <span className="w-11 h-11 rounded-full bg-white" />
              </button>
            ) : isRecording ? (
              <button
                type="button"
                onClick={handleStopVideoRecording}
                aria-label="Stop video recording"
                className="w-16 h-16 rounded-full border-4 border-white bg-red-600/30 flex items-center justify-center transition-transform active:scale-95"
              >
                <Square className="w-6 h-6 fill-red-500 text-red-500" />
              </button>
            ) : (
              <button
                type="button"
                disabled={Boolean(errorMsg) || !isStreamReady}
                onClick={handleStartVideoRecording}
                aria-label="Start video recording"
                className="w-16 h-16 rounded-full border-4 border-white bg-red-600/20 hover:bg-red-600/35 disabled:opacity-30 flex items-center justify-center transition-transform active:scale-95"
              >
                <span className="w-10 h-10 rounded-full bg-red-600" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
