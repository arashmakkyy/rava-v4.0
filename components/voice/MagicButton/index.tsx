import React from 'react';
import { motion as _motion, AnimatePresence } from 'framer-motion';
import { MessageSquare, Zap, X } from 'lucide-react';
import { useUIStore } from '../../../store/useUIStore';
import { useGeminiLive } from '../../../hooks/useGeminiLive';
import { AudioVisualizer } from '../AudioVisualizer';
import { StatusRing } from './StatusRing';
import { MicTrigger } from './MicTrigger';
import { ControlActions } from './ControlActions';

const motion = _motion as any;

export const MagicButton: React.FC = () => {
  const isRecording = useUIStore((s) => s.isRecording);
  const isSpeaking = useUIStore((s) => s.isSpeaking);
  const isThinking = useUIStore((s) => s.isThinking);
  const showTranscript = useUIStore((s) => s.showTranscript);
  const captions = useUIStore((s) => s.captions);
  const setShowTranscript = useUIStore((s) => s.setShowTranscript);
  const voiceError = useUIStore((s) => s.voiceError);
  const setVoiceError = useUIStore((s) => s.setVoiceError);

  const { connect, disconnect, interrupt } = useGeminiLive();

  return (
    <div
      className="fixed inset-x-0 z-[1500] flex flex-col items-center gap-3 pointer-events-none"
      style={{ bottom: 'var(--magic-button-bottom)' }}
    >
      <AnimatePresence>
        {captions.user && isRecording && !isSpeaking && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="glass max-w-[72%] rounded-xl px-4 py-2 text-center text-rava-xs font-bold text-white/60 shadow-glass"
          >
            شما: {captions.user}
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
          e.stopPropagation();
          setShowTranscript(!showTranscript);
        }}
        className="pointer-events-auto flex items-center gap-2 rounded-rava-md border border-white/5 glass px-3 py-1.5 text-rava-xs font-bold text-white/40"
      >
        <MessageSquare size={12} />
        {showTranscript ? 'پنهان' : 'متن'}
      </motion.button>

      <AnimatePresence>
        {(isRecording || isSpeaking || isThinking) && (
          <motion.div
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.92 }}
            className="glass flex items-center gap-3 rounded-full border border-white/10 px-4 py-2 shadow-glass"
          >
            {isThinking && !isSpeaking ? (
              <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}>
                <Zap size={14} className="text-rava-gold" />
              </motion.div>
            ) : (
              <AudioVisualizer isActive={isRecording || isSpeaking} />
            )}
            <span className="text-rava-xs font-black tracking-wide text-rava-gold">
              {isSpeaking ? 'راوا در حال پاسخ است' : isThinking ? 'در حال فکر کردن' : 'در حال گوش دادن'}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {voiceError && !isRecording && !isSpeaking && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="glass pointer-events-auto flex max-w-[80%] items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-center shadow-glass"
          >
            <span className="flex-1 text-rava-xs font-bold leading-relaxed text-red-200">{voiceError}</span>
            <button
              type="button"
              aria-label="بستن خطا"
              onClick={() => setVoiceError(null)}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-red-300/70 transition-colors hover:text-red-200"
            >
              <X size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="relative flex h-20 w-full items-center justify-center pointer-events-none">
        <div className="absolute inset-0 flex items-center justify-center scale-75">
          <StatusRing />
        </div>

        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <ControlActions onDisconnect={disconnect} onInterrupt={interrupt} />
        </div>

        <div className="relative z-20 scale-90 pointer-events-auto">
          <MicTrigger onStart={connect} />
        </div>
      </div>
    </div>
  );
};
