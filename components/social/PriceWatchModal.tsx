import React, { useState } from 'react';
import { X, Coins, CheckCircle2, Loader2, Tag, Upload, AlertTriangle } from 'lucide-react';
import { useUserStore } from '../../store/useUserStore';
import { supabase } from '../../services/supabaseClient';
import { ModalShell, ModalCard, IconButton, Input, Button } from '../ui';

interface PriceWatchModalProps {
  poiId: string;
  poiName: string;
  onClose: () => void;
}

export const PriceWatchModal: React.FC<PriceWatchModalProps> = ({ poiId, poiName, onClose }) => {
  const [step, setStep] = useState<'form' | 'uploading' | 'success'>('form');
  const [price, setPrice] = useState('');
  const [item, setItem] = useState('');
  const [image, setImage] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { cityMode } = useUserStore();

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) setImage(e.target.files[0]);
  };

  const handleSubmit = async () => {
    if (!price || !item || !image) return;
    setStep('uploading');
    setError(null);

    let uploadedPath = '';

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('ابتدا وارد حساب شو');
      // Owner-prefixed path: required by the price_proofs storage policy (<uid>/...).
      const fileName = `${user.id}/${Date.now()}-${image.name}`;
      const { error: uploadError } = await supabase.storage.from('price_proofs').upload(fileName, image);
      if (uploadError) throw uploadError;
      uploadedPath = fileName;

      const { error: dbError } = await supabase.from('price_reports').insert({
        user_id: user.id,
        place_id: poiId,
        item_name: item,
        reported_price: parseFloat(price),
        currency: cityMode === 'Istanbul' ? 'TRY' : 'AED',
        proof_image_url: fileName,
        ai_verification_status: 'pending',
      });

      if (dbError) {
        await supabase.storage.from('price_proofs').remove([uploadedPath]);
        throw dbError;
      }

      setStep('success');
    } catch (e: any) {
      console.error('Atomic Transaction Failed:', e);
      setError(`خطا در ارسال گزارش: ${e.message || 'مشکل در اتصال'}`);
      setStep('form');
    }
  };

  return (
    <ModalShell open={true} onClose={onClose} contentClassName="max-w-sm">
      <ModalCard>
        <IconButton icon={X} label="بستن" onClick={onClose} size="sm" variant="ghost" className="absolute start-4 top-4" />

        {step === 'form' && (
          <div className="space-y-5 pt-4 text-right">
            <div className="mb-4 flex flex-col items-center gap-2">
              <div className="flex h-14 w-14 items-center justify-center rounded-rava-xl border border-blue-500/20 bg-blue-500/20 text-blue-400"><Tag size={28} /></div>
              <h3 className="rava-page-title text-xl">پلیس قیمت</h3>
              <p className="rava-page-subtitle text-center ltr-island">Help others &amp; Earn Fuel</p>
              <p className="text-rava-xs text-white/35">برای {poiName}</p>
            </div>

            <div className="space-y-4">
              <Input placeholder="نام کالا یا خدمات (مثلاً ورودی موزه)" value={item} onChange={(e) => setItem(e.target.value)} icon={<Tag size={16} />} />
              <Input type="number" placeholder="قیمت جدید" value={price} onChange={(e) => setPrice(e.target.value)} icon={<Coins size={16} />} />
              <p className="text-rava-xs text-white/30">واحد: {cityMode === 'Istanbul' ? 'لیر' : 'درهم'}</p>
            </div>

            <label className="block cursor-pointer rounded-rava-xl border-2 border-dashed border-white/10 p-6 text-center transition-colors hover:border-blue-500/40">
              <input type="file" className="hidden" accept="image/*" onChange={handleFile} />
              {image ? (
                <div className="flex flex-col items-center gap-2 text-blue-400">
                  <CheckCircle2 size={24} />
                  <span className="max-w-[200px] truncate text-rava-sm font-bold">{image.name}</span>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 text-white/40">
                  <Upload size={24} />
                  <span className="text-rava-sm font-bold">عکس از منو یا برچسب قیمت</span>
                </div>
              )}
            </label>

            <div className="flex items-center gap-3 rounded-rava-xl border border-blue-500/10 bg-blue-500/5 p-4">
              <AlertTriangle size={16} className="shrink-0 text-blue-500" />
              <p className="text-rava-xs leading-relaxed text-white/60">گزارش شما توسط هوش مصنوعی بررسی می‌شود. در صورت تایید، ۳۰ دقیقه شارژ رایگان هدیه می‌گیرید.</p>
            </div>

            {error ? <p className="text-rava-xs font-bold text-rava-danger">{error}</p> : null}

            <Button fullWidth className="bg-blue-600 text-white" disabled={!price || !item || !image} onClick={handleSubmit}>
              ارسال گزارش
            </Button>
          </div>
        )}

        {step === 'uploading' && (
          <div className="flex flex-col items-center gap-6 py-16">
            <Loader2 size={44} className="animate-spin text-blue-500" />
            <h3 className="text-rava-xl font-black text-white">در حال ارسال امن...</h3>
            <p className="text-rava-xs font-bold text-white/30 ltr-island">Atomic sync in progress</p>
          </div>
        )}

        {step === 'success' && (
          <div className="space-y-6 py-8 text-center">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-green-500 text-black shadow-[0_0_50px_rgba(34,197,94,0.4)]">
              <CheckCircle2 size={40} />
            </div>
            <div>
              <h3 className="mb-2 text-rava-2xl font-black text-white">دمت گرم رفیق!</h3>
              <p className="text-rava-sm leading-relaxed text-white/40">گزارشت با موفقیت ثبت شد. بعد از تایید هوش مصنوعی، شارژ به کیف پولت اضافه میشه.</p>
            </div>
            <Button fullWidth variant="ghost" onClick={onClose} className="bg-white/10 text-white">
              بزن بریم
            </Button>
          </div>
        )}
      </ModalCard>
    </ModalShell>
  );
};
