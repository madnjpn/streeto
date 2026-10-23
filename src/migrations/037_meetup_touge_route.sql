-- Touge meetups: a custom route with a start (A) and a finish (B).
ALTER TABLE meetups ADD COLUMN route_start_lat REAL;
ALTER TABLE meetups ADD COLUMN route_start_lng REAL;
ALTER TABLE meetups ADD COLUMN route_start_name TEXT;
ALTER TABLE meetups ADD COLUMN route_end_lat REAL;
ALTER TABLE meetups ADD COLUMN route_end_lng REAL;
ALTER TABLE meetups ADD COLUMN route_end_name TEXT;
ALTER TABLE meetups ADD COLUMN route_distance_km REAL;