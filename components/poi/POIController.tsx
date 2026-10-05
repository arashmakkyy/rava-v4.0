
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion as _motion, AnimatePresence, LayoutGroup } from 'framer-motion';
import { useMapStore } from '../../store/useMapStore';
import { useUserStore } from '../../store/useUserStore';
import { useRouteStore } from '../../store/useRouteStore';
import { useUIStore } from '../../store/useUIStore';
import { PlaceService } from '../../services/placeService';
import { footprintService } from '../../services/social/footprintService';
import { AudioGraph } from '../../services/audioGraph';
import { PriceWatchModal } from '../social/PriceWatchModal';
import { StampCelebration } from '../social/StampCelebration';
import { POIMissionAction } from './POIMissionAction';
import { isWithinRadius } from '../../utils/geoUtils';
import { GeoPoint } from '../../utils/geoPoint';
import { formatJalaliShort } from '../../utils/jalali';
import { 
  X, Sparkles, MapPin, Tag, Star,
  Loader2, AudioWaveform as Waveform,
  Play, Square, BookOpen,
  Heart, Navigation, CalendarPlus, AlertCircle, RefreshCw
} from 'lucide-react';

import { POIHeader } from './POIHeader';
import { POIFootprintSection } from './POIFootprintSection';
import type { TripEvent } from '../../types';

const motion = _motion as any;

const Category3DIcon = ({ category, size = "text-5xl" }: { category: string, size?: string }) => {
  const c = category?.toLowerCase() || '';
  if (c.includes('restaurant') || c.includes('food')) return <span className={`${size} drop-shadow-2xl`}>🍱</span>;
  if (c.includes('cafe') || c.includes('coffee')) return <span className={`${size} drop-shadow-2xl`}>☕</span>;
  if (c.includes('shopping') || c.includes('store') || c.includes('mall')) return <span className={`${size} drop-shadow-2xl`}>🛍️</span>;
  if (c.includes('park') || c.includes('nature')) return <span className={`${size} drop-shadow-2xl`}>🌳</span>;
  if (c.includes('museum') || c.includes('historical') || c.includes('church') || c.includes('mosque') || c.includes('attraction')) return <span className={`${size} drop-shadow-2xl`}>🕌</span>;
  return <span className={`${size} drop-shadow-2xl`}>📍</span>;
};

const getOptimizedImageUrl = (url: string) => {
  if (!url) return '';
  if (url.includes('images.unsplash.com')) {
    return url.includes('?') ? `${url}&q=70&w=800` : `${url}?q=70&w=800`;
  }
  return url;
};

export const POIController: React.FC = () => {
  const { 
    activePOI, setActivePOI, 
    fullDetailPOI, setFullDetailPOI,
    isLoadingDetails, setLoadingDetails,
    addFootprintOptimistic,
    userLocation,
    isCelebratingStamp, setCelebratingStamp,
    isNarrativePlaying, setNarrativePlaying,
    clearActivePOI,
    poiError, setPOIError,
  } = useMapStore();
  
  const { addStamp, wallet, isStamping, favorites, toggleFavorite, addTripEvent } = useUserStore();
  const { startRoute, isActive: routeActive, error: routeError, isCalculating: routeCalculating } = useRouteStore();
  const { setActiveTab } = useUIStore();
  const audioGraph = AudioGraph.getInstance();

  const [vibeCheck, setVibeCheck] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPriceWatch, setShowPriceWatch] = useState(false);
  const [itineraryAdded, setItineraryAdded] = useState(false);

  const activeRequestIdRef = useRef<string | null>(null);

  const displayPOI = fullDetailPOI || activePOI;
  const isFavorite = displayPOI ? favorites.some((f) => f.placeId === displayPOI.id) : false;

  useEffect(() => {
    audioGraph.onNarrativeStop = () => {
      setNarrativePlaying(false);
    };
    return () => {
      audioGraph.onNarrativeStop = null;
    };
  }, [setNarrativePlaying]);

  useEffect(() => {
    if (!fullDetailPOI?.narrative?.audio_url) return;
    
    const controller = new AbortController();
    fetch(fullDetailPOI.narrative.audio_url, { signal: controller.signal })
      .then(() => console.log('[POI] Narrative audio cached successfully'))
      .catch(() => {});
      
    return () => controller.abort();
  }, [fullDetailPOI?.narrative?.audio_url]);

  useEffect(() => {
    if (!isCelebratingStamp) return;
    const safetyId = setTimeout(() => setCelebratingStamp(false), 5000);
    return () => clearTimeout(safetyId);
  }, [isCelebratingStamp, setCelebratingStamp]);

  useEffect(() => {
    setItineraryAdded(false);
    setVibeCheck(null);
  }, [activePOI?.id, fullDetailPOI?.id]);

  const attemptStamping = useCallback(async (poiId: string, poiName: string, poiLat: number, poiLng: number) => {
    const geo = GeoPoint.fromArray(userLocation);
    if (!geo || isStamping) return;
    
    const isNearby = isWithinRadius(geo.lat, geo.lng, poiLat, poiLng, 150);
    const alreadyStamped = wallet.stamps.some(s => s.placeId === poiId);

    if (isNearby && !alreadyStamped) {
      try {
        await addStamp({
          id: Math.random().toString(), 
          placeId: poiId,
          placeName: poiName,
          date: formatJalaliShort(new Date()),
          lat: poiLat,
          lng: poiLng,
        });
        setCelebratingStamp(true);
      } catch (err) {
        console.error("[POI] Stamp failed silently:", err);
      }
    }
  }, [userLocation, wallet.stamps, addStamp, setCelebratingStamp, isStamping]);

  const handleExpand = async () => {
    if (!activePOI) return;
    
    const requestId = activePOI.id;
    const poiSnapshot = { ...activePOI };

    activeRequestIdRef.current = requestId;
    setLoadingDetails(true);
    setPOIError(null);
    
    try {
      const [curatedInfo, googleInfo] = await Promise.all([
        PlaceService.fetchHybridDetails(requestId).catch(() => ({})),
        requestId.startsWith('rava_syn_')
          ? Promise.resolve({})
          : PlaceService.fetchFullDetails(requestId).catch(() => ({})),
      ]);

      if (activeRequestIdRef.current !== requestId) return;

      const updatedPOI = { ...poiSnapshot, ...curatedInfo, ...googleInfo };
      
      setActivePOI(null);
      setFullDetailPOI(updatedPOI);
      
      if ((curatedInfo as any).is_curated) {
        setVibeCheck((curatedInfo as any).description || null);
      } else {
        const vibe = await PlaceService.getAIVibeCheck(updatedPOI.reviews || []);
        if (activeRequestIdRef.current !== requestId) return;
        setVibeCheck(vibe);
      }
      
      attemptStamping(poiSnapshot.id, poiSnapshot.name, poiSnapshot.lat, poiSnapshot.lng);
    } catch (e) {
      console.error("[POI] Expand Error:", e);
      setPOIError('نتونستیم جزئیات رو کامل کنیم. دوباره تلاش کن.');
      activeRequestIdRef.current = null;
    } finally {
      if (activeRequestIdRef.current === requestId) {
        setLoadingDetails(false);
      }
    }
  };

  const toggleNarrative = () => {
    if (!fullDetailPOI?.narrative) return;
    
    if (isNarrativePlaying) {
      audioGraph.stopStaticFile();
      setNarrativePlaying(false);
    } else {
      audioGraph.playStaticFile(fullDetailPOI.narrative.audio_url);
      setNarrativePlaying(true);
      AudioGraph.haptic(50);
    }
  };

  const submitFootprint = async () => {
    if (!comment.trim() || !fullDetailPOI) return;
    if (fullDetailPOI.lat === 0 && fullDetailPOI.lng === 0) {
      setPOIError('مختصات این مکان هنوز آماده نیست. چند لحظه صبر کن.');
      return;
    }
    setIsSubmitting(true);
    setPOIError(null);

    // Persist first: the entry below only renders after the server accepts it,
    // so a refresh can never silently drop what the user thought was saved.
    const saved = await footprintService.postFootprint(
      comment.trim(),
      fullDetailPOI.lat,
      fullDetailPOI.lng,
    );
    if (!saved) {
      setPOIError('ثبت ردپا ناموفق بود. اتصال رو چک کن و دوباره تلاش کن.');
      setIsSubmitting(false);
      return;
    }

    addFootprintOptimistic(fullDetailPOI.id, {
      id: Math.random().toString(),
      user: 'شما',
      text: comment.trim(),
      date: 'همین الان',
      is_verified: false
    });
    setComment('');
    setIsSubmitting(false);
  };

  const handleFavorite = async () => {
    const poi = fullDetailPOI || activePOI;
    if (!poi) return;
    await toggleFavorite(poi);
    AudioGraph.haptic(10);
  };

  const handleAddItinerary = async () => {
    const poi = fullDetailPOI || activePOI;
    if (!poi) return;
    const event: TripEvent = {
      id: crypto.randomUUID(),
      type: 'activity',
      title: poi.name,
      time: '14:00',
      date: new Date().toISOString().slice(0, 10),
      status: 'pending',
      sequence: 0,
      placeId: poi.id,
      placeName: poi.name,
      coordinates: [poi.lat, poi.lng],
      details: {},
    };
    await addTripEvent(event);
    setItineraryAdded(true);
    AudioGraph.getInstance().playTickSound();
  };

  const handleStartNav = async () => {
    const poi = fullDetailPOI || activePOI;
    if (!poi) return;
    setActiveTab('home');
    await startRoute(poi, 'walking');
    AudioGraph.getInstance().playTickSound();
    AudioGraph.haptic(10);
  };

  const nearbyForStamp = (() => {
    const poi = fullDetailPOI || activePOI;
    const geo = GeoPoint.fromArray(userLocation);
    if (!poi || !geo || (poi.lat === 0 && poi.lng === 0)) return false;
    return isWithinRadius(geo.lat, geo.lng, poi.lat, poi.lng, 150);
  })();

  return (
    <LayoutGroup>
      <AnimatePresence>
        {activePOI && !fullDetailPOI && (
          <motion.div
            layoutId={`card-${activePOI.id}`}
            initial={{ y: 300, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 300, opacity: 0 }}
            className="fixed bottom-28 start-4 end-4 z-[3000]"
          >
            <div className="glass relative overflow-hidden rounded-rava-xl border-white/10 p-5 shadow-[0_20px_40px_rgba(0,0,0,0.45)]">
              <div className="absolute -top-4 -start-4 opacity-5 blur-sm transform rotate-12 pointer-events-none">
                <Category3DIcon category={activePOI.category} size="text-9xl" />
              </div>
              <div className="flex items-start justify-between mb-4">
                <button onClick={() => { activeRequestIdRef.current = null; clearActivePOI(); }} className="w-10 h-10 glass rounded-xl flex items-center justify-center text-white/40 hover:text-white transition-all active:scale-90">
                  <X size={20} />
                </button>
                <div className="flex-1 pe-4">
                  <motion.h3 layoutId={`title-${activePOI.id}`} className="text-white font-black text-xl mb-0.5 truncate">{activePOI.name}</motion.h3>
                  <div className="flex items-center justify-end gap-1 text-white/40 text-[11px] font-bold">
                    <span>{activePOI.description || 'آماده کشف'}</span>
                    <MapPin size={11} className="text-rava-gold" />
                  </div>
                </div>
                <motion.div layoutId={`img-${activePOI.id}`} className="w-14 h-14 bg-white/5 rounded-2xl flex items-center justify-center border border-white/10 shrink-0 overflow-hidden">
                   {activePOI.image ? (
                     <img src={getOptimizedImageUrl(activePOI.image)} className="w-full h-full object-cover" alt={activePOI.name} />
                   ) : (
                     <Category3DIcon category={activePOI.category} size="text-4xl" />
                   )}
                </motion.div>
              </div>

              {/* Quick actions on collapsed sheet */}
              <div className="flex gap-2 mb-4">
                <button onClick={handleFavorite} className={`flex-1 glass py-2.5 rounded-xl flex items-center justify-center gap-1.5 text-[11px] font-black ${isFavorite ? 'text-red-400 border-red-500/30' : 'text-white/50'}`}>
                  <Heart size={14} fill={isFavorite ? 'currentColor' : 'none'} />
                  علاقه
                </button>
                <button onClick={handleStartNav} disabled={routeCalculating} className="flex flex-1 items-center justify-center gap-1.5 rounded-rava-lg border-rava-gold/20 py-2.5 text-rava-sm font-black text-rava-gold disabled:opacity-50 glass">
                  {routeCalculating ? <Loader2 size={14} className="animate-spin" /> : <Navigation size={14} />}
                  مسیر
                </button>
                <button onClick={handleAddItinerary} className="flex-1 glass py-2.5 rounded-xl flex items-center justify-center gap-1.5 text-[11px] font-black text-white/50">
                  <CalendarPlus size={14} />
                  {itineraryAdded ? 'اضافه شد' : 'برنامه'}
                </button>
              </div>

              {routeError && (
                <div className="mb-3 glass border-red-500/30 bg-red-500/10 p-3 rounded-xl flex items-start gap-2 text-right">
                  <AlertCircle size={16} className="text-red-400 shrink-0 mt-0.5" />
                  <p className="text-red-200 text-[11px] font-bold leading-relaxed flex-1">{routeError}</p>
                </div>
              )}

              {poiError && (
                <div className="mb-4 glass border-red-500/30 bg-red-500/10 p-4 rounded-2xl flex items-center gap-3 text-right">
                  <AlertCircle size={18} className="text-red-400 shrink-0" />
                  <p className="text-red-200 text-xs font-bold flex-1">{poiError}</p>
                  <button onClick={handleExpand} className="text-red-300 p-2">
                    <RefreshCw size={16} />
                  </button>
                </div>
              )}

              <div className="text-center relative z-10">
                <button onClick={handleExpand} disabled={isLoadingDetails} className="flex w-full items-center justify-center gap-3 rounded-rava-lg bg-rava-gold py-3.5 text-rava-base font-black text-black shadow-[0_12px_32px_rgba(234,179,8,0.25)] transition-all active:scale-[0.98] disabled:opacity-70">
                  {isLoadingDetails ? <Loader2 size={22} className="animate-spin" /> : <><span>تحلیل هوشمند و جزئیات</span><Sparkles size={18} /></>}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {fullDetailPOI && (
          <div className="fixed inset-0 z-[4000] flex items-end">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setFullDetailPOI(null)} className="absolute inset-0 bg-black/98 backdrop-blur-3xl" />
            <motion.div
              layoutId={`card-${fullDetailPOI.id}`}
              initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 40, stiffness: 300 }}
              className="relative h-[92dvh] w-full overflow-y-auto rounded-t-rava-modal border-t border-white/10 bg-rava-bg pb-safe no-scrollbar shadow-[0_-40px_80px_rgba(0,0,0,0.9)]"
            >
              <POIHeader 
                id={fullDetailPOI.id}
                name={fullDetailPOI.name} 
                image={getOptimizedImageUrl(fullDetailPOI.image || '')} 
                rating={fullDetailPOI.rating} 
                category={fullDetailPOI.category}
                onBack={() => setFullDetailPOI(null)}
              />

              <div className="px-4 pt-6 pb-36 space-y-6 min-[380px]:px-6">
                {/* Primary CTAs */}
                <div className="flex gap-2">
                  <button
                    onClick={handleStartNav}
                    disabled={routeCalculating}
                    className={`flex flex-[2] items-center justify-center gap-2 rounded-rava-lg py-3.5 text-rava-base font-black disabled:opacity-60 ${
                      routeActive && !routeError ? 'bg-white text-black' : 'bg-rava-gold text-black shadow-lg shadow-rava-gold/15'
                    }`}
                  >
                    {routeCalculating ? <Loader2 size={18} className="animate-spin" /> : <Navigation size={18} />}
                    {routeActive && !routeError ? 'مسیر فعال است' : 'شروع مسیریابی'}
                  </button>
                  <button
                    onClick={handleFavorite}
                    className={`flex-1 glass py-4 rounded-2xl flex items-center justify-center ${isFavorite ? 'text-red-400 border-red-500/40' : 'text-white/50'}`}
                  >
                    <Heart size={20} fill={isFavorite ? 'currentColor' : 'none'} />
                  </button>
                  <button
                    onClick={handleAddItinerary}
                    className="flex-1 glass py-4 rounded-2xl flex items-center justify-center text-white/60"
                  >
                    <CalendarPlus size={20} />
                  </button>
                </div>

                {routeError && (
                  <div className="glass border-red-500/30 bg-red-500/10 p-4 rounded-2xl flex items-start gap-2 text-right">
                    <AlertCircle size={18} className="text-red-400 shrink-0 mt-0.5" />
                    <p className="text-red-200 text-xs font-bold leading-relaxed flex-1">{routeError}</p>
                  </div>
                )}

                {nearbyForStamp && (
                  <div className="glass rounded-rava-xl border-rava-gold/30 bg-rava-gold/10 p-5 text-center">
                    <p className="text-rava-sm font-black text-rava-gold">نزدیکی! مهر پاسپورت آماده ثبت است ✨</p>
                  </div>
                )}

                {fullDetailPOI.narrative && (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.9 }} 
                    animate={{ opacity: 1, scale: 1 }}
                    className="glass relative flex flex-col items-center gap-5 overflow-hidden rounded-rava-modal border-rava-gold/30 bg-rava-gold/10 p-6"
                  >
                    <div className="absolute top-0 inset-x-0 h-1 bg-white/5 overflow-hidden">
                       <motion.div 
                         className="h-full bg-rava-gold" 
                         initial={{ width: 0 }} 
                         animate={{ width: isNarrativePlaying ? "100%" : "0%" }}
                         transition={{ duration: fullDetailPOI.narrative.duration_seconds || 60, ease: "linear" }}
                       />
                    </div>
                    <div className="flex flex-col items-center gap-2">
                       <div className="flex h-12 w-12 items-center justify-center rounded-rava-xl bg-rava-gold text-black shadow-2xl">
                          <BookOpen size={24} />
                       </div>
                       <h4 className="text-rava-lg font-black text-white">داستان اینجا رو بشنو</h4>
                        <p className="text-rava-xs font-black tracking-widest text-rava-gold/60">روایت راوا</p>
                    </div>

                    <button 
                      onClick={toggleNarrative}
                      className={`flex w-full items-center justify-center gap-3 rounded-rava-xl py-4 text-rava-lg font-black transition-all ${isNarrativePlaying ? 'bg-white text-black' : 'bg-rava-gold text-black shadow-xl shadow-rava-gold/20'}`}
                    >
                      {isNarrativePlaying ? <><Square size={20} fill="currentColor" /> توقف داستان</> : <><Play size={20} fill="currentColor" /> پخش داستان صوتی</>}
                    </button>
                  </motion.div>
                )}

                <div className="flex gap-6">
                  <POIMissionAction 
                    poiId={fullDetailPOI.id} 
                    poiName={fullDetailPOI.name} 
                    onInitiated={() => setFullDetailPOI(null)} 
                  />
                  <button 
                    onClick={() => setShowPriceWatch(true)}
                    className="glass group flex flex-1 flex-col items-center gap-3 rounded-rava-xl border-blue-500/20 p-5 shadow-xl transition-all active:scale-95"
                  >
                    <div className="flex h-12 w-12 items-center justify-center rounded-rava-lg bg-blue-600 text-white shadow-lg transition-transform group-hover:-rotate-12">
                      <Tag size={24} />
                    </div>
                    <span className="text-rava-sm font-black text-white">گزارش قیمت</span>
                    <span className="text-rava-xs font-bold tracking-tighter text-blue-400">پاداش ۳۰ دقیقه‌ای</span>
                  </button>
                </div>

                <div className="glass flex items-center justify-around rounded-rava-xl border-white/5 bg-white/[0.01] p-6">
                  <div className="flex flex-col items-center gap-1">
                    <span className="text-rava-lg font-black text-white">{fullDetailPOI.footprints?.length || 0}</span>
                    <span className="text-rava-xs font-black tracking-[0.2em] text-white/40">ردپاها</span>
                  </div>
                  <div className="h-10 w-px bg-white/10" />
                  <div className="flex flex-col items-center gap-1">
                    <span className="flex items-center gap-1 text-rava-lg font-black text-white">
                      {typeof fullDetailPOI.rating === 'number' ? fullDetailPOI.rating.toFixed(1).replace('.', '٫') : '—'}
                      <Star size={16} className="fill-rava-gold text-rava-gold" />
                    </span>
                    <span className="text-rava-xs font-black tracking-[0.2em] text-white/40">امتیاز</span>
                  </div>
                </div>

                <div className="relative group">
                  <div className="absolute -top-4 -start-4 w-14 h-14 bg-indigo-600 rounded-3xl flex items-center justify-center shadow-2xl shadow-indigo-600/30 z-10 group-hover:scale-110 transition-transform">
                    <Sparkles size={28} className="text-white" />
                  </div>
                  <div className="glass rounded-rava-modal border-indigo-500/30 bg-indigo-600/5 p-8 pt-10 transition-all group-hover:bg-indigo-600/10">
                    <p className="text-right text-rava-lg font-medium italic leading-[1.8] tracking-tight text-white">
                      {vibeCheck ? `"${vibeCheck}"` : "تحلیلگر راوا در حال بررسی اتمسفر اینجاست..."}
                    </p>
                  </div>
                </div>

                <POIFootprintSection 
                  footprints={fullDetailPOI.footprints || []}
                  comment={comment}
                  isSubmitting={isSubmitting}
                  onCommentChange={setComment}
                  onSubmit={submitFootprint}
                />

                <button 
                  disabled 
                  className="flex w-full cursor-not-allowed items-center justify-center gap-4 rounded-rava-modal bg-gradient-to-b from-white/10 to-neutral-800/10 py-5 text-rava-lg font-black text-white/30"
                >
                  <Waveform size={24} className="text-indigo-400/30" />
                  <span>راهنمای صوتی لوکس — به زودی</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showPriceWatch && fullDetailPOI && (
          <PriceWatchModal 
            poiId={fullDetailPOI.id} 
            poiName={fullDetailPOI.name} 
            onClose={() => setShowPriceWatch(false)} 
          />
        )}
        
        {isCelebratingStamp && fullDetailPOI && (
          <StampCelebration 
            placeName={fullDetailPOI.name} 
            onComplete={() => setCelebratingStamp(false)} 
          />
        )}
      </AnimatePresence>
    </LayoutGroup>
  );
};
