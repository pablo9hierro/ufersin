-- Achado real (VRTECH-BUG P0): tabelas do modulo eletronicos abaixo
-- foram criadas manualmente em producao (Supabase) em algum momento
-- passado, fora do fluxo de migration -- nenhuma migration versionada
-- ate 0046 as cria. Um Postgres vazio nunca conseguia terminar o boot:
-- 'sqlx::migrate!' quebrava na migration 32 (INSERT em
-- eletronicos.device_types, que nao existia) e, corrigido isso, quebraria
-- de novo mais adiante (assistant_config na 0028, agenda_settings/
-- whatsapp_templates na 0039, etc). Shape das colunas abaixo foi extraido
-- via pg_dump --schema-only (so leitura) direto do Supabase de producao
-- (role loja_svc2, projeto migkkrwzykpztrakbfij), pra bater exatamente
-- com o que ja roda de verdade.
--
-- Versionada como 0000 (antes de tudo) de proposito: todas as outras
-- 46 ja foram aplicadas em producao com checksum fixo (nao da pra
-- renumerar sem quebrar o boot de producao), entao essa e a unica versao
-- livre que ordena antes da 0028 (primeiro ALTER que exige essas
-- tabelas). Roda antes da 0005_tenancy.sql (cria 'tenants'), por isso as
-- colunas tenant_id aqui NAO tem FK pra tenants -- mesmo padrao de
--'nao vaza porque o backend so conecta como dono e filtra tenant_id na
-- mao' documentado na 0035_eletronicos_rls.sql. 100% idempotente: em
-- producao (tabelas/constraints ja existem) tudo aqui e no-op.

CREATE SCHEMA IF NOT EXISTS eletronicos;

-- eletronicos.shipping_settings tambem sofre do mesmo achado, mas parcial:
-- 0029_eletronicos_shipping_settings.sql ja cria a tabela (por isso nao
-- entra na lista de "phantom" acima), so que com um shape DIFERENTE do
-- real -- faltando a coluna `id` (era a PK original, integer, default
-- literal 1, sem sequence de verdade ainda). Pre-criar aqui com o shape
-- pre-0029 (sem UNIQUE em tenant_id, sem RLS/policy, sem sequence) deixa
-- 0029/0030/0031 rodarem exatamente como rodaram em producao: 0029 vira
-- no-op na CREATE TABLE mas ainda liga RLS/cria a policy, 0030 adiciona o
-- UNIQUE pela primeira vez, 0031 cria a sequence e troca o default.
CREATE TABLE IF NOT EXISTS eletronicos.shipping_settings (
    id integer PRIMARY KEY DEFAULT 1,
    price_per_km double precision NOT NULL DEFAULT 2.0,
    store_lat double precision NOT NULL DEFAULT -7.1195,
    store_lng double precision NOT NULL DEFAULT -34.8450,
    max_km double precision,
    store_address text,
    cobrar_coleta boolean NOT NULL DEFAULT true,
    cobrar_entrega boolean NOT NULL DEFAULT true,
    minutes_per_km numeric NOT NULL DEFAULT 3,
    tenant_id text NOT NULL DEFAULT 'c585d2f2-b29e-4040-998e-e16bc45f6898'
);

CREATE TABLE IF NOT EXISTS eletronicos.agenda_blocks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by text DEFAULT 'admin'::text NOT NULL,
    tenant_id text DEFAULT 'c585d2f2-b29e-4040-998e-e16bc45f6898'::text NOT NULL
);

CREATE TABLE IF NOT EXISTS eletronicos.agenda_business_hours (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    weekday integer NOT NULL,
    open_time time without time zone NOT NULL,
    close_time time without time zone NOT NULL,
    tenant_id text DEFAULT 'c585d2f2-b29e-4040-998e-e16bc45f6898'::text NOT NULL
);

CREATE TABLE IF NOT EXISTS eletronicos.agenda_settings (
    id text DEFAULT 'default'::text NOT NULL,
    appointment_ai_enabled boolean DEFAULT false NOT NULL,
    default_duration_minutes integer DEFAULT 60 NOT NULL,
    lead_time_minutes integer DEFAULT 30 NOT NULL,
    max_advance_days integer DEFAULT 1 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    buffer_minutes integer DEFAULT 0 NOT NULL,
    tenant_id text DEFAULT 'c585d2f2-b29e-4040-998e-e16bc45f6898'::text NOT NULL
);

CREATE TABLE IF NOT EXISTS eletronicos.ai_model_configs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider text NOT NULL,
    model_id text NOT NULL,
    api_key text NOT NULL,
    label text,
    priority integer DEFAULT 0 NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    last_used_at timestamp with time zone,
    last_failure_at timestamp with time zone,
    last_failure_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    tenant_id text DEFAULT 'c585d2f2-b29e-4040-998e-e16bc45f6898'::text NOT NULL
);

CREATE TABLE IF NOT EXISTS eletronicos.appointment_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    appointment_id uuid NOT NULL,
    action text NOT NULL,
    actor_type text NOT NULL,
    actor_id text,
    justification text,
    previous_starts_at timestamp with time zone,
    previous_ends_at timestamp with time zone,
    new_starts_at timestamp with time zone,
    new_ends_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    tenant_id text DEFAULT 'c585d2f2-b29e-4040-998e-e16bc45f6898'::text NOT NULL
);

CREATE TABLE IF NOT EXISTS eletronicos.appointments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    service_id uuid,
    service_label text NOT NULL,
    customer_name text NOT NULL,
    customer_phone text NOT NULL,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    status text DEFAULT 'agendado'::text NOT NULL,
    notes text,
    created_by text DEFAULT 'assistente'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    appointment_type text DEFAULT 'service'::text NOT NULL,
    service_request_id uuid,
    tenant_id text DEFAULT 'c585d2f2-b29e-4040-998e-e16bc45f6898'::text NOT NULL
);

CREATE TABLE IF NOT EXISTS eletronicos.assistant_config (
    id text DEFAULT 'default'::text NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    prompt_interpreter text DEFAULT ''::text NOT NULL,
    prompt_validator text DEFAULT ''::text NOT NULL,
    start_keywords text[] DEFAULT ARRAY['oi'::text, 'olá'::text, 'ola'::text, 'atendimento'::text, 'quero comprar'::text, 'pedido'::text] NOT NULL,
    end_keywords text[] DEFAULT ARRAY['tchau'::text, 'encerrar'::text] NOT NULL,
    window_timeout_minutes integer DEFAULT 30 NOT NULL,
    message_batch_window_seconds integer DEFAULT 8 NOT NULL,
    min_response_chars integer DEFAULT 150 NOT NULL,
    max_response_chars integer DEFAULT 300 NOT NULL,
    ai_provider text DEFAULT 'openai'::text NOT NULL,
    ai_model text DEFAULT 'gpt-4o-mini'::text NOT NULL,
    api_key text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    tenant_id text DEFAULT 'c585d2f2-b29e-4040-998e-e16bc45f6898'::text NOT NULL
);

CREATE TABLE IF NOT EXISTS eletronicos.assistant_conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    phone text NOT NULL,
    customer_name text,
    status text DEFAULT 'aberta'::text NOT NULL,
    human_override boolean DEFAULT false NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    last_message_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone,
    customer_typing_until timestamp with time zone,
    lojista_typing_until timestamp with time zone,
    is_test boolean DEFAULT false NOT NULL,
    tenant_id text DEFAULT 'c585d2f2-b29e-4040-998e-e16bc45f6898'::text NOT NULL
);

CREATE TABLE IF NOT EXISTS eletronicos.assistant_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    direction text NOT NULL,
    sender_type text NOT NULL,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    tenant_id text DEFAULT 'c585d2f2-b29e-4040-998e-e16bc45f6898'::text NOT NULL
);

CREATE TABLE IF NOT EXISTS eletronicos.assistant_rag_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    filename text NOT NULL,
    content text NOT NULL,
    char_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    tenant_id text DEFAULT 'c585d2f2-b29e-4040-998e-e16bc45f6898'::text NOT NULL
);

CREATE TABLE IF NOT EXISTS eletronicos.catalog_models (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    brand_id uuid NOT NULL,
    name text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    tenant_id text DEFAULT 'c585d2f2-b29e-4040-998e-e16bc45f6898'::text NOT NULL
);

CREATE TABLE IF NOT EXISTS eletronicos.consultation_otps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    phone_digits text NOT NULL,
    code text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    attempts integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 5 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    tenant_id text DEFAULT 'c585d2f2-b29e-4040-998e-e16bc45f6898'::text NOT NULL
);

CREATE TABLE IF NOT EXISTS eletronicos.device_types (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    icon_key text DEFAULT 'generic'::text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    tenant_id text DEFAULT 'c585d2f2-b29e-4040-998e-e16bc45f6898'::text NOT NULL
);

CREATE TABLE IF NOT EXISTS eletronicos.driver_location (
    id text DEFAULT 'default'::text NOT NULL,
    lat double precision NOT NULL,
    lng double precision NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    tenant_id text DEFAULT 'c585d2f2-b29e-4040-998e-e16bc45f6898'::text NOT NULL
);

CREATE TABLE IF NOT EXISTS eletronicos.neighborhood_shipping_rates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    neighborhood text NOT NULL,
    price numeric DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    tenant_id text DEFAULT 'c585d2f2-b29e-4040-998e-e16bc45f6898'::text NOT NULL
);

CREATE TABLE IF NOT EXISTS eletronicos.pdv_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sale_id uuid NOT NULL,
    method text NOT NULL,
    amount numeric NOT NULL,
    status text DEFAULT 'pendente'::text NOT NULL,
    installments integer,
    change_amount numeric,
    mp_payment_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    confirmed_at timestamp with time zone,
    tenant_id text DEFAULT 'c585d2f2-b29e-4040-998e-e16bc45f6898'::text NOT NULL
);

CREATE TABLE IF NOT EXISTS eletronicos.pdv_sale_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sale_id uuid NOT NULL,
    item_type text NOT NULL,
    product_id uuid,
    service_id uuid,
    label text NOT NULL,
    quantity numeric DEFAULT 1 NOT NULL,
    unit_price numeric NOT NULL,
    service_request_id uuid,
    stock_deducted boolean DEFAULT false NOT NULL,
    requested_scheduled_at timestamp with time zone,
    appointment_id uuid,
    tenant_id text DEFAULT 'c585d2f2-b29e-4040-998e-e16bc45f6898'::text NOT NULL
);

CREATE TABLE IF NOT EXISTS eletronicos.pdv_sales (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    status text DEFAULT 'aberta'::text NOT NULL,
    total_value numeric DEFAULT 0 NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    concluded_at timestamp with time zone,
    tenant_id text DEFAULT 'c585d2f2-b29e-4040-998e-e16bc45f6898'::text NOT NULL
);

CREATE TABLE IF NOT EXISTS eletronicos.product_brands (
    product_id uuid NOT NULL,
    brand_id uuid NOT NULL,
    tenant_id text DEFAULT 'c585d2f2-b29e-4040-998e-e16bc45f6898'::text NOT NULL
);

CREATE TABLE IF NOT EXISTS eletronicos.product_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    tenant_id text DEFAULT 'c585d2f2-b29e-4040-998e-e16bc45f6898'::text NOT NULL
);

CREATE TABLE IF NOT EXISTS eletronicos.product_devices (
    product_id uuid NOT NULL,
    device_type_id uuid NOT NULL,
    tenant_id text DEFAULT 'c585d2f2-b29e-4040-998e-e16bc45f6898'::text NOT NULL
);

CREATE TABLE IF NOT EXISTS eletronicos.product_models (
    product_id uuid NOT NULL,
    model_id uuid NOT NULL,
    tenant_id text DEFAULT 'c585d2f2-b29e-4040-998e-e16bc45f6898'::text NOT NULL
);

CREATE TABLE IF NOT EXISTS eletronicos.products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text,
    price numeric DEFAULT 0 NOT NULL,
    quantity numeric DEFAULT 0 NOT NULL,
    category_id uuid,
    image_url text,
    image_urls text[] DEFAULT '{}'::text[] NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    phone_brand text,
    phone_model text,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    low_stock_threshold numeric,
    tenant_id text DEFAULT 'c585d2f2-b29e-4040-998e-e16bc45f6898'::text NOT NULL
);

CREATE TABLE IF NOT EXISTS eletronicos.service_catalog_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    image_url text,
    device_type text DEFAULT 'celular'::text NOT NULL,
    device_type_id uuid,
    tenant_id text DEFAULT 'c585d2f2-b29e-4040-998e-e16bc45f6898'::text NOT NULL
);

CREATE TABLE IF NOT EXISTS eletronicos.service_catalog_item_extra_costs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    service_catalog_item_id uuid NOT NULL,
    name text NOT NULL,
    value numeric NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    tenant_id text DEFAULT 'c585d2f2-b29e-4040-998e-e16bc45f6898'::text NOT NULL
);

CREATE TABLE IF NOT EXISTS eletronicos.service_catalog_item_parts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    service_catalog_item_id uuid NOT NULL,
    stock_item_id uuid NOT NULL,
    quantity numeric DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    tenant_id text DEFAULT 'c585d2f2-b29e-4040-998e-e16bc45f6898'::text NOT NULL,
    unit text DEFAULT 'unidade'::text NOT NULL,
    CONSTRAINT service_catalog_item_parts_unit_check CHECK ((unit = ANY (ARRAY['unidade'::text, 'caixa'::text, 'par'::text, 'pacote'::text, 'rolo'::text, 'g'::text, 'kg'::text, 'ml'::text, 'l'::text, 'cm'::text, 'm'::text])))
);

CREATE TABLE IF NOT EXISTS eletronicos.service_catalog_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    category_id uuid NOT NULL,
    model_name text,
    repair_type text NOT NULL,
    price numeric DEFAULT 0 NOT NULL,
    description text,
    sort_order integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    image_url text,
    duration_minutes integer DEFAULT 60 NOT NULL,
    cost_price numeric DEFAULT 0 NOT NULL,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    tenant_id text DEFAULT 'c585d2f2-b29e-4040-998e-e16bc45f6898'::text NOT NULL
);

CREATE TABLE IF NOT EXISTS eletronicos.service_diagnostics (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    service_request_id uuid NOT NULL,
    services_selected jsonb DEFAULT '[]'::jsonb NOT NULL,
    notes text,
    pdf_url text,
    quote_confirmed numeric(10,2),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    media_urls text[] DEFAULT '{}'::text[] NOT NULL,
    finalized boolean DEFAULT true NOT NULL,
    tenant_id text DEFAULT 'c585d2f2-b29e-4040-998e-e16bc45f6898'::text NOT NULL
);

CREATE TABLE IF NOT EXISTS eletronicos.service_item_brands (
    service_catalog_item_id uuid NOT NULL,
    brand_id uuid NOT NULL,
    tenant_id text DEFAULT 'c585d2f2-b29e-4040-998e-e16bc45f6898'::text NOT NULL
);

CREATE TABLE IF NOT EXISTS eletronicos.service_item_devices (
    service_catalog_item_id uuid NOT NULL,
    device_type_id uuid NOT NULL,
    tenant_id text DEFAULT 'c585d2f2-b29e-4040-998e-e16bc45f6898'::text NOT NULL
);

CREATE TABLE IF NOT EXISTS eletronicos.service_item_models (
    service_catalog_item_id uuid NOT NULL,
    model_id uuid NOT NULL,
    tenant_id text DEFAULT 'c585d2f2-b29e-4040-998e-e16bc45f6898'::text NOT NULL
);

CREATE TABLE IF NOT EXISTS eletronicos.service_request_credentials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    service_request_id uuid NOT NULL,
    kind text NOT NULL,
    value text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    tenant_id text DEFAULT 'c585d2f2-b29e-4040-998e-e16bc45f6898'::text NOT NULL
);

CREATE TABLE IF NOT EXISTS eletronicos.whatsapp_state (
    id integer DEFAULT 1 NOT NULL,
    status text DEFAULT 'disconnected'::text NOT NULL,
    qr_code text,
    updated_at timestamp with time zone DEFAULT now(),
    tenant_id text DEFAULT 'c585d2f2-b29e-4040-998e-e16bc45f6898'::text NOT NULL
);

CREATE TABLE IF NOT EXISTS eletronicos.whatsapp_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    template_key text NOT NULL,
    section text NOT NULL,
    label text NOT NULL,
    description text,
    content text NOT NULL,
    required_variables text[] DEFAULT '{}'::text[] NOT NULL,
    available_variables text[] DEFAULT '{}'::text[] NOT NULL,
    editable boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    tenant_id text DEFAULT 'c585d2f2-b29e-4040-998e-e16bc45f6898'::text NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agenda_blocks_pkey' AND conrelid = 'eletronicos.agenda_blocks'::regclass) THEN
    ALTER TABLE ONLY eletronicos.agenda_blocks ADD CONSTRAINT agenda_blocks_pkey PRIMARY KEY (id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agenda_business_hours_pkey' AND conrelid = 'eletronicos.agenda_business_hours'::regclass) THEN
    ALTER TABLE ONLY eletronicos.agenda_business_hours ADD CONSTRAINT agenda_business_hours_pkey PRIMARY KEY (id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agenda_business_hours_tenant_weekday_key' AND conrelid = 'eletronicos.agenda_business_hours'::regclass) THEN
    ALTER TABLE ONLY eletronicos.agenda_business_hours ADD CONSTRAINT agenda_business_hours_tenant_weekday_key UNIQUE (tenant_id, weekday);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agenda_settings_pkey' AND conrelid = 'eletronicos.agenda_settings'::regclass) THEN
    ALTER TABLE ONLY eletronicos.agenda_settings ADD CONSTRAINT agenda_settings_pkey PRIMARY KEY (id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agenda_settings_tenant_id_key' AND conrelid = 'eletronicos.agenda_settings'::regclass) THEN
    ALTER TABLE ONLY eletronicos.agenda_settings ADD CONSTRAINT agenda_settings_tenant_id_key UNIQUE (tenant_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_model_configs_pkey' AND conrelid = 'eletronicos.ai_model_configs'::regclass) THEN
    ALTER TABLE ONLY eletronicos.ai_model_configs ADD CONSTRAINT ai_model_configs_pkey PRIMARY KEY (id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointment_events_pkey' AND conrelid = 'eletronicos.appointment_events'::regclass) THEN
    ALTER TABLE ONLY eletronicos.appointment_events ADD CONSTRAINT appointment_events_pkey PRIMARY KEY (id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointments_pkey' AND conrelid = 'eletronicos.appointments'::regclass) THEN
    ALTER TABLE ONLY eletronicos.appointments ADD CONSTRAINT appointments_pkey PRIMARY KEY (id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assistant_config_pkey' AND conrelid = 'eletronicos.assistant_config'::regclass) THEN
    ALTER TABLE ONLY eletronicos.assistant_config ADD CONSTRAINT assistant_config_pkey PRIMARY KEY (tenant_id, id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assistant_conversations_pkey' AND conrelid = 'eletronicos.assistant_conversations'::regclass) THEN
    ALTER TABLE ONLY eletronicos.assistant_conversations ADD CONSTRAINT assistant_conversations_pkey PRIMARY KEY (id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assistant_messages_pkey' AND conrelid = 'eletronicos.assistant_messages'::regclass) THEN
    ALTER TABLE ONLY eletronicos.assistant_messages ADD CONSTRAINT assistant_messages_pkey PRIMARY KEY (id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assistant_rag_documents_pkey' AND conrelid = 'eletronicos.assistant_rag_documents'::regclass) THEN
    ALTER TABLE ONLY eletronicos.assistant_rag_documents ADD CONSTRAINT assistant_rag_documents_pkey PRIMARY KEY (id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'catalog_models_key_name_key' AND conrelid = 'eletronicos.catalog_models'::regclass) THEN
    ALTER TABLE ONLY eletronicos.catalog_models ADD CONSTRAINT catalog_models_key_name_key UNIQUE (brand_id, name);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'catalog_models_pkey' AND conrelid = 'eletronicos.catalog_models'::regclass) THEN
    ALTER TABLE ONLY eletronicos.catalog_models ADD CONSTRAINT catalog_models_pkey PRIMARY KEY (id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'consultation_otps_pkey' AND conrelid = 'eletronicos.consultation_otps'::regclass) THEN
    ALTER TABLE ONLY eletronicos.consultation_otps ADD CONSTRAINT consultation_otps_pkey PRIMARY KEY (id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'device_types_key_slug_key' AND conrelid = 'eletronicos.device_types'::regclass) THEN
    ALTER TABLE ONLY eletronicos.device_types ADD CONSTRAINT device_types_key_slug_key UNIQUE (slug);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'device_types_pkey' AND conrelid = 'eletronicos.device_types'::regclass) THEN
    ALTER TABLE ONLY eletronicos.device_types ADD CONSTRAINT device_types_pkey PRIMARY KEY (id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'driver_location_pkey' AND conrelid = 'eletronicos.driver_location'::regclass) THEN
    ALTER TABLE ONLY eletronicos.driver_location ADD CONSTRAINT driver_location_pkey PRIMARY KEY (id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'neighborhood_shipping_rates_key_hood_key' AND conrelid = 'eletronicos.neighborhood_shipping_rates'::regclass) THEN
    ALTER TABLE ONLY eletronicos.neighborhood_shipping_rates ADD CONSTRAINT neighborhood_shipping_rates_key_hood_key UNIQUE (neighborhood);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'neighborhood_shipping_rates_pkey' AND conrelid = 'eletronicos.neighborhood_shipping_rates'::regclass) THEN
    ALTER TABLE ONLY eletronicos.neighborhood_shipping_rates ADD CONSTRAINT neighborhood_shipping_rates_pkey PRIMARY KEY (id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pdv_payments_pkey' AND conrelid = 'eletronicos.pdv_payments'::regclass) THEN
    ALTER TABLE ONLY eletronicos.pdv_payments ADD CONSTRAINT pdv_payments_pkey PRIMARY KEY (id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pdv_sale_items_pkey' AND conrelid = 'eletronicos.pdv_sale_items'::regclass) THEN
    ALTER TABLE ONLY eletronicos.pdv_sale_items ADD CONSTRAINT pdv_sale_items_pkey PRIMARY KEY (id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pdv_sales_pkey' AND conrelid = 'eletronicos.pdv_sales'::regclass) THEN
    ALTER TABLE ONLY eletronicos.pdv_sales ADD CONSTRAINT pdv_sales_pkey PRIMARY KEY (id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_brands_pkey' AND conrelid = 'eletronicos.product_brands'::regclass) THEN
    ALTER TABLE ONLY eletronicos.product_brands ADD CONSTRAINT product_brands_pkey PRIMARY KEY (product_id, brand_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_categories_key_name_key' AND conrelid = 'eletronicos.product_categories'::regclass) THEN
    ALTER TABLE ONLY eletronicos.product_categories ADD CONSTRAINT product_categories_key_name_key UNIQUE (name);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_categories_pkey' AND conrelid = 'eletronicos.product_categories'::regclass) THEN
    ALTER TABLE ONLY eletronicos.product_categories ADD CONSTRAINT product_categories_pkey PRIMARY KEY (id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_devices_pkey' AND conrelid = 'eletronicos.product_devices'::regclass) THEN
    ALTER TABLE ONLY eletronicos.product_devices ADD CONSTRAINT product_devices_pkey PRIMARY KEY (product_id, device_type_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_models_pkey' AND conrelid = 'eletronicos.product_models'::regclass) THEN
    ALTER TABLE ONLY eletronicos.product_models ADD CONSTRAINT product_models_pkey PRIMARY KEY (product_id, model_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_pkey' AND conrelid = 'eletronicos.products'::regclass) THEN
    ALTER TABLE ONLY eletronicos.products ADD CONSTRAINT products_pkey PRIMARY KEY (id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_catalog_categories_key_slug_key' AND conrelid = 'eletronicos.service_catalog_categories'::regclass) THEN
    ALTER TABLE ONLY eletronicos.service_catalog_categories ADD CONSTRAINT service_catalog_categories_key_slug_key UNIQUE (slug);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_catalog_categories_pkey' AND conrelid = 'eletronicos.service_catalog_categories'::regclass) THEN
    ALTER TABLE ONLY eletronicos.service_catalog_categories ADD CONSTRAINT service_catalog_categories_pkey PRIMARY KEY (id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_catalog_item_extra_costs_pkey' AND conrelid = 'eletronicos.service_catalog_item_extra_costs'::regclass) THEN
    ALTER TABLE ONLY eletronicos.service_catalog_item_extra_costs ADD CONSTRAINT service_catalog_item_extra_costs_pkey PRIMARY KEY (id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_catalog_item_parts_pkey' AND conrelid = 'eletronicos.service_catalog_item_parts'::regclass) THEN
    ALTER TABLE ONLY eletronicos.service_catalog_item_parts ADD CONSTRAINT service_catalog_item_parts_pkey PRIMARY KEY (id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_catalog_items_pkey' AND conrelid = 'eletronicos.service_catalog_items'::regclass) THEN
    ALTER TABLE ONLY eletronicos.service_catalog_items ADD CONSTRAINT service_catalog_items_pkey PRIMARY KEY (id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_diagnostics_pkey' AND conrelid = 'eletronicos.service_diagnostics'::regclass) THEN
    ALTER TABLE ONLY eletronicos.service_diagnostics ADD CONSTRAINT service_diagnostics_pkey PRIMARY KEY (id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_item_brands_pkey' AND conrelid = 'eletronicos.service_item_brands'::regclass) THEN
    ALTER TABLE ONLY eletronicos.service_item_brands ADD CONSTRAINT service_item_brands_pkey PRIMARY KEY (service_catalog_item_id, brand_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_item_devices_pkey' AND conrelid = 'eletronicos.service_item_devices'::regclass) THEN
    ALTER TABLE ONLY eletronicos.service_item_devices ADD CONSTRAINT service_item_devices_pkey PRIMARY KEY (service_catalog_item_id, device_type_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_item_models_pkey' AND conrelid = 'eletronicos.service_item_models'::regclass) THEN
    ALTER TABLE ONLY eletronicos.service_item_models ADD CONSTRAINT service_item_models_pkey PRIMARY KEY (service_catalog_item_id, model_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_request_credentials_key_t_id_key' AND conrelid = 'eletronicos.service_request_credentials'::regclass) THEN
    ALTER TABLE ONLY eletronicos.service_request_credentials ADD CONSTRAINT service_request_credentials_key_t_id_key UNIQUE (service_request_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_request_credentials_pkey' AND conrelid = 'eletronicos.service_request_credentials'::regclass) THEN
    ALTER TABLE ONLY eletronicos.service_request_credentials ADD CONSTRAINT service_request_credentials_pkey PRIMARY KEY (id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_state_pkey' AND conrelid = 'eletronicos.whatsapp_state'::regclass) THEN
    ALTER TABLE ONLY eletronicos.whatsapp_state ADD CONSTRAINT whatsapp_state_pkey PRIMARY KEY (id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_templates_key__key_key' AND conrelid = 'eletronicos.whatsapp_templates'::regclass) THEN
    ALTER TABLE ONLY eletronicos.whatsapp_templates ADD CONSTRAINT whatsapp_templates_key__key_key UNIQUE (tenant_id, template_key);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_templates_pkey' AND conrelid = 'eletronicos.whatsapp_templates'::regclass) THEN
    ALTER TABLE ONLY eletronicos.whatsapp_templates ADD CONSTRAINT whatsapp_templates_pkey PRIMARY KEY (id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_elt_agenda_blocks_tenant ON eletronicos.agenda_blocks USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_elt_agenda_business_hours_tenant ON eletronicos.agenda_business_hours USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_elt_agenda_settings_tenant ON eletronicos.agenda_settings USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_elt_ai_model_configs_tenant ON eletronicos.ai_model_configs USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_elt_appointment_events_tenant ON eletronicos.appointment_events USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_elt_appointments_tenant ON eletronicos.appointments USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_elt_assistant_config_tenant ON eletronicos.assistant_config USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_elt_assistant_conversations_tenant ON eletronicos.assistant_conversations USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_elt_assistant_messages_tenant ON eletronicos.assistant_messages USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_elt_assistant_rag_documents_tenant ON eletronicos.assistant_rag_documents USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_elt_catalog_models_tenant ON eletronicos.catalog_models USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_elt_consultation_otps_tenant ON eletronicos.consultation_otps USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_elt_device_types_tenant ON eletronicos.device_types USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_elt_driver_location_tenant ON eletronicos.driver_location USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_elt_neighborhood_shipping_rates_tenant ON eletronicos.neighborhood_shipping_rates USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_elt_pdv_payments_tenant ON eletronicos.pdv_payments USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_elt_pdv_sale_items_tenant ON eletronicos.pdv_sale_items USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_elt_pdv_sales_tenant ON eletronicos.pdv_sales USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_elt_product_brands_tenant ON eletronicos.product_brands USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_elt_product_categories_tenant ON eletronicos.product_categories USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_elt_product_devices_tenant ON eletronicos.product_devices USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_elt_product_models_tenant ON eletronicos.product_models USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_elt_products_tenant ON eletronicos.products USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_elt_service_catalog_categories_tenant ON eletronicos.service_catalog_categories USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_elt_service_catalog_item_extra_costs_tenant ON eletronicos.service_catalog_item_extra_costs USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_elt_service_catalog_item_parts_tenant ON eletronicos.service_catalog_item_parts USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_elt_service_catalog_items_tenant ON eletronicos.service_catalog_items USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_elt_service_diagnostics_tenant ON eletronicos.service_diagnostics USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_elt_service_item_brands_tenant ON eletronicos.service_item_brands USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_elt_service_item_devices_tenant ON eletronicos.service_item_devices USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_elt_service_item_models_tenant ON eletronicos.service_item_models USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_elt_service_request_credentials_tenant ON eletronicos.service_request_credentials USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_elt_whatsapp_state_tenant ON eletronicos.whatsapp_state USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_elt_whatsapp_templates_tenant ON eletronicos.whatsapp_templates USING btree (tenant_id);

-- eletronicos.service_requests sofre do mesmo drift, mas parcial (como
-- shipping_settings acima): 0022_eletronicos_module.sql cria a tabela, so
-- que com um shape ANTIGO -- faltando 8 colunas que ja existem em producao
-- (adicionadas manualmente ao longo do tempo, fora de migration) e que o
-- codigo Rust (eletronicos.rs::SELECT_COLUMNS / insert_service_request) ja
-- espera existir. Pre-criar aqui com o shape REAL de producao (extraido via
-- information_schema.columns, mesma role loja_svc2) faz 0022 virar no-op
-- na CREATE TABLE (idem padrao shipping_settings) e ainda cria os indexes
-- dela normalmente. CHECKs de status/discount_percent replicados aqui pra
-- nao perder a validacao no nivel do banco que a 0022 teria criado.
CREATE TABLE IF NOT EXISTS eletronicos.service_requests (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    customer_name text NOT NULL,
    customer_phone text NOT NULL,
    customer_email text,
    phone_model text,
    problem_description text,
    image_url text,
    address_cep text,
    address_street text,
    address_number text,
    address_reference text,
    address_neighborhood text,
    address_city text,
    address_state text,
    status text DEFAULT 'pending'::text NOT NULL
        CHECK (status IN (
            'pending','accepted','rejected','retirada_local','em_busca',
            'in_progress','em_entrega','completed','em_pagamento',
            'delivered','finished','cancelled'
        )),
    quote_value numeric,
    owner_notes text,
    discount_percent integer
        CHECK (discount_percent IS NULL OR (discount_percent >= 0 AND discount_percent <= 100)),
    payment_methods jsonb DEFAULT '[]'::jsonb NOT NULL,
    self_pickup boolean DEFAULT false NOT NULL,
    shipping_price numeric,
    address_lat double precision,
    address_lng double precision,
    address_label text,
    selected_service_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    diagnosis_requested boolean DEFAULT false NOT NULL,
    estimated_quote numeric,
    return_leg text,
    return_leg_price numeric,
    return_leg_same_address boolean,
    source text DEFAULT 'storefront_form'::text NOT NULL,
    busy_until timestamp with time zone,
    estimated_quote_value numeric
);
