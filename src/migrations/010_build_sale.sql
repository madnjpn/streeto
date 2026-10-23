-- Selling a build: the owner ticks "for sale" and names a price, so the
-- car also shows up under Builds > For sale. price is whole GEL units
-- (NULL means "ask", the same convention the parts board uses) and
-- price_note carries things like "negotiable" or "swap".
--
-- A listing is only ever public: the "For sale" tab filters on
-- visibility = 'public', so ticking the box on a private build keeps it
-- hidden from buyers.
ALTER TABLE builds ADD COLUMN for_sale   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE builds ADD COLUMN price      INTEGER;
ALTER TABLE builds ADD COLUMN price_note TEXT;

CREATE INDEX idx_builds_for_sale ON builds (for_sale, created_at DESC);
