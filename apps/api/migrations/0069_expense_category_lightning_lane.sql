BEGIN;

-- Widen chk_expenses_category check constraint to include 'lightning_lane'
ALTER TABLE expenses DROP CONSTRAINT IF EXISTS chk_expenses_category;
ALTER TABLE expenses
  ADD CONSTRAINT chk_expenses_category CHECK (
    category IS NULL OR category IN (
      'hotel',
      'tickets',
      'lightning_lane',
      'dining',
      'shopping',
      'transportation',
      'other'
    )
  );

COMMIT;

