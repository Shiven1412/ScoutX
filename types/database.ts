export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type Table<Row, Insert = Partial<Row>, Update = Partial<Insert>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export interface Database {
  public: {
    Tables: {
      users: Table<{ id: string; email: string; display_name: string; created_at: string; updated_at: string }>;
      profiles: Table<{ id: string; full_name: string | null; company: string | null; industry: string | null; avatar_url: string | null; is_platform_admin: boolean; created_at: string; updated_at: string }>;
      organizations: Table<{ id: string; name: string; slug: string; industry: string | null; created_by: string; created_at: string; updated_at: string; deleted_at: string | null }>;
      organization_members: Table<{ id: string; organization_id: string; user_id: string; role: "owner" | "admin" | "member"; status: "active" | "invited"; invited_at: string | null; joined_at: string | null; created_at: string }>;
      keyword_trackers: Table<{ id: string; organization_id: string; created_by: string; keyword: string; negative_keywords: string[]; communities: string[]; platforms: string[]; alert_threshold: number; status: "active" | "paused"; deleted_at: string | null; created_at: string; updated_at: string }>;
      tracker_profiles: Table<{ id: string; organization_id: string; tracker_id: string; business_description: string; business_summary: string; industry: string; target_audience: string[]; pain_points: string[]; generated_at: string; model: string; prompt_version: string; created_at: string }>;
      tracker_keywords: Table<{ id: string; organization_id: string; tracker_id: string; keyword_type: "product" | "intent" | "negative"; keyword: string; created_at: string }>;
      tracker_competitors: Table<{ id: string; organization_id: string; tracker_id: string; name: string; created_at: string }>;
      tracker_sources: Table<{ id: string; organization_id: string; tracker_id: string; source_type: "subreddit" | "community" | "website"; provider: "reddit" | "firecrawl" | "serper"; source_value: string; created_at: string }>;
      tracker_queries: Table<{ id: string; organization_id: string; tracker_id: string; query: string; created_at: string }>;
      tracker_signals: Table<{ id: string; organization_id: string; tracker_id: string; signal_type: "buying_signal" | "outreach_angle"; signal: string; created_at: string }>;
      tracker_runs: Table<{ id: string; organization_id: string; tracker_id: string; status: "queued" | "running" | "completed" | "partial" | "failed"; progress: number; signals_found: number; providers_total: number; providers_completed: number; last_error: string | null; started_at: string | null; completed_at: string | null; created_at: string }>;
      tracker_events: Table<{ id: string; organization_id: string; tracker_id: string; run_id: string | null; event_type: string; title: string; details: Json; created_at: string }>;
      intent_signals: Table<{ id: string; organization_id: string; tracker_id: string | null; platform: string; external_id: string; keyword: string; prospect_name: string | null; company: string | null; source_url: string | null; post_snippet: string; intent_score: number; confidence: number; category: "pain_point" | "seeking_alternative" | "feature_request" | "buying_intent" | "recommendation_request"; pain_intensity: number; buying_probability: number; urgency: number; decision_maker_likelihood: number; budget_intent: number; raw_payload: Json; provider: string | null; community: string | null; content_hash: string | null; created_at: string }>;
      leads: Table<{ id: string; organization_id: string; created_by: string; intent_signal_id: string | null; hubspot_contact_id: string | null; name: string; company: string; title: string | null; email: string | null; platform: string | null; source_post: string | null; status: "new" | "contacted" | "replied" | "meeting" | "converted" | "disqualified"; estimated_value: number | null; notes: string; deleted_at: string | null; created_at: string; updated_at: string }>;
      outreach_messages: Table<{ id: string; organization_id: string; lead_id: string | null; created_by: string; channel: "email" | "linkedin"; subject: string; content: string; status: "draft" | "approved" | "sent" | "failed"; generation_metadata: Json; approved_at: string | null; sent_at: string | null; deleted_at: string | null; created_at: string; updated_at: string }>;
      outreach_versions: Table<{ id: string; organization_id: string; outreach_message_id: string; version: number; subject: string; content: string; generation_metadata: Json; changed_by: string; created_at: string }>;
      notifications: Table<{ id: string; organization_id: string; user_id: string; kind: string; title: string; body: string; href: string | null; read_at: string | null; created_at: string }>;
      integrations: Table<{ id: string; organization_id: string; provider: string; connected: boolean; sync_status: "healthy" | "syncing" | "error"; last_sync_at: string | null; configuration: Json; created_at: string; updated_at: string }>;
      subscriptions: Table<{ id: string; organization_id: string; plan: "starter" | "growth" | "agency"; status: "trialing" | "active" | "past_due" | "canceled"; seats_used: number; ai_credits_total: number; ai_credits_used: number; signals_total: number; signals_used: number; current_period_start: string; current_period_end: string; stripe_customer_id: string | null; stripe_subscription_id: string | null; payment_provider: "stripe" | "razorpay" | null; razorpay_customer_id: string | null; razorpay_subscription_id: string | null; created_at: string; updated_at: string }>;
      subscription_history: Table<{ id: string; organization_id: string; archived_subscription: Json; archived_at: string }>;
      usage_records: Table<{ id: string; organization_id: string; tracked_date: string; signals_used: number; ai_credits_used: number; seats_used: number; created_at: string }>;
      audit_logs: Table<{ id: string; organization_id: string | null; actor_id: string | null; action: string; resource_type: string; resource_id: string | null; metadata: Json; ip_address: string | null; created_at: string }>;
      activity_logs: Table<{ id: string; organization_id: string; user_id: string | null; action: string; entity_type: string; entity_id: string | null; metadata: Json; created_at: string }>;
      api_keys: Table<{ id: string; organization_id: string; created_by: string; name: string; key_prefix: string; key_hash: string; scopes: string[]; last_used_at: string | null; expires_at: string | null; revoked_at: string | null; created_at: string }>;
      webhooks: Table<{ id: string; organization_id: string; created_by: string; name: string; endpoint_url: string; secret_encrypted: string; events: string[]; active: boolean; last_delivered_at: string | null; created_at: string; updated_at: string }>;
      feature_flags: Table<{ id: string; key: string; description: string; enabled: boolean; created_at: string; updated_at: string }>;
      stripe_events: Table<{ id: string; event_id: string; event_type: string; payload_hash: string; received_at: string; processed_at: string | null }>;
      payment_customers: Table<{ id: string; organization_id: string; provider: "stripe" | "razorpay"; external_customer_id: string; created_at: string; updated_at: string }>;
      billing_events: Table<{ id: string; provider: "stripe" | "razorpay"; event_id: string; event_type: string; payload_hash: string; received_at: string; processed_at: string | null; claimed_at: string | null; attempts: number; last_error: string | null }>;
      invoices: Table<{ id: string; organization_id: string; provider: "stripe" | "razorpay"; external_invoice_id: string; status: string; currency: string; amount_due: number; amount_paid: number; invoice_url: string | null; period_start: string | null; period_end: string | null; created_at: string }>;
      cron_job_runs: Table<{ id: string; job_name: string; status: "running" | "completed" | "failed"; started_at: string; completed_at: string | null; processed_count: number; error_message: string | null }>;
      analytics_daily: Table<{ organization_id: string; report_date: string; signal_count: number; lead_count: number; reply_count: number; conversion_count: number; aggregated_at: string }>;
        provider_status: Table<{ organization_id: string; provider: "gemini" | "razorpay" | "reddit" | "firecrawl" | "serper" | "apify" | "rss" | "hackernews"; connected: boolean; sync_status: "healthy" | "syncing" | "error"; last_sync_at: string | null; updated_at: string }>;
      ai_rate_limits: Table<{ organization_id: string; window_started_at: string; request_count: number }>;
      api_rate_limits: Table<{ api_key_id: string; window_started_at: string; request_count: number }>;
      storage_objects: Table<{ id: string; name: string; bucket_id: string; owner_id: string | null; created_at: string; updated_at: string; metadata: Json }>;
    };
    Views: Record<string, never>;
    Functions: {
      create_workspace: { Args: { target_name: string; target_industry: string | null; target_slug: string; target_keywords: string[] }; Returns: string };
      create_ai_tracker: { Args: { target_org: string; target_profile: Json }; Returns: string };
      create_ai_tracker_with_run: { Args: { target_org: string; target_profile: Json; target_sources: string[] }; Returns: { tracker_id: string; run_id: string }[] };
      create_manual_tracker_with_run: { Args: { target_org: string; target_keyword: string; target_keywords: string[]; target_intent_keywords: string[]; target_negative_keywords: string[]; target_communities: string[]; target_sources: string[]; target_websites: string[]; target_queries: string[]; target_alert_threshold: number }; Returns: { tracker_id: string; run_id: string }[] };
      update_manual_tracker: { Args: { target_org: string; target_tracker: string; target_keyword: string; target_keywords: string[]; target_intent_keywords: string[]; target_negative_keywords: string[]; target_communities: string[]; target_sources: string[]; target_websites: string[]; target_queries: string[]; target_alert_threshold: number }; Returns: boolean };
      create_tracker_run: { Args: { target_org: string; target_tracker: string }; Returns: string };
      consume_ai_rate_limit: { Args: { target_org: string; max_requests?: number }; Returns: boolean };
      aggregate_daily_analytics: { Args: { target_day: string }; Returns: number };
      is_org_member: { Args: { target_org: string }; Returns: boolean };
      has_org_role: { Args: { target_org: string; allowed_roles: string[] }; Returns: boolean };
      record_usage: { Args: { target_org: string; usage_kind: string; amount: number }; Returns: undefined };
      accept_organization_invitation: { Args: { target_org: string }; Returns: undefined };
      consume_api_key_rate_limit: { Args: { target_key: string; max_requests?: number }; Returns: boolean };
      ingest_signals: { Args: { target_org: string; signal_rows: Json }; Returns: number };
      consume_ai_credit: { Args: { target_org: string; amount?: number }; Returns: undefined };
      get_workspace_analytics: { Args: { target_org: string; start_date: string; end_date: string }; Returns: { day: string; signal_count: number; lead_count: number; reply_count: number; conversion_count: number }[] };
      get_signal_source_counts: { Args: { target_org: string; start_date: string }; Returns: { platform: string; signal_count: number }[] };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
