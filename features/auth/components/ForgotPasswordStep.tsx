import React, { useState } from 'react';
import { motion as _motion } from 'framer-motion';
import { Mail, ChevronRight, CheckCircle2 } from 'lucide-react';
import { useAuthStore } from '../../../store/useAuthStore';
import { AudioGraph } from '../../../services/audioGraph';
import { Input, Button } from '../../../components/ui';

const motion = _motion as any;

interface ForgotPasswordStepProps {
  email: string;
  onEmailChange: (val: string) => void;
  onBack: () => void;
}

export const ForgotPasswordStep: React.FC<ForgotPasswordStepProps> = ({ email, onEmailChange, onBack }) => {
  const resetPassword = useAuthStore((s) => s.resetPassword);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.includes('@')) {
      setError('ایمیلت رو درست وارد کن.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await resetPassword(email);
      if (!result.success) {
        setError(result.message || 'خطا در ارسال ایمیل.');
        AudioGraph.haptic([50, 30, 50]);
      } else {
        setSent(true);
        AudioGraph.getInstance().playTickSound();
      }
    } catch {
      setError('ارتباط با سرور برقرار نشد.');
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <motion.div initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16 }} className="space-y-6 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-rava-modal border border-green-500/20 bg-green-500/10 text-green-500">
          <CheckCircle2 size={30} />
        </div>
        <div className="space-y-2">
          <h2 className="rava-page-title text-2xl">ایمیل ارسال شد</h2>
          <p className="text-rava-sm leading-relaxed text-white/40">
            لینک بازیابی رمز به <span className="font-mono text-white/70" dir="ltr">{email}</span> فرستاده شد. اینباکس و اسپم رو چک کن.
          </p>
        </div>
        <Button fullWidth variant="secondary" size="lg" onClick={onBack}>بازگشت به ورود</Button>
      </motion.div>
    );
  }

  return (
    <motion.form initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16 }} onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-2 text-right">
        <div className="flex items-center justify-between">
          <Button type="button" variant="ghost" size="sm" onClick={onBack} leadingIcon={<ChevronRight size={14} />}>
            بازگشت
          </Button>
          <h2 className="rava-page-title text-xl">بازیابی رمز</h2>
        </div>
        <p className="text-rava-sm leading-relaxed text-white/40">لینک تنظیم رمز جدید برات ایمیل می‌شه.</p>
      </div>

      <Input type="email" required ltr value={email} onChange={(e) => onEmailChange(e.target.value)} placeholder="example@mail.com" icon={<Mail size={16} />} error={error} />

      <Button type="submit" fullWidth size="lg" loading={loading}>ارسال لینک بازیابی</Button>
    </motion.form>
  );
};
