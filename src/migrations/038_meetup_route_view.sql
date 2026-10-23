-- The camera the host left the route map at: { lat, lng, zoom }.
-- The saved preview opens on the same view instead of guessing a fit.
ALTER TABLE meetups ADD COLUMN route_view TEXT;
