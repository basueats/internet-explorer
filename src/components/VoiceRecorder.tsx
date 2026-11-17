import React, { useEffect, useRef, useState } from 'react';
import { Mic, Send, Square, Trash2 } from 'lucide-react';
import { formatDuration } from '../lib/media';

export interface RecordedVoiceNote {
  audioDataUrl: string;
  durationSec: number;
  waveform: number[];
}

interface VoiceRecorderProps {
  onSendVoice: (voice: RecordedVoiceNote) => void;
  onCancel: () => void;
}

export const VoiceRecorder: React.FC<VoiceRecorderProps> = ({
  onSendVoice,
  onCancel,
}) => {
  const [status, setStatus] = useState<'initializing' | 'recording' | 'preview' | 'error'>(
    'initializing'
  );
  const [errorText, setErrorText] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [liveBars, setLiveBars] = useState<number[]>(new Array(24).fill(0.15));
  const [recordedNote, setRecordedNote] = useState<RecordedVoiceNote | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const samplesHistoryRef = useRef<number[]>([]);
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const shouldAutoSendRef = useRef<boolean>(false);

  const cleanupMedia = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      audioCtxRef.current.close().catch(() => undefined);
      audioCtxRef.current = null;
    }
  };

  useEffect(() => {
    let cancelled = false;

    async function startRecording() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setStatus('error');
        setErrorText('Audio recording is not supported in this browser.');
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
          },
        });

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;

        const AudioContextCtor =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const audioCtx = new AudioContextCtor();
        audioCtxRef.current = audioCtx;
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 64;
        source.connect(analyser);

        const preferredMime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : MediaRecorder.isTypeSupported('audio/mp4')
            ? 'audio/mp4'
            : '';

        const recorder = preferredMime
          ? new MediaRecorder(stream, { mimeType: preferredMime })
          : new MediaRecorder(stream);

        mediaRecorderRef.current = recorder;
        chunksRef.current = [];
        samplesHistoryRef.current = [];

        recorder.ondataavailable = (ev) => {
          if (ev.data.size > 0) {
            chunksRef.current.push(ev.data);
          }
        };

        recorder.onstop = () => {
          const durationSec = Math.max(
            1,
            Math.round((Date.now() - startTimeRef.current) / 1000)
          );
          const blob = new Blob(chunksRef.current, {
            type: recorder.mimeType || 'audio/webm',
          });

          // Downsample collected amplitude history into 28 clean bars
          const history = samplesHistoryRef.current;
          const barCount = 28;
          const waveform: number[] = [];
          if (history.length === 0) {
            for (let i = 0; i < barCount; i++) waveform.push(0.25);
          } else {
            for (let i = 0; i < barCount; i++) {
              const idx = Math.floor((i / barCount) * history.length);
              waveform.push(Math.max(0.14, Math.min(1, history[idx] ?? 0.2)));
            }
          }

          const reader = new FileReader();
          reader.onloadend = () => {
            const audioDataUrl = reader.result as string;
            const result: RecordedVoiceNote = {
              audioDataUrl,
              durationSec,
              waveform,
            };
            cleanupMedia();
            if (shouldAutoSendRef.current) {
              onSendVoice(result);
            } else {
              setRecordedNote(result);
              setStatus('preview');
            }
          };
          reader.readAsDataURL(blob);
        };

        recorder.start(150);
        startTimeRef.current = Date.now();
        setStatus('recording');

        timerRef.current = setInterval(() => {
          const secs = Math.floor((Date.now() - startTimeRef.current) / 1000);
          setElapsedSec(secs);
          if (secs >= 180) {
            // 3 minute cap for smooth encrypted storage
            shouldAutoSendRef.current = false;
            recorder.stop();
          }
        }, 250);

        const freqData = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          if (cancelled) return;
          analyser.getByteFrequencyData(freqData);
          let sum = 0;
          for (let i = 0; i < freqData.length; i++) {
            sum += freqData[i];
          }
          const avg = sum / (freqData.length * 255);
          const level = Math.max(0.12, Math.min(1, avg * 2.2));
          samplesHistoryRef.current.push(level);
          setLiveBars((prev) => [...prev.slice(1), level]);
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      } catch (err) {
        setStatus('error');
        setErrorText(
          err instanceof Error && err.name === 'NotAllowedError'
            ? 'Microphone permission was denied. Allow mic access in browser settings to send voice notes.'
            : 'Could not access microphone.'
        );
      }
    }

    startRecording();

    return () => {
      cancelled = true;
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        try {
          mediaRecorderRef.current.onstop = null;
          mediaRecorderRef.current.stop();
        } catch {
          // Ignore
        }
      }
      cleanupMedia();
    };
  }, []);

  const handleStopForPreview = () => {
    shouldAutoSendRef.current = false;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  };

  const handleStopAndSend = () => {
    shouldAutoSendRef.current = true;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  };

  if (status === 'error') {
    return (
      <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60">
        <p className="text-xs sm:text-sm text-red-700 dark:text-red-300">{errorText}</p>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-[40px] px-3 text-xs font-semibold text-red-700 dark:text-red-200 hover:underline whitespace-nowrap shrink-0"
        >
          Dismiss
        </button>
      </div>
    );
  }

  if (status === 'preview' && recordedNote) {
    return (
      <div className="flex items-center gap-3 px-3.5 py-2.5 rounded-2xl bg-slate-100 dark:bg-[#161C28] border border-slate-200 dark:border-slate-800">
        <button
          type="button"
          onClick={onCancel}
          aria-label="Discard voice note"
          className="min-h-[44px] min-w-[44px] rounded-xl text-slate-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 flex items-center justify-center transition-colors shrink-0"
        >
          <Trash2 className="w-4 h-4" />
        </button>

        <audio controls src={recordedNote.audioDataUrl} className="h-9 flex-1 min-w-0" />

        <span className="font-mono tabular-nums text-xs text-slate-500 dark:text-slate-400 shrink-0">
          {formatDuration(recordedNote.durationSec)}
        </span>

        <button
          type="button"
          onClick={() => onSendVoice(recordedNote)}
          aria-label="Encrypt and send voice note"
          className="min-h-[44px] px-4 rounded-xl bg-[#2C6BED] hover:bg-[#2359C9] text-white text-sm font-semibold flex items-center gap-2 transition-colors shrink-0"
        >
          <Send className="w-4 h-4" />
          <span className="hidden sm:inline">Send</span>
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 px-3.5 py-2 rounded-2xl bg-slate-100 dark:bg-[#161C28] border border-slate-200 dark:border-slate-800">
      <button
        type="button"
        onClick={onCancel}
        aria-label="Cancel voice recording"
        className="min-h-[44px] min-w-[44px] rounded-xl text-slate-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 flex items-center justify-center transition-colors shrink-0"
      >
        <Trash2 className="w-4 h-4" />
      </button>

      <div className="flex items-center gap-2 shrink-0">
        <Mic className="w-4 h-4 text-red-600 dark:text-red-400" aria-hidden="true" />
        <span className="font-mono tabular-nums text-sm font-medium text-slate-900 dark:text-white">
          {formatDuration(elapsedSec)}
        </span>
      </div>

      {/* Live audio waveform */}
      <div
        aria-hidden="true"
        className="flex-1 h-8 flex items-center justify-center gap-1 overflow-hidden px-2"
      >
        {liveBars.map((level, idx) => (
          <span
            key={idx}
            style={{ transform: `scaleY(${Math.max(0.18, level)})` }}
            className="w-1 h-7 rounded-full bg-[#2C6BED] dark:bg-blue-400 origin-center transition-transform duration-75"
          />
        ))}
      </div>

      <button
        type="button"
        onClick={handleStopForPreview}
        aria-label="Stop and preview voice note"
        className="min-h-[44px] min-w-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-800 flex items-center justify-center gap-1.5 text-xs font-medium transition-colors shrink-0"
      >
        <Square className="w-3.5 h-3.5 fill-current" />
        <span className="hidden sm:inline">Preview</span>
      </button>

      <button
        type="button"
        onClick={handleStopAndSend}
        aria-label="Stop and send encrypted voice note"
        className="min-h-[44px] px-4 rounded-xl bg-[#2C6BED] hover:bg-[#2359C9] text-white text-sm font-semibold flex items-center gap-2 transition-colors shrink-0"
      >
        <Send className="w-4 h-4" />
        <span className="hidden sm:inline">Send</span>
      </button>
    </div>
  );
};
