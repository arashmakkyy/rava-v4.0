import React, { useMemo, useEffect } from 'react';
import { MainMap } from '../components/map/MainMap';
import { TopBar } from '../components/layout/TopBar';
import { BottomBar } from '../components/layout/BottomBar';
import { CityPickerModal } from '../components/layout/CityPickerModal';
import { MagicButton } from '../components/voice/MagicButton';
import { ToolConfirmSheet } from '../components/voice/ToolConfirmSheet';
import { VisionOverlay } from '../components/camera/VisionOverlay';
import { POIController } from '../components/poi/POIController';
import { useUIStore } from '../store/useUIStore';
import { useRouteStore } from '../store/useRouteStore';
import { motion as _motion, AnimatePresence } from 'framer-motion';
import { Camera } from 'lucide-react';
import { AppTab } from '../types';

import { Explore } from './Explore';
import { MyTrip } from './MyTrip';
import { Tools } from './Tools';
import { Profile } from './Profile';

const motion = _motion as any;

interface DashboardProps {
  defaultTab?: AppTab;
}

export const Dashboard: React.FC<DashboardProps> = ({ defaultTab }) => {
  const activeTab = useUIStore((s) => s.activeTab);
  const setActiveTab = useUIStore((s) => s.setActiveTab);
  const setShowVision = useUIStore((s) => s.setShowVision);
  const routeActive = useRouteStore((s) => s.isActive);

  useEffect(() => {
    setActiveTab(defaultTab ?? 'home');
  }, [defaultTab, setActiveTab]);

  const mapInteractive = activeTab === 'home' || routeActive;

  const overlayContent = useMemo(() => {
    switch (activeTab) {
      case 'explore':
        return <Explore />;
      case 'trip':
        return <MyTrip />;
      case 'tools':
        return <Tools />;
      case 'profile':
        return <Profile />;
      default:
        return null;
    }
  }, [activeTab]);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-rava-bg text-right text-rava-fg">
      <TopBar />

      <div
        className={`absolute inset-0 z-0 transition-opacity duration-500 ${
          mapInteractive ? 'opacity-100' : 'pointer-events-none opacity-20'
        }`}
      >
        <MainMap />
      </div>

      <main className="relative z-10 h-full w-full pointer-events-none text-right">
        <AnimatePresence mode="wait">
          {activeTab !== 'home' && (
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 24 }}
              transition={{ type: 'spring', damping: 30, stiffness: 250 }}
              className="h-full w-full bg-black/70 pt-[var(--chrome-top)] pointer-events-auto backdrop-blur-xl"
            >
              {overlayContent}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <AnimatePresence>
        {activeTab === 'home' && (
          <motion.div
            initial={{ opacity: 0, y: 80 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 80 }}
            className="contents"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.75 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.75 }}
              className="fixed end-6 z-[1501] pointer-events-none"
              style={{ bottom: 'calc(var(--magic-button-bottom) + 4.5rem)' }}
            >
              <button
                onClick={() => setShowVision(true)}
                className="pointer-events-auto flex min-h-tap min-w-tap items-center justify-center rounded-rava-xl border border-white/20 bg-white/10 p-4 text-white shadow-glass backdrop-blur-2xl transition-transform active:scale-90 group"
                aria-label="باز کردن دوربین"
              >
                <Camera size={24} className="transition-colors group-hover:text-rava-gold" />
              </button>
            </motion.div>

            <MagicButton />
          </motion.div>
        )}
      </AnimatePresence>

      <BottomBar />
      <POIController />
      <ToolConfirmSheet />
      <VisionOverlay />
      <CityPickerModal />
    </div>
  );
};
