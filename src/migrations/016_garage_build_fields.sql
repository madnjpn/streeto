-- Add build-like fields to vehicles table
ALTER TABLE vehicles ADD COLUMN engine TEXT;
ALTER TABLE vehicles ADD COLUMN drivetrain TEXT;
ALTER TABLE vehicles ADD COLUMN transmission TEXT;
ALTER TABLE vehicles ADD COLUMN power_hp INTEGER;
ALTER TABLE vehicles ADD COLUMN torque_nm INTEGER;
ALTER TABLE vehicles ADD COLUMN weight_kg INTEGER;
ALTER TABLE vehicles ADD COLUMN mods TEXT;
ALTER TABLE vehicles ADD COLUMN description TEXT;
ALTER TABLE vehicles ADD COLUMN visibility TEXT DEFAULT 'public';
