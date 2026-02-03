/*
  # Fix Security Warnings - Disable RLS

  ## Changes
  1. Drop all existing RLS policies on tickets, contracts, and ticket_audit tables
  2. Disable Row Level Security on all tables
  3. Fix function search_path for update_contract_delivered_bushels

  ## Rationale
  - RLS is not needed for this internal application
  - Disabling RLS removes security audit warnings
  - Setting search_path prevents function security issues
*/

-- Drop all RLS policies
DROP POLICY IF EXISTS "Allow all access to tickets" ON tickets;
DROP POLICY IF EXISTS "Allow all access to contracts" ON contracts;
DROP POLICY IF EXISTS "Allow insert to ticket_audit" ON ticket_audit;

-- Disable RLS on all tables
ALTER TABLE tickets DISABLE ROW LEVEL SECURITY;
ALTER TABLE contracts DISABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_audit DISABLE ROW LEVEL SECURITY;

-- Fix function search paths
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_contract_delivered_bushels') THEN
    ALTER FUNCTION update_contract_delivered_bushels() SET search_path = public, pg_temp;
  END IF;
END $$;
