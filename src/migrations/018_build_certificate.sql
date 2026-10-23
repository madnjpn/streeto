-- Link a build to one of the owner's My Ride vehicles and keep a copy of
-- the registration certificate (tech passport) data on the build itself.
-- The link is what lets a build pull the same details as the vehicle;
-- the copied columns keep the build page working even if the vehicle is
-- later removed.
ALTER TABLE builds ADD COLUMN linked_vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE SET NULL;

ALTER TABLE builds ADD COLUMN number_plate TEXT;             -- A
ALTER TABLE builds ADD COLUMN technical_passport TEXT;       -- P
ALTER TABLE builds ADD COLUMN registration_date TEXT;        -- I
ALTER TABLE builds ADD COLUMN owner_surname TEXT;            -- C.1.1
ALTER TABLE builds ADD COLUMN owner_name TEXT;               -- C.1.2
ALTER TABLE builds ADD COLUMN owner_address TEXT;            -- C.1.3
ALTER TABLE builds ADD COLUMN owner_id TEXT;                 -- C.1.4
ALTER TABLE builds ADD COLUMN owner_of_vehicle TEXT;         -- C.4(a)
ALTER TABLE builds ADD COLUMN expiry_date TEXT;              -- H
ALTER TABLE builds ADD COLUMN vehicle_type TEXT;             -- D.2
ALTER TABLE builds ADD COLUMN vin TEXT;                      -- E
ALTER TABLE builds ADD COLUMN max_laden_mass INTEGER;        -- F.1
ALTER TABLE builds ADD COLUMN permissible_mass INTEGER;      -- F.2
ALTER TABLE builds ADD COLUMN unladen_mass INTEGER;          -- G
ALTER TABLE builds ADD COLUMN engine_capacity INTEGER;       -- P.1
ALTER TABLE builds ADD COLUMN net_power_kw INTEGER;          -- P.2
ALTER TABLE builds ADD COLUMN fuel_type TEXT;                -- P.3
ALTER TABLE builds ADD COLUMN engine_number TEXT;            -- P.5
ALTER TABLE builds ADD COLUMN power_weight_ratio REAL;       -- Q
ALTER TABLE builds ADD COLUMN colour TEXT;                   -- R
ALTER TABLE builds ADD COLUMN seats INTEGER;                 -- S.1
ALTER TABLE builds ADD COLUMN standing_places INTEGER;       -- S.2
