import React, { useRef, useEffect, useState } from 'react';
import { motion as _motion, AnimatePresence } from 'framer-motion';
import { X, Sparkles, Loader2 } from 'lucide-react';
import { useUIStore } from '../../store/useUIStore';
import { useGeminiLive } from '../../hooks/useGeminiLive';
import { IconButton } from '../ui';

const motion = _motion as any;

export const VisionOverlay: React.FC = () => {
  const { showVision, setShowVision, isRecording } = useUIStore();
  const { sendVisionFrame } = useGeminiLive();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  useEffect(() => {
    let frameInterval: number;

    if (showVision) {
      navigator.mediaDevices
        .getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } },
        })
        .then((stream) => {
          if (videoRef.current) videoRef.current.srcObject = stream;

          frameInterval = window.setInterval(() => {
            if (canvasRef.current && videoRef.current && isRecording) {
              const canvas = canvasRef.current;
              const video = videoRef.current;
              const context = canvas.getContext('2d');
              if (context) {
                canvas.width = 320;
                canvas.height = (video.videoHeight / video.videoWidth) * 320;
                context.drawImage(video, 0, 0, canvas.width, canvas.height);

                const base64 = canvas.toDataURL('image/jpeg', 0.5).split(',')[1];
                sendVisionFrame(base64);
                setIsAnalyzing(true);
                setTimeout(() => setIsAnalyzing(false), 500);
              }
            }
          }, 1500);
        })
        .catch((err) => console.error('Camera error:', err));
    } else {
      const stream = videoRef.current?.srcObject as MediaStream;
      stream?.getTracks().forEach((t) => t.stop());
    }

    return () => clearInterval(frameInterval);
  }, [showVision, isRecording, sendVisionFrame]);

  return (
    <AnimatePresence>
      {showVision && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[5000] bg-black">
          <video ref={videoRef} autoPlay playsInline className="h-full w-full object-cover opacity-80" />
          <canvas ref={canvasRef} className="hidden" />

          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <motion.div
              animate={{ opacity: [0.3, 0.8, 0.3] }}
              transition={{ duration: 2, repeat: Infinity }}
              className="relative h-72 w-72 rounded-rava-modal border-2 border-rava-gold/30"
            >
              <div className="absolute -ms-1 -mt-1 start-0 top-0 h-12 w-12 corner-ts border-s-4 border-t-4 border-rava-gold" />
              <div className="absolute -me-1 -mt-1 end-0 top-0 h-12 w-12 corner-te border-e-4 border-t-4 border-rava-gold" />
              <div className="absolute -mb-1 -ms-1 bottom-0 start-0 h-12 w-12 corner-bs border-b-4 border-s-4 border-rava-gold" />
              <div className="absolute -mb-1 -me-1 bottom-0 end-0 h-12 w-12 corner-be border-b-4 border-e-4 border-rava-gold" />

              <motion.div
                animate={{ top: ['0%', '100%', '0%'] }}
                transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
                className="absolute inset-x-0 z-10 h-1 bg-rava-gold/40 shadow-[0_0_20px_rgba(234,179,8,0.8)]"
              />

              <AnimatePresence>
                {isAnalyzing && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 flex items-center justify-center rounded-rava-modal bg-rava-gold/5 backdrop-blur-[2px]"
                  >
                    <div className="flex flex-col items-center gap-2">
                      <Sparkles className="animate-pulse text-rava-gold" />
                      <span className="text-rava-xs font-black uppercase tracking-tighter text-rava-gold">Analyzing Reality</span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          </div>

          <div className="absolute inset-x-0 bottom-16 flex flex-col items-center gap-8">
            <div className="glass flex items-center gap-3 rounded-full border-rava-gold/20 px-6 py-3">
              <Loader2 size={16} className="animate-spin text-rava-gold" />
              <span className="text-rava-xs font-bold text-white">راوا داره محیط رو اسکن میکنه...</span>
            </div>

            <IconButton icon={X} label="بستن دوربین" onClick={() => setShowVision(false)} size="lg" variant="solid" className="h-20 w-20" iconSize={32} />
          </div>

          <div className="absolute inset-x-0 top-16 flex items-start justify-between px-8 pt-safe">
            <div className="glass flex items-center gap-3 rounded-rava-lg p-4">
              <div className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
              <span className="text-rava-xs font-black uppercase text-white/60">Live Vision Session</span>
            </div>
            <div className="text-right">
              <h2 className="mb-1 text-rava-lg font-black text-white">چشم هوشمند راوا</h2>
              <p className="text-rava-xs font-medium text-white/40">دوربین رو بگیر سمت هر چیزی تا برات توضیح بدم</p>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
