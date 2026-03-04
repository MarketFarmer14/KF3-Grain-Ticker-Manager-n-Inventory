import type { Database } from './database.types';

type Contract = Database['public']['Tables']['contracts']['Row'];

export interface MatchResult {
  contract: Contract | null;
  matchType: 'exact' | 'fuzzy' | 'spot' | 'overfill';
  confidence: number;
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
    const notFilled = (c.percent_filled || 0) < 100; // Skip 100% filled contracts
    const notSpot = !c.is_spot_sale; // Skip spot sales

    return personMatch && cropMatch && throughMatch && notFilled && notSpot;
  });

  if (matchingContracts.length === 0) {
    return { contract: null, matchType: 'spot', confidence: 0 };
  }

  // Sort by fewest remaining bushels first (fill smallest gaps first)
  const sorted = matchingContracts.sort((a, b) => {
    const aRemaining = a.remaining_bushels ?? (a.contracted_bushels - a.delivered_bushels);
    const bRemaining = b.remaining_bushels ?? (b.contracted_bushels - b.delivered_bushels);
    return aRemaining - bRemaining;
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
  bushels?: number;
}) {
  const date = new Date(ticket.ticket_date).toLocaleDateString();
  return {
    contract_number: `SPOT-${date}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`,
    crop: ticket.crop,
    owner: ticket.person,
    through: ticket.through,
    destination: ticket.delivery_location,
    contracted_bushels: ticket.bushels || 1, // Must be > 0 for CHECK constraint
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
