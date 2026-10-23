-- My Garage: personal vehicles
CREATE TABLE IF NOT EXISTS vehicles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  make TEXT,
  model TEXT,
  year INTEGER,
  photo TEXT,
  number_plate TEXT,
  technical_passport TEXT,
  current_mileage INTEGER NOT NULL DEFAULT 0,
  oil_change_mileage INTEGER,
  oil_change_interval INTEGER DEFAULT 5000,
  linked_build_id INTEGER REFERENCES builds(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vehicle_maintenance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  item_name TEXT NOT NULL,
  mileage INTEGER NOT NULL,
  cost REAL,
  notes TEXT,
  changed_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
