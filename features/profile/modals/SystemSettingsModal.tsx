import React, { useState, useEffect } from 'react';
import { Settings, Database, Trash2, Globe, Check, Languages } from 'lucide-react';
import { useSurvivalStore } from '../../../store/useSurvivalStore';
import { useAuthStore } from '../../../store/useAuthStore';
import { AudioGraph } from '../../../services/audioGraph';
import { ModalShell, ModalCard, ModalHeader, Button } from '../../../components/ui';

interface SystemSettingsModalProps {
  onClose: () => void;
}

const optionClass = (active: boolean, accent: 'gold' | 'indigo') =>
  [
    'flex w-full items-center justify-between rounded-rava-lg border p-4 transition-all',
    active
      ? accent === 'gold'
        ? 'border-rava-gold/40 bg-rava-gold/10 text-white'
        : 'border-indigo-500/40 bg-indigo-500/10 text-white'
      : 'border-white/5 bg-white/[0.02] text-white/40 hover:border-white/10',
  ].join(' ');

export const SystemSettingsModal: React.FC<SystemSettingsModalProps> = ({ onClose }) => {
  const { activeCurrency, setActiveCurrency } = useSurvivalStore();
  const { semanticProfile, updatePreference } = useAuthStore();
  const [cacheSize, setCacheSize] = useState('...');
  const [clearing, setClearing] = useState(false);
  const language = semanticProfile.language || 'fa';

  useEffect(() => {
    if ('storage' in navigator && 'estimate' in navigator.storage) {
      navigator.storage.estimate().then((estimate) => {
        const sizeMB = (estimate.usage || 0) / (1024 * 1024);
        setCacheSize(`${sizeMB.toFixed(1)} MB`);
      });
    }
  }, []);

  const handleClearCache = async () => {
    setClearing(true);
    AudioGraph.haptic([50, 100, 50]);
    try {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map((name) => caches.delete(name)));
      setTimeout(() => {
        setCacheSize('0.0 MB');
        setClearing(false);
      }, 1200);
    } catch {
      setClearing(false);
    }
  };

  const currencies: { id: 'IRT' | 'TRY' | 'AED'; label: string; desc: string }[] = [
    { id: 'IRT', label: 'تومان (ایران)', desc: 'نمایش تمام قیمت‌ها به واحد وطن' },
    { id: 'TRY', label: 'لیر (ترکیه)', desc: 'مناسب برای مسافران استانبول' },
    { id: 'AED', label: 'درهم (امارات)', desc: 'مناسب برای مسافران دبی' },
  ];

  const languages: { id: 'fa' | 'en'; label: string; desc: string }[] = [
    { id: 'fa', label: 'فارسی', desc: 'رابط و پاسخ‌های پیش‌فرض فارسی' },
    { id: 'en', label: 'English', desc: 'Prefer English UI cues where available' },
  ];

  return (
    <ModalShell open={true} onClose={onClose} contentClassName="max-w-sm">
      <ModalCard className="max-h-[85vh] overflow-hidden">
        <ModalHeader
          icon={<Settings size={28} />}
          title="تنظیمات سیستم"
          subtitle="Core System Control"
          onClose={onClose}
        />

        <div className="max-h-[55vh] space-y-8 overflow-y-auto text-right no-scrollbar">
          <section className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <Languages size={14} className="text-rava-gold" />
              <h4 className="text-rava-xs font-black tracking-widest text-white/40">زبان ترجیحی</h4>
            </div>
            <div className="space-y-2">
              {languages.map((lang) => (
                <button
                  key={lang.id}
                  type="button"
                  onClick={() => {
                    updatePreference('language', lang.id);
                    AudioGraph.getInstance().playTickSound();
                  }}
                  className={optionClass(language === lang.id, 'gold')}
                >
                  {language === lang.id ? <Check size={18} className="text-rava-gold" /> : <div className="w-4" />}
                  <div className="text-right">
                    <span className="block text-rava-sm font-black">{lang.label}</span>
                    <span className="text-rava-xs font-bold opacity-60">{lang.desc}</span>
                  </div>
                </button>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <Globe size={14} className="text-indigo-400" />
              <h4 className="text-rava-xs font-black tracking-widest text-white/40">واحد پول پیش‌فرض</h4>
            </div>
            <div className="space-y-2">
              {currencies.map((curr) => (
                <button
                  key={curr.id}
                  type="button"
                  onClick={() => {
                    setActiveCurrency(curr.id);
                    AudioGraph.getInstance().playTickSound();
                  }}
                  className={optionClass(activeCurrency === curr.id, 'indigo')}
                >
                  {activeCurrency === curr.id ? <Check size={18} className="text-indigo-400" /> : <div className="w-4" />}
                  <div className="text-right">
                    <span className="block text-rava-sm font-black">{curr.label}</span>
                    <span className="text-rava-xs font-bold opacity-60">{curr.desc}</span>
                  </div>
                </button>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <Database size={14} className="text-rava-danger" />
              <h4 className="text-rava-xs font-black tracking-widest text-white/40">مدیریت حافظه</h4>
            </div>
            <div className="glass flex items-center justify-between rounded-rava-xl border-white/5 p-4">
              <Button
                size="sm"
                variant="danger"
                onClick={handleClearCache}
                loading={clearing}
                leadingIcon={!clearing ? <Trash2 size={14} /> : undefined}
              >
                پاکسازی
              </Button>
              <div className="text-right">
                <span className="block text-rava-sm font-black text-white">دیتای ذخیره شده</span>
                <span className="text-rava-xs font-bold text-white/25">{cacheSize} اشغال شده</span>
              </div>
            </div>
          </section>
        </div>

        <Button fullWidth variant="secondary" size="lg" className="mt-6" onClick={onClose}>
          تایید نهایی
        </Button>
      </ModalCard>
    </ModalShell>
  );
};
