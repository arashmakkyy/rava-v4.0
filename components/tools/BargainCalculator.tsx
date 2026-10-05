import React, { useState } from 'react';
import { motion as _motion, AnimatePresence } from 'framer-motion';
import { DollarSign, Tag, AlertCircle, CheckCircle2, Sparkles } from 'lucide-react';
import { GlassCard } from '../core/GlassCard';
import { useUserStore } from '../../store/useUserStore';
import { useSurvivalStore } from '../../store/useSurvivalStore';
import { GoogleGenAI, Type } from '@google/genai';
import { extractJSON } from '../../utils/jsonParser';
import { formatAsToman } from '../../utils/helpers';
import { AudioGraph } from '../../services/audioGraph';
import { APP_CONFIG } from '../../config';
import { Button, Input } from '../ui';

const motion = _motion as any;

interface Verdict {
  status: 'good' | 'bad' | 'neutral';
  fair_price: number;
  message: string;
}

export const BargainCalculator: React.FC = () => {
  const { cityMode, semanticProfile } = useUserStore();
  const { rates } = useSurvivalStore();
  const [price, setPrice] = useState('');
  const [item, setItem] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [verdict, setVerdict] = useState<Verdict | null>(null);

  const currencyLabel = cityMode === 'Istanbul' ? 'لیر' : 'درهم';
  const currentRate = cityMode === 'Istanbul' ? rates.TRY : rates.AED;

  const calculateFairness = async () => {
    if (!price || !item) return;
    setIsThinking(true);
    setVerdict(null);
    AudioGraph.getInstance().playTickSound();

    const ai = new GoogleGenAI({ apiKey: APP_CONFIG.GOOGLE.GEMINI_API_KEY });
    const userVibe = semanticProfile.travel_style || 'normal';

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `به عنوان "راوا" (دستیار توریست ایرانی)، این قیمت رو کارشناسی کن:
        آیتم: ${item}
        قیمت اعلامی فروشنده: ${price} ${currencyLabel}
        شهر: ${cityMode}
        سبک سفر کاربر: ${userVibe}
        
        بگو آیا می‌ارزه؟ قیمت منصفانه (fair_price) چنده؟ 
        لحن: صمیمی و محافظ جیب مسافر.`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              status: { type: Type.STRING, enum: ['good', 'bad', 'neutral'] },
              fair_price: { type: Type.NUMBER },
              message: { type: Type.STRING },
            },
            required: ['status', 'fair_price', 'message'],
          },
        },
      });

      const data = extractJSON<Verdict>(response.text || '{}');
      setVerdict(data);
      if (data.status === 'bad') AudioGraph.haptic([100, 50, 100]);
      else AudioGraph.getInstance().playCoinSound();
    } catch {
      setVerdict({ status: 'neutral', fair_price: parseFloat(price), message: 'رفیق فعلاً ارتباطم با بازار قطع شده، ولی کلاً حواست باشه توریستی حساب نکنن باهات!' });
    } finally {
      setIsThinking(false);
    }
  };

  return (
    <div className="space-y-5">
      <GlassCard className="relative overflow-hidden border-rava-gold/20">
        <div className="absolute -start-10 -top-10 h-32 w-32 rounded-full bg-rava-gold/5 blur-3xl" />
        <h3 className="mb-5 flex items-center gap-3 text-rava-xl font-black text-white">
          <div className="rounded-rava-md bg-rava-gold/20 p-2 text-rava-gold"><DollarSign size={20} /></div>
          ماشین‌حساب چانه‌زنی
        </h3>

        <div className="space-y-4">
          <Input type="text" placeholder="چی می‌خوای بخری؟ (مثلاً: تیشرت)" value={item} onChange={(e) => setItem(e.target.value)} icon={<Tag size={16} />} />
          <Input type="number" placeholder={`قیمت به ${currencyLabel}`} value={price} onChange={(e) => setPrice(e.target.value)} icon={<span className="text-rava-xs font-black uppercase">{currencyLabel}</span>} className="font-mono text-xl font-black" />

          <div className="flex items-center justify-between rounded-rava-lg border border-rava-gold/20 bg-gradient-to-l from-rava-gold/10 to-transparent px-5 py-4">
            <span className="text-rava-2xl font-black text-rava-gold">{price ? formatAsToman(parseFloat(price), currentRate) : '۰ تومان'}</span>
            <p className="text-rava-xs font-black text-white/40 ltr-island">Toman Equivalent</p>
          </div>

          <Button fullWidth size="lg" onClick={calculateFairness} disabled={isThinking || !price || !item} leadingIcon={!isThinking ? <Sparkles size={18} /> : undefined} loading={isThinking}>
            می‌ارزه؟
          </Button>
        </div>
      </GlassCard>

      <AnimatePresence>
        {verdict && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className={`flex flex-col gap-4 rounded-rava-modal border p-5 text-right shadow-glass ${verdict.status === 'good' ? 'border-green-500/30 bg-green-500/10 text-green-400' : verdict.status === 'bad' ? 'border-red-500/30 bg-red-500/10 text-red-400' : 'border-blue-500/30 bg-blue-500/10 text-blue-400'}`}>
            <div className="flex items-center justify-between">
              <div className="rounded-full bg-black/20 px-3 py-1 text-rava-xs font-black">
                Fair: {verdict.fair_price} {currencyLabel}
              </div>
              <div className="flex items-center gap-2">
                {verdict.status === 'good' ? <CheckCircle2 size={22} /> : <AlertCircle size={22} />}
                <span className="font-black">نظر راوا</span>
              </div>
            </div>
            <p className="pe-1 text-rava-sm font-bold leading-relaxed">{verdict.message}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
