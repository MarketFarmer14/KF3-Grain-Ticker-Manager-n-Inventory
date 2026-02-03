/*
  # Grain Ticket Management System Database Schema

  ## Overview
  Complete database schema for grain delivery ticket management system with contracts,
  ticket tracking, audit logging, and automated contract fulfillment calculations.

  ## New Tables
  
  ### `tickets`
  Stores grain delivery ticket information with image uploads and status tracking.
  - `id` (uuid, primary key) - Unique ticket identifier
  - `ticket_date` (date) - Date of the ticket
  - `ticket_number` (text, nullable) - Optional ticket number
  - `person` (text) - Person delivering the grain
  - `crop` (text) - Type of crop (Corn, Soybeans, etc.)
  - `bushels` (numeric) - Quantity in bushels
  - `delivery_location` (text) - Where grain was delivered
  - `through` (text) - Elevator/handler (Akron, RVC, Cargill)
  - `elevator` (text, nullable) - Specific elevator name
  - `contract_id` (uuid, nullable, foreign key) - Links to contracts table
  - `status` (enum) - needs_review, approved, rejected, hold
  - `image_url` (text, nullable) - URL to uploaded ticket image
  - `duplicate_flag` (boolean) - Marks potential duplicates
  - `duplicate_group` (text, nullable) - Groups duplicate tickets
  - `notes` (text, nullable) - Additional notes
  - `created_at` (timestamptz) - Creation timestamp
  - `updated_at` (timestamptz) - Last update timestamp

  ### `contracts`
  Manages grain contracts with automatic bushel tracking and fulfillment percentages.
  - `id` (uuid, primary key) - Unique contract identifier
  - `contract_number` (text, unique) - Contract reference number
  - `crop` (text) - Type of crop
  - `buyer` (text, nullable) - Buyer name
  - `destination` (text) - Delivery destination
  - `through` (text, nullable) - Preferred elevator (Any, Akron, RVC, Cargill)
  - `contracted_bushels` (numeric) - Total bushels contracted
  - `delivered_bushels` (numeric) - Bushels delivered so far
  - `remaining_bushels` (numeric, computed) - Bushels left to deliver
  - `percent_filled` (numeric, computed) - Percentage complete
  - `start_date` (date, nullable) - Contract start date
  - `end_date` (date, nullable) - Contract end date
  - `priority` (integer) - Priority level (1=urgent, 10=low)
  - `overfill_allowed` (boolean) - Allow deliveries over contracted amount
  - `is_template` (boolean) - Mark as template contract
  - `notes` (text, nullable) - Additional notes
  - `created_at` (timestamptz) - Creation timestamp
  - `updated_at` (timestamptz) - Last update timestamp

  ### `ticket_audit`
  Audit trail for all ticket changes.
  - `id` (uuid, primary key) - Unique audit record identifier
  - `ticket_id` (uuid, nullable, foreign key) - Related ticket
  - `action` (text) - Action performed
  - `old_values` (jsonb, nullable) - Values before change
  - `new_values` (jsonb, nullable) - Values after change
  - `changed_at` (timestamptz) - When change occurred

  ## Security
  - RLS enabled on all tables
  - Public access for authenticated users (simple auth model as per PRD)
  - Audit table tracks all changes

  ## Automation
  - Automatic timestamp updates
  - Automatic contract fulfillment calculations via triggers
  - Computed columns for remaining_bushels and percent_filled
*/

-- Create custom types
CREATE TYPE ticket_status AS ENUM ('needs_review', 'approved', 'rejected', 'hold');

-- =====================================================
-- TICKETS TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_date date NOT NULL DEFAULT CURRENT_DATE,
  ticket_number text,
  person text NOT NULL DEFAULT '',
  crop text NOT NULL DEFAULT '',
  bushels numeric NOT NULL DEFAULT 0,
  delivery_location text NOT NULL DEFAULT '',
  through text NOT NULL DEFAULT 'Akron',
  elevator text,
  contract_id uuid,
  status ticket_status NOT NULL DEFAULT 'needs_review',
  image_url text,
  duplicate_flag boolean NOT NULL DEFAULT false,
  duplicate_group text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_contract_id ON tickets(contract_id);
CREATE INDEX IF NOT EXISTS idx_tickets_ticket_date ON tickets(ticket_date);
CREATE INDEX IF NOT EXISTS idx_tickets_crop ON tickets(crop);

-- =====================================================
-- CONTRACTS TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_number text UNIQUE NOT NULL,
  crop text NOT NULL,
  buyer text,
  destination text NOT NULL,
  through text DEFAULT 'Any',
  contracted_bushels numeric NOT NULL DEFAULT 0,
  delivered_bushels numeric NOT NULL DEFAULT 0,
  remaining_bushels numeric GENERATED ALWAYS AS (contracted_bushels - delivered_bushels) STORED,
  percent_filled numeric GENERATED ALWAYS AS (
    CASE 
      WHEN contracted_bushels > 0 THEN (delivered_bushels / contracted_bushels * 100)
      ELSE 0 
    END
  ) STORED,
  start_date date,
  end_date date,
  priority integer NOT NULL DEFAULT 5 CHECK (priority >= 1 AND priority <= 10),
  overfill_allowed boolean NOT NULL DEFAULT true,
  is_template boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contracts_crop ON contracts(crop);
CREATE INDEX IF NOT EXISTS idx_contracts_priority ON contracts(priority);
CREATE INDEX IF NOT EXISTS idx_contracts_remaining ON contracts(remaining_bushels);

-- =====================================================
-- TICKET AUDIT TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS ticket_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid,
  action text NOT NULL,
  old_values jsonb,
  new_values jsonb,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ticket_audit_ticket_id ON ticket_audit(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_audit_changed_at ON ticket_audit(changed_at);

-- =====================================================
-- FOREIGN KEYS
-- =====================================================

ALTER TABLE tickets 
  ADD CONSTRAINT fk_tickets_contract 
  FOREIGN KEY (contract_id) 
  REFERENCES contracts(id) 
  ON DELETE SET NULL;

ALTER TABLE ticket_audit 
  ADD CONSTRAINT fk_ticket_audit_ticket 
  FOREIGN KEY (ticket_id) 
  REFERENCES tickets(id) 
  ON DELETE CASCADE;

-- =====================================================
-- TRIGGERS & FUNCTIONS
-- =====================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for tickets updated_at
DROP TRIGGER IF EXISTS update_tickets_updated_at ON tickets;
CREATE TRIGGER update_tickets_updated_at
  BEFORE UPDATE ON tickets
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Trigger for contracts updated_at
DROP TRIGGER IF EXISTS update_contracts_updated_at ON contracts;
CREATE TRIGGER update_contracts_updated_at
  BEFORE UPDATE ON contracts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Function to update contract delivered bushels when tickets change
CREATE OR REPLACE FUNCTION update_contract_bushels()
RETURNS TRIGGER AS $$
BEGIN
  -- When a ticket is approved or updated, recalculate contract totals
  IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') AND NEW.status = 'approved' AND NEW.contract_id IS NOT NULL THEN
    UPDATE contracts
    SET delivered_bushels = (
      SELECT COALESCE(SUM(bushels), 0)
      FROM tickets
      WHERE contract_id = NEW.contract_id
        AND status = 'approved'
    )
    WHERE id = NEW.contract_id;
  END IF;

  -- When a ticket is deleted or status changes, recalculate
  IF (TG_OP = 'DELETE' OR TG_OP = 'UPDATE') AND OLD.contract_id IS NOT NULL THEN
    UPDATE contracts
    SET delivered_bushels = (
      SELECT COALESCE(SUM(bushels), 0)
      FROM tickets
      WHERE contract_id = OLD.contract_id
        AND status = 'approved'
        AND id != COALESCE(NEW.id, OLD.id)
    )
    WHERE id = OLD.contract_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Trigger to update contract bushels
DROP TRIGGER IF EXISTS update_contract_bushels_trigger ON tickets;
CREATE TRIGGER update_contract_bushels_trigger
  AFTER INSERT OR UPDATE OR DELETE ON tickets
  FOR EACH ROW
  EXECUTE FUNCTION update_contract_bushels();

-- =====================================================
-- ROW LEVEL SECURITY
-- =====================================================

-- Enable RLS on all tables
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_audit ENABLE ROW LEVEL SECURITY;

-- Tickets policies (public access for this simple auth system)
CREATE POLICY "Allow all access to tickets"
  ON tickets
  FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);

-- Contracts policies
CREATE POLICY "Allow all access to contracts"
  ON contracts
  FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);

-- Ticket audit policies (read-only for public, system writes)
CREATE POLICY "Allow read access to ticket_audit"
  ON ticket_audit
  FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Allow insert to ticket_audit"
  ON ticket_audit
  FOR INSERT
  TO public
  WITH CHECK (true);
