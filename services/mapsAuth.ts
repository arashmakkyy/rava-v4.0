import { useMapStore } from '../store/useMapStore';

declare global {
  interface Window {
    gm_authFailure?: () => void;
  }
}

let installed = false;

/**
 * Installs the OFFICIAL Google Maps authentication-failure callback.
 *
 * Must run BEFORE the Maps JS API script loads (APIProvider injects it on
 * mount), otherwise Google has nowhere to report auth/billing failures and
 * the app only discovers the broken map when markers start crashing.
 *
 * Distinct from APIProvider.onError (which covers script LOAD failures):
 * gm_authFailure fires when the JS loads fine but Google rejects the
 * key/project/billing at runtime. On fire: no marker may mount, and the
 * map subtree goes to fallback via mapsLoadError (already rendered
 * outside the broken map by MainMap).
 *
 * Idempotent; safe to import from multiple modules.
 */
export function installMapsAuthFailureHandler(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  window.gm_authFailure = () => {
    console.error('[MapsAuth] gm_authFailure: Google rejected the Maps key/project (billing, restrictions, or Map ID).');
    const store = useMapStore.getState();
    store.setMapRuntime('auth-failed');
    store.setMapsLoadError(
      'احراز هویت نقشه گوگل رد شد (کلید، billing یا دسترسی). بقیه بخش‌های برنامه کار می‌کنند.'
    );
  };
}

/** Test hook: check installation without loading Maps. */
export function isMapsAuthFailureHandlerInstalled(): boolean {
  return installed && typeof window !== 'undefined' && typeof window.gm_authFailure === 'function';
}
