import React from 'react';
import { motion as _motion, AnimatePresence } from 'framer-motion';
import { ShieldCheck, Check, X } from 'lucide-react';
import { useUIStore } from '../../store/useUIStore';
import { resolveToolConfirm } from '../../services/geminiLive/toolConfirmation';
import { AudioGraph } from '../../services/audioGraph';

const motion = _motion as any;

/**
 * Real confirmation gate for destructive Gemini Live tool calls.
 * Rendered only while a dispatcher pause is waiting (pendingToolConfirm set
 * by requestToolConfirm). Confirm resumes execution; cancel returns an
 * explicit {cancelled:true} result to the model without running anything.
 */
export const ToolConfirmSheet: React.FC = () => {
  const pending = useUIStore((s) => s.pendingToolConfirm);

  const decide = (approved: boolean) => {
    const callId = (pending?.payload?.callId as string) || '';
    AudioGraph.getInstance().playTickSound();
    if (callId) resolveToolConfirm(callId, approved);
    else useUIStore.getState().setPendingToolConfirm(null);
  };

  return (
    <AnimatePresence>
      {pending && (
        <div className="pointer-events-auto fixed inset-0 z-[5000] flex items-end justify-center">
          <motion.button
            type="button"
            aria-label="بستن"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => decide(false)}
            className="rava-modal-backdrop absolute inset-0"
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 32, stiffness: 300 }}
            className="rava-sheet relative w-full max-w-lg px-6 pb-safe pt-6"
          >
            <div className="mb-5 flex items-center justify-end gap-3">
              <div className="text-right">
                <h3 className="rava-page-title flex items-center justify-end gap-2">
                  {pending.label}
                  <ShieldCheck size={20} className="text-rava-gold" />
                </h3>
                <p className="rava-page-subtitle mt-1">راوا قبل از اجرا اجازه می‌گیرد</p>
              </div>
            </div>
            <div className="flex gap-2 pb-4">
              <button
                type="button"
                onClick={() => decide(true)}
                className="rava-btn rava-btn-primary min-h-btn-md flex-1 gap-2 px-5 text-rava-base"
              >
                <Check size={18} /> تأیید
              </button>
              <button
                type="button"
                onClick={() => decide(false)}
                className="rava-btn min-h-btn-md flex-1 gap-2 border border-white/10 bg-white/5 px-5 text-rava-base font-extrabold text-white/70"
              >
                <X size={18} /> لغو
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
