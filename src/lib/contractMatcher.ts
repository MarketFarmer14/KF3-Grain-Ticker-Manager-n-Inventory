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

// Get actual remaining for a contract using split totals (source of truth)
function getRemaining(contract: Contract, actualDelivered?: Record<string, number>): number {
  if (actualDelivered) {
    return contract.contracted_bushels - (actualDelivered[contract.id] || 0);
  }
  return contract.remaining_bushels;
}

// Find best matching contract for a ticket (legacy single-contract match)
export function findBestContract(
  ticket: {
    person: string;
    crop: string;
    through: string;
    bushels: number;
  },
  contracts: Contract[],
  actualDelivered?: Record<string, number>
): AutoAssignmentResult {
  const splits: SplitAssignment[] = [];
  let remainingBushels = ticket.bushels;

  const matchingContracts = contracts.filter((c) => {
    const personMatch = c.owner === ticket.person;
    const cropMatch = c.crop === ticket.crop;
    const throughMatch = c.through === ticket.through;
    const notSpot = !c.is_spot_sale;
    const hasRemaining = getRemaining(c, actualDelivered) > 0;

    return personMatch && cropMatch && throughMatch && notSpot && hasRemaining;
  });

  const sorted = matchingContracts.sort((a, b) => {
    return getRemaining(a, actualDelivered) - getRemaining(b, actualDelivered);
  });

  for (const contract of sorted) {
    if (remainingBushels <= 0) break;

    const available = getRemaining(contract, actualDelivered);
    const bushelsToAssign = Math.min(remainingBushels, available);

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

// Auto-assign ticket across multiple contracts (smallest remaining first)
export function autoAssignTicket(
  ticket: {
    person: string;
    crop: string;
    through: string;
    bushels: number;
  },
  contracts: Contract[],
  actualDelivered?: Record<string, number>
): AutoAssignmentResult {
  const splits: SplitAssignment[] = [];
  let remainingBushels = ticket.bushels;

  // Filter contracts that match person, crop, and through (case-insensitive, trimmed)
  const matchingContracts = contracts.filter((c) => {
    const personMatch = (c.owner || '').trim().toLowerCase() === (ticket.person || '').trim().toLowerCase();
    const cropMatch = (c.crop || '').trim().toLowerCase() === (ticket.crop || '').trim().toLowerCase();
    const throughMatch = (c.through || '').trim().toLowerCase() === (ticket.through || '').trim().toLowerCase();
    const notSpot = !c.is_spot_sale;
    const hasRemaining = getRemaining(c, actualDelivered) > 0;

    return personMatch && cropMatch && throughMatch && notSpot && hasRemaining;
  });

  // Sort by remaining bushels (SMALLEST FIRST)
  const sorted = [...matchingContracts].sort((a, b) => {
    return getRemaining(a, actualDelivered) - getRemaining(b, actualDelivered);
  });

  // Assign bushels to contracts (smallest first)
  for (const contract of sorted) {
    if (remainingBushels <= 0) break;

    const available = getRemaining(contract, actualDelivered);
    const bushelsToAssign = Math.min(remainingBushels, available);

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

// Create spot sale contract
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
