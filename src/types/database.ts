export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type SourceChannel =
  | "staff_referral"
  | "social_comment"
  | "instagram_ad_click"
  | "google_ad_click"
  | "lead_form"
  | "google_reviews"
  | "website_widget";

export type SocialPlatform = "instagram" | "tiktok" | "facebook";
export type IdentityLevel =
  | "anonymous"
  | "social_handle"
  | "email"
  | "authenticated";
export type LeadStatus = "active" | "auth_started" | "converted" | "expired";
export type FunnelEventName =
  | "visitor"
  | "conversation_started"
  | "value_event"
  | "auth_started"
  | "consented"
  | "patient_created"
  | "escalation_sent";

export type Database = {
  public: {
    Tables: {
      clinics: {
        Row: {
          id: string;
          slug: string;
          name: string;
          timezone: string;
          response_min_hours: number;
          response_max_hours: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          slug: string;
          name: string;
          timezone?: string;
          response_min_hours?: number;
          response_max_hours?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["clinics"]["Insert"]>;
        Relationships: [];
      };
      lead_sessions: {
        Row: {
          id: string;
          clinic_id: string;
          status: LeadStatus;
          source_channel: SourceChannel;
          social_platform: SocialPlatform | null;
          campaign_id: string | null;
          creative: string | null;
          identity_level: IdentityLevel;
          landing_timestamp: string;
          landing_context: Json;
          context_ciphertext: string | null;
          social_handle_ciphertext: string | null;
          recovery_token_hash: string | null;
          request_fingerprint_hash: string;
          expires_at: string;
          converted_patient_id: string | null;
          converted_patient_session_id: string | null;
          converted_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          clinic_id: string;
          status?: LeadStatus;
          source_channel: SourceChannel;
          social_platform?: SocialPlatform | null;
          campaign_id?: string | null;
          creative?: string | null;
          identity_level: IdentityLevel;
          landing_timestamp: string;
          landing_context?: Json;
          context_ciphertext?: string | null;
          social_handle_ciphertext?: string | null;
          recovery_token_hash?: string | null;
          request_fingerprint_hash: string;
          expires_at: string;
          converted_patient_id?: string | null;
          converted_patient_session_id?: string | null;
          converted_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["lead_sessions"]["Insert"]>;
        Relationships: [];
      };
      channel_rules: {
        Row: {
          id: string;
          clinic_id: string | null;
          source_channel: SourceChannel;
          identity_level: IdentityLevel;
          time_of_day: string;
          opening_strategy: Json;
          priority: number;
          active: boolean;
          version: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          clinic_id?: string | null;
          source_channel: SourceChannel;
          identity_level: IdentityLevel;
          time_of_day: string;
          opening_strategy: Json;
          priority?: number;
          active?: boolean;
          version?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["channel_rules"]["Insert"]>;
        Relationships: [];
      };
      funnel_events: {
        Row: {
          id: string;
          clinic_id: string;
          lead_session_id: string | null;
          patient_session_id: string | null;
          name: FunnelEventName;
          source_channel: SourceChannel;
          identity_level: IdentityLevel;
          metadata: Json;
          idempotency_key: string;
          occurred_at: string;
        };
        Insert: {
          id?: string;
          clinic_id: string;
          lead_session_id?: string | null;
          patient_session_id?: string | null;
          name: FunnelEventName;
          source_channel: SourceChannel;
          identity_level: IdentityLevel;
          metadata?: Json;
          idempotency_key: string;
          occurred_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["funnel_events"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      create_lead_session: {
        Args: {
          p_clinic_slug: string;
          p_source_channel: SourceChannel;
          p_social_platform: SocialPlatform | null;
          p_campaign_id: string | null;
          p_creative: string | null;
          p_identity_level: IdentityLevel;
          p_landing_timestamp: string;
          p_landing_context: Json;
          p_context_ciphertext: string | null;
          p_social_handle_ciphertext: string | null;
          p_recovery_token_hash: string;
          p_request_fingerprint_hash: string;
          p_expires_at: string;
        };
        Returns: Database["public"]["Tables"]["lead_sessions"]["Row"][];
      };
      expire_lead_sessions: {
        Args: Record<PropertyKey, never>;
        Returns: number;
      };
    };
    Enums: {
      source_channel: SourceChannel;
      social_platform: SocialPlatform;
      identity_level: IdentityLevel;
      lead_status: LeadStatus;
      funnel_event_name: FunnelEventName;
    };
    CompositeTypes: Record<string, never>;
  };
};
