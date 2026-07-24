-- =====================================================
-- "Categoria inteira" numa promoção selfie_service deixa de ser um
-- snapshot fixo dos produtos daquela categoria NO MOMENTO em que foi
-- adicionada — vira uma regra de verdade (promotion_category_discounts).
-- Um produto criado (ou recategorizado) DEPOIS que a promoção já existe
-- entra em promoção automaticamente, via trigger em sunset.products —
-- sem precisar reabrir/salvar a promoção de novo. promotions.product_ids
-- passa a ser sempre recalculado a partir de promotion_product_discounts
-- (nunca editado à mão), então checkout (create_order, que valida contra
-- product_ids) e catálogo público continuam funcionando sem precisar
-- mexer naquela função.
--
-- Execução: depois de sunset_promocao_catalogo_publico.sql.
-- =====================================================

CREATE TABLE IF NOT EXISTS sunset.promotion_category_discounts (
  id text PRIMARY KEY,
  promotion_id text NOT NULL REFERENCES sunset.promotions(id) ON DELETE CASCADE,
  category_id text NOT NULL,
  discount_type text NOT NULL,
  discount_value double precision NOT NULL
);
CREATE INDEX IF NOT EXISTS promotion_category_discounts_promotion_idx ON sunset.promotion_category_discounts (promotion_id);
CREATE INDEX IF NOT EXISTS promotion_category_discounts_category_idx ON sunset.promotion_category_discounts (category_id);
ALTER TABLE sunset.promotion_category_discounts ENABLE ROW LEVEL SECURITY;

-- _promotion_json ganha category_discounts, pra tela de editar promoção
-- reconstruir quais produtos vieram de "categoria inteira" (e com qual
-- desconto), em vez de re-tagueação manual no client.
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
    ), '[]'::jsonb),
    'category_discounts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'category_id', cd.category_id, 'discount_type', cd.discount_type, 'discount_value', cd.discount_value
      )) FROM sunset.promotion_category_discounts cd WHERE cd.promotion_id = c.id
    ), '[]'::jsonb)
  ) FROM sunset.promotions c WHERE c.id = p_id;
$$;

-- Garante que todo produto ATUAL de uma categoria com desconto-de-categoria
-- numa promoção selfie_service tenha uma linha em promotion_product_discounts
-- (sem sobrescrever um desconto individual já definido pra esse produto) e
-- recalcula product_ids a partir disso. Chamada tanto ao salvar a promoção
-- quanto pelo trigger abaixo, toda vez que um produto entra/muda pra essa
-- categoria — funciona independente de o produto ter sido cadastrado antes
-- ou depois da promoção.
CREATE OR REPLACE FUNCTION sunset._sync_promotion_category_products(p_category_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public AS $$
DECLARE
  v_rule    sunset.promotion_category_discounts%ROWTYPE;
  v_product sunset.products%ROWTYPE;
BEGIN
  FOR v_rule IN
    SELECT pcd.* FROM sunset.promotion_category_discounts pcd
    JOIN sunset.promotions p ON p.id = pcd.promotion_id
    WHERE pcd.category_id = p_category_id AND p.promotion_type = 'selfie_service'
  LOOP
    FOR v_product IN SELECT * FROM sunset.products WHERE category_id = p_category_id AND active <> 0 LOOP
      INSERT INTO sunset.promotion_product_discounts (id, promotion_id, product_id, discount_type, discount_value)
        SELECT gen_random_uuid()::text, v_rule.promotion_id, v_product.id, v_rule.discount_type, v_rule.discount_value
        WHERE NOT EXISTS (
          SELECT 1 FROM sunset.promotion_product_discounts
          WHERE promotion_id = v_rule.promotion_id AND product_id = v_product.id
        );
    END LOOP;

    UPDATE sunset.promotions SET product_ids = (
      SELECT COALESCE(array_agg(DISTINCT product_id), ARRAY[]::text[])
      FROM sunset.promotion_product_discounts WHERE promotion_id = v_rule.promotion_id
    ) WHERE id = v_rule.promotion_id;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION sunset._products_category_promo_sync_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public AS $$
BEGIN
  IF NEW.category_id IS NOT NULL THEN
    PERFORM sunset._sync_promotion_category_products(NEW.category_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sunset_product_category_promo_sync ON sunset.products;
CREATE TRIGGER sunset_product_category_promo_sync
  AFTER INSERT OR UPDATE OF category_id ON sunset.products
  FOR EACH ROW
  EXECUTE FUNCTION sunset._products_category_promo_sync_trigger();

-- admin_create_promotion / admin_update_promotion ganham p_category_discounts.
CREATE OR REPLACE FUNCTION sunset.admin_create_promotion(
  p_token text, p_title text, p_image_url text, p_product_ids text[],
  p_promotion_type text DEFAULT 'kit',
  p_discount_type text DEFAULT NULL, p_discount_value double precision DEFAULT NULL,
  p_shipping_discount_type text DEFAULT NULL, p_shipping_discount_value double precision DEFAULT NULL,
  p_starts_at text DEFAULT NULL, p_expires_at text DEFAULT NULL,
  p_product_discounts jsonb DEFAULT NULL,
  p_category_discounts jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_id text := gen_random_uuid()::text;
  v_pd jsonb;
  v_cd jsonb;
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

    IF p_category_discounts IS NOT NULL THEN
      FOR v_cd IN SELECT * FROM jsonb_array_elements(p_category_discounts) LOOP
        INSERT INTO sunset.promotion_category_discounts (id, promotion_id, category_id, discount_type, discount_value)
          VALUES (gen_random_uuid()::text, v_id, v_cd->>'category_id', v_cd->>'discount_type', (v_cd->>'discount_value')::double precision);
        PERFORM sunset._sync_promotion_category_products(v_cd->>'category_id');
      END LOOP;
    END IF;

    UPDATE sunset.promotions SET product_ids = (
      SELECT COALESCE(array_agg(DISTINCT product_id), ARRAY[]::text[])
      FROM sunset.promotion_product_discounts WHERE promotion_id = v_id
    ) WHERE id = v_id;
  END IF;

  RETURN sunset._promotion_json(v_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_create_promotion(text, text, text, text[], text, text, double precision, text, double precision, text, text, jsonb, jsonb) TO anon, authenticated;

CREATE OR REPLACE FUNCTION sunset.admin_update_promotion(
  p_token text, p_id text, p_title text, p_image_url text, p_product_ids text[],
  p_promotion_type text,
  p_discount_type text, p_discount_value double precision,
  p_shipping_discount_type text, p_shipping_discount_value double precision,
  p_active boolean,
  p_starts_at text DEFAULT NULL, p_expires_at text DEFAULT NULL,
  p_product_discounts jsonb DEFAULT NULL,
  p_category_discounts jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_pd jsonb;
  v_cd jsonb;
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
  DELETE FROM sunset.promotion_category_discounts WHERE promotion_id = p_id;

  IF p_promotion_type = 'selfie_service' THEN
    FOR v_pd IN SELECT * FROM jsonb_array_elements(p_product_discounts) LOOP
      INSERT INTO sunset.promotion_product_discounts (id, promotion_id, product_id, discount_type, discount_value)
        VALUES (gen_random_uuid()::text, p_id, v_pd->>'product_id', v_pd->>'discount_type', (v_pd->>'discount_value')::double precision);
    END LOOP;

    IF p_category_discounts IS NOT NULL THEN
      FOR v_cd IN SELECT * FROM jsonb_array_elements(p_category_discounts) LOOP
        INSERT INTO sunset.promotion_category_discounts (id, promotion_id, category_id, discount_type, discount_value)
          VALUES (gen_random_uuid()::text, p_id, v_cd->>'category_id', v_cd->>'discount_type', (v_cd->>'discount_value')::double precision);
        PERFORM sunset._sync_promotion_category_products(v_cd->>'category_id');
      END LOOP;
    END IF;

    UPDATE sunset.promotions SET product_ids = (
      SELECT COALESCE(array_agg(DISTINCT product_id), ARRAY[]::text[])
      FROM sunset.promotion_product_discounts WHERE promotion_id = p_id
    ) WHERE id = p_id;
  END IF;

  RETURN sunset._promotion_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_update_promotion(text, text, text, text, text[], text, text, double precision, text, double precision, boolean, text, text, jsonb, jsonb) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
