export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          username: string | null;
          avatar_url: string | null;
          wallet_balance: number;
          xp_level: number;
          reputation_score: number;
          current_city: 'Istanbul' | 'Dubai' | 'Tehran' | null;
          preferences: Json;
          semantic_profile: Json;
          onboarding_completed: boolean;
          last_summary_at: string | null;
          referral_code: string | null;
          referred_by: string | null;
          last_active_date: string | null;
          current_streak: number;
          created_at: string;
        };
        Insert: {
          id: string;
          username?: string | null;
          avatar_url?: string | null;
          wallet_balance?: number;
          xp_level?: number;
          reputation_score?: number;
          current_city?: 'Istanbul' | 'Dubai' | 'Tehran' | null;
          preferences?: Json;
          semantic_profile?: Json;
          onboarding_completed?: boolean;
          last_summary_at?: string | null;
          referral_code?: string | null;
          referred_by?: string | null;
          last_active_date?: string | null;
          current_streak?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          username?: string | null;
          avatar_url?: string | null;
          wallet_balance?: number;
          xp_level?: number;
          reputation_score?: number;
          current_city?: 'Istanbul' | 'Dubai' | 'Tehran' | null;
          preferences?: Json;
          semantic_profile?: Json;
          onboarding_completed?: boolean;
          last_summary_at?: string | null;
          referral_code?: string | null;
          referred_by?: string | null;
          last_active_date?: string | null;
          current_streak?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'profiles_id_fkey';
            columns: ['id'];
            isOneToOne: true;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'profiles_referred_by_fkey';
            columns: ['referred_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      places_cache: {
        Row: {
          place_id: string;
          name: string;
          location: unknown;
          category: string | null;
          google_types: string[] | null;
          address: string | null;
          phone: string | null;
          opening_hours: Json | null;
          google_photo_refs: Json[] | null;
          crowd_photos: Json[] | null;
          vibe_summary: string | null;
          last_ai_analysis: string | null;
          updated_at: string;
        };
        Insert: {
          place_id: string;
          name: string;
          location: unknown;
          category?: string | null;
          google_types?: string[] | null;
          address?: string | null;
          phone?: string | null;
          opening_hours?: Json | null;
          google_photo_refs?: Json[] | null;
          crowd_photos?: Json[] | null;
          vibe_summary?: string | null;
          last_ai_analysis?: string | null;
          updated_at?: string;
        };
        Update: {
          place_id?: string;
          name?: string;
          location?: unknown;
          category?: string | null;
          google_types?: string[] | null;
          address?: string | null;
          phone?: string | null;
          opening_hours?: Json | null;
          google_photo_refs?: Json[] | null;
          crowd_photos?: Json[] | null;
          vibe_summary?: string | null;
          last_ai_analysis?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      destinations: {
        Row: {
          id: string;
          name: string;
          center: unknown;
          manifest_version: number;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          center: unknown;
          manifest_version?: number;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          center?: unknown;
          manifest_version?: number;
          is_active?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      attractions: {
        Row: {
          place_id: string;
          destination_id: string | null;
          name: string;
          location: unknown;
          static_data: Json;
          assets: Json;
          is_premium: boolean;
          google_place_id: string | null;
          updated_at: string;
          created_at: string;
        };
        Insert: {
          place_id: string;
          destination_id?: string | null;
          name: string;
          location: unknown;
          static_data?: Json;
          assets?: Json;
          is_premium?: boolean;
          google_place_id?: string | null;
          updated_at?: string;
          created_at?: string;
        };
        Update: {
          place_id?: string;
          destination_id?: string | null;
          name?: string;
          location?: unknown;
          static_data?: Json;
          assets?: Json;
          is_premium?: boolean;
          google_place_id?: string | null;
          updated_at?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'attractions_destination_id_fkey';
            columns: ['destination_id'];
            isOneToOne: false;
            referencedRelation: 'destinations';
            referencedColumns: ['id'];
          },
        ];
      };
      narratives: {
        Row: {
          id: string;
          place_id: string | null;
          audio_url: string;
          transcript: string | null;
          trigger_type: string;
          voice_profile: string;
          duration_seconds: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          place_id?: string | null;
          audio_url: string;
          transcript?: string | null;
          trigger_type?: string;
          voice_profile?: string;
          duration_seconds?: number | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          place_id?: string | null;
          audio_url?: string;
          transcript?: string | null;
          trigger_type?: string;
          voice_profile?: string;
          duration_seconds?: number | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'narratives_place_id_fkey';
            columns: ['place_id'];
            isOneToOne: false;
            referencedRelation: 'attractions';
            referencedColumns: ['place_id'];
          },
        ];
      };
      trips: {
        Row: {
          id: string;
          user_id: string | null;
          type: 'flight' | 'hotel' | 'activity' | 'food' | null;
          title: string | null;
          start_time: string | null;
          end_time: string | null;
          location: unknown | null;
          destination_address: string | null;
          details: Json | null;
          status:
            | 'upcoming'
            | 'pending'
            | 'active'
            | 'now'
            | 'completed'
            | 'skipped'
            | 'cancelled'
            | null;
          journey_id: string | null;
          sequence_order: number;
          place_id: string | null;
          place_name: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          type?: 'flight' | 'hotel' | 'activity' | 'food' | null;
          title?: string | null;
          start_time?: string | null;
          end_time?: string | null;
          location?: unknown | null;
          destination_address?: string | null;
          details?: Json | null;
          status?:
            | 'upcoming'
            | 'pending'
            | 'active'
            | 'now'
            | 'completed'
            | 'skipped'
            | 'cancelled'
            | null;
          journey_id?: string | null;
          sequence_order?: number;
          place_id?: string | null;
          place_name?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          type?: 'flight' | 'hotel' | 'activity' | 'food' | null;
          title?: string | null;
          start_time?: string | null;
          end_time?: string | null;
          location?: unknown | null;
          destination_address?: string | null;
          details?: Json | null;
          status?:
            | 'upcoming'
            | 'pending'
            | 'active'
            | 'now'
            | 'completed'
            | 'skipped'
            | 'cancelled'
            | null;
          journey_id?: string | null;
          sequence_order?: number;
          place_id?: string | null;
          place_name?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'trips_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'trips_journey_id_fkey';
            columns: ['journey_id'];
            isOneToOne: false;
            referencedRelation: 'user_trips';
            referencedColumns: ['id'];
          },
        ];
      };
      user_trips: {
        Row: {
          id: string;
          user_id: string;
          city: string | null;
          title: string;
          status:
            | 'planning'
            | 'upcoming'
            | 'active'
            | 'paused'
            | 'completed'
            | 'cancelled';
          start_date: string | null;
          end_date: string | null;
          budget_style: 'budget' | 'mid' | 'luxury' | null;
          interests: Json;
          template_id: string | null;
          passport_entry: string | null;
          total_budget: number;
          daily_expenses: number;
          recorded_expenses: number;
          estimated_cost: number;
          currency: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          city?: string | null;
          title: string;
          status?:
            | 'planning'
            | 'upcoming'
            | 'active'
            | 'paused'
            | 'completed'
            | 'cancelled';
          start_date?: string | null;
          end_date?: string | null;
          budget_style?: 'budget' | 'mid' | 'luxury' | null;
          interests?: Json;
          template_id?: string | null;
          passport_entry?: string | null;
          total_budget?: number;
          daily_expenses?: number;
          recorded_expenses?: number;
          estimated_cost?: number;
          currency?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          city?: string | null;
          title?: string;
          status?:
            | 'planning'
            | 'upcoming'
            | 'active'
            | 'paused'
            | 'completed'
            | 'cancelled';
          start_date?: string | null;
          end_date?: string | null;
          budget_style?: 'budget' | 'mid' | 'luxury' | null;
          interests?: Json;
          template_id?: string | null;
          passport_entry?: string | null;
          total_budget?: number;
          daily_expenses?: number;
          recorded_expenses?: number;
          estimated_cost?: number;
          currency?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'user_trips_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      stamps: {
        Row: {
          id: string;
          user_id: string;
          place_id: string;
          place_name: string;
          city: string | null;
          claimed_lat: number | null;
          claimed_lng: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          place_id: string;
          place_name: string;
          city?: string | null;
          claimed_lat?: number | null;
          claimed_lng?: number | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          place_id?: string;
          place_name?: string;
          city?: string | null;
          claimed_lat?: number | null;
          claimed_lng?: number | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'stamps_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      favorites: {
        Row: {
          id: string;
          user_id: string | null;
          place_id: string;
          place_snapshot: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          place_id: string;
          place_snapshot: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          place_id?: string;
          place_snapshot?: Json;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'favorites_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      reward_ledger: {
        Row: {
          transaction_id: string;
          user_id: string | null;
          amount: number;
          xp_amount: number;
          reward_type: string;
          reference_id: string | null;
          created_at: string;
        };
        Insert: {
          transaction_id: string;
          user_id?: string | null;
          amount: number;
          xp_amount?: number;
          reward_type: string;
          reference_id?: string | null;
          created_at?: string;
        };
        Update: {
          transaction_id?: string;
          user_id?: string | null;
          amount?: number;
          xp_amount?: number;
          reward_type?: string;
          reference_id?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'reward_ledger_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      footprints: {
        Row: {
          id: string;
          user_id: string | null;
          place_id: string | null;
          location: unknown | null;
          content: string | null;
          mood: string | null;
          upvotes: number;
          is_verified: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          place_id?: string | null;
          location?: unknown | null;
          content?: string | null;
          mood?: string | null;
          upvotes?: number;
          is_verified?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          place_id?: string | null;
          location?: unknown | null;
          content?: string | null;
          mood?: string | null;
          upvotes?: number;
          is_verified?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'footprints_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      chat_logs: {
        Row: {
          id: string;
          user_id: string | null;
          role: 'user' | 'model' | null;
          content: string | null;
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          role?: 'user' | 'model' | null;
          content?: string | null;
          metadata?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          role?: 'user' | 'model' | null;
          content?: string | null;
          metadata?: Json;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'chat_logs_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      daily_recaps: {
        Row: {
          id: string;
          user_id: string;
          recap_date: string;
          city: string | null;
          summary: string | null;
          highlights: Json;
          xp_earned: number;
          places_visited: number;
          daily_cost: number | null;
          tomorrow_hint: string | null;
          facts: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          recap_date?: string;
          city?: string | null;
          summary?: string | null;
          highlights?: Json;
          xp_earned?: number;
          places_visited?: number;
          daily_cost?: number | null;
          tomorrow_hint?: string | null;
          facts?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          recap_date?: string;
          city?: string | null;
          summary?: string | null;
          highlights?: Json;
          xp_earned?: number;
          places_visited?: number;
          daily_cost?: number | null;
          tomorrow_hint?: string | null;
          facts?: Json | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'daily_recaps_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      achievements: {
        Row: {
          id: string;
          code: string;
          title: string;
          title_fa: string | null;
          description: string | null;
          icon: string | null;
          xp_threshold: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          code: string;
          title: string;
          title_fa?: string | null;
          description?: string | null;
          icon?: string | null;
          xp_threshold?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          code?: string;
          title?: string;
          title_fa?: string | null;
          description?: string | null;
          icon?: string | null;
          xp_threshold?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      user_achievements: {
        Row: {
          id: string;
          user_id: string;
          achievement_id: string;
          unlocked_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          achievement_id: string;
          unlocked_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          achievement_id?: string;
          unlocked_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'user_achievements_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'user_achievements_achievement_id_fkey';
            columns: ['achievement_id'];
            isOneToOne: false;
            referencedRelation: 'achievements';
            referencedColumns: ['id'];
          },
        ];
      };
      price_reports: {
        Row: {
          id: string;
          user_id: string | null;
          place_id: string | null;
          item_name: string | null;
          reported_price: number | null;
          currency: string | null;
          proof_image_url: string | null;
          ai_verification_status: string | null;
          ai_confidence_score: number | null;
          report_date: string | null;
          proof_hash: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          place_id?: string | null;
          item_name?: string | null;
          reported_price?: number | null;
          currency?: string | null;
          proof_image_url?: string | null;
          ai_verification_status?: string | null;
          ai_confidence_score?: number | null;
          report_date?: string | null;
          proof_hash?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          place_id?: string | null;
          item_name?: string | null;
          reported_price?: number | null;
          currency?: string | null;
          proof_image_url?: string | null;
          ai_verification_status?: string | null;
          ai_confidence_score?: number | null;
          report_date?: string | null;
          proof_hash?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      ai_usage: {
        Row: {
          user_id: string;
          usage_date: string;
          live_mints: number;
          proxy_calls: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          usage_date?: string;
          live_mints?: number;
          proxy_calls?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          usage_date?: string;
          live_mints?: number;
          proxy_calls?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      ticket_receipts: {
        Row: {
          user_id: string;
          image_path: string;
          trip_id: string | null;
          created_at: string;
        };
        Insert: {
          user_id: string;
          image_path: string;
          trip_id?: string | null;
          created_at?: string;
        };
        Update: {
          user_id?: string;
          image_path?: string;
          trip_id?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      process_poi_visit: {
        Args: {
          px_transaction_id: string;
          px_place_id: string;
          px_place_name: string;
          px_city: string;
          px_lat: number | null;
          px_lng: number | null;
        };
        Returns: undefined;
      };
      deduct_fuel: {
        Args: {
          px_seconds: number;
          px_reason?: string;
          px_transaction_id?: string;
        };
        Returns: undefined;
      };
      increment_wallet: {
        Args: {
          px_transaction_id: string;
          px_amount: number;
          px_xp_amount: number;
          px_reward_type?: string;
        };
        Returns: undefined;
      };
      increment_my_wallet: {
        Args: {
          px_transaction_id: string;
          px_amount: number;
          px_xp_amount: number;
          px_reward_type?: string;
        };
        Returns: undefined;
      };
      claim_referral: {
        Args: { px_code: string };
        Returns: undefined;
      };
      claim_reward: {
        Args: {
          px_transaction_id: string;
          px_reward_type: string;
        };
        Returns: Json;
      };
      claim_demo_credit: {
        Args: { px_transaction_id: string };
        Returns: Json;
      };
      finalize_price_verification: {
        Args: { px_report_id: string; px_verified: boolean; px_confidence?: number | null };
        Returns: Json;
      };
      consume_live_mint: {
        Args: { px_max_per_day: number };
        Returns: boolean;
      };
      consume_proxy_call: {
        Args: { px_max_per_day: number };
        Returns: boolean;
      };
      record_daily_activity: {
        Args: { px_date?: string };
        Returns: Json;
      };
      update_trip_budget: {
        Args: {
          px_journey_id: string;
          px_total_budget?: number | null;
          px_estimated_cost?: number | null;
          px_expense_delta?: number | null;
          px_daily_expenses?: number | null;
        };
        Returns: Json;
      };
      unlock_xp_achievements: {
        Args: { px_user_id?: string };
        Returns: undefined;
      };
      get_nearby_footprints: {
        Args: { px_lat: number; px_lng: number; px_radius?: number };
        Returns: {
          id: string;
          content: string;
          lat: number;
          lng: number;
          user_name: string;
          created_at: string;
          is_verified: boolean;
          is_mine: boolean;
        }[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row'];
export type TablesInsert<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert'];
export type TablesUpdate<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update'];
