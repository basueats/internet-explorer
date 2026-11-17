import React, { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { formatDuration } from '../lib/media';

interface VoiceMessagePlayerProps {
  audioDataUrl: string;
  durationSec: number;
  waveform: number[];
  isMine: boolean;
}

const DEFAULT_WAVEFORM = [
  0.3, 0.55, 0.4, 0.8, 0.65, 0.45, 0.9, 0.7, 0.35, 0.6, 0.85, 0.5, 0.4, 0.75,
  0.95, 0.6, 0.35, 0.5, 0.7, 0.45, 0.65, 0.8, 0.4, 0.55, 0.3, 0.45, 0.6, 0.35,
];

export const VoiceMessagePlayer: React.FC<VoiceMessagePlayerProps> = ({
  audioDataUrl,
  durationSec,
  waveform,
  isMine,
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [actualDuration, setActualDuration] = useState(durationSec || 1);
  const [playbackRate, setPlaybackRate] = useState<1 | 1.5 | 2>(1);

  const bars = waveform && waveform.length > 0 ? waveform : DEFAULT_WAVEFORM;

  useEffect(() => {
    const audio = new Audio(audioDataUrl);
    audioRef.current = audio;

    const handleLoadedMetadata = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setActualDuration(audio.duration);
      }
    };
    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };
    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.pause();
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [audioDataUrl]);

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      try {
        audio.playbackRate = playbackRate;
        await audio.play();
        setIsPlaying(true);
      } catch {
        setIsPlaying(false);
      }
    }
  };

  const cycleSpeed = () => {
    const next: 1 | 1.5 | 2 = playbackRate === 1 ? 1.5 : playbackRate === 1.5 ? 2 : 1;
    setPlaybackRate(next);
    if (audioRef.current) {
      audioRef.current.playbackRate = next;
    }
  };

  const seekToRatio = (ratio: number) => {
    const audio = audioRef.current;
    if (!audio || !actualDuration) return;
    const clamped = Math.max(0, Math.min(1, ratio));
    audio.currentTime = clamped * actualDuration;
    setCurrentTime(audio.currentTime);
  };

  const progress = actualDuration > 0 ? currentTime / actualDuration : 0;

  return (
    <div className="flex items-center gap-2.5 min-w-[230px] sm:min-w-[270px]">
      <button
        type="button"
        onClick={togglePlay}
        aria-label={isPlaying ? 'Pause voice note' : 'Play voice note'}
        className="min-h-[44px] min-w-[44px] rounded-full bg-[#2C6BED] hover:bg-[#2359C9] text-white flex items-center justify-center transition-colors shrink-0"
      >
        {isPlaying ? (
          <Pause className="w-4 h-4 fill-current" />
        ) : (
          <Play className="w-4 h-4 fill-current ml-0.5" />
        )}
      </button>

      <div className="flex-1 min-w-0 space-y-1.5">
        <div
          role="slider"
          aria-label="Voice note progress"
          aria-valuemin={0}
          aria-valuemax={Math.round(actualDuration)}
          aria-valuenow={Math.round(currentTime)}
          tabIndex={0}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            seekToRatio((e.clientX - rect.left) / rect.width);
          }}
          className="h-7 flex items-center gap-[3px] cursor-pointer"
        >
          {bars.map((amp, idx) => {
            const barRatio = idx / bars.length;
            const active = barRatio <= progress;
            return (
              <span
                key={idx}
                style={{ height: `${Math.max(20, Math.round(amp * 100))}%` }}
                className={`flex-1 min-w-[2px] rounded-full transition-colors ${
                  active
                    ? 'bg-[#2C6BED] dark:bg-blue-400'
                    : isMine
                      ? 'bg-blue-300/70 dark:bg-blue-800'
                      : 'bg-slate-300 dark:bg-slate-600'
                }`}
              />
            );
          })}
        </div>

        <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-600 dark:text-slate-300">
          <span>
            {isPlaying || currentTime > 0
              ? `${formatDuration(currentTime)} / ${formatDuration(actualDuration)}`
              : formatDuration(actualDuration)}
          </span>
          <button
            type="button"
            onClick={cycleSpeed}
            aria-label={`Playback speed ${playbackRate}x`}
            className="px-1.5 py-0.5 rounded font-semibold hover:bg-black/5 dark:hover:bg-white/10 text-slate-700 dark:text-slate-200 transition-colors"
          >
            {playbackRate}x
          </button>
        </div>
      </div>
    </div>
  );
};
