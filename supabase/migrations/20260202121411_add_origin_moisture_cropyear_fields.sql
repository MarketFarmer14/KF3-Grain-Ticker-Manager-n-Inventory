/*
  # Add Origin, Moisture, and Crop Year Fields

  ## Changes
  1. Add origin (text) field to tickets table - stores where grain came from
  2. Add moisture_percent (decimal) field to tickets table - stores moisture percentage
  3. Add crop_year (text) field to tickets table - stores crop year (2024, 2025, etc.)
  4. Add crop_year (text) field to contracts table - stores crop year for contract
  
  ## Notes
  - Origin is required for new tickets
  - Moisture percent is optional
  - Crop year defaults to current year
*/

-- Add origin field to tickets table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tickets' AND column_name = 'origin'
  ) THEN
    ALTER TABLE tickets ADD COLUMN origin text NOT NULL DEFAULT '';
  END IF;
END $$;

-- Add moisture_percent field to tickets table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tickets' AND column_name = 'moisture_percent'
  ) THEN
    ALTER TABLE tickets ADD COLUMN moisture_percent numeric(5,2);
  END IF;
END $$;

-- Add crop_year field to tickets table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tickets' AND column_name = 'crop_year'
  ) THEN
    ALTER TABLE tickets ADD COLUMN crop_year text NOT NULL DEFAULT '2025';
  END IF;
END $$;

-- Add crop_year field to contracts table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'contracts' AND column_name = 'crop_year'
  ) THEN
    ALTER TABLE contracts ADD COLUMN crop_year text NOT NULL DEFAULT '2025';
  END IF;
END $$;

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_tickets_crop_year ON tickets(crop_year);
CREATE INDEX IF NOT EXISTS idx_contracts_crop_year ON contracts(crop_year);
CREATE INDEX IF NOT EXISTS idx_tickets_origin ON tickets(origin);
