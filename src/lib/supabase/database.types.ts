export type Json =
  string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      analytics_events: {
        Row: {
          created_at: string;
          event_type: string;
          form_id: string | null;
          id: string;
          is_preview: boolean;
          metadata: Json;
          session_id: string | null;
        };
        Insert: {
          created_at?: string;
          event_type: string;
          form_id?: string | null;
          id?: string;
          is_preview?: boolean;
          metadata?: Json;
          session_id?: string | null;
        };
        Update: {
          created_at?: string;
          event_type?: string;
          form_id?: string | null;
          id?: string;
          is_preview?: boolean;
          metadata?: Json;
          session_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "analytics_events_form_id_fkey";
            columns: ["form_id"];
            isOneToOne: false;
            referencedRelation: "forms";
            referencedColumns: ["id"];
          },
        ];
      };
      answers: {
        Row: {
          id: string;
          question_id: string;
          response_id: string;
          search_text: string | null;
          updated_at: string;
          value: Json;
        };
        Insert: {
          id?: string;
          question_id: string;
          response_id: string;
          search_text?: never;
          updated_at?: string;
          value: Json;
        };
        Update: {
          id?: string;
          question_id?: string;
          response_id?: string;
          search_text?: never;
          updated_at?: string;
          value?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "answers_response_id_fkey";
            columns: ["response_id"];
            isOneToOne: false;
            referencedRelation: "responses";
            referencedColumns: ["id"];
          },
        ];
      };
      api_keys: {
        Row: {
          created_at: string;
          created_by: string | null;
          id: string;
          key_hash: string;
          last_used_at: string | null;
          name: string;
          prefix: string;
          revoked_at: string | null;
          scopes: string[];
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          key_hash: string;
          last_used_at?: string | null;
          name: string;
          prefix: string;
          revoked_at?: string | null;
          scopes?: string[];
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          key_hash?: string;
          last_used_at?: string | null;
          name?: string;
          prefix?: string;
          revoked_at?: string | null;
          scopes?: string[];
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "api_keys_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "api_keys_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_logs: {
        Row: {
          action: string;
          actor_id: string | null;
          created_at: string;
          id: number;
          metadata: Json;
          target_id: string | null;
          target_type: string | null;
          workspace_id: string;
        };
        Insert: {
          action: string;
          actor_id?: string | null;
          created_at?: string;
          id?: never;
          metadata?: Json;
          target_id?: string | null;
          target_type?: string | null;
          workspace_id: string;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          created_at?: string;
          id?: never;
          metadata?: Json;
          target_id?: string | null;
          target_type?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "audit_logs_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      booking_hosts: {
        Row: {
          added_at: string;
          booking_type_id: string;
          user_id: string;
        };
        Insert: {
          added_at?: string;
          booking_type_id: string;
          user_id: string;
        };
        Update: {
          added_at?: string;
          booking_type_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "booking_hosts_booking_type_id_fkey";
            columns: ["booking_type_id"];
            isOneToOne: false;
            referencedRelation: "booking_types";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "booking_hosts_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      booking_types: {
        Row: {
          archived_at: string | null;
          blocked_dates: string[];
          buffer_after_minutes: number;
          buffer_before_minutes: number;
          created_at: string;
          created_by: string | null;
          duration_minutes: number;
          id: string;
          interval_minutes: number | null;
          location: string | null;
          max_days_ahead: number;
          min_notice_minutes: number;
          name: string;
          reminders: boolean;
          time_zone: string;
          updated_at: string;
          weekly: Json;
          workspace_id: string;
        };
        Insert: {
          archived_at?: string | null;
          blocked_dates?: string[];
          buffer_after_minutes?: number;
          buffer_before_minutes?: number;
          created_at?: string;
          created_by?: string | null;
          duration_minutes: number;
          id?: string;
          interval_minutes?: number | null;
          location?: string | null;
          max_days_ahead?: number;
          min_notice_minutes?: number;
          name: string;
          reminders?: boolean;
          time_zone: string;
          updated_at?: string;
          weekly?: Json;
          workspace_id: string;
        };
        Update: {
          archived_at?: string | null;
          blocked_dates?: string[];
          buffer_after_minutes?: number;
          buffer_before_minutes?: number;
          created_at?: string;
          created_by?: string | null;
          duration_minutes?: number;
          id?: string;
          interval_minutes?: number | null;
          location?: string | null;
          max_days_ahead?: number;
          min_notice_minutes?: number;
          name?: string;
          reminders?: boolean;
          time_zone?: string;
          updated_at?: string;
          weekly?: Json;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "booking_types_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      bookings: {
        Row: {
          attendee_email: string | null;
          attendee_name: string | null;
          attendee_time_zone: string | null;
          blocked: string;
          booking_type_id: string;
          cancelled_at: string | null;
          cancelled_by: string | null;
          confirmed_at: string | null;
          created_at: string;
          ends_at: string;
          form_id: string | null;
          host_id: string;
          id: string;
          manage_token_hash: string;
          reminder_sent_at: string | null;
          rescheduled_from: string | null;
          response_id: string | null;
          starts_at: string;
          status: "pending" | "confirmed" | "cancelled";
        };
        Insert: {
          attendee_email?: string | null;
          attendee_name?: string | null;
          attendee_time_zone?: string | null;
          blocked: string;
          booking_type_id: string;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          confirmed_at?: string | null;
          created_at?: string;
          ends_at: string;
          form_id?: string | null;
          host_id: string;
          id?: string;
          manage_token_hash: string;
          reminder_sent_at?: string | null;
          rescheduled_from?: string | null;
          response_id?: string | null;
          starts_at: string;
          status?: "pending" | "confirmed" | "cancelled";
        };
        Update: {
          attendee_email?: string | null;
          attendee_name?: string | null;
          attendee_time_zone?: string | null;
          blocked?: string;
          booking_type_id?: string;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          confirmed_at?: string | null;
          created_at?: string;
          ends_at?: string;
          form_id?: string | null;
          host_id?: string;
          id?: string;
          manage_token_hash?: string;
          reminder_sent_at?: string | null;
          rescheduled_from?: string | null;
          response_id?: string | null;
          starts_at?: string;
          status?: "pending" | "confirmed" | "cancelled";
        };
        Relationships: [
          {
            foreignKeyName: "bookings_booking_type_id_fkey";
            columns: ["booking_type_id"];
            isOneToOne: false;
            referencedRelation: "booking_types";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bookings_host_id_fkey";
            columns: ["host_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bookings_form_id_fkey";
            columns: ["form_id"];
            isOneToOne: false;
            referencedRelation: "forms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bookings_response_id_fkey";
            columns: ["response_id"];
            isOneToOne: false;
            referencedRelation: "responses";
            referencedColumns: ["id"];
          },
        ];
      };
      confirmation_email_log: {
        Row: {
          created_at: string;
          error: string | null;
          form_id: string;
          response_id: string;
          status: string;
        };
        Insert: {
          created_at?: string;
          error?: string | null;
          form_id: string;
          response_id: string;
          status: string;
        };
        Update: {
          created_at?: string;
          error?: string | null;
          form_id?: string;
          response_id?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "confirmation_email_log_form_id_fkey";
            columns: ["form_id"];
            isOneToOne: false;
            referencedRelation: "forms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "confirmation_email_log_response_id_fkey";
            columns: ["response_id"];
            isOneToOne: true;
            referencedRelation: "responses";
            referencedColumns: ["id"];
          },
        ];
      };
      confirmation_emails: {
        Row: {
          body: string;
          cta_label: string | null;
          cta_url: string | null;
          enabled: boolean;
          form_id: string;
          recipient_question_id: string | null;
          subject: string;
          updated_at: string;
        };
        Insert: {
          body?: string;
          cta_label?: string | null;
          cta_url?: string | null;
          enabled?: boolean;
          form_id: string;
          recipient_question_id?: string | null;
          subject?: string;
          updated_at?: string;
        };
        Update: {
          body?: string;
          cta_label?: string | null;
          cta_url?: string | null;
          enabled?: boolean;
          form_id?: string;
          recipient_question_id?: string | null;
          subject?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "confirmation_emails_form_id_fkey";
            columns: ["form_id"];
            isOneToOne: true;
            referencedRelation: "forms";
            referencedColumns: ["id"];
          },
        ];
      };
      connector_connections: {
        Row: {
          created_at: string;
          created_by: string | null;
          encrypted: Json;
          id: string;
          label: string | null;
          provider: string;
          settings: Json;
          status: "ok" | "invalid" | "revoked";
          updated_at: string;
          user_id: string | null;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          encrypted: Json;
          id?: string;
          label?: string | null;
          provider: string;
          settings?: Json;
          status?: "ok" | "invalid" | "revoked";
          updated_at?: string;
          user_id?: string | null;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          encrypted?: Json;
          id?: string;
          label?: string | null;
          provider?: string;
          settings?: Json;
          status?: "ok" | "invalid" | "revoked";
          updated_at?: string;
          user_id?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "connector_connections_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "connector_connections_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      connector_jobs: {
        Row: {
          action: string;
          attempt_count: number;
          booking_id: string | null;
          connection_id: string | null;
          created_at: string;
          id: string;
          idempotency_key: string;
          last_error: string | null;
          next_attempt_at: string;
          payload: Json;
          provider: string;
          response_id: string | null;
          result: Json | null;
          status:
            "pending" | "running" | "succeeded" | "failed" | "exhausted" | "skipped";
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          action: string;
          attempt_count?: number;
          booking_id?: string | null;
          connection_id?: string | null;
          created_at?: string;
          id?: string;
          idempotency_key: string;
          last_error?: string | null;
          next_attempt_at?: string;
          payload?: Json;
          provider: string;
          response_id?: string | null;
          result?: Json | null;
          status?:
            "pending" | "running" | "succeeded" | "failed" | "exhausted" | "skipped";
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          action?: string;
          attempt_count?: number;
          booking_id?: string | null;
          connection_id?: string | null;
          created_at?: string;
          id?: string;
          idempotency_key?: string;
          last_error?: string | null;
          next_attempt_at?: string;
          payload?: Json;
          provider?: string;
          response_id?: string | null;
          result?: Json | null;
          status?:
            "pending" | "running" | "succeeded" | "failed" | "exhausted" | "skipped";
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "connector_jobs_connection_id_fkey";
            columns: ["connection_id"];
            isOneToOne: false;
            referencedRelation: "connector_connections";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "connector_jobs_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "connector_jobs_response_id_fkey";
            columns: ["response_id"];
            isOneToOne: false;
            referencedRelation: "responses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "connector_jobs_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: false;
            referencedRelation: "bookings";
            referencedColumns: ["id"];
          },
        ];
      };
      custom_domains: {
        Row: {
          created_at: string;
          default_form_id: string | null;
          hostname: string;
          id: string;
          last_checked_at: string | null;
          last_error: string | null;
          status: string;
          verification_token: string;
          verified_at: string | null;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          default_form_id?: string | null;
          hostname: string;
          id?: string;
          last_checked_at?: string | null;
          last_error?: string | null;
          status?: string;
          verification_token: string;
          verified_at?: string | null;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          default_form_id?: string | null;
          hostname?: string;
          id?: string;
          last_checked_at?: string | null;
          last_error?: string | null;
          status?: string;
          verification_token?: string;
          verified_at?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "custom_domains_default_form_id_fkey";
            columns: ["default_form_id"];
            isOneToOne: false;
            referencedRelation: "forms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "custom_domains_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      experiments: {
        Row: {
          created_by: string | null;
          ended_at: string | null;
          form_id: string;
          id: string;
          name: string;
          split: number;
          started_at: string;
          status: string;
          variant_form_id: string;
          winner: string | null;
          workspace_id: string;
        };
        Insert: {
          created_by?: string | null;
          ended_at?: string | null;
          form_id: string;
          id?: string;
          name: string;
          split?: number;
          started_at?: string;
          status?: string;
          variant_form_id: string;
          winner?: string | null;
          workspace_id: string;
        };
        Update: {
          created_by?: string | null;
          ended_at?: string | null;
          form_id?: string;
          id?: string;
          name?: string;
          split?: number;
          started_at?: string;
          status?: string;
          variant_form_id?: string;
          winner?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "experiments_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "experiments_form_id_fkey";
            columns: ["form_id"];
            isOneToOne: false;
            referencedRelation: "forms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "experiments_variant_form_id_fkey";
            columns: ["variant_form_id"];
            isOneToOne: false;
            referencedRelation: "forms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "experiments_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      folders: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "folders_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      form_ai_summaries: {
        Row: {
          form_id: string;
          generated_at: string;
          generated_by: string | null;
          response_count: number;
          summary: Json;
        };
        Insert: {
          form_id: string;
          generated_at?: string;
          generated_by?: string | null;
          response_count: number;
          summary: Json;
        };
        Update: {
          form_id?: string;
          generated_at?: string;
          generated_by?: string | null;
          response_count?: number;
          summary?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "form_ai_summaries_form_id_fkey";
            columns: ["form_id"];
            isOneToOne: true;
            referencedRelation: "forms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "form_ai_summaries_generated_by_fkey";
            columns: ["generated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      form_documents: {
        Row: {
          created_at: string;
          enabled: boolean;
          form_id: string;
          id: string;
          kind: "summary" | "order" | "registration" | "certificate";
          member_ids: string[];
          next_number: number;
          recipients: "owner" | "respondent" | "both" | "none";
          settings: Json;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          enabled?: boolean;
          form_id: string;
          id?: string;
          kind: "summary" | "order" | "registration" | "certificate";
          member_ids?: string[];
          next_number?: number;
          recipients?: "owner" | "respondent" | "both" | "none";
          settings?: Json;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          enabled?: boolean;
          form_id?: string;
          id?: string;
          kind?: "summary" | "order" | "registration" | "certificate";
          member_ids?: string[];
          next_number?: number;
          recipients?: "owner" | "respondent" | "both" | "none";
          settings?: Json;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "form_documents_form_id_fkey";
            columns: ["form_id"];
            isOneToOne: false;
            referencedRelation: "forms";
            referencedColumns: ["id"];
          },
        ];
      };
      form_lookups: {
        Row: {
          created_at: string;
          created_by: string | null;
          enabled: boolean;
          encrypted_header: Json | null;
          form_id: string;
          header_name: string | null;
          id: string;
          name: string;
          outputs: Json;
          trigger_question_id: string;
          url: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          enabled?: boolean;
          encrypted_header?: Json | null;
          form_id: string;
          header_name?: string | null;
          id?: string;
          name: string;
          outputs: Json;
          trigger_question_id: string;
          url: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          enabled?: boolean;
          encrypted_header?: Json | null;
          form_id?: string;
          header_name?: string | null;
          id?: string;
          name?: string;
          outputs?: Json;
          trigger_question_id?: string;
          url?: string;
        };
        Relationships: [
          {
            foreignKeyName: "form_lookups_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "form_lookups_form_id_fkey";
            columns: ["form_id"];
            isOneToOne: false;
            referencedRelation: "forms";
            referencedColumns: ["id"];
          },
        ];
      };
      form_access_secrets: {
        Row: {
          form_id: string;
          password_hash: string;
          updated_at: string;
        };
        Insert: {
          form_id: string;
          password_hash: string;
          updated_at?: string;
        };
        Update: {
          form_id?: string;
          password_hash?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "form_access_secrets_form_id_fkey";
            columns: ["form_id"];
            isOneToOne: true;
            referencedRelation: "forms";
            referencedColumns: ["id"];
          },
        ];
      };
      form_kiosk_secrets: {
        Row: {
          form_id: string;
          pin_hash: string;
          updated_at: string;
        };
        Insert: {
          form_id: string;
          pin_hash: string;
          updated_at?: string;
        };
        Update: {
          form_id?: string;
          pin_hash?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "form_kiosk_secrets_form_id_fkey";
            columns: ["form_id"];
            isOneToOne: true;
            referencedRelation: "forms";
            referencedColumns: ["id"];
          },
        ];
      };
      form_versions: {
        Row: {
          created_at: string;
          form_id: string;
          id: string;
          published_at: string | null;
          published_by: string | null;
          revision: number;
          schema: Json;
          status: Database["public"]["Enums"]["form_version_status"];
          updated_at: string;
          version_number: number;
        };
        Insert: {
          created_at?: string;
          form_id: string;
          id?: string;
          published_at?: string | null;
          published_by?: string | null;
          revision?: number;
          schema: Json;
          status?: Database["public"]["Enums"]["form_version_status"];
          updated_at?: string;
          version_number: number;
        };
        Update: {
          created_at?: string;
          form_id?: string;
          id?: string;
          published_at?: string | null;
          published_by?: string | null;
          revision?: number;
          schema?: Json;
          status?: Database["public"]["Enums"]["form_version_status"];
          updated_at?: string;
          version_number?: number;
        };
        Relationships: [
          {
            foreignKeyName: "form_versions_form_id_fkey";
            columns: ["form_id"];
            isOneToOne: false;
            referencedRelation: "forms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "form_versions_published_by_fkey";
            columns: ["published_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      forms: {
        Row: {
          import_report: Json | null;
          ai_lead_criteria: string | null;
          captcha_required: boolean;
          closed_message: string | null;
          closes_at: string | null;
          created_at: string;
          created_by: string;
          deleted_at: string | null;
          description: string | null;
          folder_id: string | null;
          full_message: string | null;
          ga_measurement_id: string | null;
          gtm_container_id: string | null;
          id: string;
          kiosk_config: Json | null;
          meta_pixel_id: string | null;
          partial_retention_days: number | null;
          payment_config: Json | null;
          response_cap: number | null;
          resume_links_enabled: boolean;
          save_partial_responses: boolean;
          slug: string;
          title: string;
          updated_at: string;
          workspace_id: string;
          linkedin_conversion_id: string | null;
          linkedin_partner_id: string | null;
          pixel_consent: string;
          tiktok_pixel_id: string | null;
          confidential: Json | null;
        };
        Insert: {
          import_report?: Json | null;
          ai_lead_criteria?: string | null;
          captcha_required?: boolean;
          closed_message?: string | null;
          closes_at?: string | null;
          created_at?: string;
          created_by: string;
          deleted_at?: string | null;
          description?: string | null;
          folder_id?: string | null;
          full_message?: string | null;
          ga_measurement_id?: string | null;
          gtm_container_id?: string | null;
          id?: string;
          kiosk_config?: Json | null;
          meta_pixel_id?: string | null;
          partial_retention_days?: number | null;
          payment_config?: Json | null;
          response_cap?: number | null;
          resume_links_enabled?: boolean;
          save_partial_responses?: boolean;
          slug: string;
          title: string;
          updated_at?: string;
          workspace_id: string;
          linkedin_conversion_id?: string | null;
          linkedin_partner_id?: string | null;
          pixel_consent?: string;
          tiktok_pixel_id?: string | null;
          confidential?: Json | null;
        };
        Update: {
          import_report?: Json | null;
          ai_lead_criteria?: string | null;
          captcha_required?: boolean;
          closed_message?: string | null;
          closes_at?: string | null;
          created_at?: string;
          created_by?: string;
          deleted_at?: string | null;
          description?: string | null;
          folder_id?: string | null;
          full_message?: string | null;
          ga_measurement_id?: string | null;
          gtm_container_id?: string | null;
          id?: string;
          kiosk_config?: Json | null;
          meta_pixel_id?: string | null;
          partial_retention_days?: number | null;
          payment_config?: Json | null;
          response_cap?: number | null;
          resume_links_enabled?: boolean;
          save_partial_responses?: boolean;
          slug?: string;
          title?: string;
          updated_at?: string;
          workspace_id?: string;
          linkedin_conversion_id?: string | null;
          linkedin_partner_id?: string | null;
          pixel_consent?: string;
          tiktok_pixel_id?: string | null;
          confidential?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: "forms_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "forms_folder_id_fkey";
            columns: ["folder_id"];
            isOneToOne: false;
            referencedRelation: "folders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "forms_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      integration_credentials: {
        Row: {
          created_at: string;
          encrypted: Json;
          id: string;
          label: string | null;
          provider: string;
          status: string;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          encrypted: Json;
          id?: string;
          label?: string | null;
          provider: string;
          status?: string;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          encrypted?: Json;
          id?: string;
          label?: string | null;
          provider?: string;
          status?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "integration_credentials_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      mfa_recovery_codes: {
        Row: {
          code_hash: string;
          created_at: string;
          id: number;
          used_at: string | null;
          user_id: string;
        };
        Insert: {
          code_hash: string;
          created_at?: string;
          id?: never;
          used_at?: string | null;
          user_id: string;
        };
        Update: {
          code_hash?: string;
          created_at?: string;
          id?: never;
          used_at?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      notification_digests: {
        Row: {
          enabled: boolean;
          form_id: string;
          last_sent_on: string | null;
          member_ids: string[];
          time_zone: string;
          updated_at: string;
          frequency: string;
        };
        Insert: {
          enabled?: boolean;
          form_id: string;
          last_sent_on?: string | null;
          member_ids: string[];
          time_zone?: string;
          updated_at?: string;
          frequency?: string;
        };
        Update: {
          enabled?: boolean;
          form_id?: string;
          last_sent_on?: string | null;
          member_ids?: string[];
          time_zone?: string;
          updated_at?: string;
          frequency?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notification_digests_form_id_fkey";
            columns: ["form_id"];
            isOneToOne: false;
            referencedRelation: "forms";
            referencedColumns: ["id"];
          },
        ];
      };
      notification_rules: {
        Row: {
          attach_document: string | null;
          condition: Json | null;
          created_at: string;
          enabled: boolean;
          form_id: string;
          id: string;
          include_answers: boolean;
          member_ids: string[];
          name: string;
          subject: string | null;
          updated_at: string;
        };
        Insert: {
          attach_document?: string | null;
          condition?: Json | null;
          created_at?: string;
          enabled?: boolean;
          form_id: string;
          id?: string;
          include_answers?: boolean;
          member_ids: string[];
          name: string;
          subject?: string | null;
          updated_at?: string;
        };
        Update: {
          attach_document?: string | null;
          condition?: Json | null;
          created_at?: string;
          enabled?: boolean;
          form_id?: string;
          id?: string;
          include_answers?: boolean;
          member_ids?: string[];
          name?: string;
          subject?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notification_rules_form_id_fkey";
            columns: ["form_id"];
            isOneToOne: false;
            referencedRelation: "forms";
            referencedColumns: ["id"];
          },
        ];
      };
      notification_settings: {
        Row: {
          created_at: string;
          enabled: boolean;
          form_id: string;
          id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          enabled?: boolean;
          form_id: string;
          id?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          enabled?: boolean;
          form_id?: string;
          id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notification_settings_form_id_fkey";
            columns: ["form_id"];
            isOneToOne: true;
            referencedRelation: "forms";
            referencedColumns: ["id"];
          },
        ];
      };
      payments: {
        Row: {
          amount: number;
          checkout_session_id: string | null;
          created_at: string;
          currency: string;
          form_id: string;
          livemode: boolean;
          paid_at: string | null;
          response_id: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          amount: number;
          checkout_session_id?: string | null;
          created_at?: string;
          currency: string;
          form_id: string;
          livemode?: boolean;
          paid_at?: string | null;
          response_id: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          amount?: number;
          checkout_session_id?: string | null;
          created_at?: string;
          currency?: string;
          form_id?: string;
          livemode?: boolean;
          paid_at?: string | null;
          response_id?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payments_form_id_fkey";
            columns: ["form_id"];
            isOneToOne: false;
            referencedRelation: "forms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_response_id_fkey";
            columns: ["response_id"];
            isOneToOne: true;
            referencedRelation: "responses";
            referencedColumns: ["id"];
          },
        ];
      };
      plans: {
        Row: {
          entitlements: Json;
          id: string;
          name: string;
          sort_order: number;
        };
        Insert: {
          entitlements?: Json;
          id: string;
          name: string;
          sort_order?: number;
        };
        Update: {
          entitlements?: Json;
          id?: string;
          name?: string;
          sort_order?: number;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          created_at: string;
          email: string;
          full_name: string | null;
          id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          email: string;
          full_name?: string | null;
          id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          email?: string;
          full_name?: string | null;
          id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      question_block_versions: {
        Row: {
          block_id: string;
          created_at: string;
          created_by: string | null;
          id: string;
          questions: Json;
          version: number;
        };
        Insert: {
          block_id: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          questions: Json;
          version: number;
        };
        Update: {
          block_id?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          questions?: Json;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "question_block_versions_block_id_fkey";
            columns: ["block_id"];
            isOneToOne: false;
            referencedRelation: "question_blocks";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "question_block_versions_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      question_blocks: {
        Row: {
          archived_at: string | null;
          created_at: string;
          created_by: string | null;
          current_version: number;
          description: string | null;
          id: string;
          name: string;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          archived_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          current_version?: number;
          description?: string | null;
          id?: string;
          name: string;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          archived_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          current_version?: number;
          description?: string | null;
          id?: string;
          name?: string;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "question_blocks_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "question_blocks_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      rate_limits: {
        Row: {
          count: number;
          key: string;
          window_start: string;
        };
        Insert: {
          count: number;
          key: string;
          window_start: string;
        };
        Update: {
          count?: number;
          key?: string;
          window_start?: string;
        };
        Relationships: [];
      };
      response_comments: {
        Row: {
          author_id: string | null;
          body: string;
          created_at: string;
          id: string;
          response_id: string;
        };
        Insert: {
          author_id?: string | null;
          body: string;
          created_at?: string;
          id?: string;
          response_id: string;
        };
        Update: {
          author_id?: string | null;
          body?: string;
          created_at?: string;
          id?: string;
          response_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "response_comments_author_id_fkey";
            columns: ["author_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "response_comments_response_id_fkey";
            columns: ["response_id"];
            isOneToOne: false;
            referencedRelation: "responses";
            referencedColumns: ["id"];
          },
        ];
      };
      response_documents: {
        Row: {
          document_id: string;
          emailed_at: string | null;
          id: string;
          issued_at: string;
          number: number;
          response_id: string;
        };
        Insert: {
          document_id: string;
          emailed_at?: string | null;
          id?: string;
          issued_at?: string;
          number: number;
          response_id: string;
        };
        Update: {
          document_id?: string;
          emailed_at?: string | null;
          id?: string;
          issued_at?: string;
          number?: number;
          response_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "response_documents_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "form_documents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "response_documents_response_id_fkey";
            columns: ["response_id"];
            isOneToOne: false;
            referencedRelation: "responses";
            referencedColumns: ["id"];
          },
        ];
      };
      response_events: {
        Row: {
          actor_id: string | null;
          created_at: string;
          detail: Json;
          id: number;
          kind: string;
          outcome: string;
          response_id: string;
        };
        Insert: {
          actor_id?: string | null;
          created_at?: string;
          detail?: Json;
          id?: number;
          kind: string;
          outcome?: string;
          response_id: string;
        };
        Update: {
          actor_id?: string | null;
          created_at?: string;
          detail?: Json;
          id?: number;
          kind?: string;
          outcome?: string;
          response_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "response_events_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "response_events_response_id_fkey";
            columns: ["response_id"];
            isOneToOne: false;
            referencedRelation: "responses";
            referencedColumns: ["id"];
          },
        ];
      };
      response_followups: {
        Row: {
          answer: string | null;
          answered_at: string | null;
          created_at: string;
          id: string;
          prompt: string;
          question_id: string;
          response_id: string;
        };
        Insert: {
          answer?: string | null;
          answered_at?: string | null;
          created_at?: string;
          id?: string;
          prompt: string;
          question_id: string;
          response_id: string;
        };
        Update: {
          answer?: string | null;
          answered_at?: string | null;
          created_at?: string;
          id?: string;
          prompt?: string;
          question_id?: string;
          response_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "response_followups_response_id_fkey";
            columns: ["response_id"];
            isOneToOne: false;
            referencedRelation: "responses";
            referencedColumns: ["id"];
          },
        ];
      };
      response_insights: {
        Row: {
          analyzed_at: string;
          form_id: string;
          lead_reason: string | null;
          lead_score: number | null;
          response_id: string;
          sentiment: string | null;
          tags: string[];
        };
        Insert: {
          analyzed_at?: string;
          form_id: string;
          lead_reason?: string | null;
          lead_score?: number | null;
          response_id: string;
          sentiment?: string | null;
          tags?: string[];
        };
        Update: {
          analyzed_at?: string;
          form_id?: string;
          lead_reason?: string | null;
          lead_score?: number | null;
          response_id?: string;
          sentiment?: string | null;
          tags?: string[];
        };
        Relationships: [
          {
            foreignKeyName: "response_insights_form_id_fkey";
            columns: ["form_id"];
            isOneToOne: false;
            referencedRelation: "forms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "response_insights_response_id_fkey";
            columns: ["response_id"];
            isOneToOne: true;
            referencedRelation: "responses";
            referencedColumns: ["id"];
          },
        ];
      };
      response_orders: {
        Row: {
          created_at: string;
          currency: string;
          form_id: string;
          lines: Json;
          response_id: string;
          total_amount: number;
        };
        Insert: {
          created_at?: string;
          currency: string;
          form_id: string;
          lines: Json;
          response_id: string;
          total_amount: number;
        };
        Update: {
          created_at?: string;
          currency?: string;
          form_id?: string;
          lines?: Json;
          response_id?: string;
          total_amount?: number;
        };
        Relationships: [
          {
            foreignKeyName: "response_orders_form_id_fkey";
            columns: ["form_id"];
            isOneToOne: false;
            referencedRelation: "forms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "response_orders_response_id_fkey";
            columns: ["response_id"];
            isOneToOne: true;
            referencedRelation: "responses";
            referencedColumns: ["id"];
          },
        ];
      };
      responses: {
        Row: {
          assignee_id: string | null;
          review_status: string;
          captcha_verified_at: string | null;
          client_revision: number;
          completed_at: string | null;
          created_at: string;
          embedded: boolean;
          ending_id: string | null;
          experiment_id: string | null;
          form_id: string;
          form_version_id: string;
          hidden_fields: Json;
          id: string;
          idempotency_key: string | null;
          is_preview: boolean;
          language: string | null;
          last_active_at: string;
          last_question_id: string | null;
          lookup_calls: number;
          random_seed: string | null;
          referrer: string | null;
          spam_suspected: boolean;
          started_at: string;
          status: Database["public"]["Enums"]["response_status"];
          utm_campaign: string | null;
          utm_content: string | null;
          utm_medium: string | null;
          utm_source: string | null;
          utm_term: string | null;
          visitor_id: string | null;
          variant_test_id: string | null;
          variant: string | null;
        };
        Insert: {
          assignee_id?: string | null;
          review_status?: string;
          captcha_verified_at?: string | null;
          client_revision?: number;
          completed_at?: string | null;
          created_at?: string;
          embedded?: boolean;
          ending_id?: string | null;
          experiment_id?: string | null;
          form_id: string;
          form_version_id: string;
          hidden_fields?: Json;
          id?: string;
          idempotency_key?: string | null;
          is_preview?: boolean;
          language?: string | null;
          last_active_at?: string;
          last_question_id?: string | null;
          lookup_calls?: number;
          random_seed?: string | null;
          referrer?: string | null;
          spam_suspected?: boolean;
          started_at?: string;
          status?: Database["public"]["Enums"]["response_status"];
          utm_campaign?: string | null;
          utm_content?: string | null;
          utm_medium?: string | null;
          utm_source?: string | null;
          utm_term?: string | null;
          visitor_id?: string | null;
          variant_test_id?: string | null;
          variant?: string | null;
        };
        Update: {
          assignee_id?: string | null;
          review_status?: string;
          captcha_verified_at?: string | null;
          client_revision?: number;
          completed_at?: string | null;
          created_at?: string;
          embedded?: boolean;
          ending_id?: string | null;
          experiment_id?: string | null;
          form_id?: string;
          form_version_id?: string;
          hidden_fields?: Json;
          id?: string;
          idempotency_key?: string | null;
          is_preview?: boolean;
          language?: string | null;
          last_active_at?: string;
          last_question_id?: string | null;
          lookup_calls?: number;
          random_seed?: string | null;
          referrer?: string | null;
          spam_suspected?: boolean;
          started_at?: string;
          status?: Database["public"]["Enums"]["response_status"];
          utm_campaign?: string | null;
          utm_content?: string | null;
          utm_medium?: string | null;
          utm_source?: string | null;
          utm_term?: string | null;
          visitor_id?: string | null;
          variant_test_id?: string | null;
          variant?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "responses_experiment_id_fkey";
            columns: ["experiment_id"];
            isOneToOne: false;
            referencedRelation: "experiments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "responses_form_id_fkey";
            columns: ["form_id"];
            isOneToOne: false;
            referencedRelation: "forms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "responses_form_version_id_fkey";
            columns: ["form_version_id"];
            isOneToOne: false;
            referencedRelation: "form_versions";
            referencedColumns: ["id"];
          },
        ];
      };
      resume_tokens: {
        Row: {
          created_at: string;
          expires_at: string;
          response_id: string;
          revoked_at: string | null;
          token_hash: string;
        };
        Insert: {
          created_at?: string;
          expires_at?: string;
          response_id: string;
          revoked_at?: string | null;
          token_hash: string;
        };
        Update: {
          created_at?: string;
          expires_at?: string;
          response_id?: string;
          revoked_at?: string | null;
          token_hash?: string;
        };
        Relationships: [
          {
            foreignKeyName: "resume_tokens_response_id_fkey";
            columns: ["response_id"];
            isOneToOne: false;
            referencedRelation: "responses";
            referencedColumns: ["id"];
          },
        ];
      };
      scim_tokens: {
        Row: {
          created_at: string;
          created_by: string | null;
          last_used_at: string | null;
          prefix: string;
          token_hash: string;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          last_used_at?: string | null;
          prefix: string;
          token_hash: string;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          last_used_at?: string | null;
          prefix?: string;
          token_hash?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "scim_tokens_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "scim_tokens_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: true;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      scim_users: {
        Row: {
          active: boolean;
          created_at: string;
          display_name: string | null;
          email: string;
          external_id: string | null;
          id: string;
          updated_at: string;
          user_id: string | null;
          workspace_id: string;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          display_name?: string | null;
          email: string;
          external_id?: string | null;
          id?: string;
          updated_at?: string;
          user_id?: string | null;
          workspace_id: string;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          display_name?: string | null;
          email?: string;
          external_id?: string | null;
          id?: string;
          updated_at?: string;
          user_id?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "scim_users_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "scim_users_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      sheets_connections: {
        Row: {
          created_at: string;
          enabled: boolean;
          encrypted_tokens: Json;
          form_id: string;
          id: string;
          spreadsheet_id: string | null;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          enabled?: boolean;
          encrypted_tokens: Json;
          form_id: string;
          id?: string;
          spreadsheet_id?: string | null;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          enabled?: boolean;
          encrypted_tokens?: Json;
          form_id?: string;
          id?: string;
          spreadsheet_id?: string | null;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sheets_connections_form_id_fkey";
            columns: ["form_id"];
            isOneToOne: true;
            referencedRelation: "forms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sheets_connections_form_workspace_fkey";
            columns: ["form_id", "workspace_id"];
            isOneToOne: false;
            referencedRelation: "forms";
            referencedColumns: ["id", "workspace_id"];
          },
          {
            foreignKeyName: "sheets_connections_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      sheets_sync_log: {
        Row: {
          attempt_count: number;
          connection_id: string;
          created_at: string;
          id: string;
          last_error: string | null;
          next_attempt_at: string;
          response_id: string | null;
          status: Database["public"]["Enums"]["sheets_sync_status"];
          updated_at: string;
        };
        Insert: {
          attempt_count?: number;
          connection_id: string;
          created_at?: string;
          id?: string;
          last_error?: string | null;
          next_attempt_at?: string;
          response_id?: string | null;
          status?: Database["public"]["Enums"]["sheets_sync_status"];
          updated_at?: string;
        };
        Update: {
          attempt_count?: number;
          connection_id?: string;
          created_at?: string;
          id?: string;
          last_error?: string | null;
          next_attempt_at?: string;
          response_id?: string | null;
          status?: Database["public"]["Enums"]["sheets_sync_status"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sheets_sync_log_connection_id_fkey";
            columns: ["connection_id"];
            isOneToOne: false;
            referencedRelation: "sheets_connections";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sheets_sync_log_response_id_fkey";
            columns: ["response_id"];
            isOneToOne: false;
            referencedRelation: "responses";
            referencedColumns: ["id"];
          },
        ];
      };
      templates: {
        Row: {
          category: string;
          created_at: string;
          description: string | null;
          id: string;
          schema: Json;
          sort_order: number;
          title: string;
          updated_at: string;
        };
        Insert: {
          category: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          schema: Json;
          sort_order?: number;
          title: string;
          updated_at?: string;
        };
        Update: {
          category?: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          schema?: Json;
          sort_order?: number;
          title?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      uploads: {
        Row: {
          created_at: string;
          id: string;
          mime_type: string;
          original_filename: string;
          question_id: string;
          response_id: string;
          size_bytes: number;
          status: Database["public"]["Enums"]["upload_status"];
          storage_path: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          mime_type: string;
          original_filename: string;
          question_id: string;
          response_id: string;
          size_bytes: number;
          status?: Database["public"]["Enums"]["upload_status"];
          storage_path: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          mime_type?: string;
          original_filename?: string;
          question_id?: string;
          response_id?: string;
          size_bytes?: number;
          status?: Database["public"]["Enums"]["upload_status"];
          storage_path?: string;
        };
        Relationships: [
          {
            foreignKeyName: "uploads_response_id_fkey";
            columns: ["response_id"];
            isOneToOne: false;
            referencedRelation: "responses";
            referencedColumns: ["id"];
          },
        ];
      };
      usage_counters: {
        Row: {
          metric: string;
          period_start: string;
          value: number;
          workspace_id: string;
        };
        Insert: {
          metric: string;
          period_start: string;
          value?: number;
          workspace_id: string;
        };
        Update: {
          metric?: string;
          period_start?: string;
          value?: number;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "usage_counters_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      variant_tests: {
        Row: {
          created_by: string | null;
          ended_at: string | null;
          form_id: string;
          id: string;
          name: string;
          split: number;
          started_at: string;
          status: "running" | "paused" | "ended";
          variant_id: string;
          winner: string | null;
        };
        Insert: {
          created_by?: string | null;
          ended_at?: string | null;
          form_id: string;
          id?: string;
          name: string;
          split: number;
          started_at?: string;
          status?: "running" | "paused" | "ended";
          variant_id: string;
          winner?: string | null;
        };
        Update: {
          created_by?: string | null;
          ended_at?: string | null;
          form_id?: string;
          id?: string;
          name?: string;
          split?: number;
          started_at?: string;
          status?: "running" | "paused" | "ended";
          variant_id?: string;
          winner?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "variant_tests_form_id_fkey";
            columns: ["form_id"];
            isOneToOne: false;
            referencedRelation: "forms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "variant_tests_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      visitor_profiles: {
        Row: {
          key: string;
          question_type: string;
          updated_at: string;
          value: Json;
          visitor_id: string;
          workspace_id: string;
        };
        Insert: {
          key: string;
          question_type: string;
          updated_at?: string;
          value: Json;
          visitor_id: string;
          workspace_id: string;
        };
        Update: {
          key?: string;
          question_type?: string;
          updated_at?: string;
          value?: Json;
          visitor_id?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "visitor_profiles_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      webhook_deliveries: {
        Row: {
          attempt_count: number;
          created_at: string;
          endpoint_id: string;
          event_id: string;
          event_type: string;
          id: string;
          last_error: string | null;
          next_attempt_at: string;
          payload: Json;
          response_id: string | null;
          status: Database["public"]["Enums"]["webhook_delivery_status"];
          updated_at: string;
        };
        Insert: {
          attempt_count?: number;
          created_at?: string;
          endpoint_id: string;
          event_id?: string;
          event_type: string;
          id?: string;
          last_error?: string | null;
          next_attempt_at?: string;
          payload: Json;
          response_id?: string | null;
          status?: Database["public"]["Enums"]["webhook_delivery_status"];
          updated_at?: string;
        };
        Update: {
          attempt_count?: number;
          created_at?: string;
          endpoint_id?: string;
          event_id?: string;
          event_type?: string;
          id?: string;
          last_error?: string | null;
          next_attempt_at?: string;
          payload?: Json;
          response_id?: string | null;
          status?: Database["public"]["Enums"]["webhook_delivery_status"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "webhook_deliveries_endpoint_id_fkey";
            columns: ["endpoint_id"];
            isOneToOne: false;
            referencedRelation: "webhook_endpoints";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "webhook_deliveries_response_id_fkey";
            columns: ["response_id"];
            isOneToOne: false;
            referencedRelation: "responses";
            referencedColumns: ["id"];
          },
        ];
      };
      webhook_endpoints: {
        Row: {
          api_key_id: string | null;
          config: Json;
          created_at: string;
          enabled: boolean;
          form_id: string;
          id: string;
          kind: string;
          signing_secret: string;
          updated_at: string;
          url: string;
        };
        Insert: {
          api_key_id?: string | null;
          config?: Json;
          created_at?: string;
          enabled?: boolean;
          form_id: string;
          id?: string;
          kind?: string;
          signing_secret: string;
          updated_at?: string;
          url: string;
        };
        Update: {
          api_key_id?: string | null;
          config?: Json;
          created_at?: string;
          enabled?: boolean;
          form_id?: string;
          id?: string;
          kind?: string;
          signing_secret?: string;
          updated_at?: string;
          url?: string;
        };
        Relationships: [
          {
            foreignKeyName: "webhook_endpoints_api_key_fk";
            columns: ["api_key_id"];
            isOneToOne: false;
            referencedRelation: "api_keys";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "webhook_endpoints_form_id_fkey";
            columns: ["form_id"];
            isOneToOne: false;
            referencedRelation: "forms";
            referencedColumns: ["id"];
          },
        ];
      };
      workspace_invitations: {
        Row: {
          accepted_at: string | null;
          created_at: string;
          email: string;
          expires_at: string;
          id: string;
          invited_by: string | null;
          revoked_at: string | null;
          role: string;
          token_hash: string;
          workspace_id: string;
        };
        Insert: {
          accepted_at?: string | null;
          created_at?: string;
          email: string;
          expires_at?: string;
          id?: string;
          invited_by?: string | null;
          revoked_at?: string | null;
          role: string;
          token_hash: string;
          workspace_id: string;
        };
        Update: {
          accepted_at?: string | null;
          created_at?: string;
          email?: string;
          expires_at?: string;
          id?: string;
          invited_by?: string | null;
          revoked_at?: string | null;
          role?: string;
          token_hash?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "workspace_invitations_invited_by_fkey";
            columns: ["invited_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "workspace_invitations_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      workspace_members: {
        Row: {
          created_at: string;
          id: string;
          permissions: Json;
          role: Database["public"]["Enums"]["workspace_role"];
          user_id: string;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          permissions?: Json;
          role?: Database["public"]["Enums"]["workspace_role"];
          user_id: string;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          permissions?: Json;
          role?: Database["public"]["Enums"]["workspace_role"];
          user_id?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "workspace_members_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "workspace_members_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      workspace_sso: {
        Row: {
          created_at: string;
          default_role: string;
          domain: string;
          enforced: boolean;
          provider_id: string;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          default_role?: string;
          domain: string;
          enforced?: boolean;
          provider_id: string;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          default_role?: string;
          domain?: string;
          enforced?: boolean;
          provider_id?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "workspace_sso_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: true;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      workspaces: {
        Row: {
          created_at: string;
          entitlement_overrides: Json;
          id: string;
          name: string;
          owner_id: string;
          plan_id: string;
          response_retention_days: number | null;
          slug: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          entitlement_overrides?: Json;
          id?: string;
          name: string;
          owner_id: string;
          plan_id?: string;
          response_retention_days?: number | null;
          slug: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          entitlement_overrides?: Json;
          id?: string;
          name?: string;
          owner_id?: string;
          plan_id?: string;
          response_retention_days?: number | null;
          slug?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "workspaces_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "workspaces_plan_id_fkey";
            columns: ["plan_id"];
            isOneToOne: false;
            referencedRelation: "plans";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      book_slot: {
        Args: {
          p_attendee_email: string;
          p_attendee_name: string;
          p_attendee_time_zone: string;
          p_booking_type_id: string;
          p_form_id: string;
          p_host_ids: string[];
          p_manage_token_hash: string;
          p_rescheduled_from?: string;
          p_response_id: string;
          p_starts_at: string;
        };
        Returns: { ends_at: string; host_id: string; id: string; starts_at: string }[];
      };
      can_admin_workspace: {
        Args: { target_workspace_id: string };
        Returns: boolean;
      };
      can_edit_workspace: {
        Args: { target_workspace_id: string };
        Returns: boolean;
      };
      claim_connector_jobs: {
        Args: { p_lease_seconds: number; p_limit: number };
        Returns: Database["public"]["Tables"]["connector_jobs"]["Row"][];
      };
      claim_due_sheets_syncs: {
        Args: { p_lease_seconds: number; p_limit: number };
        Returns: {
          attempt_count: number;
          connection_id: string;
          created_at: string;
          id: string;
          last_error: string | null;
          next_attempt_at: string;
          response_id: string | null;
          status: Database["public"]["Enums"]["sheets_sync_status"];
          updated_at: string;
        }[];
        SetofOptions: {
          from: "*";
          to: "sheets_sync_log";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      claim_due_webhook_deliveries: {
        Args: { p_lease_seconds: number; p_limit: number };
        Returns: {
          attempt_count: number;
          created_at: string;
          endpoint_id: string;
          event_id: string;
          event_type: string;
          id: string;
          last_error: string | null;
          next_attempt_at: string;
          payload: Json;
          response_id: string | null;
          status: Database["public"]["Enums"]["webhook_delivery_status"];
          updated_at: string;
        }[];
        SetofOptions: {
          from: "*";
          to: "webhook_deliveries";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      complete_response_atomic: {
        Args: {
          p_answers: Json;
          p_ending_id: string;
          p_idempotency_key: string;
          p_last_question_id: string;
          p_response_id: string;
          p_revision: number;
          p_spam?: boolean;
        };
        Returns: {
          ending_id: string;
          form_id: string;
          outcome: string;
        }[];
      };
      connector_status: {
        Args: { p_workspace_id: string };
        Returns: {
          created_at: string;
          id: string;
          label: string | null;
          provider: string;
          settings: Json;
          status: string;
          user_id: string | null;
        }[];
      };
      create_form_with_draft: {
        Args: {
          p_created_by?: string;
          p_schema: Json;
          p_slug: string;
          p_title: string;
          p_workspace_id: string;
        };
        Returns: string;
      };
      create_workspace_with_owner: {
        Args: { workspace_name: string; workspace_slug: string };
        Returns: {
          created_at: string;
          entitlement_overrides: Json;
          id: string;
          name: string;
          owner_id: string;
          plan_id: string;
          response_retention_days: number | null;
          slug: string;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "workspaces";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      experiment_stats: {
        Args: { target_experiment_id: string };
        Returns: {
          completed: number;
          form_id: string;
          started: number;
        }[];
      };
      has_permission: {
        Args: { permission: string; target_workspace_id: string };
        Returns: boolean;
      };
      hit_rate_limit: {
        Args: { p_key: string; p_limit: number; p_window_seconds: number };
        Returns: boolean;
      };
      increment_usage: {
        Args: { p_amount?: number; p_metric: string; p_workspace_id: string };
        Returns: number;
      };
      integration_status: {
        Args: { p_workspace_id: string };
        Returns: {
          created_at: string;
          label: string;
          provider: string;
          status: string;
        }[];
      };
      is_workspace_member: {
        Args: { target_workspace_id: string };
        Returns: boolean;
      };
      jwt_has_sso: { Args: { claims: Json }; Returns: boolean };
      issue_response_document: {
        Args: { p_document_id: string; p_response_id: string };
        Returns: {
          emailed_at: string | null;
          id: string;
          issued_at: string;
          number: number;
        }[];
      };
      list_leads: {
        Args: {
          p_form_id?: string;
          p_limit?: number;
          p_offset?: number;
          p_search?: string;
          p_workspace_id: string;
        };
        Returns: {
          captured_at: string;
          form_id: string;
          form_title: string;
          last_active_at: string;
          referrer: string;
          response_id: string;
          status: Database["public"]["Enums"]["response_status"];
          total_count: number;
          utm_source: string;
          value: Json;
        }[];
      };
      mfa_satisfied: { Args: never; Returns: boolean };
      publish_form_version: {
        Args: { compiled_schema: Json; target_form_id: string };
        Returns: {
          created_at: string;
          form_id: string;
          id: string;
          published_at: string | null;
          published_by: string | null;
          revision: number;
          schema: Json;
          status: Database["public"]["Enums"]["form_version_status"];
          updated_at: string;
          version_number: number;
        };
        SetofOptions: {
          from: "*";
          to: "form_versions";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      publish_question_block_version: {
        Args: { p_block_id: string; p_questions: Json };
        Returns: number;
      };
      resolve_custom_domain: {
        Args: { p_hostname: string };
        Returns: {
          default_slug: string;
          domain_id: string;
        }[];
      };
      response_dropoff: {
        Args: { idle_minutes: number; target_form_id: string };
        Returns: {
          question_id: string;
          stopped: number;
        }[];
      };
      response_is_confidential: {
        Args: { p_form_id: string };
        Returns: boolean;
      };
      response_reach: {
        Args: { since?: string; target_form_id: string };
        Returns: {
          last_question_id: string;
          responses: number;
          status: string;
        }[];
      };
      response_source_conversion: {
        Args: { since?: string; target_form_id: string };
        Returns: {
          completed: number;
          source: string;
          started: number;
        }[];
      };
      responses_by_email: {
        Args: { p_email: string; p_workspace_id: string };
        Returns: {
          completed_at: string;
          form_id: string;
          form_title: string;
          response_id: string;
          started_at: string;
          status: Database["public"]["Enums"]["response_status"];
        }[];
      };
      responses_missing_sheets_sync: {
        Args: { p_limit: number };
        Returns: {
          connection_id: string;
          response_id: string;
        }[];
      };
      responses_missing_webhook_delivery: {
        Args: { p_limit: number };
        Returns: {
          endpoint_id: string;
          response_id: string;
        }[];
      };
      save_response_progress: {
        Args: {
          p_answers: Json;
          p_has_answer: boolean;
          p_last_question_id: string;
          p_response_id: string;
          p_revision: number;
        };
        Returns: {
          client_revision: number;
          outcome: string;
          status: Database["public"]["Enums"]["response_status"];
        }[];
      };
      scim_status: {
        Args: { p_workspace_id: string };
        Returns: {
          created_at: string;
          last_used_at: string;
          prefix: string;
        }[];
      };
      shares_workspace_with: {
        Args: { target_user_id: string };
        Returns: boolean;
      };
      sso_satisfied: { Args: { target_workspace_id: string }; Returns: boolean };
      unpublish_form: { Args: { target_form_id: string }; Returns: undefined };
      workspace_role_for: {
        Args: { target_workspace_id: string };
        Returns: Database["public"]["Enums"]["workspace_role"];
      };
      workspaces_requiring_sso: { Args: never; Returns: number };
    };
    Enums: {
      form_version_status: "draft" | "published" | "archived";
      response_status: "in_progress" | "partial" | "completed";
      sheets_sync_status: "pending" | "succeeded" | "failed" | "exhausted";
      upload_status: "pending" | "clean" | "quarantined" | "deleted";
      webhook_delivery_status: "pending" | "succeeded" | "failed" | "exhausted";
      workspace_role: "owner" | "editor" | "admin" | "viewer";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      form_version_status: ["draft", "published", "archived"],
      response_status: ["in_progress", "partial", "completed"],
      sheets_sync_status: ["pending", "succeeded", "failed", "exhausted"],
      upload_status: ["pending", "clean", "quarantined", "deleted"],
      webhook_delivery_status: ["pending", "succeeded", "failed", "exhausted"],
      workspace_role: ["owner", "editor", "admin", "viewer"],
    },
  },
} as const;
