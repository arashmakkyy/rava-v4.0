import React, { useMemo, useState } from 'react';
import { motion as _motion } from 'framer-motion';
import { Copy, MapPinned } from 'lucide-react';
import { getStaticTripsForCity } from '../../data/staticTrips';
import { useUserStore } from '../../store/useUserStore';
import { CityMode } from '../../types';
import { AudioGraph } from '../../services/audioGraph';
import { Button } from '../ui';

const motion = _motion as any;

interface StaticTripPickerProps {
  cityFilter?: CityMode;
  onCloned?: () => void;
}

export const StaticTripPicker: React.FC<StaticTripPickerProps> = ({ cityFilter, onCloned }) => {
  const { cityMode, cloneStaticTrip } = useUserStore();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const templates = useMemo(
    () => getStaticTripsForCity(cityFilter ?? cityMode),
    [cityFilter, cityMode]
  );

  const clone = async (id: string) => {
    if (busyId) return;
    setBusyId(id);
    setMsg(null);
    try {
      await cloneStaticTrip(id);
      AudioGraph.haptic(12);
      setMsg('برنامه کپی شد — در سفر من آماده‌ست');
      onCloned?.();
    } catch (e: any) {
      setMsg(e?.message || 'کپی نشد');
    } finally {
      setBusyId(null);
    }
  };

  if (templates.length === 0) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-rava-xs font-black tracking-widest text-white/30">قالب‌ها</span>
        <h3 className="text-rava-lg font-black text-white">برنامه‌های آماده راوا</h3>
      </div>
      {msg && <p className="text-right text-rava-xs font-bold text-rava-gold/80">{msg}</p>}
      <div className="space-y-3">
        {templates.map((t) => (
          <motion.div key={t.id} layout className="glass rounded-rava-xl border border-white/5 p-4 text-right">
            <div className="mb-2 flex items-start justify-between gap-3">
              <Button
                size="sm"
                onClick={() => clone(t.id)}
                disabled={!!busyId}
                loading={busyId === t.id}
                leadingIcon={busyId !== t.id ? <Copy size={12} /> : undefined}
              >
                کپی کن
              </Button>
              <div>
                <h4 className="text-rava-sm font-black text-white">{t.titleFa}</h4>
                <p className="mt-1 text-rava-xs leading-relaxed text-white/35">{t.description}</p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <span className="rava-chip flex items-center gap-1">
                <MapPinned size={10} /> {t.city}
              </span>
              <span className="rava-chip">{t.days} روز</span>
              <span className="rava-chip rava-chip-active">{t.budgetStyle}</span>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
};
