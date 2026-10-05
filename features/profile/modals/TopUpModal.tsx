import React, { useState } from 'react';
import { X, Zap, Gift } from 'lucide-react';
import { AudioGraph } from '../../../services/audioGraph';
import { supabase } from '../../../services/supabaseClient';
import { ModalShell, ModalCard, Button, IconButton } from '../../../components/ui';

/**
 * Demo-mode top-up. There is NO real payment provider yet, so this modal must
 * never pretend to charge money. It grants a small server-capped daily credit
 * via the `claim_demo_credit` RPC (0.5h/day, enforced server-side).
 * When a real gateway lands, replace this with the checkout flow (P0.1 exit).
 */
const DEMO_MINUTES = 30;

interface TopUpModalProps {
  onClose: () => void;
}

export const TopUpModal: React.FC<TopUpModalProps> = ({ onClose }) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claimed, setClaimed] = useState(false);

  const handleCharge = async () => {
    setIsProcessing(true);
    setError(null);
    AudioGraph.getInstance().playTickSound();

    try {
      const { data, error: rpcError } = await supabase.rpc('claim_demo_credit', {
        px_transaction_id: crypto.randomUUID(),
      });

      if (rpcError) throw rpcError;

      const row = Array.isArray(data) ? data[0] : data;
      if (row && (row as { daily_cap?: boolean }).daily_cap) {
        setError('سهم امروز رو گرفتی — فردا دوباره بیا.');
        setIsProcessing(false);
        return;
      }

      AudioGraph.getInstance().playCoinSound();
      setClaimed(true);
      setTimeout(onClose, 1200);
    } catch {
      setError('ارتباط با سرور برقرار نشد. دوباره تلاش کن.');
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
            <h3 className="rava-page-title text-2xl">شارژ سوخت</h3>
            <p className="rava-page-subtitle mt-1">اعتبار دمو · پرداخت واقعی به‌زودی</p>
          </div>
        </div>

        <div className="flex w-full items-center justify-between rounded-rava-xl border border-rava-gold/30 bg-rava-gold/10 p-4 text-right">
          <div className="text-right">
            <h4 className="text-rava-base font-black text-white">اعتبار روزانه دمو</h4>
            <p className="mt-0.5 text-rava-xs font-bold text-white/40">هر روز یک بار، بدون پرداخت</p>
          </div>
          <div className="flex flex-col items-end">
            <div className="flex items-center gap-1.5">
              <span className="text-lg font-black leading-none text-rava-gold">{DEMO_MINUTES}</span>
              <span className="mt-1 text-rava-xs font-black text-white/50">دقیقه</span>
            </div>
          </div>
        </div>

        {error ? <p className="text-right text-rava-xs font-bold text-rava-danger">{error}</p> : null}

        <div className="space-y-4">
          <div className="flex items-center justify-center gap-2 text-white/25">
            <Gift size={14} />
            <span className="text-rava-xs font-black">بدون درگاه پرداخت در حالت دمو</span>
          </div>
          <Button
            fullWidth
            variant="secondary"
            size="lg"
            onClick={handleCharge}
            loading={isProcessing}
            disabled={claimed}
            trailingIcon={!isProcessing && !claimed ? <Gift size={20} /> : undefined}
          >
            {claimed ? 'دریافت شد' : 'دریافت اعتبار دمو'}
          </Button>
        </div>
      </ModalCard>
    </ModalShell>
  );
};
