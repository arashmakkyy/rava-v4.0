import React from 'react';
import { motion as _motion } from 'framer-motion';
import { Sparkles, ArrowRight } from 'lucide-react';
import { GlassCard } from '../../../components/core/GlassCard';
import { Button } from '../../../components/ui';

const motion = _motion as any;

const CREWS = [
  { id: 'solo', label: 'تنهایی', icon: '👤' },
  { id: 'couple', label: 'دو نفره', icon: '👩‍❤️‍👨' },
  { id: 'family', label: 'با خانواده', icon: '👨‍👩‍👧‍👦' },
  { id: 'friends', label: 'با رفقا', icon: '👯‍♂️' },
];

interface CrewStepProps {
  selectedCrew: string | null;
  loading: boolean;
  onSelect: (crew: string) => void;
  onBack: () => void;
  onFinalize: () => void;
}

export const CrewStep: React.FC<CrewStepProps> = ({ selectedCrew, loading, onSelect, onBack, onFinalize }) => (
  <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="space-y-10">
    <div className="space-y-2 text-right">
      <h1 className="rava-page-title text-4xl leading-tight">با کیا همسفری؟</h1>
      <p className="rava-page-subtitle">اینطوری می‌تونم پیشنهادهای بهتری بدم.</p>
    </div>

    <div className="grid grid-cols-2 gap-4">
      {CREWS.map((crew) => (
        <button key={crew.id} type="button" onClick={() => onSelect(crew.id)} className="outline-none">
          <GlassCard
            className={`flex flex-col items-center justify-center gap-4 border-white/5 py-10 transition-all duration-500 ${
              selectedCrew === crew.id
                ? 'scale-[1.05] border-rava-gold/50 bg-rava-gold/10 shadow-[0_20px_40px_rgba(234,179,8,0.1)]'
                : 'opacity-50 grayscale hover:opacity-100 hover:grayscale-0'
            }`}
          >
            <span className="text-4xl">{crew.icon}</span>
            <span className={`text-rava-xs font-black transition-colors ${selectedCrew === crew.id ? 'text-rava-gold' : 'text-white'}`}>
              {crew.label}
            </span>
          </GlassCard>
        </button>
      ))}
    </div>

    <div className="space-y-6 pt-10">
      <Button fullWidth size="lg" onClick={onFinalize} disabled={loading || !selectedCrew} loading={loading} trailingIcon={!loading ? <Sparkles size={24} className="text-rava-gold" /> : undefined}>
        آماده‌سازی سفر لوکس
      </Button>

      <button
        type="button"
        onClick={onBack}
        className="group mx-auto flex items-center gap-2 text-rava-xs font-black uppercase tracking-widest text-white/20 transition-colors hover:text-white"
      >
        <span>مرحله قبل</span>
        <ArrowRight size={14} className="transition-transform group-hover:translate-x-1" />
      </button>
    </div>
  </motion.div>
);
