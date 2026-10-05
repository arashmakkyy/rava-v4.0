import React from 'react';
import { BargainCalculator } from '../components/tools/BargainCalculator';
import { FlashcardGrid } from '../components/tools/FlashcardGrid';
import { FlashcardModal } from '../components/tools/FlashcardModal';
import { SubwayMap } from '../components/tools/SubwayMap';
import { GlassCard } from '../components/core/GlassCard';
import { useSurvivalStore } from '../store/useSurvivalStore';
import { Phone } from 'lucide-react';
import { PageHeader, Button } from '../components/ui';

export const Tools: React.FC = () => {
  const { activeFlashcard, setActiveFlashcard } = useSurvivalStore();

  return (
    <div className="page-pad h-full overflow-y-auto pt-6 no-scrollbar scroll-smooth">
      <PageHeader title="ابزارهای بقا" subtitle="Traveler's Survival Toolkit" />

      <div className="space-y-6">
        <BargainCalculator />
        <SubwayMap />
        <FlashcardGrid />
      </div>

      <div className="mt-10 space-y-3">
        <h4 className="rava-page-subtitle px-1 text-right">پشتیبانی فوری</h4>
        <GlassCard className="overflow-hidden !rounded-rava-xl border-rava-danger/20 bg-rava-danger/10 py-5">
          <div className="relative z-10 mb-3 flex items-center justify-between">
            <div className="flex h-10 w-10 items-center justify-center rounded-rava-md bg-rava-danger text-white shadow-lg">
              <Phone size={20} />
            </div>
            <div className="text-right">
              <h4 className="text-rava-base font-black text-rava-danger">پشتیبانی فوری راوا</h4>
              <span className="text-rava-xs font-bold text-rava-danger/50 ltr-island">24/7 Priority Line</span>
            </div>
          </div>
          <p className="mb-4 text-right text-rava-sm leading-relaxed text-white/60">
            اگر مشکلی با پلیس یا راننده داری یا نیاز به ترجمه فوری در بیمارستان داری، رفقای ما آماده کمک هستن.
          </p>
          <Button fullWidth variant="danger" className="border border-rava-danger/30 bg-rava-danger text-white">
            تماس اضطراری (رایگان)
          </Button>
        </GlassCard>
      </div>

      <FlashcardModal card={activeFlashcard} onClose={() => setActiveFlashcard(null)} />
    </div>
  );
};
