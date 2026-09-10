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
export type MessageActor = "guest" | "patient" | "assistant";
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
export type RiskLevel = "low" | "medium" | "high";
export type ResponseConfidence = "low" | "med" | "high";
export type MemoryKind = "chief_complaint" | "symptom" | "medication" | "allergy";
export type MemoryStatus = "active" | "stopped" | "resolved" | "corrected";
export type MemoryBootstrapStatus = "pending" | "completed" | "failed";
export type MemoryConflictKind = "allergy_presence" | "medication_status" | "dosage";
export type MemoryConflictStatus = "open" | "resolved";
export type MemberRole = "staff" | "nurse" | "clinician";
export type EscalationStatus = "required" | "queued" | "acknowledged" | "responded" | "closed";
export type NotificationJobStatus = "pending" | "delivered" | "failed" | "no_subscription" | "transport_unavailable";
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
          phone_ciphertext: string | null;
          phone_hash: string | null;
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
          phone_ciphertext?: string | null;
          phone_hash?: string | null;
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
          lead_session_id: string | null;
          patient_session_id: string | null;
          actor: MessageActor;
          status: MessageStatus;
          content_ciphertext: string;
          content_sha256: string;
          content_sealed: boolean;
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
          lead_session_id?: string | null;
          patient_session_id?: string | null;
          actor: MessageActor;
          status: MessageStatus;
          content_ciphertext: string;
          content_sha256: string;
          content_sealed?: boolean;
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
          acquisition_identity_level: IdentityLevel;
          current_identity_level: IdentityLevel;
          authentication_method: "email_password" | "phone_otp" | "legacy_unknown";
          identity_verified: boolean;
          status: PatientSessionStatus;
          memory_bootstrap_status: MemoryBootstrapStatus;
          memory_bootstrap_attempts: number;
          memory_bootstrap_error_code: string | null;
          memory_bootstrap_completed_at: string | null;
          started_at: string;
          closed_at: string | null;
          updated_at: string;
        };
        Insert: {
          id?: string;
          clinic_id: string;
          patient_id: string;
          origin_lead_session_id: string;
          acquisition_identity_level: IdentityLevel;
          current_identity_level?: IdentityLevel;
          authentication_method: "email_password" | "phone_otp" | "legacy_unknown";
          identity_verified?: boolean;
          status?: PatientSessionStatus;
          memory_bootstrap_status?: MemoryBootstrapStatus;
          memory_bootstrap_attempts?: number;
          memory_bootstrap_error_code?: string | null;
          memory_bootstrap_completed_at?: string | null;
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
      knowledge_sources: {
        Row: {
          id: string;
          title: string;
          publisher: string;
          url: string;
          content: string;
          version: string;
          reviewed_at: string;
          active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          title: string;
          publisher: string;
          url: string;
          content: string;
          version: string;
          reviewed_at: string;
          active?: boolean;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["knowledge_sources"]["Insert"]>;
        Relationships: [];
      };
      risk_assessments: {
        Row: {
          id: string;
          clinic_id: string;
          patient_session_id: string;
          message_id: string;
          risk_level: RiskLevel;
          risk_reason: string;
          confidence: ResponseConfidence;
          escalation_required: boolean;
          rule_matches: string[];
          model_run_id: string | null;
          pipeline_version: string;
          provenance: Json;
          assessed_at: string;
        };
        Insert: {
          id?: string;
          clinic_id: string;
          patient_session_id: string;
          message_id: string;
          risk_level: RiskLevel;
          risk_reason: string;
          confidence: ResponseConfidence;
          escalation_required: boolean;
          rule_matches?: string[];
          model_run_id?: string | null;
          pipeline_version: string;
          provenance?: Json;
          assessed_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["risk_assessments"]["Insert"]>;
        Relationships: [];
      };
      citations: {
        Row: {
          id: string;
          assistant_message_id: string;
          knowledge_source_id: string;
          source_start: number;
          source_end: number;
          quoted_span_hash: string;
          ordinal: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          assistant_message_id: string;
          knowledge_source_id: string;
          source_start: number;
          source_end: number;
          quoted_span_hash: string;
          ordinal: number;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["citations"]["Insert"]>;
        Relationships: [];
      };
      memory_items: {
        Row: {
          id: string;
          clinic_id: string;
          patient_id: string;
          kind: MemoryKind;
          canonical_key: string;
          current_revision_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          clinic_id: string;
          patient_id: string;
          kind: MemoryKind;
          canonical_key: string;
          current_revision_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["memory_items"]["Insert"]>;
        Relationships: [];
      };
      memory_revisions: {
        Row: {
          id: string;
          memory_item_id: string;
          value_ciphertext: string;
          value_sha256: string;
          status: MemoryStatus;
          source_message_id: string;
          source_content_sha256: string;
          source_snapshot_ciphertext: string;
          supersedes_revision_id: string | null;
          model_run_id: string | null;
          confidence: ResponseConfidence;
          effective_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          memory_item_id: string;
          value_ciphertext: string;
          value_sha256: string;
          status: MemoryStatus;
          source_message_id: string;
          source_content_sha256?: string;
          source_snapshot_ciphertext?: string;
          supersedes_revision_id?: string | null;
          model_run_id?: string | null;
          confidence: ResponseConfidence;
          effective_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["memory_revisions"]["Insert"]>;
        Relationships: [];
      };
      memory_conflicts: {
        Row: {
          id: string;
          clinic_id: string;
          patient_id: string;
          kind: MemoryConflictKind;
          status: MemoryConflictStatus;
          left_revision_id: string;
          right_revision_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          clinic_id: string;
          patient_id: string;
          kind: MemoryConflictKind;
          status?: MemoryConflictStatus;
          left_revision_id: string;
          right_revision_id: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["memory_conflicts"]["Insert"]>;
        Relationships: [];
      };
      clinic_memberships: {
        Row: {
          id: string;
          clinic_id: string;
          auth_user_id: string;
          role: MemberRole;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          clinic_id: string;
          auth_user_id: string;
          role: MemberRole;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["clinic_memberships"]["Insert"]>;
        Relationships: [];
      };
      escalations: {
        Row: {
          id: string;
          clinic_id: string;
          patient_id: string;
          patient_session_id: string;
          trigger_message_id: string;
          risk_assessment_id: string;
          status: EscalationStatus;
          triage_summary_ciphertext: string | null;
          triage_summary_sha256: string | null;
          profile_snapshot_ciphertext: string | null;
          profile_snapshot_sha256: string | null;
          attribution_snapshot: Json | null;
          response_min_hours: number | null;
          response_max_hours: number | null;
          response_expected_by: string | null;
          acknowledged_by_membership_id: string | null;
          acknowledged_at: string | null;
          clinician_response_at: string | null;
          created_at: string;
          sent_at: string | null;
          updated_at: string;
        };
        Insert: {
          id?: string;
          clinic_id: string;
          patient_id: string;
          patient_session_id: string;
          trigger_message_id: string;
          risk_assessment_id: string;
          status?: EscalationStatus;
          triage_summary_ciphertext?: string | null;
          triage_summary_sha256?: string | null;
          profile_snapshot_ciphertext?: string | null;
          profile_snapshot_sha256?: string | null;
          attribution_snapshot?: Json | null;
          response_min_hours?: number | null;
          response_max_hours?: number | null;
          response_expected_by?: string | null;
          acknowledged_by_membership_id?: string | null;
          acknowledged_at?: string | null;
          clinician_response_at?: string | null;
          created_at?: string;
          sent_at?: string | null;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["escalations"]["Insert"]>;
        Relationships: [];
      };
      escalation_provenance: {
        Row: {
          id: string;
          escalation_id: string;
          message_id: string | null;
          memory_revision_id: string | null;
          purpose: "trigger" | "summary_support" | "profile_support";
          created_at: string;
        };
        Insert: {
          id?: string;
          escalation_id: string;
          message_id?: string | null;
          memory_revision_id?: string | null;
          purpose: "trigger" | "summary_support" | "profile_support";
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["escalation_provenance"]["Insert"]>;
        Relationships: [];
      };
      clinician_responses: {
        Row: {
          id: string;
          escalation_id: string;
          clinic_id: string;
          author_membership_id: string;
          content_ciphertext: string;
          content_sha256: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          escalation_id: string;
          clinic_id: string;
          author_membership_id: string;
          content_ciphertext: string;
          content_sha256: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["clinician_responses"]["Insert"]>;
        Relationships: [];
      };
      push_subscriptions: {
        Row: { id: string; clinic_id: string; patient_id: string; subscription_ciphertext: string; endpoint_hash: string; active: boolean; expires_at: string | null; last_success_at: string | null; failure_count: number; created_at: string; updated_at: string };
        Insert: { id?: string; clinic_id: string; patient_id: string; subscription_ciphertext: string; endpoint_hash: string; active?: boolean; expires_at?: string | null; last_success_at?: string | null; failure_count?: number; created_at?: string; updated_at?: string };
        Update: Partial<Database["public"]["Tables"]["push_subscriptions"]["Insert"]>;
        Relationships: [];
      };
      notification_jobs: {
        Row: { id: string; clinic_id: string; patient_id: string; patient_session_id: string; escalation_id: string; clinician_response_id: string; transport: "web_push"; status: NotificationJobStatus; attempt_count: number; delivered_at: string | null; last_error_code: string | null; created_at: string; updated_at: string };
        Insert: { id?: string; clinic_id: string; patient_id: string; patient_session_id: string; escalation_id: string; clinician_response_id: string; transport?: "web_push"; status?: NotificationJobStatus; attempt_count?: number; delivered_at?: string | null; last_error_code?: string | null; created_at?: string; updated_at?: string };
        Update: Partial<Database["public"]["Tables"]["notification_jobs"]["Insert"]>;
        Relationships: [];
      };
      notification_attempts: {
        Row: { id: string; notification_job_id: string; push_subscription_id: string | null; outcome: "delivered" | "failed" | "gone" | "transport_unavailable"; provider_status: number | null; error_code: string | null; attempted_at: string };
        Insert: { id?: string; notification_job_id: string; push_subscription_id?: string | null; outcome: "delivered" | "failed" | "gone" | "transport_unavailable"; provider_status?: number | null; error_code?: string | null; attempted_at?: string };
        Update: Partial<Database["public"]["Tables"]["notification_attempts"]["Insert"]>;
        Relationships: [];
      };
      lead_recovery_tombstones: {
        Row: { recovery_token_hash: string; state: "expired" | "purged"; expired_at: string; purged_at: string; updated_at: string };
        Insert: { recovery_token_hash: string; state?: "expired" | "purged"; expired_at: string; purged_at: string; updated_at?: string };
        Update: Partial<Database["public"]["Tables"]["lead_recovery_tombstones"]["Insert"]>;
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
      create_lead_session_v2: {
        Args: Database["public"]["Functions"]["create_lead_session"]["Args"] & {
          p_phone_ciphertext: string | null;
          p_phone_hash: string | null;
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
      seal_guest_message: {
        Args: {
          p_recovery_token_hash: string;
          p_source_message_id: string;
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
      convert_lead_to_patient_v2: {
        Args: {
          p_recovery_token_hash: string;
          p_phone_ciphertext: string;
          p_phone_hash: string;
          p_consent_granted: boolean;
          p_policy_version: string;
          p_notice_version: string;
          p_marketing_consent: boolean;
          p_marketing_policy_version: string;
          p_marketing_notice_version: string;
        };
        Returns: string;
      };
      record_marketing_email_consent: {
        Args: {
          p_patient_session_id: string;
          p_action: ConsentAction;
          p_policy_version: string;
          p_notice_version: string;
          p_idempotency_key: string;
        };
        Returns: string;
      };
      has_current_marketing_email_consent: {
        Args: { p_patient_session_id: string };
        Returns: boolean;
      };
      append_patient_message: {
        Args: {
          p_patient_session_id: string;
          p_client_message_id: string;
          p_content_ciphertext: string;
          p_content_sha256: string;
        };
        Returns: Database["public"]["Tables"]["messages"]["Row"][];
      };
      seal_patient_message: {
        Args: {
          p_patient_session_id: string;
          p_source_message_id: string;
          p_content_ciphertext: string;
          p_content_sha256: string;
        };
        Returns: Database["public"]["Tables"]["messages"]["Row"][];
      };
      complete_patient_turn: {
        Args: {
          p_patient_session_id: string;
          p_source_message_id: string;
          p_source_status: MessageStatus;
          p_redaction_status: RedactionStatus;
          p_redaction_version: string | null;
          p_redaction_summary: Json;
          p_assistant_ciphertext: string;
          p_assistant_sha256: string;
          p_risk_level: RiskLevel;
          p_risk_reason: string;
          p_confidence: ResponseConfidence;
          p_escalation_required: boolean;
          p_rule_matches: string[];
          p_pipeline_version: string;
          p_risk_provenance: Json;
          p_provider: string;
          p_model: string;
          p_prompt_version: string;
          p_redacted_input_hash: string;
          p_provider_response_id: string | null;
          p_model_status: ModelRunStatus;
          p_duration_ms: number;
          p_error_code: string | null;
          p_citations: Json;
        };
        Returns: Database["public"]["Tables"]["messages"]["Row"][];
      };
      complete_patient_turn_with_memory: {
        Args: Database["public"]["Functions"]["complete_patient_turn"]["Args"] & {
          p_memory_proposals: Json;
        };
        Returns: Database["public"]["Tables"]["messages"]["Row"][];
      };
      apply_patient_memory: {
        Args: { p_patient_session_id: string; p_memory_proposals: Json };
        Returns: undefined;
      };
      record_memory_bootstrap_result: {
        Args: {
          p_patient_session_id: string;
          p_succeeded: boolean;
          p_error_code?: string | null;
        };
        Returns: undefined;
      };
      queue_escalation: {
        Args: {
          p_escalation_id: string;
          p_triage_summary_ciphertext: string;
          p_triage_summary_sha256: string;
          p_profile_snapshot_ciphertext: string;
          p_profile_snapshot_sha256: string;
          p_provenance: Json;
        };
        Returns: Database["public"]["Tables"]["escalations"]["Row"][];
      };
      acknowledge_escalation: {
        Args: { p_escalation_id: string };
        Returns: Database["public"]["Tables"]["escalations"]["Row"][];
      };
      respond_to_escalation: {
        Args: {
          p_escalation_id: string;
          p_content_ciphertext: string;
          p_content_sha256: string;
        };
        Returns: Database["public"]["Tables"]["clinician_responses"]["Row"][];
      };
      close_escalation: {
        Args: { p_escalation_id: string };
        Returns: Database["public"]["Tables"]["escalations"]["Row"][];
      };
      expire_lead_sessions: {
        Args: Record<PropertyKey, never>;
        Returns: number;
      };
      rotate_lead_recovery_token: {
        Args: { p_current_token_hash: string; p_new_token_hash: string };
        Returns: Database["public"]["Tables"]["lead_sessions"]["Row"][];
      };
      upsert_push_subscription: {
        Args: { p_patient_session_id: string; p_subscription_ciphertext: string; p_endpoint_hash: string; p_expires_at: string | null };
        Returns: string;
      };
      deactivate_push_subscription: {
        Args: { p_patient_session_id: string; p_endpoint_hash: string };
        Returns: boolean;
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
      risk_level: RiskLevel;
      response_confidence: ResponseConfidence;
      memory_kind: MemoryKind;
      memory_status: MemoryStatus;
      member_role: MemberRole;
      escalation_status: EscalationStatus;
    };
    CompositeTypes: Record<string, never>;
  };
};
