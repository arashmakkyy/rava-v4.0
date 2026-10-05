import { useUIStore } from '../../store/useUIStore';

/**
 * Real tool confirmation gate for Gemini Live function calls.
 *
 * Flow: dispatcher encounters a tool flagged requiresConfirmation
 *   -> requestToolConfirm() shows the sheet and returns a promise
 *   -> execution PAUSES until the user taps confirm/cancel (or disconnects)
 *   -> dispatcher resumes with the handler result, or a {cancelled:true} result.
 *
 * There is no timeout: a pending decision survives until acted on or until the
 * session ends (disconnect() calls cancelAllToolConfirms()).
 */
const waiters = new Map<string, (approved: boolean) => void>();

export function requestToolConfirm(callId: string, tool: string, label: string): Promise<boolean> {
  useUIStore.getState().setPendingToolConfirm({ tool, label, payload: { callId } });
  return new Promise<boolean>((resolve) => {
    waiters.set(callId, (approved: boolean) => {
      waiters.delete(callId);
      useUIStore.getState().setPendingToolConfirm(null);
      resolve(approved);
    });
  });
}

export function resolveToolConfirm(callId: string, approved: boolean): boolean {
  const resolve = waiters.get(callId);
  if (!resolve) return false;
  resolve(approved);
  return true;
}

export function cancelAllToolConfirms(): void {
  const pending = Array.from(waiters.values());
  waiters.clear();
  useUIStore.getState().setPendingToolConfirm(null);
  for (const resolve of pending) resolve(false);
}

export function hasPendingToolConfirm(): boolean {
  return waiters.size > 0;
}
