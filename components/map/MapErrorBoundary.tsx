import React from 'react';
import { MapPinOff } from 'lucide-react';

interface MapErrorBoundaryProps {
  children: React.ReactNode;
  onError?: (error: unknown) => void;
}

interface MapErrorBoundaryState {
  error: unknown | null;
}

/**
 * Isolates Google Maps / AdvancedMarker crashes from the rest of the app.
 * Without this, a failed Maps bootstrap (bad key, unauthorized Map ID,
 * billing off) throws inside <AdvancedMarker> and white-screens everything.
 */
export class MapErrorBoundary extends React.Component<MapErrorBoundaryProps, MapErrorBoundaryState> {
  state: MapErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): MapErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: unknown) {
    console.error('[MapErrorBoundary] Maps subtree crashed:', error);
    this.props.onError?.(error);
  }

  render() {
    if (this.state.error) {
      return <MapFallback />;
    }
    return this.props.children;
  }
}

export const MapFallback: React.FC<{ message?: string }> = ({ message }) => (
  <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-rava-bg p-8 text-center">
    <div className="flex h-14 w-14 items-center justify-center rounded-rava-xl border border-white/10 bg-white/5 text-white/40">
      <MapPinOff size={26} />
    </div>
    <p className="text-rava-base font-black text-white">نقشه فعلاً در دسترس نیست</p>
    <p className="max-w-xs text-rava-xs leading-relaxed text-white/40">
      {message || 'اتصال اینترنت و کلید Google Maps را بررسی کن. بقیه بخش‌های برنامه کار می‌کنند.'}
    </p>
  </div>
);
