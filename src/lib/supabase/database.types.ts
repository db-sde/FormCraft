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
          updated_at: string;
          value: Json;
        };
        Insert: {
          id?: string;
          question_id: string;
          response_id: string;
          updated_at?: string;
          value: Json;
        };
        Update: {
          id?: string;
          question_id?: string;
          response_id?: string;
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
      form_versions: {
        Row: {
          created_at: string;
          form_id: string;
          id: string;
          published_at: string | null;
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
        ];
      };
      forms: {
        Row: {
          created_at: string;
          created_by: string;
          deleted_at: string | null;
          description: string | null;
          id: string;
          slug: string;
          title: string;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          deleted_at?: string | null;
          description?: string | null;
          id?: string;
          slug: string;
          title: string;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          deleted_at?: string | null;
          description?: string | null;
          id?: string;
          slug?: string;
          title?: string;
          updated_at?: string;
          workspace_id?: string;
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
            foreignKeyName: "forms_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
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
      responses: {
        Row: {
          client_revision: number;
          completed_at: string | null;
          created_at: string;
          ending_id: string | null;
          form_id: string;
          form_version_id: string;
          id: string;
          idempotency_key: string | null;
          is_preview: boolean;
          last_active_at: string;
          last_question_id: string | null;
          referrer: string | null;
          started_at: string;
          status: Database["public"]["Enums"]["response_status"];
          utm_campaign: string | null;
          utm_medium: string | null;
          utm_source: string | null;
        };
        Insert: {
          client_revision?: number;
          completed_at?: string | null;
          created_at?: string;
          ending_id?: string | null;
          form_id: string;
          form_version_id: string;
          id?: string;
          idempotency_key?: string | null;
          is_preview?: boolean;
          last_active_at?: string;
          last_question_id?: string | null;
          referrer?: string | null;
          started_at?: string;
          status?: Database["public"]["Enums"]["response_status"];
          utm_campaign?: string | null;
          utm_medium?: string | null;
          utm_source?: string | null;
        };
        Update: {
          client_revision?: number;
          completed_at?: string | null;
          created_at?: string;
          ending_id?: string | null;
          form_id?: string;
          form_version_id?: string;
          id?: string;
          idempotency_key?: string | null;
          is_preview?: boolean;
          last_active_at?: string;
          last_question_id?: string | null;
          referrer?: string | null;
          started_at?: string;
          status?: Database["public"]["Enums"]["response_status"];
          utm_campaign?: string | null;
          utm_medium?: string | null;
          utm_source?: string | null;
        };
        Relationships: [
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
          created_at: string;
          enabled: boolean;
          form_id: string;
          id: string;
          signing_secret: string;
          updated_at: string;
          url: string;
        };
        Insert: {
          created_at?: string;
          enabled?: boolean;
          form_id: string;
          id?: string;
          signing_secret: string;
          updated_at?: string;
          url: string;
        };
        Update: {
          created_at?: string;
          enabled?: boolean;
          form_id?: string;
          id?: string;
          signing_secret?: string;
          updated_at?: string;
          url?: string;
        };
        Relationships: [
          {
            foreignKeyName: "webhook_endpoints_form_id_fkey";
            columns: ["form_id"];
            isOneToOne: false;
            referencedRelation: "forms";
            referencedColumns: ["id"];
          },
        ];
      };
      workspace_members: {
        Row: {
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["workspace_role"];
          user_id: string;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["workspace_role"];
          user_id: string;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
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
      workspaces: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          owner_id: string;
          slug: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          owner_id: string;
          slug: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          owner_id?: string;
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
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      create_workspace_with_owner: {
        Args: { workspace_name: string; workspace_slug: string };
        Returns: {
          created_at: string;
          id: string;
          name: string;
          owner_id: string;
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
      is_workspace_member: {
        Args: { target_workspace_id: string };
        Returns: boolean;
      };
      publish_form_version: {
        Args: { compiled_schema: Json; target_form_id: string };
        Returns: {
          created_at: string;
          form_id: string;
          id: string;
          published_at: string | null;
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
      workspace_role_for: {
        Args: { target_workspace_id: string };
        Returns: Database["public"]["Enums"]["workspace_role"];
      };
    };
    Enums: {
      form_version_status: "draft" | "published" | "archived";
      response_status: "in_progress" | "partial" | "completed";
      sheets_sync_status: "pending" | "succeeded" | "failed" | "exhausted";
      upload_status: "pending" | "clean" | "quarantined" | "deleted";
      webhook_delivery_status: "pending" | "succeeded" | "failed" | "exhausted";
      workspace_role: "owner" | "editor";
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
      workspace_role: ["owner", "editor"],
    },
  },
} as const;
