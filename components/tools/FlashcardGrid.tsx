import React from 'react';
import { motion as _motion } from 'framer-motion';
import { Zap } from 'lucide-react';
import { GlassCard } from '../core/GlassCard';
import { FLASHCARDS_DATA } from '../../constants';
import { useSurvivalStore } from '../../store/useSurvivalStore';
import { useUserStore } from '../../store/useUserStore';

const motion = _motion as any;

export const FlashcardGrid: React.FC = () => {
  const { setActiveFlashcard } = useSurvivalStore();
  const { cityMode } = useUserStore();

  // Tehran has no curated flashcard pack yet (see P0.5 city guard) — never crash, show empty grid.
  const flashcards = cityMode ? FLASHCARDS_DATA[cityMode as 'Istanbul' | 'Dubai'] ?? [] : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between px-2">
        <span className="text-rava-xs font-black tracking-widest text-white/20">برای نمایش به راننده بزن</span>
        <h4 className="flex items-center gap-2 text-rava-lg font-black text-white">
          جملات ضروری <Zap size={16} className="text-rava-gold" />
        </h4>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {flashcards.map((card, idx) => (
          <motion.div key={card.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.05 }}>
            <GlassCard
              onClick={() => setActiveFlashcard(card)}
              className="group flex cursor-pointer flex-col items-center justify-center gap-4 border-white/5 py-8 transition-all active:scale-95"
            >
              <span className="text-4xl transition-transform duration-500 group-hover:scale-125">{card.icon}</span>
              <div className="space-y-1 text-center">
                <span className="block text-rava-xs font-black text-white">{card.farsi}</span>
                <span className="text-rava-xs font-bold uppercase tracking-tighter text-white/40">{card.category}</span>
              </div>
            </GlassCard>
          </motion.div>
        ))}
      </div>
    </div>
  );
};
