import React, { useEffect } from 'react';
import { useAuthStore } from './store/useAuthStore';
import { useUserStore } from './store/useUserStore';
import { RewardToast } from './components/social/RewardToast';
import { motion as _motion, AnimatePresence } from 'framer-motion';
import { syncManager } from './services/syncManager';
import { AuthGuard } from './features/auth/AuthGuard';

const motion = _motion as any;

const App: React.FC = () => {
  // Fix: Move 'user' to useAuthStore where it is defined
  const { initializeAuth, user } = useAuthStore();
  const { setIsOnline, syncWithCloud, subscribeToUpdates } = useUserStore();

  useEffect(() => {
    // ۱. بیداری سیستم احراز هویت (مهم‌ترین گام برای مدیریت Session URL)
    initializeAuth();
    
    // ۲. بیداری سیستم سینک
    syncManager.init();
    
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // ۳. بیداری سیستم عصبی دیتابیس بلافاصله پس از شناسایی یوزر
  useEffect(() => {
    if (user) {
      subscribeToUpdates();
      syncWithCloud();
      // Replay own outbox (owner-gated inside; no-op while offline or logged out).
      // Covers offline reloads where init() ran before the session was restored.
      syncManager.processOutbox();
    }
  }, [user]);

  return (
    <div className="w-full h-full bg-black select-none overflow-hidden">
      <AnimatePresence mode="wait">
        <motion.div 
          key="app-content"
          initial={{ opacity: 0 }} 
          animate={{ opacity: 1 }} 
          transition={{ duration: 0.8 }}
          className="w-full h-full"
        >
          <RewardToast />
          {/* تمام مسئولیت نمایش صفحه درست به AuthGuard سپرده شده است */}
          <AuthGuard />
        </motion.div>
      </AnimatePresence>
    </div>
  );
};

export default App;