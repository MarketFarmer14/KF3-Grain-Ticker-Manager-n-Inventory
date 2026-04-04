import React, { useState, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { findBestContract } from '../lib/contractMatcher';
import type { Database } from '../lib/database.types';

type Ticket = Database['public']['Tables']['tickets']['Row'];
type Contract = Database['public']['Tables']['contracts']['Row'];

interface SplitPlan {
  bushels: number;
  contractId: string | null;
  contractNumber: string;
  remaining: number; // contract remaining before this allocation
}

interface SplitTicketModalProps {
  ticket: Ticket;
  contracts: Contract[];
  onClose: () => void;
  onSplitComplete: () => void;
}

const MAX_SPLITS = 4;

export function SplitTicketModal({ ticket, contracts, onClose, onSplitComplete }: SplitTicketModalProps) {
  const [mode, setMode] = useState<'manual' | 'auto'>('manual');
  const [manualBushels, setManualBushels] = useState('');
  const [manualContractId, setManualContractId] = useState('');
  const [splitting, setSplitting] = useState(false);
  const [autoPreview, setAutoPreview] = useState<SplitPlan[] | null>(null);

  // Contracts available for assignment (not spot, not 100% filled)
  const assignableContracts = useMemo(() =>
    contracts.filter(c =>
      !c.is_spot_sale &&
      (c.percent_filled || 0) < 100 &&
      (c.crop || '').trim().toLowerCase() === (ticket.crop || '').trim().toLowerCase() &&
      (c.through || '').trim().toLowerCase() === (ticket.through || '').trim().toLowerCase()
    ).sort((a, b) => {
      const aDate = a.end_date ? new Date(a.end_date).getTime() : Infinity;
      const bDate = b.end_date ? new Date(b.end_date).getTime() : Infinity;
      if (aDate !== bDate) return aDate - bDate;
      return a.remaining_bushels - b.remaining_bushels;
    }),
    [contracts, ticket.crop, ticket.through]
  );

  const manualBushelsNum = parseFloat(manualBushels) || 0;
  const remainder = ticket.bushels - manualBushelsNum;
  const manualValid = manualBushelsNum > 0 && manualBushelsNum < ticket.bushels && remainder > 0;

  // Generate auto-split preview
  const generateAutoSplit = () => {
    const plan: SplitPlan[] = [];
    let remaining = ticket.bushels;
    // Track contract remaining as we plan allocations
    const contractRemaining = new Map<string, number>();
    assignableContracts.forEach(c => contractRemaining.set(c.id, c.remaining_bushels));

    for (const contract of assignableContracts) {
      if (remaining <= 0 || plan.length >= MAX_SPLITS) break;

      const contractLeft = contractRemaining.get(contract.id) || 0;
      if (contractLeft <= 0) continue;

      const allocate = Math.min(remaining, contractLeft);
      plan.push({
        bushels: allocate,
        contractId: contract.id,
        contractNumber: contract.contract_number,
        remaining: contractLeft,
      });

      contractRemaining.set(contract.id, contractLeft - allocate);
      remaining -= allocate;
    }

    // If there's leftover after filling all contracts, add unassigned remainder
    if (remaining > 0) {
      plan.push({
        bushels: remaining,
        contractId: null,
        contractNumber: 'Unassigned',
        remaining: 0,
      });
    }

    setAutoPreview(plan);
  };

  // Execute manual split: original ticket gets manualBushels + contract, new ticket gets remainder
  const executeManualSplit = async () => {
    if (!manualValid) return;
    setSplitting(true);

    // Update original ticket bushels and optionally assign contract
    const originalUpdate: any = { bushels: manualBushelsNum };
    if (manualContractId) {
      originalUpdate.contract_id = manualContractId;
    }

    const { error: updateError } = await supabase
      .from('tickets')
      .update(originalUpdate)
      .eq('id', ticket.id);

    if (updateError) {
      alert('Failed to update original ticket: ' + updateError.message);
      setSplitting(false);
      return;
    }

    // Create new ticket with remainder
    const { error: insertError } = await supabase
      .from('tickets')
      .insert({
        ticket_date: ticket.ticket_date,
        ticket_number: ticket.ticket_number ? `${ticket.ticket_number}-S` : null,
        person: ticket.person,
        crop: ticket.crop,
        bushels: remainder,
        delivery_location: ticket.delivery_location,
        through: ticket.through,
        truck: ticket.truck,
        elevator: ticket.elevator,
        status: ticket.status,
        image_url: ticket.image_url,
        duplicate_flag: false,
        duplicate_group: null,
        notes: `Split from ticket ${ticket.ticket_number || ticket.id.slice(0, 8)} (${ticket.bushels.toLocaleString()} bu total)`,
        origin: ticket.origin,
        moisture_percent: ticket.moisture_percent,
        dockage: ticket.dockage,
        crop_year: ticket.crop_year,
        deleted: false,
        deleted_at: null,
        deleted_by: null,
        contract_id: null,
      });

    if (insertError) {
      alert('Failed to create split ticket: ' + insertError.message);
      // Revert original ticket
      await supabase
        .from('tickets')
        .update({ bushels: ticket.bushels, contract_id: ticket.contract_id })
        .eq('id', ticket.id);
    } else {
      onSplitComplete();
    }
    setSplitting(false);
  };

  // Execute auto-split: first allocation stays on original ticket, rest create new tickets
  const executeAutoSplit = async () => {
    if (!autoPreview || autoPreview.length === 0) return;
    setSplitting(true);

    // First allocation goes to the original ticket
    const first = autoPreview[0];
    const { error: updateError } = await supabase
      .from('tickets')
      .update({
        bushels: first.bushels,
        contract_id: first.contractId,
        status: first.contractId ? 'approved' : ticket.status,
      })
      .eq('id', ticket.id);

    if (updateError) {
      alert('Failed to update original ticket: ' + updateError.message);
      setSplitting(false);
      return;
    }

    // Create split tickets for remaining allocations
    const splitTickets = autoPreview.slice(1);
    let splitNum = 1;
    let anyFailed = false;

    for (const split of splitTickets) {
      const suffix = splitNum === 1 ? 'S' : `S${splitNum}`;
      const { error: insertError } = await supabase
        .from('tickets')
        .insert({
          ticket_date: ticket.ticket_date,
          ticket_number: ticket.ticket_number ? `${ticket.ticket_number}-${suffix}` : null,
          person: ticket.person,
          crop: ticket.crop,
          bushels: split.bushels,
          delivery_location: ticket.delivery_location,
          through: ticket.through,
          truck: ticket.truck,
          elevator: ticket.elevator,
          status: split.contractId ? 'approved' : ticket.status,
          image_url: ticket.image_url,
          duplicate_flag: false,
          duplicate_group: null,
          notes: `Auto-split from ticket ${ticket.ticket_number || ticket.id.slice(0, 8)} (${ticket.bushels.toLocaleString()} bu total)`,
          origin: ticket.origin,
          moisture_percent: ticket.moisture_percent,
          dockage: ticket.dockage,
          crop_year: ticket.crop_year,
          deleted: false,
          deleted_at: null,
          deleted_by: null,
          contract_id: split.contractId,
        });

      if (insertError) {
        alert(`Failed to create split ticket #${splitNum}: ${insertError.message}`);
        anyFailed = true;
        break;
      }
      splitNum++;
    }

    if (!anyFailed) {
      onSplitComplete();
    }
    setSplitting(false);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-start mb-4">
          <h2 className="text-2xl font-bold text-white">Split Ticket</h2>
          <button
            onClick={onClose}
            className="px-3 py-1 bg-gray-600 hover:bg-gray-500 text-white rounded text-lg font-bold"
          >
            X
          </button>
        </div>

        {/* Ticket Summary */}
        <div className="bg-gray-700 rounded-lg p-4 mb-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div>
              <span className="text-gray-400">Ticket #:</span>
              <span className="text-white ml-1">{ticket.ticket_number || '-'}</span>
            </div>
            <div>
              <span className="text-gray-400">Person:</span>
              <span className="text-white ml-1">{ticket.person}</span>
            </div>
            <div>
              <span className="text-gray-400">Crop:</span>
              <span className="text-white ml-1">{ticket.crop}</span>
            </div>
            <div>
              <span className="text-gray-400">Total Bushels:</span>
              <span className="text-white ml-1 font-bold">{ticket.bushels.toLocaleString()}</span>
            </div>
          </div>
        </div>

        {/* Mode Toggle */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => { setMode('manual'); setAutoPreview(null); }}
            className={`flex-1 px-4 py-2 rounded-lg font-semibold ${
              mode === 'manual' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            Manual Split
          </button>
          <button
            onClick={() => { setMode('auto'); setAutoPreview(null); }}
            className={`flex-1 px-4 py-2 rounded-lg font-semibold ${
              mode === 'auto' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            Auto-Split
          </button>
        </div>

        {mode === 'manual' ? (
          /* ===== MANUAL SPLIT ===== */
          <div>
            <p className="text-gray-300 text-sm mb-4">
              Enter the bushels for the first portion. The remainder becomes a new ticket you can assign separately.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-gray-400 text-xs mb-1">Bushels for this ticket</label>
                <input
                  type="number"
                  step="0.01"
                  value={manualBushels}
                  onChange={(e) => setManualBushels(e.target.value)}
                  placeholder={`Max: ${ticket.bushels}`}
                  className="w-full px-3 py-2 bg-gray-700 text-white rounded border border-gray-500 focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-gray-400 text-xs mb-1">Assign this portion to contract (optional)</label>
                <select
                  value={manualContractId}
                  onChange={(e) => setManualContractId(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 text-white rounded border border-gray-500"
                >
                  <option value="">No contract</option>
                  {assignableContracts.map(c => (
                    <option key={c.id} value={c.id}>
                      #{c.contract_number} — {c.owner} ({c.remaining_bushels.toLocaleString()} remaining)
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {manualBushelsNum > 0 && (
              <div className="bg-gray-700 rounded-lg p-3 mb-4">
                <div className="text-sm">
                  <div className="flex justify-between text-gray-300">
                    <span>This ticket:</span>
                    <span className="text-white font-semibold">{manualBushelsNum.toLocaleString()} bu</span>
                  </div>
                  <div className="flex justify-between text-gray-300 mt-1">
                    <span>New split ticket:</span>
                    <span className={`font-semibold ${remainder > 0 ? 'text-yellow-400' : 'text-red-400'}`}>
                      {remainder > 0 ? `${remainder.toLocaleString()} bu` : 'Invalid (must be > 0)'}
                    </span>
                  </div>
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={executeManualSplit}
                disabled={!manualValid || splitting}
                className="flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-600 text-white rounded-lg font-semibold"
              >
                {splitting ? 'Splitting...' : 'Split Ticket'}
              </button>
            </div>
          </div>
        ) : (
          /* ===== AUTO-SPLIT ===== */
          <div>
            <p className="text-gray-300 text-sm mb-4">
              Auto-split fills matching contracts by deadline order. Each contract gets exactly what it needs,
              and any remainder becomes an unassigned ticket. Max {MAX_SPLITS} splits.
            </p>

            {assignableContracts.length === 0 ? (
              <div className="text-yellow-400 text-center py-4 mb-4">
                No matching contracts available for {ticket.crop} / {ticket.through}.
              </div>
            ) : !autoPreview ? (
              <div className="mb-4">
                <p className="text-gray-400 text-sm mb-3">
                  {assignableContracts.length} matching contract{assignableContracts.length !== 1 ? 's' : ''} found.
                  Click Preview to see how the ticket will be split.
                </p>
                <button
                  onClick={generateAutoSplit}
                  className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold"
                >
                  Preview Auto-Split
                </button>
              </div>
            ) : (
              <div className="mb-4">
                <h3 className="text-white font-semibold mb-2">Split Plan ({autoPreview.length} part{autoPreview.length !== 1 ? 's' : ''})</h3>
                <div className="space-y-2 mb-4">
                  {autoPreview.map((split, i) => (
                    <div key={i} className={`rounded-lg p-3 ${
                      split.contractId ? 'bg-emerald-900 bg-opacity-40 border border-emerald-700' : 'bg-yellow-900 bg-opacity-40 border border-yellow-700'
                    }`}>
                      <div className="flex justify-between items-center">
                        <div>
                          <span className="text-white font-semibold">
                            {i === 0 ? 'Original ticket' : `Split #${i}`}
                          </span>
                          <span className="text-gray-300 ml-2">
                            {split.contractId
                              ? `-> Contract #${split.contractNumber} (needs ${split.remaining.toLocaleString()} bu)`
                              : '-> Unassigned (remainder)'
                            }
                          </span>
                        </div>
                        <span className="text-white font-bold">{split.bushels.toLocaleString()} bu</span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => setAutoPreview(null)}
                    className="flex-1 px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-lg"
                  >
                    Re-Preview
                  </button>
                  <button
                    onClick={executeAutoSplit}
                    disabled={splitting}
                    className="flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-600 text-white rounded-lg font-semibold"
                  >
                    {splitting ? 'Splitting...' : `Execute Split (${autoPreview.length} parts)`}
                  </button>
                </div>
              </div>
            )}

            {!autoPreview && (
              <button
                onClick={onClose}
                className="w-full px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-lg mt-2"
              >
                Cancel
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
