// Smart contract matching utility with fuzzy location matching

import type { Database } from './database.types';

type Contract = Database['public']['Tables']['contracts']['Row'];

export interface MatchResult {
  contract: Contract | null;
  matchType: 'exact' | 'fuzzy' | 'spot' | 'overfill';
  confidence: number;
}

// Normalize location strings for fuzzy matching
function normalizeLocation(location: string): string {
  return location
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '') // Remove all non-alphanumeric
    .trim();
}

// Check if two locations match (fuzzy)
function locationsMatch(loc1: string, loc2: string): boolean {
  const normalized1 = normalizeLocation(loc1);
  const normalized2 = normalizeLocation(loc2);
  return normalized1 === normalized2;
}

// Find best matching contract for a ticket
export function findBestContract(
  ticket: {
    person: string;
    crop: string;
    through: string;
    delivery_location: string;
  },
  contracts: Contract[]
): MatchResult {
  // Filter contracts that match person, crop, and through
  const matchingContracts = contracts.filter((c) => {
    const personMatch = c.owner === ticket.person;
    const cropMatch = c.crop === ticket.crop;
    const throughMatch = c.through === ticket.through;
    const locationMatch = locationsMatch(c.destination, ticket.delivery_location);
    const notFilled = (c.percent_filled || 0) < 100; // Skip 100% filled contracts
    const notSpot = !c.is_spot_sale; // Skip spot sales

    return personMatch && cropMatch && throughMatch && locationMatch && notFilled && !notSpot;
  });

  if (matchingContracts.length === 0) {
    return { contract: null, matchType: 'spot', confidence: 0 };
  }

  // Sort by urgency: nearest end date first
  const sorted = matchingContracts.sort((a, b) => {
    const aDate = a.end_date ? new Date(a.end_date).getTime() : Infinity;
    const bDate = b.end_date ? new Date(b.end_date).getTime() : Infinity;
    return aDate - bDate;
  });

  return {
    contract: sorted[0],
    matchType: 'exact',
    confidence: 100,
  };
}

// Create spot sale contract
export function createSpotSaleContract(ticket: {
  person: string;
  crop: string;
  through: string;
  delivery_location: string;
  ticket_date: string;
  crop_year: string;
}) {
  const date = new Date(ticket.ticket_date).toLocaleDateString();
  return {
    contract_number: `SPOT-${date}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`,
    crop: ticket.crop,
    owner: ticket.person,
    through: ticket.through,
    destination: ticket.delivery_location,
    contracted_bushels: 0, // Spot sales have no contracted amount
    start_date: ticket.ticket_date,
    end_date: ticket.ticket_date,
    priority: 10, // Lowest priority
    overfill_allowed: true,
    is_template: false,
    is_spot_sale: true,
    notes: `Auto-created spot sale on ${date}`,
    crop_year: ticket.crop_year,
  };
}
