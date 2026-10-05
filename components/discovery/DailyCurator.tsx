import React, { useState } from 'react';
import { motion as _motion } from 'framer-motion';
import { Sparkles, Loader2, Calendar, CheckCircle2 } from 'lucide-react';
import { GlassCard } from '../core/GlassCard';
import { useUserStore } from '../../store/useUserStore';
import { useMapStore } from '../../store/useMapStore';
import { GoogleGenAI, Type } from '@google/genai';
import { extractJSON } from '../../utils/jsonParser';
import { TripEvent } from '../../types';
import { GeoPoint } from '../../utils/geoPoint';
import { APP_CONFIG } from '../../config';

const motion = _motion as any;

interface AIPlan {
  morning: string;
  lunch: string;
  afternoon: string;
  evening: string;
}

export const DailyCurator: React.FC = () => {
  const { cityMode, addTripEvent } = useUserStore();
  const userLocation = useMapStore(s => s.userLocation);
  const [isPlanning, setIsPlanning] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [plan, setPlan] = useState<AIPlan | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const generatePlan = async () => {
    if (!cityMode) return;
    setIsPlanning(true);
    
    // استفاده از کلاس GeoPoint برای استانداردسازی لوکیشن ارسالی به AI
    const geo = GeoPoint.fromArray(userLocation);
    const locString = geo ? `${geo.lat},${geo.lng}` : "Unknown Location";

    const ai = new GoogleGenAI({ apiKey: APP_CONFIG.GOOGLE.GEMINI_API_KEY });
    
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `به عنوان راوا، برای امروز من در ${cityMode} یک برنامه سفر باحال بچین.
        موقعیت فعلی من: ${locString}
        برنامه شامل: صبح، ناهار، عصر و شب.
        خروجی فقط و فقط JSON باشد.`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              morning: { type: Type.STRING },
              lunch: { type: Type.STRING },
              afternoon: { type: Type.STRING },
              evening: { type: Type.STRING }
            },
            required: ['morning', 'lunch', 'afternoon', 'evening']
          }
        }
      });

      const data = extractJSON<AIPlan>(response.text || "{}");
      setPlan(data);
    } catch (e) {
      console.error("AI Planning Error:", e);
    } finally {
      setIsPlanning(false);
    }
  };

  const handleAddToTimeline = async () => {
    if (!plan) return;
    setIsAdding(true);

    const times = {
      morning: '09:00',
      lunch: '13:30',
      afternoon: '16:00',
      evening: '20:00'
    };

    try {
      const geo = GeoPoint.fromArray(userLocation);
      
      const promises = (Object.entries(plan) as [keyof AIPlan, string][]).map(([key, value]) => {
        const event: TripEvent = {
          id: crypto.randomUUID(),
          type: key === 'lunch' ? 'food' : 'activity',
          title: value,
          time: times[key],
          date: new Date().toISOString().split('T')[0],
          status: 'pending',
          sequence: Object.keys(times).indexOf(key),
          coordinates: geo?.toArray(),
          details: { notes: 'پیشنهاد هوشمند راوا' }
        };
        return addTripEvent(event);
      });

      await Promise.all(promises);
      setPlan(null);
      setSuccessMsg("برنامه امروزت توی تب 'سفر من' چیده شد رفیق! بزن بریم.");
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch(err) {
      console.error("Sync to Timeline Failed:", err);
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <GlassCard className="bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border-indigo-500/30 overflow-hidden relative">
      <div className="absolute top-0 end-0 w-32 h-32 bg-indigo-500/10 blur-3xl rounded-full" />
      <div className="flex justify-between items-center mb-6 relative z-10">
        <div className="p-2 bg-indigo-500/20 rounded-lg text-indigo-400"><Calendar size={20} /></div>
        <h3 className="text-white font-black text-xl">برنامه پیشنهادی امروز</h3>
      </div>

      {!plan ? (
        <div className="relative z-10 space-y-4">
          {successMsg ? (
            <p className="rounded-rava-lg border border-green-500/20 bg-green-500/10 p-3 text-right text-rava-xs font-bold text-green-400">
              {successMsg}
            </p>
          ) : null}
          <p className="text-white/60 text-sm leading-relaxed text-right">
             رفیق هنوز برنامه‌ای نداری؟ راوا با هوش مصنوعی‌ش برات یه مسیر خفن می‌چینه که نه خسته شی، نه جای باحالی رو از دست بدی.
          </p>
          <button 
            onClick={generatePlan} disabled={isPlanning}
            className="w-full bg-indigo-600 py-4 rounded-2xl text-white font-black shadow-lg flex items-center justify-center gap-2 active:scale-95 transition-all disabled:opacity-50"
          >
            {isPlanning ? <Loader2 size={18} className="animate-spin" /> : <><Sparkles size={18} /> برنامه رو بچین</>}
          </button>
        </div>
      ) : (
        <div className="relative z-10 space-y-6">
           <div className="space-y-4 text-right">
              {[
                { label: 'صبح', text: plan.morning, color: 'text-yellow-400' },
                { label: 'ناهار', text: plan.lunch, color: 'text-orange-400' },
                { label: 'عصر', text: plan.afternoon, color: 'text-indigo-400' },
                { label: 'شب', text: plan.evening, color: 'text-purple-400' }
              ].map((item, i) => (
                <motion.div 
                  initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.1 }}
                  key={i} className="flex gap-4 items-start"
                >
                   <div className={`mt-1 h-2 w-2 rounded-full shrink-0 ${item.color.replace('text', 'bg')}`} />
                   <div>
                      <span className={`text-rava-xs font-black uppercase ${item.color}`}>{item.label}</span>
                      <p className="text-white text-xs font-bold leading-relaxed">{item.text}</p>
                   </div>
                </motion.div>
              ))}
           </div>
           <div className="flex gap-2">
             <button 
                onClick={handleAddToTimeline} disabled={isAdding}
                className="flex-[2] bg-white text-black py-4 rounded-2xl font-black text-xs flex items-center justify-center gap-2 shadow-xl active:scale-95 transition-all disabled:opacity-50"
              >
               {isAdding ? <Loader2 size={14} className="animate-spin" /> : <><CheckCircle2 size={14} /> اضافه به برنامه من</>}
             </button>
             <button 
                onClick={() => setPlan(null)} 
                className="glass flex-1 rounded-rava-lg py-4 text-rava-xs font-black text-white/40 active:scale-95"
              >
                لغو
              </button>
           </div>
        </div>
      )}
    </GlassCard>
  );
};