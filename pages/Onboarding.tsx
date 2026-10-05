import React, { useState } from 'react';
import { AnimatePresence, motion as _motion } from 'framer-motion';
import { useAuthStore } from '../store/useAuthStore';
import { Sparkles, Clock, MapPin, ChevronLeft } from 'lucide-react';
import { AudioGraph } from '../services/audioGraph';
import { CityMode } from '../types';
import { ProgressIndicator } from '../features/onboarding/components/ProgressIndicator';
import { CityStep } from '../features/onboarding/components/CityStep';
import { VibeStep } from '../features/onboarding/components/VibeStep';
import { CrewStep } from '../features/onboarding/components/CrewStep';
import { Button } from '../components/ui';

const motion = _motion as any;

export const Onboarding: React.FC = () => {
  const { finalizeOnboarding } = useAuthStore();

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [isTravelingNow, setIsTravelingNow] = useState(true);
  const [selection, setSelection] = useState({
    city: null as CityMode,
    vibe: null as string | null,
    crew: null as string | null,
  });

  const handleNext = () => {
    AudioGraph.getInstance().playTickSound();
    setStep((s) => s + 1);
  };

  const handleFinalize = async () => {
    if (!selection.city || !selection.vibe || !selection.crew) return;
    setLoading(true);
    AudioGraph.getInstance().playCoinSound();
    const { city, vibe, crew } = selection;
    await finalizeOnboarding({ city, vibe, crew, isTravelingNow });
  };

  return (
    <div className="fixed inset-0 z-[5000] flex flex-col overflow-hidden bg-rava-bg px-5 pb-safe pt-safe sm:px-8">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute start-1/4 top-1/4 h-72 w-72 rounded-full bg-rava-gold/5 blur-[120px] sm:h-96 sm:w-96" />
        <div className="absolute bottom-1/4 end-1/4 h-72 w-72 rounded-full bg-indigo-500/5 blur-[120px] sm:h-96 sm:w-96" />
      </div>

      <div className="pt-4">
        <ProgressIndicator currentStep={step} />
      </div>

      <div className="relative z-10 flex flex-1 flex-col overflow-y-auto no-scrollbar pt-6">
        <AnimatePresence mode="wait">
          {step === 1 && (
            <motion.div key="step1" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-8">
              <CityStep selectedCity={selection.city} onSelect={(city) => setSelection({ ...selection, city })} />

              {selection.city && (
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
                  <h4 className="px-1 text-right text-rava-base font-black text-white/60">زمان سفر شما؟</h4>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <button
                      onClick={() => setIsTravelingNow(true)}
                      className={`flex flex-col items-center gap-3 rounded-rava-xl border p-5 transition-all duration-500 ${
                        isTravelingNow
                          ? 'border-rava-gold bg-rava-gold text-black shadow-gold'
                          : 'border-white/5 bg-white/5 text-white/40 hover:border-white/10'
                      }`}
                    >
                      <MapPin size={22} className={isTravelingNow ? 'animate-bounce' : ''} />
                      <span className="text-rava-xs font-black">همین الان</span>
                    </button>
                    <button
                      onClick={() => setIsTravelingNow(false)}
                      className={`flex flex-col items-center gap-3 rounded-rava-xl border p-5 transition-all duration-500 ${
                        !isTravelingNow
                          ? 'border-rava-gold bg-rava-gold text-black shadow-gold'
                          : 'border-white/5 bg-white/5 text-white/40 hover:border-white/10'
                      }`}
                    >
                      <Clock size={22} />
                      <span className="text-rava-xs font-black">در آینده</span>
                    </button>
                  </div>
                  <Button fullWidth variant="secondary" size="lg" onClick={handleNext} trailingIcon={<ChevronLeft size={18} />}>
                    تایید و ادامه
                  </Button>
                </motion.div>
              )}
            </motion.div>
          )}

          {step === 2 && (
            <VibeStep
              key="step2"
              selectedVibe={selection.vibe}
              onSelect={(vibe) => {
                setSelection({ ...selection, vibe });
                handleNext();
              }}
              onBack={() => setStep(1)}
            />
          )}

          {step === 3 && (
            <CrewStep
              key="step3"
              selectedCrew={selection.crew}
              loading={loading}
              onSelect={(crew) => setSelection({ ...selection, crew })}
              onBack={() => setStep(2)}
              onFinalize={handleFinalize}
            />
          )}
        </AnimatePresence>
      </div>

      <div className="pointer-events-none flex items-center justify-center gap-2 pb-4 pt-6 text-rava-xs font-black tracking-[0.28em] text-white/12">
        <Sparkles size={10} /> منطق هویت راوا
      </div>
    </div>
  );
};
