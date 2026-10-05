
export interface VoiceConfig {
  voiceName: string;
  speechRate: number;
}

export interface SemanticProfile {
  travel_style?: string;
  food_preferences?: string[];
  interests?: string[];
  energy_level?: 'low' | 'medium' | 'high';
  budget_sensitivity?: 'low' | 'medium' | 'high';
  crew_type?: 'solo' | 'couple' | 'family' | 'friends';
  dislikes?: string[];
  last_summary_at?: string;
  is_traveling_now?: boolean;
  language?: 'fa' | 'en';
  /** Optional trip budget snapshot mirrored for prompts (source of truth: user_trips). */
  trip_budget?: TripBudgetSnapshot;
  // Added voice_config to fix property access errors in UI components
  voice_config?: VoiceConfig;
}

/**
 * Monetary trip budget — separate from AI Fuel (wallet_balance hours).
 * remaining = total_budget - recorded_expenses
 */
export interface TripBudgetSnapshot {
  total_budget: number;
  daily_expenses: number;
  recorded_expenses: number;
  estimated_cost: number;
  remaining: number;
  over_budget: boolean;
  currency?: string;
}

export type CityMode = 'Istanbul' | 'Dubai' | 'Tehran' | null;
/** Tab ids. `trip` replaced legacy `wallet` (MyTrip surface). */
export type AppTab = 'home' | 'explore' | 'trip' | 'tools' | 'profile';
export type CurrencyType = 'IRT' | 'TRY' | 'AED';

/** Journey-level lifecycle (user_trips). */
export type TripLifecycleStatus =
  | 'planning'
  | 'upcoming'
  | 'active'
  | 'paused'
  | 'completed'
  | 'cancelled';

/** Activity-level status on TripEvent / trips rows. */
export type TripActivityStatus =
  | 'pending'
  | 'active'
  | 'completed'
  | 'skipped'
  /** @deprecated prefer pending */
  | 'upcoming'
  /** @deprecated prefer active */
  | 'now';

export interface Narrative {
  id: string;
  place_id: string;
  audio_url: string;
  transcript?: string;
  voice_profile?: string;
  duration_seconds?: number;
}

export interface POI {
  id: string;
  name: string;
  description?: string;
  lat: number;
  lng: number;
  image?: string;
  category: string;
  priceLevel?: number;
  rating?: number;
  userRatingCount?: number;
  moodTags?: string[];
  localPriceHint?: string;
  openingHours?: string[];
  reviews?: any[];
  footprints?: Footprint[];
  isGooglePOI?: boolean;
  // فیلدهای اختصاصی فاز ۲ و ۳
  is_curated?: boolean;
  narrative?: Narrative;
  icon_3d?: string;
  address?: string;
}

export interface Footprint {
  id: string;
  user: string;
  text: string;
  date: string;
  lat?: number;
  lng?: number;
  avatar?: string;
  is_verified?: boolean; 
}

export type TripEventType = 'flight' | 'hotel' | 'activity' | 'food';

export interface TripEvent {
  id: string;
  type: TripEventType;
  title: string;
  time: string;
  date: string;
  status: TripActivityStatus;
  sequence: number;
  journeyId?: string;
  placeId?: string;
  placeName?: string;
  coordinates?: [number, number];
  start_time?: string;
  end_time?: string;
  details: {
    flightNo?: string;
    gate?: string;
    seat?: string;
    address?: string;
    reservationId?: string;
    notes?: string;
    price?: number;
    placeId?: string;
    placeName?: string;
  };
}

export interface Trip {
  id: string;
  city: CityMode;
  title: string;
  status: TripLifecycleStatus;
  startDate: string;
  endDate: string;
  budgetStyle?: 'budget' | 'mid' | 'luxury';
  interests?: string[];
  templateId?: string | null;
  passportEntry?: string | null;
  /** Monetary budget (not AI fuel). */
  totalBudget?: number;
  dailyExpenses?: number;
  recordedExpenses?: number;
  estimatedCost?: number;
  currency?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface StaticTripTemplate {
  id: string;
  city: NonNullable<CityMode>;
  title: string;
  titleFa: string;
  description: string;
  days: number;
  budgetStyle: 'budget' | 'mid' | 'luxury';
  tags: string[];
  activities: (Omit<TripEvent, 'id' | 'journeyId' | 'status' | 'date'> & { dayOffset: number })[];
}

export interface RecapFacts {
  placesVisited: { placeId?: string; placeName: string; date: string }[];
  distanceKm?: number | null;
  expenses: { label: string; amount: number }[];
  skippedItems: { title: string; time?: string }[];
  remainingActivities: { title: string; time?: string }[];
  chatHighlights?: string[];
  city?: string | null;
  date: string;
}

export interface RecapResult {
  summary: string;
  highlights: string[];
  dailyCost: number;
  xpEarned: number;
  tomorrowHint: string;
  passportItem: string;
  placesVisited: number;
}

export interface Stamp {
  id: string;
  placeId: string;
  placeName: string;
  date: string;
  city?: string;
  /** Claimed coordinates for server-side soft-geofence check (optional for legacy rows). */
  lat?: number;
  lng?: number;
}

export interface DailyRecap {
  id: string;
  recap_date: string;
  city?: string | null;
  summary?: string | null;
  highlights?: string[] | Record<string, unknown>;
  xp_earned: number;
  places_visited: number;
  daily_cost?: number;
  tomorrow_hint?: string | null;
}

export interface AchievementDef {
  id: string;
  code: string;
  title: string;
  title_fa?: string | null;
  description?: string | null;
  xp_threshold: number;
  unlocked: boolean;
}

/** reward_ledger row. `amount` is hours (negative = usage). UI shows minutes × 60. */
export interface FuelTransaction {
  id: string;
  amount: number;
  type: string;
  /** Reason / reference text stored in reference_id for usage rows (nullable in DB) */
  reference_id?: string | null;
  reason?: string;
  created_at: string;
}

export type RewardEventType =
  | 'stamp'
  | 'daily_itinerary'
  | 'profile_complete'
  | 'achievement'
  | 'referral_bonus'
  | 'streak'
  | 'topup'
  | 'usage';

export interface Favorite {
  id: string;
  placeId: string;
  snapshot: {
    name: string;
    image?: string;
    category: string;
    lat?: number;
    lng?: number;
    address?: string;
  };
}

export interface Flashcard {
  id: string;
  category: 'health' | 'transport' | 'emergency' | 'food' | 'general';
  icon: string;
  farsi: string;
  local: string;
  pronunciation: string;
}

export interface UserState {
  session: any | null;
  user: any | null;
  onboardingCompleted: boolean;
  cityMode: CityMode;
  wallet: {
    /** AI fuel in hours. Display as minutes: Math.floor(balance * 60). */
    balance: number;
    xp: number;
    stamps: Stamp[];
    referralCode?: string;
    isReferred?: boolean;
    currentStreak?: number;
    lastActiveDate?: string | null;
  };
  tripEvents: TripEvent[];
  activeTrip: Trip | null;
  trips: Trip[];
  /** Derived monetary budget for the active journey (not fuel). */
  tripBudget: TripBudgetSnapshot | null;
  favorites: Favorite[];
  isSyncing: boolean;
  semanticProfile: SemanticProfile;
  setSession: (session: any) => void;
  completeOnboarding: () => void;
  signOut: () => void;
  setCityMode: (mode: CityMode) => void;
  /** Reconcile local wallet from server values only — never invent balance. */
  updateWallet: (balance: number, xp: number) => void;
  syncWithCloud: () => Promise<void>;
  subscribeToUpdates: () => Promise<void>;
  addTripEvent: (event: TripEvent) => Promise<void>;
  removeTripEvent: (id: string) => Promise<void>;
  updateTripEvent: (id: string, patch: Partial<TripEvent>) => Promise<void>;
  startActivity: (id: string) => Promise<void>;
  completeActivity: (id: string) => Promise<{ next?: TripEvent | null }>;
  skipActivity: (id: string) => Promise<{ next?: TripEvent | null }>;
  rescheduleActivity: (id: string, time: string, date?: string) => Promise<void>;
  replaceActivity: (id: string, replacement: Partial<TripEvent>) => Promise<void>;
  createTrip: (draft: Partial<Trip> & { city: CityMode; title: string }) => Promise<Trip>;
  startTrip: (tripId?: string) => Promise<void>;
  pauseTrip: (tripId?: string) => Promise<void>;
  resumeTrip: (tripId?: string) => Promise<void>;
  completeTrip: (tripId?: string) => Promise<void>;
  cancelTrip: (tripId?: string) => Promise<void>;
  cloneStaticTrip: (templateId: string, startDate?: string) => Promise<Trip>;
  toggleFavorite: (poi: POI) => Promise<void>;
  claimReferral: (code: string) => Promise<void>;
  addStamp: (stamp: Stamp) => Promise<void>;
  claimReward: (type: RewardEventType, referenceId?: string, transactionId?: string) => Promise<void>;
  recordStreak: () => Promise<void>;
  updateTripBudget: (patch: {
    totalBudget?: number;
    estimatedCost?: number;
    expenseDelta?: number;
    dailyExpenses?: number;
  }) => Promise<TripBudgetSnapshot | null>;
}

export interface PendingToolConfirm {
  tool: string;
  label: string;
  payload?: Record<string, unknown>;
}

export interface UIState {
  activeTab: AppTab;
  isRecording: boolean;
  isThinking: boolean;
  isSpeaking: boolean;
  isConnecting: boolean;
  showTranscript: boolean;
  showVision: boolean;
  captions: { user: string; ai: string };
  rewardNotify: { show: boolean; amount: string } | null;
  isPlayingNarrative: boolean;
  pendingToolConfirm: PendingToolConfirm | null;
  
  setActiveTab: (tab: AppTab) => void;
  setRecording: (val: boolean) => void;
  setThinking: (val: boolean) => void;
  setSpeaking: (val: boolean) => void;
  setConnecting: (val: boolean) => void;
  setShowTranscript: (val: boolean) => void;
  setShowVision: (val: boolean) => void;
  setCaptions: (captions: { user: string; ai: string }) => void;
  setRewardNotify: (val: { show: boolean; amount: string } | null) => void;
  setPlayingNarrative: (val: boolean) => void;
  setPendingToolConfirm: (val: PendingToolConfirm | null) => void;
}

export interface MapState {
  userLocation: [number, number] | null;
  activePOI: POI | null;
  fullDetailPOI: POI | null;
  nearbyFootprints: Footprint[];
  // Added pendingFootprints to prevent build errors during Phase 1 refactor
  pendingFootprints: Footprint[];
  isLoadingDetails: boolean;
  isCelebratingStamp: boolean;
  isNarrativePlaying: boolean;
  poiError: string | null;
  locationPermissionDenied: boolean;
  mapsLoadError: string | null;
  
  setUserLocation: (loc: [number, number]) => void;
  setActivePOI: (poi: POI | null) => void;
  setFullDetailPOI: (poi: POI | null) => void;
  setNearbyFootprints: (footprints: Footprint[]) => void;
  setLoadingDetails: (val: boolean) => void;
  setCelebratingStamp: (val: boolean) => void;
  setNarrativePlaying: (val: boolean) => void;
  setPOIError: (msg: string | null) => void;
  setLocationPermissionDenied: (val: boolean) => void;
  setMapsLoadError: (msg: string | null) => void;
  addFootprintOptimistic: (poiId: string, footprint: Footprint) => void;
  clearActivePOI: () => void;
}

export interface SurvivalState {
  rates: { TRY: number; AED: number };
  activeFlashcard: Flashcard | null;
  setRate: (currency: 'TRY' | 'AED', val: number) => void;
  setActiveFlashcard: (card: Flashcard | null) => void;
}
