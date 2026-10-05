import { supabase } from '../supabaseClient';

/**
 * Authenticated client for the ai-complete Edge Function.
 * The browser sends structured data only — prompts live server-side.
 * Per-user daily quota is enforced by the function (429 when exhausted).
 */
async function invokeText(task: string, payload: Record<string, unknown>): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('برای هوش مصنوعی وارد حساب شو');

  const { data, error } = await supabase.functions.invoke('ai-complete', {
    body: { task, payload },
  });
  if (error) throw error;
  const text = (data as { text?: unknown })?.text;
  if (typeof text !== 'string') throw new Error('پاسخ نامعتبر از سرور');
  return text;
}

export const aiProxyService = {
  bargainVerdict(input: { item: string; price: string; currency: string; city: string; vibe: string }) {
    return invokeText('bargain_verdict', input as Record<string, unknown>);
  },
  dailyPlan(input: { city: string; location: string }) {
    return invokeText('daily_plan', input as Record<string, unknown>);
  },
  recapSummary(facts: unknown) {
    return invokeText('recap_summary', { facts });
  },
  vibeCheck(reviews: unknown[]) {
    return invokeText('vibe_check', { reviews });
  },
};
