import React, { useState } from 'react';
import { X, Sparkles, MapPin, Coins, Zap, Sunrise } from 'lucide-react';
import { useUserStore } from '../../store/useUserStore';
import { supabase } from '../../services/supabaseClient';
import { recapService } from '../../services/recapService';
import { RecapResult } from '../../types';
import { todayIso } from '../../utils/tripMapper';
import { displayJalaliDate } from '../../utils/jalali';
import { AudioGraph } from '../../services/audioGraph';
import { Sheet, IconButton, Button } from '../ui';

interface DailyRecapModalProps {
  open: boolean;
  onClose: () => void;
}

export const DailyRecapModal: React.FC<DailyRecapModalProps> = ({ open, onClose }) => {
  const { wallet, tripEvents, cityMode, activeTrip, claimReward, setActiveTripLocal, trips } = useUserStore();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RecapResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const date = todayIso();
      const chatHighlights = user ? await recapService.fetchTodayChatHighlights(user.id, date) : [];

      const facts = recapService.collectRecapFacts({ stamps: wallet.stamps, tripEvents, city: activeTrip?.city || cityMode, date, chatHighlights });
      const recap = await recapService.generateDailyRecap(facts);
      setResult(recap);

      if (user) {
        await recapService.saveDailyRecap(user.id, facts, recap);
        // Server derives the daily reference from its own date — no client reference sent.
        await claimReward('daily_itinerary');
      }

      if (activeTrip && recap.passportItem && !activeTrip.passportEntry) {
        const updated = { ...activeTrip, passportEntry: recap.passportItem };
        setActiveTripLocal(updated);
        useUserStore.setState({ trips: trips.map((t) => (t.id === updated.id ? updated : t)) });
      }

      AudioGraph.getInstance().playCoinSound();
    } catch (e: any) {
      setError(e?.message || 'خلاصه ساخته نشد');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} className="max-w-md">
      <div className="relative max-h-[80vh] overflow-y-auto no-scrollbar px-1 pb-2">
        <IconButton icon={X} label="بستن" onClick={onClose} size="sm" variant="ghost" className="absolute start-0 top-0 z-10" />

        <div className="mb-6 flex items-center justify-end gap-3 pt-10">
          <div>
            <h3 className="rava-page-title">خلاصه امروز</h3>
            <p className="rava-page-subtitle mt-1">راوا · {displayJalaliDate(todayIso())} · فقط بر پایه واقعیت‌های ثبت‌شده</p>
          </div>
          <div className="flex h-12 w-12 items-center justify-center rounded-rava-xl bg-rava-gold/20 text-rava-gold">
            <Sparkles size={22} />
          </div>
        </div>

        {!result ? (
          <div className="space-y-4">
            <p className="text-rava-sm leading-relaxed text-white/50">مهرها، هزینه‌های برنامه، آیتم‌های ردشده و باقی‌مانده امروز را جمع می‌کنیم — بدون داستان‌سازی.</p>
            {error ? <p className="text-rava-xs text-rava-danger">{error}</p> : null}
            <Button fullWidth onClick={generate} loading={loading} leadingIcon={!loading ? <Sparkles size={18} /> : undefined}>
              ساخت خلاصه امروز
            </Button>
          </div>
        ) : (
          <div className="space-y-5">
            <p className="text-rava-sm leading-relaxed text-white">{result.summary}</p>

            {result.highlights.length > 0 && (
              <ul className="space-y-2">
                {result.highlights.map((h, i) => (
                  <li key={i} className="flex items-start gap-2 rounded-rava-lg bg-white/5 px-3 py-2 text-rava-sm text-white/60">
                    <MapPin size={12} className="mt-0.5 shrink-0 text-rava-gold" />
                    {h}
                  </li>
                ))}
              </ul>
            )}

            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-rava-xl bg-white/5 p-3 text-center">
                <Coins size={14} className="mx-auto mb-1 text-rava-gold" />
                <span className="block text-rava-base font-black text-white">{result.dailyCost}</span>
                <span className="text-rava-xs font-bold text-white/30">هزینه</span>
              </div>
              <div className="rounded-rava-xl bg-white/5 p-3 text-center">
                <Zap size={14} className="mx-auto mb-1 text-rava-gold" />
                <span className="block text-rava-base font-black text-white">+{result.xpEarned}</span>
                <span className="text-rava-xs font-bold text-white/30">XP</span>
              </div>
              <div className="rounded-rava-xl bg-white/5 p-3 text-center">
                <MapPin size={14} className="mx-auto mb-1 text-rava-gold" />
                <span className="block text-rava-base font-black text-white">{result.placesVisited}</span>
                <span className="text-rava-xs font-bold text-white/30">مکان</span>
              </div>
            </div>

            {result.tomorrowHint && (
              <div className="flex items-start gap-3 rounded-rava-xl border border-rava-gold/20 bg-rava-gold/10 p-4">
                <Sunrise size={16} className="mt-0.5 text-rava-gold" />
                <p className="text-rava-sm font-bold leading-relaxed text-rava-gold/90">{result.tomorrowHint}</p>
              </div>
            )}

            {result.passportItem ? <p className="text-center font-mono text-rava-xs text-white/30">{result.passportItem}</p> : null}

            <Button fullWidth variant="ghost" onClick={onClose} className="bg-white/10 text-white">بستن</Button>
          </div>
        )}
      </div>
    </Sheet>
  );
};
