import type { Database } from './database.types';

type Contract = Database['public']['Tables']['contracts']['Row'];

export interface SplitAssignment {
  contract: Contract;
  bushels: number;
  person: string;
}

export interface AutoAssignmentResult {
  splits: SplitAssignment[];
  totalAssigned: number;
  remainder: number;
  needsSpotSale: boolean;
}

// Normalize location strings for fuzzy matching
function normalizeLocation(location: string): string {
  return location
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

// Check if two locations match (fuzzy)
function locationsMatch(loc1: string, loc2: string): boolean {
  const normalized1 = normalizeLocation(loc1);
  const normalized2 = normalizeLocation(loc2);
  return normalized1 === normalized2;
}

// Auto-assign ticket across multiple contracts (smallest remaining first)
export function autoAssignTicket(
  ticket: {
    person: string;
    crop: string;
    through: string;
    bushels: number;
  },
  contracts: Contract[]
): AutoAssignmentResult {
  const splits: SplitAssignment[] = [];
  let remainingBushels = ticket.bushels;

  // Filter contracts that match person, crop, and through
  const matchingContracts = contracts.filter((c) => {
    const personMatch = c.owner === ticket.person;
    const cropMatch = c.crop === ticket.crop;
    const throughMatch = c.through === ticket.through;
    const notFilled = (c.percent_filled || 0) < 100;
    const notSpot = !c.is_spot_sale;
    const hasRemaining = c.remaining_bushels > 0;

    return personMatch && cropMatch && throughMatch && notFilled && !notSpot && hasRemaining;
  });

  // Sort by remaining bushels (SMALLEST FIRST)
  const sorted = matchingContracts.sort((a, b) => {
    return a.remaining_bushels - b.remaining_bushels;
  });

  // Assign bushels to contracts (smallest first)
  for (const contract of sorted) {
    if (remainingBushels <= 0) break;

    const bushelsToAssign = Math.min(remainingBushels, contract.remaining_bushels);

    splits.push({
      contract,
      bushels: bushelsToAssign,
      person: ticket.person,
    });

    remainingBushels -= bushelsToAssign;
  }

  return {
    splits,
    totalAssigned: ticket.bushels - remainingBushels,
    remainder: remainingBushels,
    needsSpotSale: remainingBushels > 0,
  };
}

// Create spot sale contract for leftover bushels
export function createSpotSaleContract(ticket: {
  person: string;
  crop: string;
  through: string;
  delivery_location: string;
  ticket_date: string;
  crop_year: string;
  bushels: number;
}) {
  const date = new Date(ticket.ticket_date).toLocaleDateString();
  return {
    contract_number: `SPOT-${date}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`,
    crop: ticket.crop,
    owner: ticket.person,
    through: ticket.through,
    destination: ticket.delivery_location,
    contracted_bushels: ticket.bushels,
    delivered_bushels: 0,
    start_date: ticket.ticket_date,
    end_date: ticket.ticket_date,
    priority: 10,
    overfill_allowed: true,
    is_template: false,
    is_spot_sale: true,
    notes: `Auto-created spot sale for ${ticket.bushels} bushels on ${date}`,
    crop_year: ticket.crop_year,
  };
}
