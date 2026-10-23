-- Georgian registration certificate (tech passport) details.
-- These mirror the fields printed on the paper document so My Ride can
-- render a card that looks like it. The letter codes below match the
-- standard (A, B, I, C.1.1 ... S.2) used on the certificate itself.
ALTER TABLE vehicles ADD COLUMN registration_date TEXT;      -- I
ALTER TABLE vehicles ADD COLUMN owner_surname TEXT;          -- C.1.1
ALTER TABLE vehicles ADD COLUMN owner_name TEXT;             -- C.1.2
ALTER TABLE vehicles ADD COLUMN owner_address TEXT;          -- C.1.3
ALTER TABLE vehicles ADD COLUMN owner_id TEXT;               -- C.1.4
ALTER TABLE vehicles ADD COLUMN owner_of_vehicle TEXT;       -- C.4(a)
ALTER TABLE vehicles ADD COLUMN expiry_date TEXT;            -- H
ALTER TABLE vehicles ADD COLUMN vehicle_type TEXT;           -- D.2
ALTER TABLE vehicles ADD COLUMN vin TEXT;                    -- E
ALTER TABLE vehicles ADD COLUMN max_laden_mass INTEGER;      -- F.1
ALTER TABLE vehicles ADD COLUMN permissible_mass INTEGER;    -- F.2
ALTER TABLE vehicles ADD COLUMN unladen_mass INTEGER;        -- G
ALTER TABLE vehicles ADD COLUMN engine_capacity INTEGER;     -- P.1
ALTER TABLE vehicles ADD COLUMN net_power_kw INTEGER;        -- P.2
ALTER TABLE vehicles ADD COLUMN fuel_type TEXT;              -- P.3
ALTER TABLE vehicles ADD COLUMN engine_number TEXT;          -- P.5
ALTER TABLE vehicles ADD COLUMN power_weight_ratio REAL;     -- Q
ALTER TABLE vehicles ADD COLUMN colour TEXT;                 -- R
ALTER TABLE vehicles ADD COLUMN seats INTEGER;               -- S.1
ALTER TABLE vehicles ADD COLUMN standing_places INTEGER;     -- S.2
