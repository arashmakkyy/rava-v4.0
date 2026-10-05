import React, { useState } from 'react';
import { motion as _motion } from 'framer-motion';
import { Globe, MapPin, Sparkles } from 'lucide-react';
import { useUserStore } from '../../store/useUserStore';
import { PassportPage } from '../social/PassportPage';
import { AudioGraph } from '../../services/audioGraph';
import { FullPageOverlay } from '../ui';

const motion = _motion as any;

export const PassportCard: React.FC = () => {
  const { wallet } = useUserStore();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          AudioGraph.getInstance().playTickSound();
          setOpen(true);
        }}
        className="group relative h-64 w-full overflow-hidden rounded-rava-modal border border-white/10 bg-rava-elevated shadow-2xl transition-transform active:scale-[0.99] selection:bg-rava-gold/30"
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)',
            backgroundSize: '24px 24px',
          }}
        />

        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-rava-gold/5 to-transparent" />

        <div className="relative flex h-full flex-col justify-between p-8">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-rava-lg border border-white/10 bg-white/5 text-rava-gold shadow-lg">
                <Globe size={24} />
              </div>
              <div className="text-right">
                <h4 className="text-rava-lg font-black uppercase leading-none tracking-wider text-white">DIGITAL PASSPORT</h4>
                <p className="mt-1.5 text-rava-xs font-black uppercase tracking-[0.4em] text-rava-gold/50">Rava / راوا Digital ID</p>
              </div>
            </div>

            <div className="flex h-14 w-10 flex-col items-center justify-center gap-1 rounded-rava-md border border-white/10 bg-white/5 opacity-40">
              <div className="h-0.5 w-6 rounded-full bg-white/20" />
              <div className="h-0.5 w-4 rounded-full bg-white/20" />
              <div className="h-0.5 w-5 rounded-full bg-white/20" />
            </div>
          </div>

          <div className="flex gap-3 overflow-x-auto pb-1 no-scrollbar">
            {wallet.stamps.length === 0 ? (
              <div className="flex w-full items-center justify-center rounded-rava-lg border border-dashed border-white/10 py-4 opacity-20">
                <span className="text-rava-xs font-black uppercase tracking-[0.2em]">No Active Visas Found</span>
              </div>
            ) : (
              wallet.stamps.slice(0, 4).map((stamp, i) => (
                <motion.div
                  key={stamp.id}
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: i * 0.1 }}
                  className="relative flex h-20 w-20 shrink-0 flex-col items-center justify-center rounded-rava-lg border border-white/10 bg-white/[0.03] p-2"
                >
                  <div className="absolute start-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-indigo-500/30" />
                  <MapPin size={20} className="mb-1 text-white/20" />
                  <span className="w-full truncate px-1 text-center text-rava-xs font-black leading-tight text-white/80">
                    {stamp.placeName}
                  </span>
                </motion.div>
              ))
            )}
            {wallet.stamps.length > 4 && (
              <div className="glass flex h-20 w-20 shrink-0 items-center justify-center rounded-rava-lg border-rava-gold/20 text-rava-xs font-black text-rava-gold shadow-lg">
                +{wallet.stamps.length - 4}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between opacity-40">
            <Sparkles size={14} className="text-rava-gold" />
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-1.5 rounded-full bg-green-500" />
              <span className="text-rava-xs font-black tracking-widest text-white">برای باز کردن بزن · راوا</span>
            </div>
          </div>
        </div>
      </button>

      <FullPageOverlay open={open} onClose={() => setOpen(false)} title="پاسپورت راوا">
        <PassportPage />
      </FullPageOverlay>
    </>
  );
};
