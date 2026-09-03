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
export type MessageActor = "guest" | "assistant";
export type MessageStatus = "received" | "completed" | "blocked" | "failed";
export type RedactionStatus = "not_required" | "passed" | "failed";
export type ModelRunStatus = "completed" | "failed" | "skipped";
export type ValueEventType =
  | "service_answer"
  | "hours_answer"
  | "availability_answer"
  | "general_education"
  | "concern_summary"
  | "question_preparation"
  | "trust_explanation";
export type PatientSessionStatus = "active" | "closed";
export type ContactPointType = "email" | "phone" | "social_handle";
export type ConsentType = "healthcare_sharing" | "marketing_email";
export type ConsentAction = "granted" | "withdrawn";
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
      clinic_public_profiles: {
        Row: {
          clinic_id: string;
          services: string[];
          hours_summary: string;
          availability_summary: string;
          general_note: string;
          updated_at: string;
        };
        Insert: {
          clinic_id: string;
          services?: string[];
          hours_summary: string;
          availability_summary: string;
          general_note: string;
          updated_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["clinic_public_profiles"]["Insert"]
        >;
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
          conversion_idempotency_hash: string | null;
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
          conversion_idempotency_hash?: string | null;
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
      messages: {
        Row: {
          id: string;
          clinic_id: string;
          lead_session_id: string;
          actor: MessageActor;
          status: MessageStatus;
          content_ciphertext: string;
          content_sha256: string;
          client_message_id: string | null;
          in_reply_to_message_id: string | null;
          sequence_number: number;
          redaction_status: RedactionStatus;
          redaction_version: string | null;
          redaction_summary: Json;
          requires_secure_continue: boolean;
          audio_recording_id: string | null;
          audio_transcript_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          clinic_id: string;
          lead_session_id: string;
          actor: MessageActor;
          status: MessageStatus;
          content_ciphertext: string;
          content_sha256: string;
          client_message_id?: string | null;
          in_reply_to_message_id?: string | null;
          sequence_number: number;
          redaction_status?: RedactionStatus;
          redaction_version?: string | null;
          redaction_summary?: Json;
          requires_secure_continue?: boolean;
          audio_recording_id?: string | null;
          audio_transcript_id?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["messages"]["Insert"]>;
        Relationships: [];
      };
      model_runs: {
        Row: {
          id: string;
          clinic_id: string;
          source_message_id: string;
          provider: string;
          model: string;
          prompt_version: string;
          redacted_input_hash: string;
          provider_response_id: string | null;
          store_requested: boolean;
          status: ModelRunStatus;
          duration_ms: number;
          error_code: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          clinic_id: string;
          source_message_id: string;
          provider: string;
          model: string;
          prompt_version: string;
          redacted_input_hash: string;
          provider_response_id?: string | null;
          store_requested?: boolean;
          status: ModelRunStatus;
          duration_ms: number;
          error_code?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["model_runs"]["Insert"]>;
        Relationships: [];
      };
      value_events: {
        Row: {
          funnel_event_id: string;
          value_type: ValueEventType;
          source_query_id: string | null;
          validated_at: string | null;
        };
        Insert: {
          funnel_event_id: string;
          value_type: ValueEventType;
          source_query_id?: string | null;
          validated_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["value_events"]["Insert"]>;
        Relationships: [];
      };
      patients: {
        Row: {
          id: string;
          clinic_id: string;
          auth_user_id: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          clinic_id: string;
          auth_user_id: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["patients"]["Insert"]>;
        Relationships: [];
      };
      contact_points: {
        Row: {
          id: string;
          clinic_id: string;
          patient_id: string;
          type: ContactPointType;
          value_ciphertext: string | null;
          value_hash: string;
          external_ref: string | null;
          verified_at: string | null;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          clinic_id: string;
          patient_id: string;
          type: ContactPointType;
          value_ciphertext?: string | null;
          value_hash: string;
          external_ref?: string | null;
          verified_at?: string | null;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["contact_points"]["Insert"]>;
        Relationships: [];
      };
      patient_sessions: {
        Row: {
          id: string;
          clinic_id: string;
          patient_id: string;
          origin_lead_session_id: string;
          status: PatientSessionStatus;
          started_at: string;
          closed_at: string | null;
          updated_at: string;
        };
        Insert: {
          id?: string;
          clinic_id: string;
          patient_id: string;
          origin_lead_session_id: string;
          status?: PatientSessionStatus;
          started_at?: string;
          closed_at?: string | null;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["patient_sessions"]["Insert"]>;
        Relationships: [];
      };
      consent_events: {
        Row: {
          id: string;
          clinic_id: string;
          patient_id: string;
          lead_session_id: string | null;
          type: ConsentType;
          action: ConsentAction;
          policy_version: string;
          notice_version: string;
          captured_via: string;
          evidence_metadata: Json;
          idempotency_key: string;
          occurred_at: string;
        };
        Insert: {
          id?: string;
          clinic_id: string;
          patient_id: string;
          lead_session_id?: string | null;
          type: ConsentType;
          action: ConsentAction;
          policy_version: string;
          notice_version: string;
          captured_via: string;
          evidence_metadata?: Json;
          idempotency_key: string;
          occurred_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["consent_events"]["Insert"]>;
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
      append_guest_message: {
        Args: {
          p_recovery_token_hash: string;
          p_client_message_id: string;
          p_content_ciphertext: string;
          p_content_sha256: string;
        };
        Returns: Database["public"]["Tables"]["messages"]["Row"][];
      };
      complete_guest_turn: {
        Args: {
          p_recovery_token_hash: string;
          p_source_message_id: string;
          p_source_status: MessageStatus;
          p_redaction_status: RedactionStatus;
          p_redaction_version: string | null;
          p_redaction_summary: Json;
          p_assistant_ciphertext: string;
          p_assistant_sha256: string;
          p_requires_secure_continue: boolean;
          p_value_type: ValueEventType | null;
          p_provider: string;
          p_model: string;
          p_prompt_version: string;
          p_redacted_input_hash: string;
          p_provider_response_id: string | null;
          p_model_status: ModelRunStatus;
          p_duration_ms: number;
          p_error_code: string | null;
        };
        Returns: Database["public"]["Tables"]["messages"]["Row"][];
      };
      mark_lead_auth_started: {
        Args: { p_recovery_token_hash: string };
        Returns: string;
      };
      convert_lead_to_patient: {
        Args: {
          p_recovery_token_hash: string;
          p_phone_ciphertext: string;
          p_phone_hash: string;
          p_consent_granted: boolean;
          p_policy_version: string;
          p_notice_version: string;
        };
        Returns: string;
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
      message_actor: MessageActor;
      message_status: MessageStatus;
      redaction_status: RedactionStatus;
      model_run_status: ModelRunStatus;
      value_event_type: ValueEventType;
      patient_session_status: PatientSessionStatus;
      contact_point_type: ContactPointType;
      consent_type: ConsentType;
      consent_action: ConsentAction;
    };
    CompositeTypes: Record<string, never>;
  };
};
