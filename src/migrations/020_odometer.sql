-- Odometer reading for a build. When the build is linked to one of the
-- owner's My Ride vehicles this stays in step with `vehicles.current_mileage`
-- in both directions, so the same number is shown on both pages.
ALTER TABLE builds ADD COLUMN odometer_km INTEGER;
