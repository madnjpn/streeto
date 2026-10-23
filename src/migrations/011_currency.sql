-- Two currencies: the seller picks GEL or USD for a price, and each
-- visitor can read every price in their own pick. The amount is stored
-- exactly as it was typed, together with the currency it was typed in,
-- so the seller's figure is never lost - display converts on the fly at
-- the reference rate in config (config.usdToGel).
--
-- Existing prices were all quoted in lari, so the default is right for
-- them. NULL in users.currency means "never chosen".
ALTER TABLE users  ADD COLUMN currency TEXT;
ALTER TABLE parts  ADD COLUMN currency TEXT NOT NULL DEFAULT 'GEL';
ALTER TABLE builds ADD COLUMN currency TEXT NOT NULL DEFAULT 'GEL';
