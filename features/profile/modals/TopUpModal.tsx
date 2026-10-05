import React, { useState } from 'react';
import { X, Zap, CreditCard, ShieldCheck } from 'lucide-react';
import { useSurvivalStore } from '../../../store/useSurvivalStore';
import { AudioGraph } from '../../../services/audioGraph';
import { supabase } from '../../../services/supabaseClient';
import { ModalShell, ModalCard, Button, IconButton } from '../../../components/ui';

const PACKAGES = [
  { id: '1h', mins: 60, price: 5, label: 'پکیج پایه', desc: 'مناسب برای گشت‌وگذار سریع' },
  { id: '5h', mins: 300, price: 20, label: 'پکیج کاشف', desc: 'محبوب‌ترین انتخاب مسافران', badge: 'Best Value' },
  { id: '10h', mins: 600, price: 35, label: 'پکیج الیت', desc: 'تجربه سفر کاملاً خودمختار' },
];

interface TopUpModalProps {
  onClose: () => void;
}

export const TopUpModal: React.FC<TopUpModalProps> = ({ onClose }) => {
  const { rates, activeCurrency } = useSurvivalStore();
  const [selectedId, setSelectedId] = useState('5h');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getPrice = (usdPrice: number) => {
    const rate = activeCurrency === 'AED' ? rates.AED : rates.TRY;
    const finalPrice = usdPrice * rate;
    const formatter = new Intl.NumberFormat('fa-IR');
    return `${formatter.format(Math.floor(finalPrice))} ${activeCurrency === 'AED' ? 'درهم' : activeCurrency === 'TRY' ? 'لیر' : 'تومان'}`;
  };

  const handleCharge = async () => {
    setIsProcessing(true);
    setError(null);
    AudioGraph.getInstance().playTickSound();

    try {
      const pkg = PACKAGES.find((p) => p.id === selectedId);
      if (!pkg) return;

      const { error } = await supabase.rpc('increment_wallet', {
        px_transaction_id: crypto.randomUUID(),
        px_amount: pkg.mins / 60.0,
        px_xp_amount: pkg.mins * 2,
        px_reward_type: 'topup',
      });

      if (error) throw error;

      AudioGraph.getInstance().playCoinSound();
      setTimeout(onClose, 1200);
    } catch {
      setError('خطا در برقراری ارتباط با درگاه بانکی');
      setIsProcessing(false);
    }
  };

  return (
    <ModalShell open={true} onClose={onClose} contentClassName="max-w-sm">
      <ModalCard className="space-y-6">
        <div className="flex items-start justify-between">
          <IconButton icon={X} label="بستن" onClick={onClose} size="sm" variant="ghost" />
          <div className="text-right">
            <div className="mb-3 ms-auto flex h-14 w-14 items-center justify-center rounded-rava-xl border border-green-500/20 bg-green-500/10 text-green-500 shadow-glass">
              <Zap size={28} fill="currentColor" />
            </div>
            <h3 className="rava-page-title text-2xl">شارژ سوخت الیت</h3>
            <p className="rava-page-subtitle mt-1 ltr-island">Purchase Talking Time</p>
          </div>
        </div>

        <div className="space-y-3">
          {PACKAGES.map((pkg) => (
            <button
              key={pkg.id}
              onClick={() => setSelectedId(pkg.id)}
              className={`relative flex w-full items-center justify-between overflow-hidden rounded-rava-xl border p-4 text-right transition-all ${
                selectedId === pkg.id
                  ? 'border-rava-gold bg-rava-gold text-black shadow-gold'
                  : 'border-white/5 bg-white/[0.02] text-white hover:border-white/10'
              }`}
            >
              {pkg.badge ? (
                <span className={`absolute end-8 top-0 rounded-b-xl px-3 py-1 text-rava-xs font-black ${selectedId === pkg.id ? 'bg-black text-rava-gold' : 'bg-rava-gold text-black'}`}>
                  {pkg.badge}
                </span>
              ) : null}
              <div className="text-right">
                <h4 className="text-rava-base font-black">{pkg.label}</h4>
                <p className={`mt-0.5 text-rava-xs font-bold ${selectedId === pkg.id ? 'text-black/65' : 'text-white/25'}`}>{pkg.desc}</p>
              </div>
              <div className="flex flex-col items-end">
                <div className="flex items-center gap-1.5">
                  <span className="text-lg font-black leading-none">{pkg.mins}</span>
                  <span className="mt-1 text-rava-xs font-black opacity-60 ltr-island">Min</span>
                </div>
                <span className={`mt-1.5 text-rava-xs font-bold ${selectedId === pkg.id ? 'text-black/80' : 'text-rava-gold/80'}`}>
                  {getPrice(pkg.price)}
                </span>
              </div>
            </button>
          ))}
        </div>

        {error ? <p className="text-right text-rava-xs font-bold text-rava-danger">{error}</p> : null}

        <div className="space-y-4">
          <div className="flex items-center justify-center gap-2 text-white/25">
            <ShieldCheck size={14} />
            <span className="text-rava-xs font-black ltr-island">Secure Payment Gateway</span>
          </div>
          <Button fullWidth variant="secondary" size="lg" onClick={handleCharge} loading={isProcessing} trailingIcon={!isProcessing ? <CreditCard size={20} /> : undefined}>
            تایید و پرداخت
          </Button>
        </div>
      </ModalCard>
    </ModalShell>
  );
};
