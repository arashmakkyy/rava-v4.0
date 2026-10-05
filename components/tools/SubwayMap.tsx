import React, { useState, useMemo, useRef } from 'react';
import { motion as _motion, AnimatePresence } from 'framer-motion';
import { Map as MapIcon, Loader2, ZoomIn, ZoomOut, Maximize2, X, Navigation2, Zap } from 'lucide-react';
import { GlassCard } from '../core/GlassCard';
import { useUserStore } from '../../store/useUserStore';
import { useMapStore } from '../../store/useMapStore';
import { useSurvivalStore } from '../../store/useSurvivalStore';
import type { CityMode } from '../../types';
import { SUBWAY_STATIONS } from '../../constants';
import { calculateDistance } from '../../utils/geoUtils';
import { GeoPoint } from '../../utils/geoPoint';
import { AudioGraph } from '../../services/audioGraph';
import { IconButton } from '../ui';

const motion = _motion as any;

export const SubwayMap: React.FC = () => {
  const { cityMode } = useUserStore();
  const { userLocation } = useMapStore();
  const { isMapFullscreen, setMapFullscreen } = useSurvivalStore();
  const [isLoading, setIsLoading] = useState(true);
  const [scale, setScale] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);

  // Tehran has no curated subway pack yet (see P0.5 city guard) — lookups stay undefined-safe.
  const mapUrls: Partial<Record<NonNullable<CityMode>, string>> = {
    Istanbul: 'https://www.metro.istanbul/Content/assets/img/rayli-sistemler-haritasi.png',
    Dubai: 'https://www.visitdubai.com/-/media/gathercontent/article/d/dubai-metro-guide/media/dubai-metro-guide-dubai-metro-map-1.jpg',
  };

  const currentMap = cityMode ? mapUrls[cityMode] ?? null : null;

  const nearestStation = useMemo(() => {
    const geo = GeoPoint.fromArray(userLocation);
    const stations = cityMode ? SUBWAY_STATIONS[cityMode as 'Istanbul' | 'Dubai'] : undefined;
    if (!geo || !stations) return null;

    let closest = stations[0];
    let minDistance = Infinity;

    stations.forEach((st) => {
      const dist = calculateDistance(geo.lat, geo.lng, st.lat, st.lng);
      if (dist < minDistance) {
        minDistance = dist;
        closest = st;
      }
    });

    return { ...closest, distance: Math.round(minDistance) };
  }, [userLocation, cityMode]);

  const handleZoom = (dir: 'in' | 'out') => {
    AudioGraph.getInstance().playTickSound();
    setScale((prev) => {
      const next = dir === 'in' ? prev + 0.5 : prev - 0.5;
      return Math.max(1, Math.min(5, next));
    });
  };

  const toggleFullscreen = () => {
    AudioGraph.haptic(20);
    setMapFullscreen(!isMapFullscreen);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between px-2">
        <span className="text-rava-xs font-black uppercase tracking-widest text-white/20">High-Res Offline Data</span>
        <h4 className="flex items-center gap-2 text-rava-lg font-black text-white">
          نقشه مترو <MapIcon size={16} className="text-indigo-500" />
        </h4>
      </div>

      <AnimatePresence>
        {nearestStation && nearestStation.distance < 3000 && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="px-2">
            <div className="flex items-center justify-between rounded-rava-lg border border-indigo-500/20 bg-indigo-500/10 p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 animate-pulse items-center justify-center rounded-rava-md bg-indigo-500 text-white shadow-lg">
                  <Navigation2 size={20} />
                </div>
                <div className="text-right">
                  <p className="text-rava-xs font-black text-white">{nearestStation.name}</p>
                  <p className="text-rava-xs font-bold uppercase tracking-tighter text-indigo-400">
                    نزدیک‌ترین ایستگاه به شما • {nearestStation.distance} متر
                  </p>
                </div>
              </div>
              <Zap size={14} className="text-indigo-500/40" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <GlassCard className="group relative aspect-square overflow-hidden border-indigo-500/20 p-0" ref={containerRef}>
        {!currentMap ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-4 py-20 opacity-20">
            <MapIcon size={64} />
            <p className="text-rava-xs font-black">نقشه برای این شهر در دسترس نیست</p>
          </div>
        ) : (
          <>
            <AnimatePresence>
              {isLoading && (
                <motion.div
                  initial={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-black/80 backdrop-blur-xl"
                >
                  <Loader2 size={32} className="animate-spin text-indigo-500" />
                  <p className="text-rava-xs font-black uppercase tracking-widest text-white/40">در حال دریافت نقشه بقا...</p>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="relative h-full w-full overflow-hidden bg-neutral-900">
              <motion.div drag dragConstraints={containerRef} animate={{ scale }} className="flex h-full w-full cursor-move items-center justify-center">
                <img
                  src={currentMap}
                  onLoad={() => setIsLoading(false)}
                  className="pointer-events-none h-auto w-[1200px] max-w-none"
                  alt="Subway Map"
                />
              </motion.div>
            </div>

            <div className="absolute end-4 top-4 z-30 flex flex-col gap-2 opacity-0 transition-opacity group-hover:opacity-100">
              <IconButton icon={ZoomIn} label="بزرگ‌نمایی" onClick={() => handleZoom('in')} size="sm" />
              <IconButton icon={ZoomOut} label="کوچک‌نمایی" onClick={() => handleZoom('out')} size="sm" />
              <IconButton icon={Maximize2} label="تمام صفحه" onClick={toggleFullscreen} size="sm" className="text-rava-gold" />
            </div>
          </>
        )}
      </GlassCard>

      <AnimatePresence>
        {isMapFullscreen && currentMap && (
          <motion.div
            initial={{ opacity: 0, scale: 1.1 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.1 }}
            className="fixed inset-0 z-[8000] bg-black"
          >
            <div className="absolute start-8 top-12 z-50 flex items-center gap-4 pt-safe">
              <IconButton icon={X} label="بستن" onClick={toggleFullscreen} size="lg" />
              <div className="glass rounded-rava-md px-4 py-2 text-rava-xs font-black uppercase text-white/60">Subway Master View</div>
            </div>
            <div className="h-full w-full overflow-hidden">
              <motion.div
                drag
                dragConstraints={{ left: -1500, right: 1500, top: -1500, bottom: 1500 }}
                initial={{ scale: 1.8 }}
                className="flex h-full w-full items-center justify-center"
              >
                <img src={currentMap} className="max-w-none w-[2000px]" alt="Subway Full" />
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
