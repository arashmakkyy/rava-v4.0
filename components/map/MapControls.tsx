import React from 'react';
import { motion as _motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Navigation, Layers, Route, X } from 'lucide-react';
import { useDiscoveryStore } from '../../store/useDiscoveryStore';
import { useMapStore } from '../../store/useMapStore';
import { useRouteStore } from '../../store/useRouteStore';
import { useMap } from '@vis.gl/react-google-maps';
import { AudioGraph } from '../../services/audioGraph';

const motion = _motion as any;
const controlClass = 'relative flex h-14 w-14 min-h-tap min-w-tap flex-col items-center justify-center rounded-rava-xl border shadow-glass transition-all duration-500';

export const MapControls: React.FC = () => {
  const map = useMap();
  const { showCurated, toggleShowCurated } = useDiscoveryStore();
  const { userLocation, locationPermissionDenied, mapsLoadError, setMapsLoadError, setLocationPermissionDenied } = useMapStore();
  const { isActive, route, mode, setMode, recalculate, cancelRoute, isCalculating, error } = useRouteStore();

  const handleToggle = () => {
    AudioGraph.getInstance().playTickSound();
    AudioGraph.haptic(10);
    toggleShowCurated();
  };

  const handleRecenter = () => {
    if (!map || !userLocation) return;
    AudioGraph.getInstance().playTickSound();
    map.panTo({ lat: userLocation[0], lng: userLocation[1] });
    map.setZoom(15);
  };

  const cycleMode = () => {
    const order: Array<'walking' | 'driving' | 'transit'> = ['walking', 'driving', 'transit'];
    const next = order[(order.indexOf(mode) + 1) % order.length];
    setMode(next);
    recalculate();
  };

  const modeLabel = mode === 'walking' ? 'پیاده' : mode === 'driving' ? 'خودرو' : 'حمل‌ونقل';

  return (
    <div className="absolute start-6 top-24 z-[1000] flex flex-col gap-4">
      {(mapsLoadError || locationPermissionDenied) && (
        <div className="absolute start-16 top-0 w-56 space-y-1 rounded-rava-xl border border-red-500/30 glass px-3 py-2.5">
          {mapsLoadError && (
            <button type="button" className="w-full text-start" onClick={() => setMapsLoadError(null)}>
              <p className="text-rava-xs font-bold leading-relaxed text-red-300">{mapsLoadError}</p>
            </button>
          )}
          {locationPermissionDenied && (
            <button type="button" className="w-full text-start" onClick={() => setLocationPermissionDenied(false)}>
              <p className="text-rava-xs font-bold leading-relaxed text-amber-300">دسترسی موقعیت قطع است. از تنظیمات مرورگر GPS را فعال کن.</p>
            </button>
          )}
        </div>
      )}

      <button type="button" onClick={handleToggle} aria-label="نمایش مکان‌های راوا" className={`${controlClass} group ${showCurated ? 'border-yellow-400 bg-rava-gold text-black shadow-[0_0_30px_rgba(234,179,8,0.4)]' : 'border-white/10 bg-black/40 text-white/40 backdrop-blur-xl hover:border-white/20 hover:text-white'}`}>
        <Sparkles size={20} className={showCurated ? 'animate-pulse' : ''} />
        <span className="mt-1 text-rava-xs font-black tracking-tight">جواهر</span>
        <div className="pointer-events-none absolute end-full me-4 hidden rounded-rava-md glass px-3 py-1.5 whitespace-nowrap [@media(hover:hover)]:group-hover:block">
          <span className="text-rava-xs font-bold text-white">نمایش لایه راوا</span>
        </div>
      </button>

      <button type="button" onClick={handleRecenter} aria-label="موقعیت من" className={`${controlClass} border-white/10 bg-black/40 text-white/60 backdrop-blur-xl hover:text-white`}>
        <Navigation size={20} />
        <span className="mt-1 text-rava-xs font-black tracking-tight">من</span>
      </button>

      {isActive && (
        <>
          <button type="button" onClick={cycleMode} disabled={isCalculating} aria-label="تغییر حالت مسیر" className={`${controlClass} border-yellow-400 bg-rava-gold text-black shadow-[0_0_30px_rgba(234,179,8,0.35)]`}>
            <Route size={20} className={isCalculating ? 'animate-pulse' : ''} />
            <span className="mt-1 text-rava-xs font-black tracking-tight">{modeLabel}</span>
          </button>
          <button type="button" onClick={() => { AudioGraph.getInstance().playTickSound(); cancelRoute(); }} aria-label="لغو مسیر" className={`${controlClass} border-red-400 bg-red-500/90 text-white`}>
            <X size={20} />
            <span className="mt-1 text-rava-xs font-black tracking-tight">توقف</span>
          </button>
        </>
      )}

      <button type="button" disabled aria-label="لایه ترکیبی (به‌زودی)" className={`${controlClass} cursor-not-allowed border-white/10 bg-black/40 text-white/20 backdrop-blur-xl`}>
        <Layers size={20} />
        <span className="mt-1 text-rava-xs font-black tracking-tight">ترکیبی</span>
      </button>

      <AnimatePresence>
        {isActive && (route || error || isCalculating) && (
          <motion.div initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }} className={`absolute start-16 top-0 min-w-[140px] max-w-[220px] rounded-rava-xl glass px-4 py-3 ${error ? 'border-red-500/40' : 'border-rava-gold/30'}`}>
            {isCalculating && !route && !error && (
              <>
                <p className="mb-1 text-rava-xs font-black tracking-widest text-rava-gold">مسیر راوا</p>
                <p className="text-rava-sm font-bold text-white/70">در حال محاسبه...</p>
              </>
            )}
            {route && !error && (
              <>
                <p className="mb-1 text-rava-xs font-black tracking-widest text-rava-gold">مسیر راوا</p>
                <p className="text-rava-base font-black text-white">{route.durationText}</p>
                <p className="text-rava-sm font-bold text-white/50">{route.distanceText}</p>
              </>
            )}
            {error && (
              <>
                <p className="mb-1 text-rava-xs font-black tracking-widest text-red-400">خطای مسیر</p>
                <p className="text-rava-xs font-bold leading-relaxed text-red-200">{error}</p>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
