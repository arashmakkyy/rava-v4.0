import React, { useEffect } from 'react';
import { ArrowUpRight, ArrowDownLeft, Clock, History } from 'lucide-react';
import { useUserStore } from '../../../store/useUserStore';
import { ModalShell, ModalCard, ModalHeader, EmptyState } from '../../../components/ui';

interface FuelLedgerModalProps {
  onClose: () => void;
}

export const FuelLedgerModal: React.FC<FuelLedgerModalProps> = ({ onClose }) => {
  const { fuelTransactions, fetchFuelHistory, wallet } = useUserStore();

  useEffect(() => {
    fetchFuelHistory().catch(() => undefined);
  }, [fetchFuelHistory]);

  const getIcon = (amount: number) =>
    amount > 0 ? <ArrowUpRight className="text-green-500" /> : <ArrowDownLeft className="text-rava-danger" />;

  const getLabel = (type: string, reason?: string) => {
    switch (type) {
      case 'usage':
        return reason || 'مصرف هوش مصنوعی';
      case 'stamp':
        return 'پاداش مهر پاسپورت';
      case 'topup':
        return 'شارژ پکیج';
      case 'price_report':
        return 'پاداش گزارش قیمت';
      case 'referral_bonus':
        return 'پاداش دعوت رفیق';
      case 'daily_itinerary':
        return 'تکمیل برنامه روزانه';
      case 'profile_complete':
        return 'تکمیل پروفایل';
      case 'achievement':
        return 'پاداش دستاورد';
      case 'streak':
        return 'پاداش رگبار روزانه';
      default:
        return 'تراکنش سیستمی';
    }
  };

  const fuelMins = Math.floor((wallet.balance ?? 0) * 60);

  return (
    <ModalShell open={true} onClose={onClose} contentClassName="max-w-md">
      <ModalCard className="flex max-h-[85vh] flex-col">
        <ModalHeader
          icon={<History size={28} className="text-rava-gold" />}
          title="دفتر کل سوخت"
          subtitle={`موجودی: ${fuelMins.toLocaleString('fa-IR')} دقیقه AI`}
          onClose={onClose}
        />

        <div className="flex-1 space-y-3 overflow-y-auto pe-1 no-scrollbar">
          {fuelTransactions.length === 0 ? (
            <EmptyState title="تراکنشی ثبت نشده" icon={Clock} className="py-12" />
          ) : (
            fuelTransactions.map((tx) => (
              <div
                key={tx.id}
                className="glass flex items-center justify-between rounded-rava-xl border-white/5 p-4 transition-all hover:border-white/10"
              >
                <div className="text-right">
                  <h4 className={`text-rava-sm font-black ${tx.amount > 0 ? 'text-white' : 'text-white/80'}`}>
                    {getLabel(tx.type, tx.reason || tx.reference_id || undefined)}
                  </h4>
                  <p className="mt-1 text-rava-xs font-bold text-white/25">
                    {new Date(tx.created_at).toLocaleString('fa-IR', {
                      hour: '2-digit',
                      minute: '2-digit',
                      day: '2-digit',
                      month: 'long',
                    })}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-left">
                    <span className={`block text-rava-lg font-black ${tx.amount > 0 ? 'text-green-500' : 'text-rava-danger'}`}>
                      {tx.amount > 0 ? '+' : ''}
                      {Math.round(tx.amount * 60)}
                    </span>
                    <span className="text-rava-xs font-black text-white/25">دقیقه</span>
                  </div>
                  <div className="flex h-10 w-10 items-center justify-center rounded-rava-lg border border-white/5 bg-white/[0.03]">
                    {getIcon(tx.amount)}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="mt-6 rounded-rava-xl border border-white/5 bg-white/[0.02] p-4">
          <p className="text-right text-rava-xs leading-relaxed text-white/40">
            سوخت راوا بر اساس ساعت استفاده از AI محاسبه می‌شود و اینجا به دقیقه نمایش داده می‌شود. هر تغییر موجودی فقط از طریق دفتر کل ثبت می‌شود.
          </p>
        </div>
      </ModalCard>
    </ModalShell>
  );
};
