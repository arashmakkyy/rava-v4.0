import { aiProxyService } from './ai/aiProxyService';
import { supabase } from './supabaseClient';
import { extractJSON, toJson } from '../utils/jsonParser';
import { RecapFacts, RecapResult, Stamp, TripEvent } from '../types';
import { getTodaysEvents, isActivityDone, isActivityOpen, todayIso } from '../utils/tripMapper';

function sumExpenses(expenses: RecapFacts['expenses']): number {
  return expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
}

function computeXp(facts: RecapFacts): number {
  const visits = facts.placesVisited.length;
  const completedBonus = Math.max(0, visits) * 40;
  const skipPenalty = facts.skippedItems.length * 5;
  return Math.max(10, completedBonus + 20 - skipPenalty);
}

function buildFactsOnlySummary(facts: RecapFacts): RecapResult {
  const names = facts.placesVisited.map((p) => p.placeName).filter(Boolean);
  const dailyCost = sumExpenses(facts.expenses);
  const highlights: string[] = [];

  if (names.length) highlights.push(`بازدید: ${names.slice(0, 5).join('، ')}`);
  if (facts.skippedItems.length) {
    highlights.push(`رد شده: ${facts.skippedItems.map((s) => s.title).slice(0, 3).join('، ')}`);
  }
  if (facts.remainingActivities.length) {
    highlights.push(`باقی‌مانده: ${facts.remainingActivities.map((r) => r.title).slice(0, 3).join('، ')}`);
  }
  if (dailyCost > 0) highlights.push(`هزینه ثبت‌شده: ${dailyCost}`);
  if (facts.distanceKm != null && facts.distanceKm > 0) {
    highlights.push(`مسافت تقریبی: ${facts.distanceKm.toFixed(1)} کیلومتر`);
  }
  if (facts.chatHighlights?.length) {
    highlights.push(...facts.chatHighlights.slice(0, 2));
  }

  const summaryParts: string[] = [];
  if (names.length) {
    summaryParts.push(`امروز ${names.length} جا مهر شد${names.length ? `؛ از جمله ${names.slice(0, 2).join(' و ')}` : ''}.`);
  } else {
    summaryParts.push('امروز مهر جدیدی ثبت نشد.');
  }
  if (facts.skippedItems.length) {
    summaryParts.push(`${facts.skippedItems.length} آیتم از برنامه رد شد.`);
  }
  if (facts.remainingActivities.length) {
    summaryParts.push(`${facts.remainingActivities.length} برنامه هنوز مانده.`);
  }
  if (dailyCost > 0) {
    summaryParts.push(`جمع هزینه‌های ثبت‌شده ${dailyCost} بود.`);
  }

  const tomorrowHint = facts.remainingActivities[0]
    ? `فردا با «${facts.remainingActivities[0].title}» ادامه بده.`
    : '';

  const passportItem = names.length
    ? `${facts.city || 'سفر'} · ${facts.date} · ${names[0]}`
    : `${facts.city || 'سفر'} · ${facts.date}`;

  return {
    summary: summaryParts.join(' '),
    highlights: highlights.slice(0, 5),
    dailyCost,
    xpEarned: computeXp(facts),
    tomorrowHint,
    passportItem,
    placesVisited: names.length,
  };
}

async function summarizeWithModel(facts: RecapFacts): Promise<RecapResult | null> {
  try {
    const text = await aiProxyService.recapSummary(facts);
    const parsed = extractJSON<{
      summary: string;
      highlights: string[];
      tomorrow_hint: string;
      passport_item: string;
    }>(text || '{}');

    if (!parsed?.summary) return null;

    return {
      summary: parsed.summary,
      highlights: Array.isArray(parsed.highlights) ? parsed.highlights.slice(0, 5) : [],
      dailyCost: sumExpenses(facts.expenses),
      xpEarned: computeXp(facts),
      tomorrowHint: parsed.tomorrow_hint || '',
      passportItem: parsed.passport_item || '',
      placesVisited: facts.placesVisited.length,
    };
  } catch (e) {
    console.warn('[recapService] model summarize failed, using facts-only', e);
    return null;
  }
}

export function collectRecapFacts(input: {
  stamps: Stamp[];
  tripEvents: TripEvent[];
  city?: string | null;
  date?: string;
  distanceKm?: number | null;
  chatHighlights?: string[];
}): RecapFacts {
  const date = input.date || todayIso();
  const todays = getTodaysEvents(input.tripEvents, date);

  const placesVisited = input.stamps
    .filter((s) => {
      // stamp.date may be fa-IR locale — also accept ISO-ish
      return s.date === date || (s as any).created_at?.startsWith?.(date);
    })
    .map((s) => ({ placeId: s.placeId, placeName: s.placeName, date: s.date }));

  // Prefer stamps that match today's completed activities when date strings differ (fa-IR vs ISO)
  const completedKeys = new Set(
    todays
      .filter((e) => e.status === 'completed')
      .flatMap((e) => [e.placeId, e.placeName, e.title].filter(Boolean) as string[])
  );
  const matchedStamps = input.stamps
    .filter((s) => completedKeys.has(s.placeId) || completedKeys.has(s.placeName))
    .map((s) => ({ placeId: s.placeId, placeName: s.placeName, date: s.date }));

  const expenses = todays
    .filter((e) => isActivityDone(e.status) && e.details?.price)
    .map((e) => ({ label: e.title, amount: Number(e.details.price) || 0 }));

  return {
    placesVisited: placesVisited.length ? placesVisited : matchedStamps,
    distanceKm: input.distanceKm ?? null,
    expenses,
    skippedItems: todays
      .filter((e) => e.status === 'skipped')
      .map((e) => ({ title: e.title, time: e.time })),
    remainingActivities: todays
      .filter((e) => isActivityOpen(e.status))
      .map((e) => ({ title: e.title, time: e.time })),
    chatHighlights: input.chatHighlights?.slice(0, 5) || [],
    city: input.city || null,
    date,
  };
}

export async function fetchTodayChatHighlights(userId: string, date = todayIso()): Promise<string[]> {
  try {
    const start = `${date}T00:00:00`;
    const end = `${date}T23:59:59`;
    const { data } = await supabase
      .from('chat_logs')
      .select('content, role')
      .eq('user_id', userId)
      .gte('created_at', start)
      .lte('created_at', end)
      .order('created_at', { ascending: false })
      .limit(12);

    if (!data?.length) return [];
    return data
      .filter((r: { role: unknown; content: unknown }) => r.role === 'model' && r.content)
      .map((r: { content: unknown }) => String(r.content).slice(0, 120))
      .slice(0, 3);
  } catch {
    return [];
  }
}

export async function generateDailyRecap(facts: RecapFacts): Promise<RecapResult> {
  const fromModel = await summarizeWithModel(facts);
  return fromModel || buildFactsOnlySummary(facts);
}

export async function saveDailyRecap(
  userId: string,
  facts: RecapFacts,
  result: RecapResult
): Promise<{ id: string } | null> {
  const payload = {
    user_id: userId,
    recap_date: facts.date,
    city: facts.city ?? null,
    summary: result.summary,
    highlights: toJson({
      items: result.highlights,
      daily_cost: result.dailyCost,
      tomorrow_hint: result.tomorrowHint,
      passport_item: result.passportItem,
    }),
    xp_earned: result.xpEarned,
    places_visited: result.placesVisited,
    daily_cost: result.dailyCost,
    tomorrow_hint: result.tomorrowHint,
    facts: toJson(facts),
  };

  const { data, error } = await supabase
    .from('daily_recaps')
    .upsert(payload, { onConflict: 'user_id,recap_date' })
    .select('id')
    .single();

  if (error) {
    console.error('[recapService] save failed', error);
    return null;
  }
  return data;
}

export const recapService = {
  collectRecapFacts,
  fetchTodayChatHighlights,
  generateDailyRecap,
  saveDailyRecap,
};
