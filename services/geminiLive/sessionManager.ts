import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { SYSTEM_INSTRUCTION, buildSessionContext, logContextVolume } from '../../prompts';
import { supabase } from '../supabaseClient';
import { useUserStore } from '../../store/useUserStore';
import { useAuthStore } from '../../store/useAuthStore';
import { useUIStore } from '../../store/useUIStore';
import { conversationState } from './conversationState';
import { audioInputStream } from './audioInputStream';
import { audioOutputQueue } from './audioOutputQueue';
import { dispatchToolCalls, LIVE_TOOL_DECLARATIONS } from './toolCallDispatcher';
import { cancelAllToolConfirms } from './toolConfirmation';
import { connectionRecovery } from './connectionRecovery';

export type SessionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting';

// Client mirror of AI_MODELS.LIVE (supabase/functions/_shared/models.ts).
// Rotate only together with the minter constraint + a B0 behavioral probe.
const LIVE_MODEL = 'gemini-2.5-flash-native-audio-preview-12-2025';

/**
 * Single-session Gemini Live manager.
 * Connection created once; guards against duplicate sessions and post-disconnect audio.
 */
class SessionManager {
  private status: SessionStatus = 'idle';
  private session: { close: () => void; sendRealtimeInput: (p: unknown) => void; sendToolResponse: (p: unknown) => void } | null = null;
  private sessionPromise: Promise<typeof this.session> | null = null;
  private abortController: AbortController | null = null;
  private intentionalClose = false;
  private disconnecting = false;
  private connectGeneration = 0;
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  // Active fuel lease for this session (proportional reservation, migration 16).
  // Usage accounting = lease debit at mint + reconcile at close. There is NO
  // parallel deductFuel path: settle-on-disconnect was removed to avoid double
  // charging (its outbox RPC still exists for legacy actions only).
  private activeLeaseId: string | null = null;
  private leaseStartedAt = 0;

  getStatus(): SessionStatus {
    return this.status;
  }

  isConnected(): boolean {
    return this.status === 'connected';
  }

  private failConnect(message: string): void {
    useUIStore.getState().setVoiceError(message);
    conversationState.setConnecting(false);
    conversationState.setIdle();
    this.status = 'idle';
    this.session = null;
    this.sessionPromise = null;
  }

  /**
   * Mint a short-lived Live token from our backend, backed by a PROPORTIONAL
   * fuel lease (migration 16). Every connect — including recovery reconnects —
   * acquires a FRESH lease (uses:1 token), so resumption can never bypass the
   * balance check, the per-day quota, or the Google-enforced token expiry.
   * No long-lived Gemini credential exists in this bundle.
   */
  private async mintLiveToken(): Promise<{ token: string; apiVersion: string; expiresAt: string; leaseId: string; minutes: number }> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('NO_SESSION');

    const { data, error } = await supabase.functions.invoke('mint-live-token');
    if (error) {
      const status = (error as { status?: number })?.status;
      if (status === 429) throw new Error('QUOTA');
      if (status === 402) throw new Error('INSUFFICIENT');
      throw error;
    }
    const token = (data as { token?: string })?.token;
    const apiVersion = (data as { apiVersion?: string })?.apiVersion || 'v1beta';
    const expiresAt = (data as { expiresAt?: string })?.expiresAt;
    const leaseId = (data as { leaseId?: string })?.leaseId;
    const minutes = (data as { minutes?: number })?.minutes;
    if (!token || !expiresAt || !leaseId || !minutes) throw new Error('BAD_TOKEN');
    return { token, apiVersion, expiresAt, leaseId, minutes };
  }

  /**
   * Reconcile the active lease with ACTUAL usage (idempotent server-side).
   * Called on every terminal path: clean disconnect, token expiry, and
   * recovery exhaustion. Crash-without-close leaks at most one lease cost
   * (bounded, ledger-visible) — never double-charges, never silently drops.
   */
  private async closeLease(reason: string) {
    const leaseId = this.activeLeaseId;
    if (!leaseId) return;
    this.activeLeaseId = null;
    const elapsedSec = this.leaseStartedAt > 0
      ? Math.max(0, Math.round((Date.now() - this.leaseStartedAt) / 1000))
      : 0;
    this.leaseStartedAt = 0;
    try {
      await supabase.rpc('close_live_lease', {
        px_lease_id: leaseId,
        px_actual_seconds: elapsedSec,
      });
    } catch (err) {
      console.error(`[SessionManager] Lease reconcile failed (${reason}), will retry on next sync:`, err);
    }
  }

  private armExpiryTimer(expiresAt: string, generation: number) {
    this.clearExpiryTimer();
    // Disconnect 15s before Google starts rejecting traffic: hard server-side cap.
    const ms = new Date(expiresAt).getTime() - Date.now() - 15_000;
    if (ms <= 0) return;
    this.expiryTimer = setTimeout(() => {
      if (generation !== this.connectGeneration || !this.isConnected()) return;
      useUIStore.getState().setVoiceError('زمان سشن صوتی تموم شد. برای ادامه دوباره وصل شو.');
      this.disconnect();
    }, ms);
  }

  private clearExpiryTimer() {
    if (this.expiryTimer) {
      clearTimeout(this.expiryTimer);
      this.expiryTimer = null;
    }
  }

  async connect(options?: { fromRecovery?: boolean }): Promise<void> {
    const { wallet } = useUserStore.getState();
    if (wallet.balance <= 0) {
      useUIStore.getState().setVoiceError('سوخت راوا تموم شده. از پروفایل اعتبار دمو بگیر.');
      useUIStore.getState().setActiveTab('profile');
      return;
    }

    // Single-session guard
    if (this.status === 'connecting' || this.status === 'connected') {
      console.debug('[SessionManager] Connect ignored — session already active');
      return;
    }
    if (this.status === 'reconnecting' && !options?.fromRecovery) {
      console.debug('[SessionManager] Connect ignored — recovery in progress');
      return;
    }

    // Ephemeral credential: minted per connect from our backend (never bundled).
    let liveToken: { token: string; apiVersion: string; expiresAt: string; leaseId: string; minutes: number };
    try {
      liveToken = await this.mintLiveToken();
    } catch (err) {
      const code = (err as Error)?.message;
      if (code === 'NO_SESSION') {
        this.failConnect('برای گفتگو اول وارد حساب شو.');
      } else if (code === 'QUOTA') {
        this.failConnect('سهم امروز گفتگو تموم شده. فردا دوباره بیا.');
      } else if (code === 'INSUFFICIENT') {
        this.failConnect('سوخت راوا تموم شده. از پروفایل اعتبار دمو بگیر.');
        useUIStore.getState().setActiveTab('profile');
      } else {
        console.error('[SessionManager] Token mint failed:', err);
        this.failConnect('توکن گفتگو صادر نشد. اتصال اینترنت رو چک کن و دوباره بزن.');
      }
      return;
    }

    this.intentionalClose = false;
    this.disconnecting = false;
    this.status = options?.fromRecovery ? 'reconnecting' : 'connecting';
    useUIStore.getState().setVoiceError(null);
    conversationState.setConnecting(true);

    const generation = ++this.connectGeneration;
    const abortController = new AbortController();
    this.abortController = abortController;

    audioOutputQueue.stopStaticNarrative();

    const ai = new GoogleGenAI({
      apiKey: liveToken.token,
      httpOptions: { apiVersion: liveToken.apiVersion },
    });
    // Hard cap: disconnect shortly before Google starts rejecting traffic.
    this.armExpiryTimer(liveToken.expiresAt, generation);

    try {
      await audioOutputQueue.init();

      const { cityMode } = useUserStore.getState();
      const { semanticProfile } = useAuthStore.getState();
      const voice = semanticProfile.voice_config;

      const sessionContext = buildSessionContext({
        city: cityMode,
        language: 'fa-IR',
        tripType: semanticProfile.travel_style,
        crewType: semanticProfile.crew_type,
        isTravelingNow: semanticProfile.is_traveling_now,
        voiceName: voice?.voiceName ?? 'Kore',
        speechRate: voice?.speechRate ?? 1,
        semanticHints: semanticProfile,
      });

      const systemInstruction = `${SYSTEM_INSTRUCTION}\n\n${sessionContext}`;
      logContextVolume('SYSTEM_INSTRUCTION', SYSTEM_INSTRUCTION);
      logContextVolume('session_context', sessionContext);
      logContextVolume('handshake_total', systemInstruction);

      conversationState.onBargeIn(() => this.handleBargeIn());

      const sessionPromise = ai.live.connect({
        model: LIVE_MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          outputAudioTranscription: {},
          inputAudioTranscription: {},
          tools: [{ functionDeclarations: LIVE_TOOL_DECLARATIONS }],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: voice?.voiceName || 'Kore',
              },
            },
          },
          systemInstruction,
        },
        callbacks: {
          onopen: () => {
            if (generation !== this.connectGeneration || this.intentionalClose) return;
            this.status = 'connected';
            this.activeLeaseId = liveToken.leaseId;
            this.leaseStartedAt = Date.now();
            connectionRecovery.markSuccess();
            useUIStore.getState().setVoiceError(null);
            conversationState.setListening();

            audioInputStream.start(
              (base64Pcm) => {
                if (!this.isConnected() || this.intentionalClose) return;
                this.sessionPromise?.then((session) => {
                  if (!session || this.intentionalClose || !this.isConnected()) return;
                  session.sendRealtimeInput({
                    media: { data: base64Pcm, mimeType: 'audio/pcm;rate=16000' },
                  });
                }).catch(() => {});
              },
              () => this.isConnected() && !this.intentionalClose,
            );
          },
          onmessage: async (message: LiveServerMessage) => {
            if (!this.isConnected() || this.intentionalClose) return;
            await this.handleMessage(message, sessionPromise);
          },
          onclose: () => {
            console.warn('[SessionManager] Session closed');
            this.handleUnexpectedClose(generation);
          },
          onerror: (err: unknown) => {
            console.error('[SessionManager] Session error:', err);
            this.handleUnexpectedClose(generation);
          },
        },
      });

      this.sessionPromise = sessionPromise as Promise<typeof this.session>;
      this.session = (await sessionPromise) as typeof this.session;

      if (generation !== this.connectGeneration || this.intentionalClose) {
        try { this.session?.close(); } catch { /* ignore */ }
        return;
      }
    } catch (err) {
      console.error('[SessionManager] Connection failed:', err);
      conversationState.setConnecting(false);
      this.teardownMediaOnly();
      this.clearExpiryTimer();
      this.status = 'idle';
      this.session = null;
      this.sessionPromise = null;

      if (!this.intentionalClose && connectionRecovery.canRetry()) {
        this.status = 'reconnecting';
        connectionRecovery.schedule(() => this.connect({ fromRecovery: true }));
      } else {
        if (!this.intentionalClose) {
          useUIStore.getState().setVoiceError('اتصال صوتی برقرار نشد. دکمه میکروفون رو دوباره بزن.');
        }
        conversationState.setIdle();
      }
    }
  }

  private async handleMessage(
    message: LiveServerMessage,
    sessionPromise: Promise<unknown>,
  ) {
    if (message.serverContent?.inputTranscription?.text) {
      conversationState.appendUserCaption(message.serverContent.inputTranscription.text);
    }
    if (message.serverContent?.outputTranscription?.text) {
      conversationState.setThinking(true);
      conversationState.appendAiCaption(message.serverContent.outputTranscription.text);
    }

    if (message.toolCall?.functionCalls?.length) {
      await dispatchToolCalls(message.toolCall.functionCalls, (responses) => {
        if (!this.isConnected() || this.intentionalClose) return;
        sessionPromise.then((s: any) => {
          if (!s || this.intentionalClose || !this.isConnected()) return;
          s.sendToolResponse({ functionResponses: responses });
        }).catch(() => {});
      });
    }

    if (message.serverContent?.interrupted) {
      audioOutputQueue.flush();
    }

    const parts = message.serverContent?.modelTurn?.parts;
    if (parts) {
      for (const part of parts) {
        if (!this.isConnected() || this.intentionalClose) return;
        if (part.inlineData?.data) {
          await audioOutputQueue.playChunk(part.inlineData.data);
        }
      }
    }

    if (message.serverContent?.turnComplete) {
      await conversationState.completeTurn();
    }
  }

  private handleBargeIn() {
    if (!this.isConnected()) return;
    audioOutputQueue.flush();
    this.sessionPromise?.then((session) => {
      if (!session || !this.isConnected()) return;
      try {
        session.sendRealtimeInput({ control: { action: 'interrupt' } } as any);
      } catch (e) {
        console.warn('[SessionManager] Interrupt send failed:', e);
      }
    }).catch(() => {});
  }

  private handleUnexpectedClose(generation: number) {
    if (generation !== this.connectGeneration) return;
    if (this.intentionalClose || this.disconnecting) return;
    // onerror + onclose fire for the SAME drop: only the first one may start recovery,
    // otherwise a single disconnect would burn two retry attempts.
    if (this.status === 'reconnecting') return;
    this.status = 'reconnecting';

    console.error('[SessionManager] Unexpected disconnect — attempting recovery without reload');
    // Reconcile the dead session's lease BEFORE recovery acquires a new one:
    // usage so far is refunded exactly once (close is idempotent), and the
    // reconnect mints a fresh lease — no overlap, no free minutes, no double bill.
    void this.closeLease('unexpected-close');
    this.teardownMediaOnly();
    this.session = null;
    this.sessionPromise = null;
    conversationState.setConnecting(true);

    const scheduled = connectionRecovery.schedule(() => this.connect({ fromRecovery: true }));
    if (!scheduled) {
      this.status = 'idle';
      conversationState.setIdle();
      useUIStore.getState().setVoiceError('اتصال قطع شد و تلاش مجدد جواب نداد. دکمه میکروفون رو دوباره بزن.');
    }
  }

  private teardownMediaOnly() {
    audioInputStream.stop();
    audioOutputQueue.flush();
  }

  disconnect() {
    if (this.status === 'idle' && !this.session && !this.disconnecting) return;
    if (this.disconnecting) return;

    this.disconnecting = true;
    this.intentionalClose = true;
    this.connectGeneration += 1;
    connectionRecovery.reset();
    this.clearExpiryTimer();

    // Reconcile actual usage against the lease (idempotent refund of unused fuel).
    void this.closeLease('disconnect');

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    this.teardownMediaOnly();
    audioOutputQueue.stopAll();
    conversationState.onBargeIn(null);
    // Pending tool decisions resolve as cancelled so no paused call leaks past the session.
    cancelAllToolConfirms();

    if (this.session) {
      try { this.session.close(); } catch { /* ignore */ }
      this.session = null;
    }
    this.sessionPromise = null;
    this.status = 'idle';
    conversationState.setIdle();
    this.disconnecting = false;
  }

  sendVisionFrame(base64: string) {
    if (!this.isConnected() || this.intentionalClose) return;
    this.sessionPromise?.then((session) => {
      if (!session || !this.isConnected() || this.intentionalClose) return;
      session.sendRealtimeInput({
        media: { data: base64, mimeType: 'image/jpeg' },
      });
    }).catch(() => {});
  }

  interrupt() {
    this.handleBargeIn();
  }
}

export const sessionManager = new SessionManager();
