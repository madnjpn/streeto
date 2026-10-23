-- Per-user interface theme: 'street' (default), 'gold' (black & gold)
-- or 'light' (white & gold). NULL means "never chosen" - then the
-- theme cookie or the default decides.
ALTER TABLE users ADD COLUMN theme TEXT;
