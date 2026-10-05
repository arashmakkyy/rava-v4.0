import React from 'react';
import { motion as _motion } from 'framer-motion';
import { ArrowRight, Star } from 'lucide-react';

const motion = _motion as any;

interface POIHeaderProps {
  id: string;
  name: string;
  image?: string;
  rating?: number;
  category?: string;
  onBack: () => void;
}

const Category3DIcon = ({ category, size = 'text-5xl' }: { category: string; size?: string }) => {
  const c = category?.toLowerCase() || '';
  if (c.includes('restaurant') || c.includes('food')) return <span className={`${size} drop-shadow-2xl`}>🍱</span>;
  if (c.includes('cafe') || c.includes('coffee')) return <span className={`${size} drop-shadow-2xl`}>☕</span>;
  if (c.includes('shopping') || c.includes('store') || c.includes('mall')) return <span className={`${size} drop-shadow-2xl`}>🛍️</span>;
  if (c.includes('park') || c.includes('nature')) return <span className={`${size} drop-shadow-2xl`}>🌳</span>;
  if (c.includes('museum') || c.includes('historical') || c.includes('church') || c.includes('mosque')) return <span className={`${size} drop-shadow-2xl`}>🕌</span>;
  return <span className={`${size} drop-shadow-2xl`}>📍</span>;
};

export const POIHeader: React.FC<POIHeaderProps> = ({ id, name, image, rating, category, onBack }) => {
  return (
    <div className="relative h-[52vh] w-full overflow-hidden sm:h-[55vh]">
      <motion.div layoutId={`img-${id}`} className="absolute inset-0" transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}>
        {image ? (
          <img src={image} className="h-full w-full object-cover" alt={name} />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-[#111] to-black">
            <Category3DIcon category={category || ''} size="text-8xl sm:text-9xl" />
          </div>
        )}
      </motion.div>

      <div className="absolute inset-0 bg-gradient-to-t from-[#050505] via-transparent to-black/40" />

      <button onClick={onBack} className="absolute start-5 top-[calc(var(--safe-top)+1rem)] z-30 flex min-h-tap min-w-tap items-center justify-center rounded-rava-xl glass text-white/80 shadow-glass transition-all active:scale-90">
        <ArrowRight size={22} />
      </button>

      <div className="absolute inset-x-6 bottom-10 z-20 text-right sm:inset-x-12 sm:bottom-12">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="mb-4 flex justify-end gap-3 sm:mb-6">
          {rating ? (
            <div className="flex items-center gap-2 rounded-full bg-rava-gold px-4 py-2 text-rava-sm font-black text-black shadow-glass">
              <Star size={14} fill="currentColor" /> {rating}
            </div>
          ) : null}
          <div className="glass rounded-full border-white/20 px-4 py-2 text-rava-xs font-black text-white/90 backdrop-blur-xl">
            {category?.replace('_', ' ') || 'EXPLORE'}
          </div>
        </motion.div>

        <motion.h2 layoutId={`title-${id}`} className="text-3xl font-black leading-tight text-white drop-shadow-[0_20px_40px_rgba(0,0,0,1)] sm:text-5xl" transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}>
          {name}
        </motion.h2>
      </div>
    </div>
  );
};
