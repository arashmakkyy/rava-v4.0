import React, { useMemo, useState } from 'react';
import { motion as _motion, AnimatePresence } from 'framer-motion';
import {
  ScanLine,
  Plus,
  Play,
  Pause,
  Flag,
  XCircle,
  BookOpen,
  Route,
} from 'lucide-react';
import { SafeHavenCard } from '../components/wallet/SafeHavenCard';
import { TimelineEvent } from '../components/wallet/TimelineEvent';
import { TicketScanner } from '../components/wallet/TicketScanner';
import { StaticTripPicker } from '../components/trip/StaticTripPicker';
import { DailyRecapModal } from '../components/trip/DailyRecapModal';
import { useUserStore } from '../store/useUserStore';
import { TripEvent, TripLifecycleStatus } from '../types';
import { getTodaysEvents, sortEvents, todayIso } from '../utils/tripMapper';
import { displayJalaliDate } from '../utils/jalali';

const motion = _motion as any;

const STATUS_UI: Record<
  TripLifecycleStatus,
  { label: string; hint: string; color: string }
> = {
  planning: {
    label: 'در حال برنامه‌ریزی',
    hint: 'شهر، تاریخ و سلیقه را کامل کن یا از قالب آماده استفاده کن.',
    color: 'text-white/50',
  },
  upcoming: {
    label: 'آماده حرکت',
    hint: 'برنامه چیده شده — وقتی رسیدی سفر را شروع کن.',
    color: 'text-blue-400',
  },
  active: {
    label: 'سفر فعال',
    hint: 'برنامه امروز به ترتیب — شروع، مسیریابی، انجام یا رد.',
    color: 'text-rava-gold',
  },
  paused: {
    label: 'متوقف',
    hint: 'سفر روی Freeze است؛ هر وقت خواستی ادامه بده.',
    color: 'text-orange-400',
  },
  completed: {
    label: 'تمام شد',
    hint: 'این سفر وارد پاسپورتت شد.',
    color: 'text-green-400',
  },
  cancelled: {
    label: 'لغو شده',
    hint: 'می‌تونی از قالب‌ها دوباره شروع کنی.',
    color: 'text-red-400',
  },
};

const actionClass = 'inline-flex items-center gap-1 rounded-rava-lg px-4 py-2 text-rava-xs font-black';

export const MyTrip: React.FC = () => {
  const {
    tripEvents,
    wallet,
    activeTrip,
    startTrip,
    pauseTrip,
    resumeTrip,
    completeTrip,
    cancelTrip,
  } = useUserStore();
  const [showScanner, setShowScanner] = useState(false);
  const [showRecap, setShowRecap] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [suggest, setSuggest] = useState<{ title: string; action: string } | null>(null);

  const status: TripLifecycleStatus = activeTrip?.status || (tripEvents.length ? 'upcoming' : 'planning');
  const meta = STATUS_UI[status];

  const todaysList = useMemo(() => {
    const today = todayIso();
    const scoped = activeTrip
      ? tripEvents.filter((e) => !e.journeyId || e.journeyId === activeTrip.id)
      : tripEvents;
    const todays = getTodaysEvents(scoped, today);
    if (todays.length > 0) return todays;
    return sortEvents(scoped);
  }, [tripEvents, activeTrip]);

  const handleSuggest = (next: TripEvent | null, action: 'complete' | 'skip') => {
    if (!next) {
      setSuggest({ title: 'آفرین — برنامه امروز تموم شد', action });
      return;
    }
    setSuggest({
      title: action === 'complete' ? `بعدی: ${next.title}` : `پیشنهاد بعدی: ${next.title}`,
      action,
    });
    setTimeout(() => setSuggest(null), 4000);
  };

  return (
    <div className="page-pad h-full overflow-y-auto pt-6 no-scrollbar">
      <div className="mb-6 flex items-end justify-between">
        <div className="text-right">
          <h2 className="mb-1 text-rava-xs font-black tracking-widest text-white/40">راوا · سفر من</h2>
          <div className="flex items-center justify-end gap-2">
            <span className="ltr-island text-3xl font-black tracking-tighter text-white" dir="ltr">
              {wallet.xp}
            </span>
            <span className="text-rava-xs font-black text-rava-gold">امتیاز</span>
          </div>
          <p className={`mt-2 text-rava-xs font-black ${meta.color}`}>{meta.label}</p>
          {activeTrip && (
            <p className="mt-1 text-rava-xs text-white/30">
              {activeTrip.title} · {activeTrip.city}
              {(activeTrip.startDate || activeTrip.endDate) && (
                <span className="mt-0.5 block">
                  {displayJalaliDate(activeTrip.startDate)}
                  {activeTrip.endDate ? ` — ${displayJalaliDate(activeTrip.endDate)}` : ''}
                </span>
              )}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowScanner(true)}
          className="tap-target flex items-center justify-center rounded-rava-xl border border-rava-gold/20 glass p-4 text-rava-gold transition-transform active:scale-95"
          aria-label="اسکن بلیط"
        >
          <ScanLine size={22} />
        </button>
      </div>

      <p className="mb-6 text-right text-rava-sm leading-relaxed text-white/35">{meta.hint}</p>

      <div className="mb-6 flex flex-wrap justify-end gap-2">
        {(status === 'upcoming' || status === 'planning') && activeTrip && (
          <button onClick={() => startTrip()} className={`${actionClass} bg-rava-gold text-black`}>
            <Play size={14} /> شروع سفر
          </button>
        )}
        {status === 'active' && (
          <>
            <button onClick={() => pauseTrip()} className={`${actionClass} bg-white/10 text-white`}>
              <Pause size={14} /> توقف
            </button>
            <button onClick={() => completeTrip()} className={`${actionClass} bg-green-500/20 text-green-400`}>
              <Flag size={14} /> پایان سفر
            </button>
          </>
        )}
        {status === 'paused' && (
          <button onClick={() => resumeTrip()} className={`${actionClass} bg-rava-gold text-black`}>
            <Play size={14} /> ادامه سفر
          </button>
        )}
        {activeTrip && status !== 'completed' && status !== 'cancelled' && (
          <button onClick={() => cancelTrip()} className={`${actionClass} bg-red-500/10 text-red-400`}>
            <XCircle size={14} /> لغو
          </button>
        )}
        <button onClick={() => setShowRecap(true)} className={`${actionClass} bg-white/10 text-white/80`}>
          <BookOpen size={14} /> خلاصه امروز
        </button>
        <button onClick={() => setShowTemplates((v) => !v)} className={`${actionClass} bg-white/5 text-white/50`}>
          <Route size={14} /> قالب‌ها
        </button>
      </div>

      <AnimatePresence>
        {suggest && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mb-4 rounded-rava-lg border border-rava-gold/30 bg-rava-gold/15 px-4 py-3 text-right text-rava-sm font-bold text-rava-gold"
          >
            {suggest.title}
          </motion.div>
        )}
      </AnimatePresence>

      {showTemplates && (
        <div className="mb-10">
          <StaticTripPicker onCloned={() => setShowTemplates(false)} />
        </div>
      )}

      {(status === 'planning' || !activeTrip) && !showTemplates && tripEvents.length === 0 && (
        <div className="mb-10">
          <StaticTripPicker />
        </div>
      )}

      <div className="mb-8">
        <SafeHavenCard />
      </div>

      {todaysList.length > 0 && (
        <div className="relative ms-4 border-s-2 border-white/10 ps-6">
          {todaysList.map((event, idx) => (
            <TimelineEvent
              key={event.id}
              event={event}
              index={idx}
              isLast={idx === todaysList.length - 1}
              onSuggestNext={handleSuggest}
            />
          ))}
        </div>
      )}

      {todaysList.length === 0 && !showTemplates && (
        <div className="mt-10 rounded-rava-modal border border-white/5 glass p-8 text-center text-rava-sm text-white/40">
          <Plus size={20} className="mx-auto mb-3 text-rava-gold" />
          برنامه‌ای برای امروز نداری. از قالب‌ها شروع کن یا بلیطت را اسکن کن.
        </div>
      )}

      <TicketScanner isOpen={showScanner} onClose={() => setShowScanner(false)} />
      <DailyRecapModal open={showRecap} onClose={() => setShowRecap(false)} />
    </div>
  );
};
