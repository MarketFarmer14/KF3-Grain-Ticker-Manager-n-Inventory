import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import type { Database } from '../lib/database.types';

type Contract = Database['public']['Tables']['contracts']['Row'];
type Ticket = Database['public']['Tables']['tickets']['Row'];
type TicketSplit = Database['public']['Tables']['ticket_splits']['Row'];

interface SplitWithTicket extends TicketSplit {
  ticket?: Ticket;
}

interface ContractDetailModalProps {
  contract: Contract;
  onClose: () => void;
}

export function ContractDetailModal({ contract, onClose }: ContractDetailModalProps) {
  const [splits, setSplits] = useState<SplitWithTicket[]>([]);
  const [legacyTickets, setLegacyTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAllocations();
  }, [contract.id]);

  const fetchAllocations = async () => {
    setLoading(true);

    // Fetch splits for this contract
    const { data: splitsData } = await supabase
      .from('ticket_splits')
      .select('*')
      .eq('contract_id', contract.id);

    const splitTicketIds = new Set((splitsData || []).map(s => s.ticket_id));

    // Fetch the tickets referenced by splits
    let ticketsForSplits: Ticket[] = [];
    if (splitTicketIds.size > 0) {
      const { data } = await supabase
        .from('tickets')
        .select('*')
        .in('id', Array.from(splitTicketIds))
        .eq('deleted', false);
      ticketsForSplits = data || [];
    }

    // Join splits with their tickets
    const splitsWithTickets: SplitWithTicket[] = (splitsData || []).map(s => ({
      ...s,
      ticket: ticketsForSplits.find(t => t.id === s.ticket_id),
    }));

    // Also fetch legacy tickets (contract_id set but NO splits exist for them)
    const { data: allContractTickets } = await supabase
      .from('tickets')
      .select('*')
      .eq('contract_id', contract.id)
      .eq('deleted', false);

    const legacy = (allContractTickets || []).filter(t => !splitTicketIds.has(t.id));

    setSplits(splitsWithTickets);
    setLegacyTickets(legacy);
    setLoading(false);
  };

  // Total bushels: splits use split.bushels (correct), legacy use ticket.bushels
  const splitTotal = splits.reduce((sum, s) => sum + (s.bushels || 0), 0);
  const legacyTotal = legacyTickets.reduce((sum, t) => sum + (t.bushels || 0), 0);
  const totalDelivered = splitTotal + legacyTotal;
  const allCount = splits.length + legacyTickets.length;

  // Use calculated total from splits/tickets, not stale contract.delivered_bushels
  const actualDelivered = totalDelivered;
  const actualRemaining = contract.contracted_bushels - actualDelivered;
  const actualPercent = contract.contracted_bushels > 0
    ? (actualDelivered / contract.contracted_bushels) * 100
    : 0;
  const percentFilled = actualPercent.toFixed(1);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg p-6 max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex justify-between items-start mb-6">
          <div>
            <h2 className="text-2xl font-bold text-white">
              Contract #{contract.contract_number}
              {contract.is_spot_sale && (
                <span className="ml-2 px-2 py-1 bg-purple-600 text-white text-xs rounded">SPOT</span>
              )}
            </h2>
            <p className="text-gray-400 mt-1">{contract.owner || 'No Owner'}</p>
          </div>
          <button
            onClick={onClose}
            className="px-3 py-1 bg-gray-600 hover:bg-gray-500 text-white rounded text-lg font-bold"
          >
            X
          </button>
        </div>

        {/* Contract Details Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-gray-700 rounded-lg p-3">
            <div className="text-gray-400 text-xs">Crop</div>
            <div className="text-white font-semibold">{contract.crop}</div>
          </div>
          <div className="bg-gray-700 rounded-lg p-3">
            <div className="text-gray-400 text-xs">Through</div>
            <div className="text-white font-semibold">{contract.through || '-'}</div>
          </div>
          <div className="bg-gray-700 rounded-lg p-3">
            <div className="text-gray-400 text-xs">Destination</div>
            <div className="text-white font-semibold">{contract.destination}</div>
          </div>
          <div className="bg-gray-700 rounded-lg p-3">
            <div className="text-gray-400 text-xs">Priority</div>
            <div className="text-white font-semibold">{contract.priority}</div>
          </div>
        </div>

        {/* Bushel Progress */}
        <div className="bg-gray-700 rounded-lg p-4 mb-6">
          <div className="flex justify-between items-center mb-2">
            <span className="text-gray-300 font-medium">Delivery Progress</span>
            <span className="text-white font-bold">{percentFilled}%</span>
          </div>
          <div className="w-full bg-gray-600 rounded-full h-4 mb-3">
            <div
              className={`h-4 rounded-full ${
                actualPercent >= 100
                  ? 'bg-gray-500'
                  : actualPercent >= 75
                  ? 'bg-yellow-500'
                  : 'bg-emerald-500'
              }`}
              style={{ width: `${Math.min(actualPercent, 100)}%` }}
            ></div>
          </div>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-gray-400 text-xs">Contracted</div>
              <div className="text-white font-bold">{contract.contracted_bushels.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-gray-400 text-xs">Delivered</div>
              <div className="text-white font-bold">{actualDelivered.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-gray-400 text-xs">Remaining</div>
              <div className={`font-bold ${actualRemaining < 0 ? 'text-red-400' : 'text-white'}`}>{actualRemaining.toLocaleString()}</div>
            </div>
          </div>
        </div>

        {/* Delivery Window */}
        {(contract.start_date || contract.end_date) && (
          <div className="bg-gray-700 rounded-lg p-3 mb-6 flex justify-between">
            <span className="text-gray-400">Delivery Window</span>
            <span className="text-white">
              {contract.start_date ? new Date(contract.start_date).toLocaleDateString() : 'Open'}
              {' — '}
              {contract.end_date ? new Date(contract.end_date).toLocaleDateString() : 'Open'}
            </span>
          </div>
        )}

        {/* Notes */}
        {contract.notes && (
          <div className="bg-gray-700 rounded-lg p-3 mb-6">
            <div className="text-gray-400 text-xs mb-1">Notes</div>
            <div className="text-white text-sm">{contract.notes}</div>
          </div>
        )}

        {/* Allocated Tickets */}
        <div>
          <h3 className="text-lg font-bold text-white mb-3">
            Allocated Tickets ({allCount})
          </h3>

          {loading ? (
            <div className="text-gray-400 text-center py-4">Loading tickets...</div>
          ) : allCount === 0 ? (
            <div className="text-gray-400 text-center py-4">No tickets allocated to this contract</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-700">
                  <tr>
                    <th className="px-3 py-2 text-left text-gray-300 text-sm">Date</th>
                    <th className="px-3 py-2 text-left text-gray-300 text-sm">Ticket #</th>
                    <th className="px-3 py-2 text-left text-gray-300 text-sm">Person</th>
                    <th className="px-3 py-2 text-right text-gray-300 text-sm">Bushels</th>
                    <th className="px-3 py-2 text-left text-gray-300 text-sm">Location</th>
                    <th className="px-3 py-2 text-left text-gray-300 text-sm">Through</th>
                    <th className="px-3 py-2 text-left text-gray-300 text-sm">Truck</th>
                    <th className="px-3 py-2 text-left text-gray-300 text-sm">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Splits — show split.bushels, not ticket.bushels */}
                  {splits.map((split) => (
                    <tr key={split.id} className="border-t border-gray-700 hover:bg-gray-700">
                      <td className="px-3 py-2 text-white text-sm">
                        {split.ticket ? new Date(split.ticket.ticket_date).toLocaleDateString() : '-'}
                      </td>
                      <td className="px-3 py-2 text-white text-sm">
                        {split.ticket?.ticket_number || '-'}
                        {split.ticket?.duplicate_flag && (
                          <span className="ml-1 px-1 py-0.5 bg-orange-600 rounded text-xs">DUP</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-white text-sm">{split.person}</td>
                      <td className="px-3 py-2 text-right text-white text-sm font-semibold">
                        {split.bushels.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-white text-sm">{split.ticket?.delivery_location || '-'}</td>
                      <td className="px-3 py-2 text-white text-sm">{split.ticket?.through || '-'}</td>
                      <td className="px-3 py-2 text-white text-sm">{split.ticket?.truck || '-'}</td>
                      <td className="px-3 py-2 text-sm">
                        <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                          split.ticket?.status === 'approved' ? 'bg-green-600' :
                          split.ticket?.status === 'rejected' ? 'bg-red-600' :
                          split.ticket?.status === 'hold' ? 'bg-yellow-600' :
                          'bg-blue-600'
                        } text-white`}>
                          {split.ticket?.status || 'split'}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {/* Legacy tickets (no splits, direct contract_id assignment) */}
                  {legacyTickets.map((ticket) => (
                    <tr key={ticket.id} className="border-t border-gray-700 hover:bg-gray-700">
                      <td className="px-3 py-2 text-white text-sm">
                        {new Date(ticket.ticket_date).toLocaleDateString()}
                      </td>
                      <td className="px-3 py-2 text-white text-sm">
                        {ticket.ticket_number || '-'}
                        {ticket.duplicate_flag && (
                          <span className="ml-1 px-1 py-0.5 bg-orange-600 rounded text-xs">DUP</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-white text-sm">{ticket.person}</td>
                      <td className="px-3 py-2 text-right text-white text-sm font-semibold">
                        {ticket.bushels.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-white text-sm">{ticket.delivery_location}</td>
                      <td className="px-3 py-2 text-white text-sm">{ticket.through}</td>
                      <td className="px-3 py-2 text-white text-sm">{ticket.truck || '-'}</td>
                      <td className="px-3 py-2 text-sm">
                        <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                          ticket.status === 'approved' ? 'bg-green-600' :
                          ticket.status === 'rejected' ? 'bg-red-600' :
                          ticket.status === 'hold' ? 'bg-yellow-600' :
                          'bg-blue-600'
                        } text-white`}>
                          {ticket.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-700">
                  <tr>
                    <td colSpan={3} className="px-3 py-2 text-gray-300 text-sm font-semibold">
                      Total: {allCount} allocation{allCount !== 1 ? 's' : ''}
                    </td>
                    <td className="px-3 py-2 text-right text-white text-sm font-bold">
                      {totalDelivered.toLocaleString()}
                    </td>
                    <td colSpan={4}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

        {/* Close Button */}
        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-lg font-semibold"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
