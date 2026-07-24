-- =====================================================
-- Rename: campanha -> promoção (banner)
--
-- O sistema de banners/carrossel (kit e selfie_service, com desconto de
-- produto e/ou frete) era chamado de "campanha"/"campaign" em todo o
-- banco. Uma nova feature de CRM (segmento de clientes -> disparo
-- automático de notificação por WhatsApp) também vai se chamar
-- "campanha" — pra evitar colisão de nomes entre os dois conceitos,
-- este arquivo renomeia TUDO relacionado ao banner/kit/selfie-service
-- de "campaign"/"campanha" para "promotion"/"promoção".
--
-- Isto é um rename puro de identificadores (tabelas, colunas, funções,
-- parâmetros, variáveis e mensagens de erro) — NENHUMA regra de negócio
-- muda. sunset.crm_segments e sunset.coupons não fazem parte deste
-- sistema, mas cada um tem uma única coluna que referenciava o conceito
-- renomeado (crm_segments.campaign_id e coupons.allow_campaign_checkout)
-- e por isso também são ajustadas aqui, junto com as funções que leem/
-- escrevem essas colunas.
-- =====================================================

-- ─────────────────────────────────────────────────────
-- 1. Tabelas e colunas
-- ─────────────────────────────────────────────────────

ALTER TABLE IF EXISTS sunset.campaigns RENAME TO promotions;
ALTER TABLE sunset.promotions RENAME COLUMN campaign_type TO promotion_type;
ALTER TABLE sunset.promotions RENAME CONSTRAINT campaigns_has_discount TO promotions_has_discount;
ALTER TABLE sunset.promotions RENAME CONSTRAINT campaigns_has_products TO promotions_has_products;

ALTER TABLE IF EXISTS sunset.campaign_product_discounts RENAME TO promotion_product_discounts;
ALTER TABLE sunset.promotion_product_discounts RENAME COLUMN campaign_id TO promotion_id;
ALTER INDEX sunset.campaign_product_discounts_campaign_idx RENAME TO promotion_product_discounts_promotion_idx;

ALTER TABLE sunset.orders RENAME COLUMN campaign_id TO promotion_id;

-- Referência simples (não é dono da campanha/promoção, só um vínculo
-- opcional) — a FK continua apontando certo porque a tabela foi
-- renomeada, não recriada.
ALTER TABLE sunset.crm_segments RENAME COLUMN campaign_id TO promotion_id;

-- allow_campaign_checkout controla se um cupom pode ser combinado com o
-- checkout de uma campanha/promoção — nome referenciava o conceito
-- renomeado, então acompanha o rename.
ALTER TABLE sunset.coupons RENAME COLUMN allow_campaign_checkout TO allow_promotion_checkout;

-- ─────────────────────────────────────────────────────
-- 2. Promoções — CRUD admin (ex-campanhas)
-- ─────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS sunset._campaign_json(text);

CREATE OR REPLACE FUNCTION sunset._promotion_json(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sunset, public AS $$
  SELECT jsonb_build_object(
    'id', c.id, 'title', c.title, 'image_url', c.image_url, 'product_ids', to_jsonb(c.product_ids),
    'promotion_type', c.promotion_type,
    'discount_type', c.discount_type, 'discount_value', c.discount_value,
    'shipping_discount_type', c.shipping_discount_type, 'shipping_discount_value', c.shipping_discount_value,
    'active', (c.active <> 0), 'starts_at', c.starts_at, 'expires_at', c.expires_at, 'created_at', c.created_at,
    'product_discounts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', pd.product_id, 'discount_type', pd.discount_type, 'discount_value', pd.discount_value
      )) FROM sunset.promotion_product_discounts pd WHERE pd.promotion_id = c.id
    ), '[]'::jsonb)
  ) FROM sunset.promotions c WHERE c.id = p_id;
$$;

DROP FUNCTION IF EXISTS sunset.admin_list_campaigns(text);

CREATE OR REPLACE FUNCTION sunset.admin_list_promotions(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
BEGIN
  PERFORM sunset._require_admin(p_token);
  RETURN COALESCE((SELECT jsonb_agg(sunset._promotion_json(id) ORDER BY created_at DESC) FROM sunset.promotions), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_list_promotions(text) TO anon, authenticated;

DROP FUNCTION IF EXISTS sunset.admin_create_campaign(text, text, text, text[], text, text, double precision, text, double precision, text, text, jsonb);

CREATE OR REPLACE FUNCTION sunset.admin_create_promotion(
  p_token text, p_title text, p_image_url text, p_product_ids text[],
  p_promotion_type text DEFAULT 'kit',
  p_discount_type text DEFAULT NULL, p_discount_value double precision DEFAULT NULL,
  p_shipping_discount_type text DEFAULT NULL, p_shipping_discount_value double precision DEFAULT NULL,
  p_starts_at text DEFAULT NULL, p_expires_at text DEFAULT NULL,
  p_product_discounts jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_id text := gen_random_uuid()::text;
  v_pd jsonb;
BEGIN
  PERFORM sunset._require_admin(p_token);
  IF trim(p_title) = '' THEN
    RAISE EXCEPTION 'title is required';
  END IF;
  IF p_image_url IS NULL OR trim(p_image_url) = '' THEN
    RAISE EXCEPTION 'image is required to create a promotion';
  END IF;
  IF p_product_ids IS NULL OR array_length(p_product_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'at least one product is required';
  END IF;
  IF p_promotion_type NOT IN ('selfie_service', 'kit') THEN
    RAISE EXCEPTION 'invalid promotion_type';
  END IF;
  IF p_promotion_type = 'selfie_service' THEN
    IF p_product_discounts IS NULL OR jsonb_array_length(p_product_discounts) = 0 THEN
      RAISE EXCEPTION 'at least one product discount is required for a selfie-service promotion';
    END IF;
  ELSE
    IF (p_discount_type IS NULL OR p_discount_value IS NULL) AND p_shipping_discount_type IS NULL THEN
      RAISE EXCEPTION 'a kit promotion needs a product discount and/or a shipping discount';
    END IF;
    IF p_discount_type IS NOT NULL AND p_discount_type NOT IN ('percent', 'fixed') THEN
      RAISE EXCEPTION 'invalid discount_type';
    END IF;
    IF p_discount_type = 'percent' AND (p_discount_value <= 0 OR p_discount_value > 100) THEN
      RAISE EXCEPTION 'percent discount must be between 0 and 100';
    END IF;
    IF p_discount_type = 'fixed' AND p_discount_value <= 0 THEN
      RAISE EXCEPTION 'fixed discount must be positive';
    END IF;
  END IF;

  INSERT INTO sunset.promotions (
    id, title, image_url, product_ids, promotion_type, discount_type, discount_value,
    shipping_discount_type, shipping_discount_value, starts_at, expires_at
  ) VALUES (
    v_id, trim(p_title), p_image_url, p_product_ids, p_promotion_type,
    CASE WHEN p_promotion_type = 'selfie_service' THEN NULL ELSE p_discount_type END,
    CASE WHEN p_promotion_type = 'selfie_service' THEN NULL ELSE p_discount_value END,
    p_shipping_discount_type, p_shipping_discount_value,
    NULLIF(trim(p_starts_at), ''), NULLIF(trim(p_expires_at), '')
  );

  IF p_promotion_type = 'selfie_service' THEN
    FOR v_pd IN SELECT * FROM jsonb_array_elements(p_product_discounts) LOOP
      INSERT INTO sunset.promotion_product_discounts (id, promotion_id, product_id, discount_type, discount_value)
        VALUES (gen_random_uuid()::text, v_id, v_pd->>'product_id', v_pd->>'discount_type', (v_pd->>'discount_value')::double precision);
    END LOOP;
  END IF;

  RETURN sunset._promotion_json(v_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_create_promotion(text, text, text, text[], text, text, double precision, text, double precision, text, text, jsonb) TO anon, authenticated;

DROP FUNCTION IF EXISTS sunset.admin_update_campaign(text, text, text, text, text[], text, text, double precision, text, double precision, boolean, text, text, jsonb);

CREATE OR REPLACE FUNCTION sunset.admin_update_promotion(
  p_token text, p_id text, p_title text, p_image_url text, p_product_ids text[],
  p_promotion_type text,
  p_discount_type text, p_discount_value double precision,
  p_shipping_discount_type text, p_shipping_discount_value double precision,
  p_active boolean,
  p_starts_at text DEFAULT NULL, p_expires_at text DEFAULT NULL,
  p_product_discounts jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_pd jsonb;
BEGIN
  PERFORM sunset._require_admin(p_token);
  IF trim(p_title) = '' THEN
    RAISE EXCEPTION 'title is required';
  END IF;
  IF p_image_url IS NULL OR trim(p_image_url) = '' THEN
    RAISE EXCEPTION 'image is required';
  END IF;
  IF p_product_ids IS NULL OR array_length(p_product_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'at least one product is required';
  END IF;
  IF p_promotion_type NOT IN ('selfie_service', 'kit') THEN
    RAISE EXCEPTION 'invalid promotion_type';
  END IF;
  IF p_promotion_type = 'selfie_service' THEN
    IF p_product_discounts IS NULL OR jsonb_array_length(p_product_discounts) = 0 THEN
      RAISE EXCEPTION 'at least one product discount is required for a selfie-service promotion';
    END IF;
  ELSIF (p_discount_type IS NULL OR p_discount_value IS NULL) AND p_shipping_discount_type IS NULL THEN
    RAISE EXCEPTION 'a kit promotion needs a product discount and/or a shipping discount';
  END IF;

  UPDATE sunset.promotions SET
    title = trim(p_title), image_url = p_image_url, product_ids = p_product_ids,
    promotion_type = p_promotion_type,
    discount_type = CASE WHEN p_promotion_type = 'selfie_service' THEN NULL ELSE p_discount_type END,
    discount_value = CASE WHEN p_promotion_type = 'selfie_service' THEN NULL ELSE p_discount_value END,
    shipping_discount_type = p_shipping_discount_type, shipping_discount_value = p_shipping_discount_value,
    active = CASE WHEN p_active THEN 1 ELSE 0 END,
    starts_at = NULLIF(trim(p_starts_at), ''), expires_at = NULLIF(trim(p_expires_at), '')
  WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'promotion not found';
  END IF;

  DELETE FROM sunset.promotion_product_discounts WHERE promotion_id = p_id;
  IF p_promotion_type = 'selfie_service' THEN
    FOR v_pd IN SELECT * FROM jsonb_array_elements(p_product_discounts) LOOP
      INSERT INTO sunset.promotion_product_discounts (id, promotion_id, product_id, discount_type, discount_value)
        VALUES (gen_random_uuid()::text, p_id, v_pd->>'product_id', v_pd->>'discount_type', (v_pd->>'discount_value')::double precision);
    END LOOP;
  END IF;

  RETURN sunset._promotion_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_update_promotion(text, text, text, text, text[], text, text, double precision, text, double precision, boolean, text, text, jsonb) TO anon, authenticated;

DROP FUNCTION IF EXISTS sunset.admin_delete_campaign(text, text);

CREATE OR REPLACE FUNCTION sunset.admin_delete_promotion(p_token text, p_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
BEGIN
  PERFORM sunset._require_admin(p_token);
  DELETE FROM sunset.promotions WHERE id = p_id;
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_delete_promotion(text, text) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- 3. Público — carrossel/banner + checkout (ex-campanhas)
-- ─────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS sunset.list_active_campaigns();

CREATE OR REPLACE FUNCTION sunset.list_active_promotions()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sunset, public AS $$
  SELECT COALESCE(jsonb_agg(sunset._promotion_json(id) ORDER BY created_at DESC), '[]'::jsonb)
  FROM sunset.promotions
  WHERE active <> 0
    AND (starts_at IS NULL OR starts_at::timestamptz <= now())
    AND (expires_at IS NULL OR expires_at::timestamptz > now());
$$;
GRANT EXECUTE ON FUNCTION sunset.list_active_promotions() TO anon, authenticated;

DROP FUNCTION IF EXISTS sunset.get_campaign(text);

CREATE OR REPLACE FUNCTION sunset.get_promotion(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sunset, public AS $$
  SELECT sunset._promotion_json(id)
  FROM sunset.promotions
  WHERE id = p_id AND active <> 0
    AND (starts_at IS NULL OR starts_at::timestamptz <= now())
    AND (expires_at IS NULL OR expires_at::timestamptz > now());
$$;
GRANT EXECUTE ON FUNCTION sunset.get_promotion(text) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- 4. Cupons — só o campo allow_campaign_checkout muda de nome
--    (o resto de sunset.coupons/coupon_grants/coupon_product_discounts
--    é intocado, não faz parte deste rename)
-- ─────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS sunset._coupon_json(text);

CREATE OR REPLACE FUNCTION sunset._coupon_json(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sunset, public AS $$
  SELECT jsonb_build_object(
    'id', c.id, 'code', c.code, 'kind', c.kind, 'discount_type', c.discount_type, 'discount_value', c.discount_value,
    'shipping_discount_type', c.shipping_discount_type, 'shipping_discount_value', c.shipping_discount_value,
    'allow_promotion_checkout', (c.allow_promotion_checkout <> 0),
    'combinable_with_public', (c.combinable_with_public <> 0),
    'active', (c.active <> 0),
    'expires_at', c.expires_at, 'max_uses', c.max_uses, 'used_count', c.used_count, 'created_at', c.created_at,
    'grant_count', (SELECT COUNT(*) FROM sunset.coupon_grants g WHERE g.coupon_id = c.id),
    'product_discounts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', pd.product_id, 'discount_type', pd.discount_type, 'discount_value', pd.discount_value
      )) FROM sunset.coupon_product_discounts pd WHERE pd.coupon_id = c.id
    ), '[]'::jsonb)
  ) FROM sunset.coupons c WHERE c.id = p_id;
$$;

DROP FUNCTION IF EXISTS sunset.admin_create_coupon(text, text, text, text, double precision, boolean, text, bigint, jsonb);

CREATE OR REPLACE FUNCTION sunset.admin_create_coupon(
  p_token text, p_code text, p_kind text, p_discount_type text, p_discount_value double precision,
  p_allow_promotion_checkout boolean DEFAULT false,
  p_expires_at text DEFAULT NULL, p_max_uses bigint DEFAULT NULL,
  p_product_discounts jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_id text := gen_random_uuid()::text;
  v_code text := upper(trim(p_code));
  v_has_products boolean := p_product_discounts IS NOT NULL AND jsonb_array_length(p_product_discounts) > 0;
  v_pd jsonb;
BEGIN
  PERFORM sunset._require_admin(p_token);
  IF v_code = '' THEN
    RAISE EXCEPTION 'code is required';
  END IF;
  IF p_kind NOT IN ('desconto', 'frete', 'aniversario', 'produto') THEN
    RAISE EXCEPTION 'invalid kind';
  END IF;
  IF p_kind = 'produto' THEN
    IF NOT v_has_products THEN
      RAISE EXCEPTION 'at least one product is required for kind=produto';
    END IF;
  ELSE
    IF p_discount_type IS NULL OR p_discount_value IS NULL THEN
      RAISE EXCEPTION 'discount_type and discount_value are required';
    END IF;
    IF p_discount_type NOT IN ('percent', 'fixed') THEN
      RAISE EXCEPTION 'invalid discount_type';
    END IF;
    IF p_discount_type = 'percent' AND (p_discount_value <= 0 OR p_discount_value > 100) THEN
      RAISE EXCEPTION 'percent discount must be between 0 and 100';
    END IF;
    IF p_discount_type = 'fixed' AND p_discount_value <= 0 THEN
      RAISE EXCEPTION 'fixed discount must be positive';
    END IF;
  END IF;
  IF p_max_uses IS NOT NULL AND p_max_uses <= 0 THEN
    RAISE EXCEPTION 'max_uses must be positive';
  END IF;
  BEGIN
    INSERT INTO sunset.coupons (id, code, kind, discount_type, discount_value, allow_promotion_checkout, expires_at, max_uses)
      VALUES (
        v_id, v_code, p_kind,
        CASE WHEN p_kind = 'produto' THEN NULL ELSE p_discount_type END,
        CASE WHEN p_kind = 'produto' THEN NULL ELSE p_discount_value END,
        CASE WHEN p_allow_promotion_checkout THEN 1 ELSE 0 END,
        NULLIF(trim(p_expires_at), ''), p_max_uses
      );
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'a coupon with this code already exists';
  END;

  IF v_has_products THEN
    FOR v_pd IN SELECT * FROM jsonb_array_elements(p_product_discounts) LOOP
      INSERT INTO sunset.coupon_product_discounts (id, coupon_id, product_id, discount_type, discount_value)
        VALUES (
          gen_random_uuid()::text, v_id, v_pd->>'product_id',
          v_pd->>'discount_type', (v_pd->>'discount_value')::double precision
        );
    END LOOP;
  END IF;

  RETURN sunset._coupon_json(v_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_create_coupon(text, text, text, text, double precision, boolean, text, bigint, jsonb) TO anon, authenticated;

DROP FUNCTION IF EXISTS sunset.admin_update_coupon(text, text, boolean, boolean, text, bigint, text, double precision, jsonb);

CREATE OR REPLACE FUNCTION sunset.admin_update_coupon(
  p_token text, p_id text, p_active boolean, p_allow_promotion_checkout boolean,
  p_expires_at text DEFAULT NULL, p_max_uses bigint DEFAULT NULL,
  p_discount_type text DEFAULT NULL, p_discount_value double precision DEFAULT NULL,
  p_product_discounts jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_kind text;
  v_pd jsonb;
BEGIN
  PERFORM sunset._require_admin(p_token);
  IF p_max_uses IS NOT NULL AND p_max_uses <= 0 THEN
    RAISE EXCEPTION 'max_uses must be positive';
  END IF;
  SELECT kind INTO v_kind FROM sunset.coupons WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'coupon not found';
  END IF;

  UPDATE sunset.coupons SET
    active = CASE WHEN p_active THEN 1 ELSE 0 END,
    allow_promotion_checkout = CASE WHEN p_allow_promotion_checkout THEN 1 ELSE 0 END,
    expires_at = NULLIF(trim(p_expires_at), ''),
    max_uses = p_max_uses,
    discount_type = CASE WHEN v_kind = 'produto' THEN discount_type ELSE COALESCE(p_discount_type, discount_type) END,
    discount_value = CASE WHEN v_kind = 'produto' THEN discount_value ELSE COALESCE(p_discount_value, discount_value) END
  WHERE id = p_id;

  IF v_kind = 'produto' AND p_product_discounts IS NOT NULL THEN
    DELETE FROM sunset.coupon_product_discounts WHERE coupon_id = p_id;
    FOR v_pd IN SELECT * FROM jsonb_array_elements(p_product_discounts) LOOP
      INSERT INTO sunset.coupon_product_discounts (id, coupon_id, product_id, discount_type, discount_value)
        VALUES (gen_random_uuid()::text, p_id, v_pd->>'product_id', v_pd->>'discount_type', (v_pd->>'discount_value')::double precision);
    END LOOP;
  END IF;

  RETURN sunset._coupon_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_update_coupon(text, text, boolean, boolean, text, bigint, text, double precision, jsonb) TO anon, authenticated;

DROP FUNCTION IF EXISTS sunset.admin_create_targeted_coupon(text, text, text[], bigint, boolean, text, boolean, boolean, text, bigint, text, double precision, text, double precision, jsonb);

CREATE OR REPLACE FUNCTION sunset.admin_create_targeted_coupon(
  p_token text,
  p_code text,
  p_customer_whatsapps text[],
  p_uses_per_customer bigint DEFAULT 1,
  p_notify_customers boolean DEFAULT true,
  p_custom_message text DEFAULT NULL,
  p_combinable_with_public boolean DEFAULT false,
  p_allow_promotion_checkout boolean DEFAULT false,
  p_expires_at text DEFAULT NULL,
  p_max_uses bigint DEFAULT NULL,
  p_discount_type text DEFAULT NULL,
  p_discount_value double precision DEFAULT NULL,
  p_shipping_discount_type text DEFAULT NULL,
  p_shipping_discount_value double precision DEFAULT NULL,
  p_product_discounts jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_id text := gen_random_uuid()::text;
  v_code text := upper(trim(p_code));
  v_whatsapp text;
  v_kind text;
  v_has_products boolean := p_product_discounts IS NOT NULL AND jsonb_array_length(p_product_discounts) > 0;
  v_pd jsonb;
BEGIN
  PERFORM sunset._require_admin(p_token);
  IF v_code = '' THEN
    RAISE EXCEPTION 'code is required';
  END IF;
  IF p_customer_whatsapps IS NULL OR array_length(p_customer_whatsapps, 1) IS NULL THEN
    RAISE EXCEPTION 'at least one customer is required';
  END IF;
  IF p_uses_per_customer IS NULL OR p_uses_per_customer <= 0 THEN
    RAISE EXCEPTION 'uses_per_customer must be positive';
  END IF;
  IF v_has_products AND p_discount_type IS NOT NULL THEN
    RAISE EXCEPTION 'use either a flat product discount or per-product discounts, not both';
  END IF;
  IF NOT v_has_products AND p_discount_type IS NULL AND p_shipping_discount_type IS NULL THEN
    RAISE EXCEPTION 'a targeted coupon needs at least one discount (produto, desconto and/or frete)';
  END IF;

  IF v_has_products THEN
    v_kind := 'produto';
  ELSIF p_discount_type IS NOT NULL THEN
    v_kind := 'desconto';
  ELSE
    v_kind := 'frete';
  END IF;

  IF p_discount_type IS NOT NULL THEN
    IF p_discount_type NOT IN ('percent', 'fixed') THEN
      RAISE EXCEPTION 'invalid discount_type';
    END IF;
    IF p_discount_type = 'percent' AND (p_discount_value <= 0 OR p_discount_value > 100) THEN
      RAISE EXCEPTION 'percent discount must be between 0 and 100';
    END IF;
    IF p_discount_type = 'fixed' AND p_discount_value <= 0 THEN
      RAISE EXCEPTION 'fixed discount must be positive';
    END IF;
  END IF;
  IF p_shipping_discount_type IS NOT NULL THEN
    IF p_shipping_discount_type NOT IN ('percent', 'fixed') THEN
      RAISE EXCEPTION 'invalid shipping_discount_type';
    END IF;
    IF p_shipping_discount_type = 'percent' AND (p_shipping_discount_value <= 0 OR p_shipping_discount_value > 100) THEN
      RAISE EXCEPTION 'percent shipping discount must be between 0 and 100';
    END IF;
    IF p_shipping_discount_type = 'fixed' AND p_shipping_discount_value <= 0 THEN
      RAISE EXCEPTION 'fixed shipping discount must be positive';
    END IF;
  END IF;

  BEGIN
    IF v_kind = 'frete' THEN
      INSERT INTO sunset.coupons (
        id, code, kind, discount_type, discount_value, allow_promotion_checkout,
        notify_customers, combinable_with_public, expires_at, max_uses
      ) VALUES (
        v_id, v_code, 'frete', p_shipping_discount_type, p_shipping_discount_value,
        CASE WHEN p_allow_promotion_checkout THEN 1 ELSE 0 END,
        CASE WHEN p_notify_customers THEN 1 ELSE 0 END,
        CASE WHEN p_combinable_with_public THEN 1 ELSE 0 END,
        NULLIF(trim(p_expires_at), ''), p_max_uses
      );
    ELSE
      INSERT INTO sunset.coupons (
        id, code, kind, discount_type, discount_value,
        shipping_discount_type, shipping_discount_value, allow_promotion_checkout,
        notify_customers, combinable_with_public, expires_at, max_uses
      ) VALUES (
        v_id, v_code, v_kind, p_discount_type, p_discount_value,
        p_shipping_discount_type, p_shipping_discount_value,
        CASE WHEN p_allow_promotion_checkout THEN 1 ELSE 0 END,
        CASE WHEN p_notify_customers THEN 1 ELSE 0 END,
        CASE WHEN p_combinable_with_public THEN 1 ELSE 0 END,
        NULLIF(trim(p_expires_at), ''), p_max_uses
      );
    END IF;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'a coupon with this code already exists';
  END;

  IF v_has_products THEN
    FOR v_pd IN SELECT * FROM jsonb_array_elements(p_product_discounts) LOOP
      INSERT INTO sunset.coupon_product_discounts (id, coupon_id, product_id, discount_type, discount_value)
        VALUES (
          gen_random_uuid()::text, v_id, v_pd->>'product_id',
          v_pd->>'discount_type', (v_pd->>'discount_value')::double precision
        );
    END LOOP;
  END IF;

  FOREACH v_whatsapp IN ARRAY p_customer_whatsapps LOOP
    INSERT INTO sunset.coupon_grants (id, coupon_id, customer_whatsapp, granted_uses)
      VALUES (gen_random_uuid()::text, v_id, v_whatsapp, p_uses_per_customer);
  END LOOP;

  RETURN sunset._coupon_json(v_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_create_targeted_coupon(text, text, text[], bigint, boolean, text, boolean, boolean, text, bigint, text, double precision, text, double precision, jsonb) TO anon, authenticated;

DROP FUNCTION IF EXISTS sunset.admin_update_targeted_coupon(text, text, boolean, bigint, boolean, boolean, text, bigint, text, double precision, text, double precision, jsonb);

CREATE OR REPLACE FUNCTION sunset.admin_update_targeted_coupon(
  p_token text,
  p_id text,
  p_active boolean,
  p_uses_per_customer bigint DEFAULT 1,
  p_combinable_with_public boolean DEFAULT false,
  p_allow_promotion_checkout boolean DEFAULT false,
  p_expires_at text DEFAULT NULL,
  p_max_uses bigint DEFAULT NULL,
  p_discount_type text DEFAULT NULL,
  p_discount_value double precision DEFAULT NULL,
  p_shipping_discount_type text DEFAULT NULL,
  p_shipping_discount_value double precision DEFAULT NULL,
  p_product_discounts jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_kind text;
  v_pd jsonb;
  v_has_products boolean := p_product_discounts IS NOT NULL AND jsonb_array_length(p_product_discounts) > 0;
BEGIN
  PERFORM sunset._require_admin(p_token);
  IF NOT EXISTS (SELECT 1 FROM sunset.coupons WHERE id = p_id) THEN
    RAISE EXCEPTION 'coupon not found';
  END IF;
  IF p_max_uses IS NOT NULL AND p_max_uses <= 0 THEN
    RAISE EXCEPTION 'max_uses must be positive';
  END IF;
  v_kind := CASE WHEN v_has_products THEN 'produto' WHEN p_discount_type IS NOT NULL THEN 'desconto' ELSE 'frete' END;

  UPDATE sunset.coupons SET
    active = CASE WHEN p_active THEN 1 ELSE 0 END,
    kind = v_kind,
    discount_type = CASE WHEN v_kind = 'produto' THEN NULL WHEN v_kind = 'frete' THEN p_shipping_discount_type ELSE p_discount_type END,
    discount_value = CASE WHEN v_kind = 'produto' THEN NULL WHEN v_kind = 'frete' THEN p_shipping_discount_value ELSE p_discount_value END,
    shipping_discount_type = CASE WHEN v_kind = 'frete' THEN NULL ELSE p_shipping_discount_type END,
    shipping_discount_value = CASE WHEN v_kind = 'frete' THEN NULL ELSE p_shipping_discount_value END,
    combinable_with_public = CASE WHEN p_combinable_with_public THEN 1 ELSE 0 END,
    allow_promotion_checkout = CASE WHEN p_allow_promotion_checkout THEN 1 ELSE 0 END,
    expires_at = NULLIF(trim(p_expires_at), ''),
    max_uses = p_max_uses
  WHERE id = p_id;

  DELETE FROM sunset.coupon_product_discounts WHERE coupon_id = p_id;
  IF v_has_products THEN
    FOR v_pd IN SELECT * FROM jsonb_array_elements(p_product_discounts) LOOP
      INSERT INTO sunset.coupon_product_discounts (id, coupon_id, product_id, discount_type, discount_value)
        VALUES (gen_random_uuid()::text, p_id, v_pd->>'product_id', v_pd->>'discount_type', (v_pd->>'discount_value')::double precision);
    END LOOP;
  END IF;

  UPDATE sunset.coupon_grants SET granted_uses = p_uses_per_customer WHERE coupon_id = p_id;

  RETURN sunset._coupon_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_update_targeted_coupon(text, text, boolean, bigint, boolean, boolean, text, bigint, text, double precision, text, double precision, jsonb) TO anon, authenticated;

DROP FUNCTION IF EXISTS sunset.validate_coupon(text, text, text, text);

CREATE OR REPLACE FUNCTION sunset.validate_coupon(
  p_code text,
  p_promotion_id text DEFAULT NULL,
  p_customer_birthdate text DEFAULT NULL,
  p_customer_whatsapp text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = sunset, public AS $$
DECLARE
  v_coupon sunset.coupons%ROWTYPE;
  v_is_targeted boolean;
BEGIN
  SELECT * INTO v_coupon FROM sunset.coupons WHERE upper(code) = upper(trim(p_code));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'coupon not found';
  END IF;
  IF v_coupon.active = 0 THEN
    RAISE EXCEPTION 'coupon is not active';
  END IF;
  IF v_coupon.expires_at IS NOT NULL AND v_coupon.expires_at::timestamptz <= now() THEN
    RAISE EXCEPTION 'coupon has expired';
  END IF;
  IF v_coupon.max_uses IS NOT NULL AND v_coupon.used_count >= v_coupon.max_uses THEN
    RAISE EXCEPTION 'coupon usage limit reached';
  END IF;
  IF p_promotion_id IS NOT NULL AND v_coupon.allow_promotion_checkout = 0 THEN
    RAISE EXCEPTION 'this coupon cannot be combined with a promotion checkout';
  END IF;
  IF v_coupon.kind = 'aniversario' THEN
    IF p_customer_birthdate IS NULL OR trim(p_customer_birthdate) = ''
       OR extract(month FROM p_customer_birthdate::date) <> extract(month FROM current_date) THEN
      RAISE EXCEPTION 'this coupon is only valid during your birthday month';
    END IF;
  END IF;

  SELECT EXISTS(SELECT 1 FROM sunset.coupon_grants WHERE coupon_id = v_coupon.id) INTO v_is_targeted;
  IF v_is_targeted THEN
    IF p_customer_whatsapp IS NULL OR trim(p_customer_whatsapp) = '' THEN
      RAISE EXCEPTION 'this coupon is not available for your account';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM sunset.coupon_grants
      WHERE coupon_id = v_coupon.id AND customer_whatsapp = p_customer_whatsapp AND used_count < granted_uses
    ) THEN
      RAISE EXCEPTION 'this coupon is not available for your account';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'code', v_coupon.code, 'kind', v_coupon.kind,
    'discount_type', v_coupon.discount_type, 'discount_value', v_coupon.discount_value,
    'shipping_discount_type', v_coupon.shipping_discount_type, 'shipping_discount_value', v_coupon.shipping_discount_value,
    'combinable_with_public', (v_coupon.combinable_with_public <> 0),
    'product_discounts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', pd.product_id, 'discount_type', pd.discount_type, 'discount_value', pd.discount_value
      )) FROM sunset.coupon_product_discounts pd WHERE pd.coupon_id = v_coupon.id
    ), '[]'::jsonb)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.validate_coupon(text, text, text, text) TO anon, authenticated;

-- sunset.list_customer_coupons(text) não referencia campaign_id nem
-- allow_campaign_checkout na sua versão atual (sunset_cupom_exclusivo_v2.sql)
-- — não precisa de nenhuma alteração, então não é recriada aqui.

-- ─────────────────────────────────────────────────────
-- 5. create_order — RPC de checkout (payment-critical). Mesmo nome
--    (usada tanto pelo catálogo quanto pelo checkout de banner), só
--    p_campaign_id/v_campaign/sunset.campaigns/sunset.campaign_product_
--    discounts/allow_campaign_checkout mudam de nome. Nenhuma regra de
--    negócio muda.
-- ─────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS sunset.create_order(text, text, text, text, text, text, jsonb, double precision, double precision, text, text, text, text);

CREATE OR REPLACE FUNCTION sunset.create_order(
  p_customer_name text,
  p_customer_whatsapp text,
  p_delivery_type text,
  p_payment_method text,
  p_neighborhood text,
  p_address text,
  p_items jsonb,
  p_customer_lat double precision DEFAULT NULL,
  p_customer_lng double precision DEFAULT NULL,
  p_reference_point text DEFAULT NULL,
  p_customer_birthdate text DEFAULT NULL,
  p_coupon_code text DEFAULT NULL,
  p_promotion_id text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_item               jsonb;
  v_product            sunset.products%ROWTYPE;
  v_quantity           bigint;
  v_subtotal           double precision := 0;
  v_shipping           double precision := 0;
  v_discount_amount    double precision := 0;
  v_shipping_discount  double precision := 0;
  v_customer_id        text;
  v_order_id           text := gen_random_uuid()::text;
  v_item_id            text;
  v_settings           sunset.shipping_settings%ROWTYPE;
  v_km                 double precision;
  v_birthdate          date;
  v_promotion          sunset.promotions%ROWTYPE;
  v_coupon             sunset.coupons%ROWTYPE;
  v_coupon_code        text;
  v_grant              sunset.coupon_grants%ROWTYPE;
  v_is_targeted        boolean;
  v_pd                 sunset.coupon_product_discounts%ROWTYPE;
  v_cpd                sunset.promotion_product_discounts%ROWTYPE;
  v_item_total         double precision;
  v_total              double precision;
  v_submitted_ids      text[];
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'order must have at least one item';
  END IF;
  IF p_delivery_type NOT IN ('entrega','retirada') THEN
    RAISE EXCEPTION 'invalid delivery_type';
  END IF;
  IF p_payment_method NOT IN ('pix','cartao','dinheiro') THEN
    RAISE EXCEPTION 'invalid payment_method';
  END IF;
  IF trim(p_customer_name) = '' OR trim(p_customer_whatsapp) = '' THEN
    RAISE EXCEPTION 'customer_name and customer_whatsapp are required';
  END IF;
  IF p_delivery_type = 'entrega' AND (p_customer_lat IS NULL OR p_customer_lng IS NULL) THEN
    RAISE EXCEPTION 'customer location (lat/lng) is required for entrega';
  END IF;

  IF p_customer_birthdate IS NULL OR trim(p_customer_birthdate) = '' THEN
    RAISE EXCEPTION 'birthdate is required';
  END IF;
  BEGIN
    v_birthdate := p_customer_birthdate::date;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'invalid birthdate';
  END;
  IF v_birthdate > current_date THEN
    RAISE EXCEPTION 'invalid birthdate';
  END IF;
  IF extract(year FROM age(current_date, v_birthdate)) < 18 THEN
    RAISE EXCEPTION 'you must be 18 or older to purchase tobacco products';
  END IF;

  IF p_promotion_id IS NOT NULL THEN
    SELECT * INTO v_promotion FROM sunset.promotions WHERE id = p_promotion_id;
    IF NOT FOUND OR v_promotion.active = 0
       OR (v_promotion.starts_at IS NOT NULL AND v_promotion.starts_at::timestamptz > now())
       OR (v_promotion.expires_at IS NOT NULL AND v_promotion.expires_at::timestamptz <= now()) THEN
      RAISE EXCEPTION 'promotion is not available';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_items) i
      WHERE NOT ((i->>'product_id') = ANY(v_promotion.product_ids))
    ) THEN
      RAISE EXCEPTION 'this promotion checkout can only contain the promotion products';
    END IF;
    IF v_promotion.promotion_type = 'kit' THEN
      SELECT array_agg(DISTINCT i->>'product_id') INTO v_submitted_ids FROM jsonb_array_elements(p_items) i;
      IF v_submitted_ids IS NULL OR array_length(v_submitted_ids, 1) <> array_length(v_promotion.product_ids, 1)
         OR NOT (v_submitted_ids @> v_promotion.product_ids) THEN
        RAISE EXCEPTION 'this kit promotion can only be purchased as the full bundle';
      END IF;
    END IF;
  END IF;

  IF p_coupon_code IS NOT NULL AND trim(p_coupon_code) <> '' THEN
    SELECT * INTO v_coupon FROM sunset.coupons WHERE upper(code) = upper(trim(p_coupon_code));
    IF NOT FOUND THEN
      RAISE EXCEPTION 'coupon not found';
    END IF;
    IF v_coupon.active = 0 THEN
      RAISE EXCEPTION 'coupon is not active';
    END IF;
    IF v_coupon.expires_at IS NOT NULL AND v_coupon.expires_at::timestamptz <= now() THEN
      RAISE EXCEPTION 'coupon has expired';
    END IF;
    IF v_coupon.max_uses IS NOT NULL AND v_coupon.used_count >= v_coupon.max_uses THEN
      RAISE EXCEPTION 'coupon usage limit reached';
    END IF;
    IF p_promotion_id IS NOT NULL AND v_coupon.allow_promotion_checkout = 0 THEN
      RAISE EXCEPTION 'this coupon cannot be combined with a promotion checkout';
    END IF;
    IF v_coupon.kind = 'aniversario' AND extract(month FROM v_birthdate) <> extract(month FROM current_date) THEN
      RAISE EXCEPTION 'this coupon is only valid during your birthday month';
    END IF;

    SELECT EXISTS(SELECT 1 FROM sunset.coupon_grants WHERE coupon_id = v_coupon.id) INTO v_is_targeted;
    IF v_is_targeted THEN
      SELECT * INTO v_grant FROM sunset.coupon_grants
        WHERE coupon_id = v_coupon.id AND customer_whatsapp = p_customer_whatsapp AND used_count < granted_uses
        FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'this coupon is not available for your account';
      END IF;
      UPDATE sunset.coupon_grants SET used_count = used_count + 1 WHERE id = v_grant.id;
    END IF;
    v_coupon_code := v_coupon.code;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_quantity := (v_item->>'quantity')::bigint;
    IF v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'item quantity must be positive';
    END IF;

    SELECT * INTO v_product FROM sunset.products
      WHERE id = (v_item->>'product_id') FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'product % not found', v_item->>'product_id';
    END IF;
    IF v_product.active = 0 THEN
      RAISE EXCEPTION 'product % is not available', v_product.name;
    END IF;
    IF v_product.quantity < v_quantity THEN
      RAISE EXCEPTION 'insufficient stock for product %', v_product.name;
    END IF;

    v_item_total := v_product.price * v_quantity;
    v_subtotal := v_subtotal + v_item_total;

    IF v_coupon.kind = 'produto' THEN
      SELECT * INTO v_pd FROM sunset.coupon_product_discounts
        WHERE coupon_id = v_coupon.id AND product_id = v_product.id;
      IF FOUND THEN
        IF v_pd.discount_type = 'percent' THEN
          v_discount_amount := v_discount_amount + round((v_item_total * v_pd.discount_value / 100)::numeric, 2);
        ELSE
          v_discount_amount := v_discount_amount + LEAST(v_pd.discount_value * v_quantity, v_item_total);
        END IF;
      END IF;
    END IF;

    IF v_promotion.id IS NOT NULL AND v_promotion.promotion_type = 'selfie_service' THEN
      SELECT * INTO v_cpd FROM sunset.promotion_product_discounts
        WHERE promotion_id = v_promotion.id AND product_id = v_product.id;
      IF FOUND THEN
        IF v_cpd.discount_type = 'percent' THEN
          v_discount_amount := v_discount_amount + round((v_item_total * v_cpd.discount_value / 100)::numeric, 2);
        ELSE
          v_discount_amount := v_discount_amount + LEAST(v_cpd.discount_value * v_quantity, v_item_total);
        END IF;
      END IF;
    END IF;
  END LOOP;

  IF p_delivery_type = 'entrega' THEN
    SELECT * INTO v_settings FROM sunset.shipping_settings WHERE id = 1;
    v_km := sunset._distance_km(v_settings.store_lat, v_settings.store_lng, p_customer_lat, p_customer_lng);
    IF v_settings.max_km IS NOT NULL AND v_km > v_settings.max_km THEN
      RAISE EXCEPTION 'delivery address is % km away, which exceeds the maximum delivery range of % km', round(v_km::numeric, 1), v_settings.max_km;
    END IF;
    v_shipping := round((v_km * v_settings.price_per_km)::numeric, 2);
  END IF;

  IF v_promotion.id IS NOT NULL THEN
    IF v_promotion.promotion_type = 'kit' THEN
      IF v_promotion.discount_type = 'percent' THEN
        v_discount_amount := v_discount_amount + round((v_subtotal * v_promotion.discount_value / 100)::numeric, 2);
      ELSIF v_promotion.discount_type = 'fixed' THEN
        v_discount_amount := v_discount_amount + v_promotion.discount_value;
      END IF;
    END IF;
    -- selfie_service já somou o desconto por item no loop acima
    IF v_promotion.shipping_discount_type = 'percent' THEN
      v_shipping_discount := v_shipping_discount + round((v_shipping * v_promotion.shipping_discount_value / 100)::numeric, 2);
    ELSIF v_promotion.shipping_discount_type = 'fixed' THEN
      v_shipping_discount := v_shipping_discount + v_promotion.shipping_discount_value;
    END IF;
  END IF;

  IF v_coupon.id IS NOT NULL THEN
    IF v_coupon.kind = 'frete' THEN
      IF v_coupon.discount_type = 'percent' THEN
        v_shipping_discount := v_shipping_discount + round((v_shipping * v_coupon.discount_value / 100)::numeric, 2);
      ELSE
        v_shipping_discount := v_shipping_discount + v_coupon.discount_value;
      END IF;
    ELSE
      IF v_coupon.kind = 'desconto' AND v_coupon.discount_type IS NOT NULL THEN
        IF v_coupon.discount_type = 'percent' THEN
          v_discount_amount := v_discount_amount + round((v_subtotal * v_coupon.discount_value / 100)::numeric, 2);
        ELSE
          v_discount_amount := v_discount_amount + v_coupon.discount_value;
        END IF;
      END IF;
      IF v_coupon.shipping_discount_type = 'percent' THEN
        v_shipping_discount := v_shipping_discount + round((v_shipping * v_coupon.shipping_discount_value / 100)::numeric, 2);
      ELSIF v_coupon.shipping_discount_type = 'fixed' THEN
        v_shipping_discount := v_shipping_discount + v_coupon.shipping_discount_value;
      END IF;
    END IF;
    UPDATE sunset.coupons SET used_count = used_count + 1 WHERE id = v_coupon.id;
  END IF;

  v_discount_amount := LEAST(GREATEST(v_discount_amount, 0), v_subtotal);
  v_shipping_discount := LEAST(GREATEST(v_shipping_discount, 0), v_shipping);
  v_total := (v_subtotal - v_discount_amount) + (v_shipping - v_shipping_discount);

  SELECT id INTO v_customer_id FROM sunset.customers WHERE whatsapp = p_customer_whatsapp;
  IF v_customer_id IS NULL THEN
    v_customer_id := gen_random_uuid()::text;
    INSERT INTO sunset.customers (id, name, whatsapp, birthdate) VALUES (v_customer_id, p_customer_name, p_customer_whatsapp, p_customer_birthdate);
  ELSE
    UPDATE sunset.customers SET name = p_customer_name, birthdate = p_customer_birthdate WHERE id = v_customer_id;
  END IF;

  INSERT INTO sunset.orders (
    id, customer_id, customer_name, customer_whatsapp, delivery_type,
    neighborhood, address, reference_point, payment_method, payment_status, status,
    shipping_price, total, customer_lat, customer_lng,
    discount_amount, shipping_discount, coupon_code, promotion_id
  ) VALUES (
    v_order_id, v_customer_id, p_customer_name, p_customer_whatsapp, p_delivery_type,
    p_neighborhood, p_address, p_reference_point, p_payment_method, 'pendente', 'pendente',
    v_shipping, v_total, p_customer_lat, p_customer_lng,
    v_discount_amount, v_shipping_discount, v_coupon_code, p_promotion_id
  );

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_product FROM sunset.products WHERE id = (v_item->>'product_id');
    v_quantity := (v_item->>'quantity')::bigint;
    v_item_id := gen_random_uuid()::text;

    INSERT INTO sunset.order_items (id, order_id, product_id, product_name, unit_price, quantity)
      VALUES (v_item_id, v_order_id, v_product.id, v_product.name, v_product.price, v_quantity);

    UPDATE sunset.products SET quantity = quantity - v_quantity WHERE id = v_product.id;
  END LOOP;

  RETURN sunset.get_order(v_order_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.create_order(text, text, text, text, text, text, jsonb, double precision, double precision, text, text, text, text) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- 6. get_order — mesmo nome, só o campo campaign_id vira promotion_id
--    no jsonb de saída (chamada pelo cliente/checkout/motoboy também,
--    por isso não pode ganhar nenhum campo novo aqui).
-- ─────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS sunset.get_order(text);

CREATE OR REPLACE FUNCTION sunset.get_order(p_order_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = sunset, public
AS $$
  SELECT jsonb_build_object(
    'id', o.id,
    'customer_name', o.customer_name,
    'customer_whatsapp', o.customer_whatsapp,
    'delivery_type', o.delivery_type,
    'neighborhood', o.neighborhood,
    'address', o.address,
    'reference_point', o.reference_point,
    'payment_method', o.payment_method,
    'payment_status', o.payment_status,
    'status', o.status,
    'shipping_price', o.shipping_price,
    'total', o.total,
    'discount_amount', o.discount_amount,
    'shipping_discount', o.shipping_discount,
    'coupon_code', o.coupon_code,
    'promotion_id', o.promotion_id,
    'motoboy_id', o.motoboy_id,
    'motoboy_name', m.name,
    'motoboy_whatsapp', m.whatsapp,
    'pix_payment_id', o.pix_payment_id,
    'pix_qr_base64', o.pix_qr_base64,
    'pix_copia_cola', o.pix_copia_cola,
    'customer_lat', o.customer_lat,
    'customer_lng', o.customer_lng,
    'motoboy_paid_at', o.motoboy_paid_at,
    'delivery_started_at', o.delivery_started_at,
    'delivered_at', o.delivered_at,
    'created_at', o.created_at,
    'updated_at', o.updated_at,
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', oi.product_id,
        'product_name', oi.product_name,
        'unit_price', oi.unit_price,
        'quantity', oi.quantity
      ))
      FROM sunset.order_items oi WHERE oi.order_id = o.id
    ), '[]'::jsonb)
  )
  FROM sunset.orders o
  LEFT JOIN sunset.motoboys m ON m.id = o.motoboy_id
  WHERE o.id = p_order_id;
$$;
GRANT EXECUTE ON FUNCTION sunset.get_order(text) TO anon, authenticated;

-- sunset._get_order_admin, sunset.admin_list_orders e
-- sunset.admin_update_order_status (sunset_comissao_origem_pedido.sql)
-- não referenciam campaign_id diretamente — _get_order_admin só faz
-- sunset.get_order(...) || jsonb_build_object(sold_by_*), então herda o
-- campo já renomeado (promotion_id) por tabela. Nenhuma das três precisa
-- ser recriada aqui.

-- ─────────────────────────────────────────────────────
-- 7. Financeiro — série temporal (campaign_orders/campaign_discount
--    viram promotion_orders/promotion_discount, mesmo nome de função)
-- ─────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS sunset.admin_financeiro_timeseries(text, bigint);

CREATE OR REPLACE FUNCTION sunset.admin_financeiro_timeseries(p_token text, p_days bigint DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_days bigint := GREATEST(LEAST(COALESCE(p_days, 30), 180), 1);
  v_result jsonb;
BEGIN
  PERFORM sunset._require_admin(p_token);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'date', d.day,
      'quantity_sold', COALESCE(q.qty, 0),
      'revenue', COALESCE(o.revenue, 0),
      'orders_count', COALESCE(o.orders_count, 0),
      'coupon_orders', COALESCE(o.coupon_orders, 0),
      'coupon_discount', COALESCE(o.coupon_discount, 0),
      'promotion_orders', COALESCE(o.promotion_orders, 0),
      'promotion_discount', COALESCE(o.promotion_discount, 0)
    ) ORDER BY d.day), '[]'::jsonb)
    INTO v_result
    FROM generate_series(current_date - (v_days - 1), current_date, interval '1 day') AS d(day)
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) AS orders_count,
        SUM(total) AS revenue,
        COUNT(*) FILTER (WHERE coupon_code IS NOT NULL) AS coupon_orders,
        SUM(discount_amount + shipping_discount) FILTER (WHERE coupon_code IS NOT NULL) AS coupon_discount,
        COUNT(*) FILTER (WHERE promotion_id IS NOT NULL) AS promotion_orders,
        SUM(discount_amount + shipping_discount) FILTER (WHERE promotion_id IS NOT NULL) AS promotion_discount
      FROM sunset.orders
      WHERE payment_status = 'pago' AND created_at::date = d.day::date
    ) o ON true
    LEFT JOIN LATERAL (
      SELECT SUM(oi.quantity) AS qty
      FROM sunset.order_items oi JOIN sunset.orders ord ON ord.id = oi.order_id
      WHERE ord.payment_status = 'pago' AND ord.created_at::date = d.day::date
    ) q ON true;

  RETURN v_result;
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_financeiro_timeseries(text, bigint) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- 8. CRM — sunset.crm_segments.campaign_id vira promotion_id (só a
--    referência ao banner mudou de nome; segmentação em si é
--    intocada). admin_list_segments e admin_delete_segment não
--    referenciam a coluna, não precisam ser recriadas.
-- ─────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS sunset._segment_json(text);

CREATE OR REPLACE FUNCTION sunset._segment_json(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sunset, public AS $$
  SELECT jsonb_build_object(
    'id', id, 'name', name, 'description', description, 'filter_criteria', filter_criteria,
    'coupon_id', coupon_id, 'promotion_id', promotion_id, 'created_at', created_at
  ) FROM sunset.crm_segments WHERE id = p_id;
$$;

DROP FUNCTION IF EXISTS sunset.admin_create_segment(text, text, text, jsonb, text, text);

CREATE OR REPLACE FUNCTION sunset.admin_create_segment(
  p_token text, p_name text, p_description text, p_filter_criteria jsonb,
  p_coupon_id text DEFAULT NULL, p_promotion_id text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_id text := gen_random_uuid()::text;
BEGIN
  PERFORM sunset._require_admin(p_token);
  IF trim(p_name) = '' THEN
    RAISE EXCEPTION 'name is required';
  END IF;
  INSERT INTO sunset.crm_segments (id, name, description, filter_criteria, coupon_id, promotion_id)
    VALUES (v_id, trim(p_name), NULLIF(trim(p_description), ''), p_filter_criteria, p_coupon_id, p_promotion_id);
  RETURN sunset._segment_json(v_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_create_segment(text, text, text, jsonb, text, text) TO anon, authenticated;

DROP FUNCTION IF EXISTS sunset.admin_update_segment(text, text, text, text, jsonb, text, text);

CREATE OR REPLACE FUNCTION sunset.admin_update_segment(
  p_token text, p_id text, p_name text, p_description text, p_filter_criteria jsonb,
  p_coupon_id text DEFAULT NULL, p_promotion_id text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
BEGIN
  PERFORM sunset._require_admin(p_token);
  IF trim(p_name) = '' THEN
    RAISE EXCEPTION 'name is required';
  END IF;
  UPDATE sunset.crm_segments SET
    name = trim(p_name), description = NULLIF(trim(p_description), ''),
    filter_criteria = p_filter_criteria, coupon_id = p_coupon_id, promotion_id = p_promotion_id
  WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'segment not found';
  END IF;
  RETURN sunset._segment_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_update_segment(text, text, text, text, jsonb, text, text) TO anon, authenticated;
