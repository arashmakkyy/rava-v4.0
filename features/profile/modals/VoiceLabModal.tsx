import React from 'react';
import { Play, Check, Headphones } from 'lucide-react';
import { useAuthStore } from '../../../store/useAuthStore';
import { AudioGraph } from '../../../services/audioGraph';
import { ModalShell, ModalCard, ModalHeader, Button } from '../../../components/ui';

const VOICES = [
  { id: 'Kore', name: 'کُور (مردانه - صمیمی)', desc: 'صدای گرم و محاوره‌ای' },
  { id: 'Zephyr', name: 'زفیر (زنانه - باوقار)', desc: 'صدای آرام و شمرده' },
  { id: 'Puck', name: 'پاک (شاداب)', desc: 'انرژی بالا برای ماجراجویی' },
];

interface VoiceLabModalProps {
  onClose: () => void;
}

export const VoiceLabModal: React.FC<VoiceLabModalProps> = ({ onClose }) => {
  const { semanticProfile, updateVoiceSettings } = useAuthStore();
  const currentVoice = semanticProfile.voice_config?.voiceName || 'Kore';
  const currentRate = semanticProfile.voice_config?.speechRate || 0.8;

  const handleSelect = (id: string) => {
    updateVoiceSettings(id, currentRate);
    AudioGraph.getInstance().playTickSound();
  };

  const handleRateChange = (rate: number) => {
    updateVoiceSettings(currentVoice, rate);
  };

  return (
    <ModalShell open={true} onClose={onClose} contentClassName="max-w-sm">
      <ModalCard>
        <ModalHeader
          icon={<Headphones size={28} className="text-black" />}
          title="لابراتوار حنجره"
          subtitle="تنظیم صدای راوا"
          onClose={onClose}
          className="[&>div:last-child>div:first-child]:bg-rava-gold [&>div:last-child>div:first-child]:border-rava-gold/30"
        />

        <div className="space-y-6 text-right">
          <h4 className="px-1 text-rava-xs font-black tracking-widest text-white/40">انتخاب پرسونا</h4>
          <div className="space-y-2">
            {VOICES.map((voice) => (
              <button
                key={voice.id}
                type="button"
                onClick={() => handleSelect(voice.id)}
                className={`flex w-full items-center justify-between rounded-rava-xl border p-4 transition-all ${
                  currentVoice === voice.id
                    ? 'border-rava-gold/40 bg-rava-gold/10'
                    : 'border-white/5 bg-white/5 opacity-60 hover:opacity-100'
                }`}
              >
                {currentVoice === voice.id ? <Check className="text-rava-gold" size={18} /> : <Play className="text-white/20" size={16} />}
                <div className="text-right">
                  <span className="block text-rava-sm font-black text-white">{voice.name}</span>
                  <span className="text-rava-xs font-bold text-white/40">{voice.desc}</span>
                </div>
              </button>
            ))}
          </div>

          <div className="space-y-4 border-t border-white/5 pt-4">
            <div className="flex items-center justify-between px-1">
              <span className="font-mono text-rava-sm font-black text-rava-gold">{currentRate}x</span>
              <h4 className="text-rava-xs font-black tracking-widest text-white/40">سرعت صحبت</h4>
            </div>
            <input
              type="range"
              min="0.5"
              max="1.5"
              step="0.1"
              value={currentRate}
              onChange={(e) => handleRateChange(parseFloat(e.target.value))}
              className="h-2 w-full cursor-pointer appearance-none rounded-full bg-white/5 accent-rava-gold"
            />
            <div className="flex justify-between px-1 text-rava-xs font-black text-white/20 ltr-island">
              <span>Fast</span>
              <span>Normal</span>
              <span>Relaxed</span>
            </div>
          </div>

          <Button fullWidth variant="secondary" size="lg" onClick={onClose}>
            بسیار خب
          </Button>
        </div>
      </ModalCard>
    </ModalShell>
  );
};
