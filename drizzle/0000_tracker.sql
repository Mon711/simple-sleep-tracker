CREATE TABLE entries (
  owner TEXT NOT NULL,
  night TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('bed', 'wake')),
  entry_id TEXT NOT NULL UNIQUE,
  at_ms INTEGER NOT NULL,
  timezone TEXT NOT NULL CHECK (timezone = 'Asia/Kolkata'),
  mood TEXT CHECK (mood IN ('Anxious', 'Okay', 'Calm')),
  difficulty TEXT CHECK (difficulty IN ('Hard to settle', 'Delayed going to bed', 'Other difficulty')),
  rested TEXT CHECK (rested IN ('Not rested', 'Somewhat rested', 'Rested')),
  nightmare INTEGER CHECK (nightmare IN (0, 1)),
  revision INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (owner, night, kind),
  CHECK ((kind = 'bed' AND rested IS NULL AND nightmare IS NULL) OR (kind = 'wake' AND difficulty IS NULL))
);
--> statement-breakpoint
CREATE TRIGGER entry_order_insert
BEFORE INSERT ON entries
WHEN EXISTS (
  SELECT 1 FROM entries
  WHERE owner = NEW.owner AND night = NEW.night
    AND ((NEW.kind = 'wake' AND kind = 'bed' AND NEW.at_ms < at_ms)
      OR (NEW.kind = 'bed' AND kind = 'wake' AND NEW.at_ms > at_ms))
)
BEGIN
  SELECT RAISE(ABORT, 'entry_order');
END;
--> statement-breakpoint
CREATE TRIGGER entry_order_update
BEFORE UPDATE OF night, at_ms ON entries
WHEN EXISTS (
  SELECT 1 FROM entries
  WHERE owner = NEW.owner AND night = NEW.night
    AND ((NEW.kind = 'wake' AND kind = 'bed' AND NEW.at_ms < at_ms)
      OR (NEW.kind = 'bed' AND kind = 'wake' AND NEW.at_ms > at_ms))
)
BEGIN
  SELECT RAISE(ABORT, 'entry_order');
END;
--> statement-breakpoint
CREATE TABLE goals (
  owner TEXT NOT NULL,
  revision INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'paused')),
  bedtime TEXT,
  wake_time TEXT,
  period TEXT NOT NULL CHECK (period IN ('weekly', 'monthly')),
  step_minutes INTEGER NOT NULL CHECK (step_minutes BETWEEN 1 AND 60),
  direction TEXT NOT NULL CHECK (direction IN ('earlier', 'later')),
  effective_night TEXT NOT NULL,
  review_night TEXT,
  changed_at_ms INTEGER NOT NULL,
  change_kind TEXT NOT NULL CHECK (change_kind IN ('created', 'edited', 'adjusted', 'paused')),
  PRIMARY KEY (owner, revision),
  CHECK (bedtime IS NOT NULL OR wake_time IS NOT NULL),
  CHECK ((status = 'active' AND review_night IS NOT NULL) OR (status = 'paused' AND review_night IS NULL))
);
--> statement-breakpoint
CREATE INDEX goals_by_night ON goals (owner, effective_night, revision);
