import { supabase } from '../../services/supabaseClient';
import { edgeService } from '../../services/ai/edgeService';
import React, { useState } from 'react';
import { motion as _motion, AnimatePresence } from 'framer-motion';
import { ScanLine, Upload, FileText, CheckCircle2, AlertCircle } from 'lucide-react';
import { useUserStore } from '../../store/useUserStore';
import { ModalShell, IconButton, Button } from '../ui';
import { X } from 'lucide-react';

const motion = _motion as any;

interface TicketScannerProps {
  isOpen: boolean;
  onClose: () => void;
}

export const TicketScanner: React.FC<TicketScannerProps> = ({ isOpen, onClose }) => {
  const syncWithCloud = useUserStore((s) => s.syncWithCloud);
  const [step, setStep] = useState<'upload' | 'scanning' | 'success' | 'error'>('upload');
  const [errorMsg, setErrorMsg] = useState('');

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setStep('scanning');
      let uploadedPath = '';

      try {
        const fileName = `${Date.now()}-${file.name}`;
        const { error: uploadError } = await supabase.storage.from('tickets').upload(fileName, file);

        if (uploadError) throw uploadError;
        uploadedPath = fileName;

        await edgeService.processTicket(fileName);
        await syncWithCloud();
        setStep('success');
      } catch (err: any) {
        if (uploadedPath) {
          await supabase.storage.from('tickets').remove([uploadedPath]);
        }
        setErrorMsg(err.message || 'خطا در پردازش تصویر');
        setStep('error');
      }
    }
  };

  return (
    <ModalShell open={isOpen} onClose={onClose} contentClassName="h-full max-w-none">
      <div className="relative flex min-h-[85vh] flex-col items-center justify-center p-8">
        <div className="absolute end-6 top-6 pt-safe">
          <IconButton icon={X} label="بستن" onClick={onClose} size="md" />
        </div>

        <AnimatePresence mode="wait">
          {step === 'upload' && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="w-full max-w-sm text-right"
            >
              <div className="mb-10">
                <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-rava-xl bg-rava-gold text-black shadow-[0_20px_40px_rgba(234,179,8,0.3)]">
                  <ScanLine size={40} />
                </div>
                <h2 className="mb-4 text-3xl font-black text-white">اسکن جادویی</h2>
                <p className="text-rava-base leading-relaxed text-white/40">
                  عکس بلیط یا واچر هتل رو بفرست تا هوش مصنوعی راوا برات آنالیز و ثبتش کنه.
                </p>
              </div>
              <label className="group flex w-full cursor-pointer flex-col items-center justify-center gap-6 rounded-rava-modal border-2 border-dashed border-white/10 bg-white/[0.02] py-10 transition-all hover:border-rava-gold/40">
                <input type="file" className="hidden" accept="image/*" onChange={handleFileUpload} />
                <Upload size={32} className="text-rava-gold" />
                <span className="font-black text-white">انتخاب تصویر مدارک</span>
              </label>
            </motion.div>
          )}

          {step === 'scanning' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-8">
              <div className="relative h-96 w-72 overflow-hidden rounded-rava-modal border border-white/10 bg-white/5 shadow-2xl">
                <motion.div
                  animate={{ top: ['-10%', '110%', '-10%'] }}
                  transition={{ duration: 2.5, repeat: Infinity }}
                  className="absolute inset-x-0 z-20 h-1.5 bg-rava-gold shadow-[0_0_30px_rgba(234,179,8,1)]"
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <FileText size={80} className="text-white/10" />
                </div>
              </div>
              <div className="space-y-2 text-center">
                <h3 className="animate-pulse text-2xl font-black text-white">در حال استخراج هوشمند...</h3>
                <p className="text-rava-xs font-bold uppercase tracking-widest text-white/30">Powered by Gemini 2.0 Flash</p>
              </div>
            </motion.div>
          )}

          {step === 'success' && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="glass w-full max-w-sm space-y-8 rounded-rava-modal border-white/10 p-10 text-center shadow-2xl"
            >
              <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-green-500 text-black shadow-[0_0_40px_rgba(34,197,94,0.3)]">
                <CheckCircle2 size={40} />
              </div>
              <div className="space-y-2">
                <h4 className="text-2xl font-black text-white">ردیف شد!</h4>
                <p className="text-rava-sm leading-relaxed text-white/40">
                  اطلاعات بلیط با موفقیت استخراج و به تایم‌لاین سفرت اضافه شد رفیق.
                </p>
              </div>
              <Button fullWidth variant="secondary" size="lg" onClick={onClose}>
                ایول، بزن بریم
              </Button>
            </motion.div>
          )}

          {step === 'error' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6 text-center">
              <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-red-500/20 text-red-500">
                <AlertCircle size={40} />
              </div>
              <p className="font-bold text-white">{errorMsg}</p>
              <Button variant="secondary" onClick={() => setStep('upload')}>
                تلاش دوباره
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </ModalShell>
  );
};
