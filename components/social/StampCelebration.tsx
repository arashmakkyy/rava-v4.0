
import React, { useEffect } from 'react';
import { motion as _motion } from 'framer-motion';
import { Award, Zap, Star, Sparkles } from 'lucide-react';

const motion = _motion as any;

interface StampCelebrationProps {
  placeName: string;
  onComplete: () => void;
}

export const StampCelebration: React.FC<StampCelebrationProps> = ({ placeName, onComplete }) => {
  useEffect(() => {
    // مهندسی صدای "کوبش مهر" (Synthetic Physical Impact)
    const playStampSound = () => {
      try {
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        
        // ۱. صدای برخورد فیزیکی (Square Wave)
        const impact = audioCtx.createOscillator();
        const impactGain = audioCtx.createGain();
        impact.type = 'square';
        impact.frequency.setValueAtTime(150, audioCtx.currentTime);
        impact.frequency.exponentialRampToValueAtTime(40, audioCtx.currentTime + 0.1);
        impactGain.gain.setValueAtTime(0.4, audioCtx.currentTime);
        impactGain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.15);
        impact.connect(impactGain);
        impactGain.connect(audioCtx.destination);

        // ۲. صدای جادویی واریز (Sine Wave)
        const magic = audioCtx.createOscillator();
        const magicGain = audioCtx.createGain();
        magic.type = 'sine';
        magic.frequency.setValueAtTime(800, audioCtx.currentTime + 0.1);
        magic.frequency.exponentialRampToValueAtTime(1200, audioCtx.currentTime + 0.4);
        magicGain.gain.setValueAtTime(0, audioCtx.currentTime + 0.1);
        magicGain.gain.linearRampToValueAtTime(0.2, audioCtx.currentTime + 0.15);
        magicGain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);
        magic.connect(magicGain);
        magicGain.connect(audioCtx.destination);

        impact.start();
        impact.stop(audioCtx.currentTime + 0.15);
        magic.start(audioCtx.currentTime + 0.1);
        magic.stop(audioCtx.currentTime + 0.5);
      } catch (e) {
        console.warn("Audio Context blocked");
      }
    };

    playStampSound();
    const timer = setTimeout(onComplete, 4500);
    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center pointer-events-none p-6">
      <motion.div 
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/80 backdrop-blur-2xl"
      />
      
      <motion.div
        initial={{ scale: 0.5, opacity: 0, rotate: -15 }}
        animate={{ scale: 1, opacity: 1, rotate: 0 }}
        exit={{ scale: 0, opacity: 0 }}
        transition={{ type: "spring", damping: 15 }}
        className="pointer-events-auto relative flex flex-col items-center gap-8 overflow-hidden rounded-rava-modal border-4 border-amber-900/10 bg-[#fcf8f0] p-12 shadow-[0_50px_100px_rgba(234,179,8,0.3)]"
      >
        <div className="absolute inset-0 opacity-5 pointer-events-none" style={{ backgroundImage: 'radial-gradient(#000 1px, transparent 1px)', backgroundSize: '30px 30px' }} />
        
        <div className="relative">
          <motion.div 
            animate={{ rotate: 360 }} transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
            className="absolute inset-[-40px] text-amber-900/5"
          >
            <Star size={180} fill="currentColor" />
          </motion.div>
          <motion.div 
            initial={{ y: -100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.2, type: "spring" }}
            className="relative z-10 flex h-28 w-28 rotate-6 items-center justify-center rounded-rava-xl bg-amber-900 text-amber-500 shadow-2xl"
          >
            <Award size={64} />
          </motion.div>
        </div>

        <div className="text-center z-10 space-y-2">
          <h3 className="text-amber-950 font-black text-4xl leading-tight">تبریک رفیق!</h3>
          <p className="text-amber-900/60 font-bold text-lg">مهر رسمی {placeName} در پاسپورتت ثبت شد.</p>
        </div>

        <div className="flex gap-4 z-10">
          <motion.div 
            initial={{ x: -20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.5 }}
            className="bg-amber-100 px-6 py-3 rounded-2xl flex items-center gap-2 border border-amber-200"
          >
             <Zap size={20} className="text-amber-600" />
             <span className="text-amber-700 font-black text-sm">+۶ دقیقه سوخت</span>
          </motion.div>
          <motion.div 
            initial={{ x: 20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.6 }}
            className="bg-blue-100 px-6 py-3 rounded-2xl flex items-center gap-2 border border-blue-200"
          >
             <Star size={20} className="text-blue-600" />
             <span className="text-blue-700 font-black text-sm">+۵۰ امتیاز</span>
          </motion.div>
        </div>

        <motion.div
          animate={{ scale: [1, 1.1, 1], opacity: [0.3, 0.6, 0.3] }}
          transition={{ duration: 2, repeat: Infinity }}
          className="flex items-center gap-2 text-rava-xs font-black uppercase tracking-[0.3em] text-amber-900/20"
        >
          <Sparkles size={14} /> پاسپورت راوا
        </motion.div>
      </motion.div>

      {/* انفجار ذرات (Juicy Confetti) */}
      {[...Array(30)].map((_, i) => (
        <motion.div
          key={i}
          initial={{ y: 0, x: 0, opacity: 1 }}
          animate={{ 
            y: [0, (Math.random() - 0.5) * 800], 
            x: [0, (Math.random() - 0.5) * 800],
            opacity: 0,
            scale: 0,
            rotate: 360
          }}
          transition={{ duration: 2.5, ease: "easeOut", delay: 0.2 }}
          className="absolute w-2 h-2 bg-amber-500 rounded-sm"
          style={{ top: '50%', left: '50%' }}
        />
      ))}
    </div>
  );
};
