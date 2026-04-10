/*
  # Fix Contract Delivered Bushels Trigger

  ## Problem
  The existing trigger only fires on `tickets` table changes and calculates
  delivered_bushels solely from tickets.bushels where status='approved'.

  But ticket_splits is the source of truth for allocations. When splits are
  added/removed/updated, contracts.delivered_bushels was never recalculated,
  causing the Haul Board to show stale data.

  ## Fix
  1. Replace update_contract_bushels() to calculate from BOTH:
     - ticket_splits.bushels (split-allocated tickets)
     - tickets.bushels for legacy tickets (contract_id set, no splits exist)
  2. Add trigger on ticket_splits table (INSERT/UPDATE/DELETE)
  3. Keep existing trigger on tickets table (uses same function)
*/

-- Replace the function to account for splits
CREATE OR REPLACE FUNCTION update_contract_bushels()
RETURNS TRIGGER AS $$
DECLARE
  target_contract_id uuid;
BEGIN
  -- Determine which contract(s) to recalculate
  IF TG_TABLE_NAME = 'ticket_splits' THEN
    -- ticket_splits trigger: recalculate the affected contract
    IF TG_OP = 'DELETE' THEN
      target_contract_id := OLD.contract_id;
    ELSE
      target_contract_id := NEW.contract_id;
    END IF;

    -- Also recalculate old contract on UPDATE if contract_id changed
    IF TG_OP = 'UPDATE' AND OLD.contract_id IS DISTINCT FROM NEW.contract_id AND OLD.contract_id IS NOT NULL THEN
      UPDATE contracts
      SET delivered_bushels = (
        -- Splits total
        SELECT COALESCE(SUM(ts.bushels), 0)
        FROM ticket_splits ts
        WHERE ts.contract_id = OLD.contract_id
      ) + (
        -- Legacy tickets: have contract_id but NO splits for that ticket
        SELECT COALESCE(SUM(t.bushels), 0)
        FROM tickets t
        WHERE t.contract_id = OLD.contract_id
          AND t.status = 'approved'
          AND t.deleted = false
          AND NOT EXISTS (
            SELECT 1 FROM ticket_splits ts2 WHERE ts2.ticket_id = t.id
          )
      )
      WHERE id = OLD.contract_id;
    END IF;

    -- Recalculate the target contract
    IF target_contract_id IS NOT NULL THEN
      UPDATE contracts
      SET delivered_bushels = (
        SELECT COALESCE(SUM(ts.bushels), 0)
        FROM ticket_splits ts
        WHERE ts.contract_id = target_contract_id
      ) + (
        SELECT COALESCE(SUM(t.bushels), 0)
        FROM tickets t
        WHERE t.contract_id = target_contract_id
          AND t.status = 'approved'
          AND t.deleted = false
          AND NOT EXISTS (
            SELECT 1 FROM ticket_splits ts2 WHERE ts2.ticket_id = t.id
          )
      )
      WHERE id = target_contract_id;
    END IF;

  ELSE
    -- tickets trigger: recalculate affected contract(s)
    IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') AND NEW.contract_id IS NOT NULL THEN
      UPDATE contracts
      SET delivered_bushels = (
        SELECT COALESCE(SUM(ts.bushels), 0)
        FROM ticket_splits ts
        WHERE ts.contract_id = NEW.contract_id
      ) + (
        SELECT COALESCE(SUM(t.bushels), 0)
        FROM tickets t
        WHERE t.contract_id = NEW.contract_id
          AND t.status = 'approved'
          AND t.deleted = false
          AND NOT EXISTS (
            SELECT 1 FROM ticket_splits ts2 WHERE ts2.ticket_id = t.id
          )
      )
      WHERE id = NEW.contract_id;
    END IF;

    IF (TG_OP = 'DELETE' OR TG_OP = 'UPDATE') AND OLD.contract_id IS NOT NULL THEN
      UPDATE contracts
      SET delivered_bushels = (
        SELECT COALESCE(SUM(ts.bushels), 0)
        FROM ticket_splits ts
        WHERE ts.contract_id = OLD.contract_id
      ) + (
        SELECT COALESCE(SUM(t.bushels), 0)
        FROM tickets t
        WHERE t.contract_id = OLD.contract_id
          AND t.status = 'approved'
          AND t.deleted = false
          AND NOT EXISTS (
            SELECT 1 FROM ticket_splits ts2 WHERE ts2.ticket_id = t.id
          )
      )
      WHERE id = OLD.contract_id;
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Recreate tickets trigger (same function, updated logic)
DROP TRIGGER IF EXISTS update_contract_bushels_trigger ON tickets;
CREATE TRIGGER update_contract_bushels_trigger
  AFTER INSERT OR UPDATE OR DELETE ON tickets
  FOR EACH ROW
  EXECUTE FUNCTION update_contract_bushels();

-- Add NEW trigger on ticket_splits
DROP TRIGGER IF EXISTS update_contract_bushels_splits_trigger ON ticket_splits;
CREATE TRIGGER update_contract_bushels_splits_trigger
  AFTER INSERT OR UPDATE OR DELETE ON ticket_splits
  FOR EACH ROW
  EXECUTE FUNCTION update_contract_bushels();

-- Disable RLS on ticket_splits to match other tables
ALTER TABLE ticket_splits DISABLE ROW LEVEL SECURITY;

-- Fix search_path for security
ALTER FUNCTION update_contract_bushels() SET search_path = public, pg_temp;

-- One-time recalculation to fix any currently stale contracts
UPDATE contracts
SET delivered_bushels = (
  SELECT COALESCE(SUM(ts.bushels), 0)
  FROM ticket_splits ts
  WHERE ts.contract_id = contracts.id
) + (
  SELECT COALESCE(SUM(t.bushels), 0)
  FROM tickets t
  WHERE t.contract_id = contracts.id
    AND t.status = 'approved'
    AND t.deleted = false
    AND NOT EXISTS (
      SELECT 1 FROM ticket_splits ts2 WHERE ts2.ticket_id = t.id
    )
);
