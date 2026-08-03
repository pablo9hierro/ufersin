-- Essential landing: rectangular hero image (not promo banners).
ALTER TABLE subscribers
  ADD COLUMN IF NOT EXISTS landing_hero_image_url text;
