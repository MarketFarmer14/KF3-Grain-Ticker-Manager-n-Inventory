import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { autoAssignTicket } from '../lib/contractMatcher';
import type { Database } from '../lib/database.types';
import * as XLSX from 'xlsx';

type Ticket = Database['public']['Tables']['tickets']['Row'];
type Contract = Database['public']['Tables']['contracts']['Row'];
type TicketSplit = Database['public']['Tables']['ticket_splits']['Row'];

interface TicketWithSplits extends Ticket {
  splits: Array<TicketSplit & { contractNumber?: string; destination?: string }>;
}

export function TicketsPage() {
  const [tickets, setTickets] = useState<TicketWithSplits[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDeleted, setShowDeleted] = useState(false);
  const [editingSplits, setEditingSplits] = useState<string | null>(null);
  const [showAddSplitModal, setShowAddSplitModal] = useState<string | null>(null);
  const [newSplit, setNewSplit] = useState({ contractId: '', person: '', bushels: 0 });
  
  const currentYear = localStorage.getItem('grain_ticket_year') || new Date().getFullYear().toString();

  useEffect(() => {
    fetchData();
  }, [currentYear, showDeleted]);

  const fetchData = async () => {
    setLoading(true);

    const deletedFilter = showDeleted ? true : false;

    try {
      const { data: ticketsData, error: ticketsError } = await supabase
        .from('tickets')
        .select('*')
        .eq('crop_year', currentYear)
        .eq('deleted', deletedFilter)
        .order('ticket_date', { ascending: false });

      if (ticketsError) throw ticketsError;

      const { data: contractsData, error: contractsError } = await supabase
        .from('contracts')
        .select('*')
        .eq('crop_year', currentYear);

      if (contractsError) throw contractsError;

      const { data: splitsData, error: splitsError } = await supabase
        .from('ticket_splits')
        .select('*');

      if (splitsError) throw splitsError;

      setContracts(contractsData || []);

      const ticketsWithSplits: TicketWithSplits[] = (ticketsData || []).map(ticket => {
        const ticketSplits = (splitsData || [])
          .filter(split => split.ticket_id === ticket.id)
          .map(split => {
            const contract = contractsData?.find(c => c.id === split.contract_id);
            return {
              ...split,
              contractNumber: contract?.contract_number,
              destination: contract?.destination,
            };
          });

        return {
          ...ticket,
          splits: ticketSplits,
        };
      });

      setTickets(ticketsWithSplits);
    } catch (error) {
      console.error('Error fetching data:', error);
      setTickets([]);
    } finally {
      setLoading(false);
    }
  };

  const handleRematch = async (ticketId: string) => {
    const ticket = tickets.find(t => t.id === ticketId);
    if (!ticket) return;

    if (!confirm('Delete existing splits and recalculate assignment?')) return;

    try {
      // Delete existing splits
      const { error: deleteError } = await supabase
        .from('ticket_splits')
        .delete()
        .eq('ticket_id', ticketId);

      if (deleteError) throw deleteError;

      // Recalculate assignment
      const assignmentResult = autoAssignTicket(
        {
          person: ticket.person,
          crop: ticket.crop,
          through: ticket.through,
          bushels: ticket.bushels,
        },
        contracts
      );

      // Create new splits
      const splits = assignmentResult.splits.map((split) => ({
        ticket_id: ticketId,
        contract_id: split.contract.id,
        person: split.person,
        bushels: split.bushels,
      }));

      if (splits.length > 0) {
        const { error: insertError } = await supabase
          .from('ticket_splits')
          .insert(splits);

        if (insertError) throw insertError;

        // Update contracts
        for (const split of assignmentResult.splits) {
          const newDelivered = split.contract.delivered_bushels + split.bushels;
          const newRemaining = split.contract.contracted_bushels - newDelivered;
          const newPercent = (newDelivered / split.contract.contracted_bushels) * 100;

          await supabase
            .from('contracts')
            .update({
              delivered_bushels: newDelivered,
              remaining_bushels: newRemaining,
              percent_filled: newPercent,
            })
            .eq('id', split.contract.id);
        }
      }

      await fetchData();
      alert('Ticket rematched successfully!');
    } catch (error) {
      console.error('Rematch error:', error);
      alert('Failed to rematch ticket');
    }
  };

  const handleDelete = async (ticketId: string) => {
    if (!confirm('Move this ticket to trash?')) return;

    const { error } = await supabase
      .from('tickets')
      .update({
        deleted: true,
        deleted_at: new Date().toISOString(),
        deleted_by: 'user',
      })
      .eq('id', ticketId);

    if (error) {
      console.error('Error deleting ticket:', error);
      alert('Failed to delete ticket');
    } else {
      await fetchData();
    }
  };

  const handleRestore = async (ticketId: string) => {
    const { error } = await supabase
      .from('tickets')
      .update({
        deleted: false,
        deleted_at: null,
        deleted_by: null,
      })
      .eq('id', ticketId);

    if (error) {
      console.error('Error restoring ticket:', error);
      alert('Failed to restore ticket');
    } else {
      await fetchData();
    }
  };

  const handlePermanentDelete = async (ticketId: string) => {
    if (!confirm('PERMANENTLY delete this ticket? This cannot be undone!')) return;

    const { error } = await supabase
      .from('tickets')
      .delete()
      .eq('id', ticketId);

    if (error) {
      console.error('Error permanently deleting ticket:', error);
      alert('Failed to delete ticket');
    } else {
      await fetchData();
    }
  };

  const handleUpdateSplit = async (splitId: string, field: string, value: any) => {
    const { error } = await supabase
      .from('ticket_splits')
      .update({ [field]: value })
      .eq('id', splitId);

    if (error) {
      console.error('Error updating split:', error);
      alert('Failed to update split');
    } else {
      await fetchData();
    }
  };

  const handleDeleteSplit = async (splitId: string) => {
    if (!confirm('Delete this split?')) return;

    const { error } = await supabase
      .from('ticket_splits')
      .delete()
      .eq('id', splitId);

    if (error) {
      console.error('Error deleting split:', error);
      alert('Failed to delete split');
    } else {
      await fetchData();
    }
  };

  const openAddSplitModal = (ticketId: string) => {
    const ticket = tickets.find(t => t.id === ticketId);
    if (!ticket) return;

    const assignedBushels = ticket.splits.reduce((sum, split) => sum + split.bushels, 0);
    const remaining = ticket.bushels - assignedBushels;

    setNewSplit({
      contractId: '',
      person: ticket.person,
      bushels: remaining,
    });
    setShowAddSplitModal(ticketId);
  };

  const handleAddSplit = async () => {
    if (!showAddSplitModal) return;
    if (!newSplit.contractId) {
      alert('Please select a contract');
      return;
    }

    const { error } = await supabase
      .from('ticket_splits')
      .insert({
        ticket_id: showAddSplitModal,
        contract_id: newSplit.contractId,
        person: newSplit.person,
        bushels: newSplit.bushels,
      });

    if (error) {
      console.error('Error adding split:', error);
      alert('Failed to add split');
    } else {
      setShowAddSplitModal(null);
      await fetchData();
    }
  };

  const handleExport = () => {
    const exportData = tickets
      .filter(t => !t.deleted)
      .map(ticket => ({
        'Crop': ticket.crop,
        'Person': ticket.person,
        'Date': ticket.ticket_date,
        'Location': ticket.delivery_location,
        'Through': ticket.through,
        'Ticket Number': ticket.ticket_number || '',
        'Bushels': ticket.bushels,
      }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Tickets');
    XLSX.writeFile(wb, `tickets-${currentYear}.xlsx`);
  };

  const getCropColor = (crop: string) => {
    if (crop === 'Corn') return 'bg-yellow-900/30 border-yellow-600';
    if (crop === 'Soybeans') return 'bg-green-900/30 border-green-600';
    return 'bg-gray-800 border-gray-700';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">Loading tickets...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-white">Tickets</h1>
        <div className="flex items-center gap-4">
          <button
            onClick={() => setShowDeleted(!showDeleted)}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg"
          >
            {showDeleted ? '📋 View Active' : '🗑️ View Trash'}
          </button>
          {!showDeleted && (
            <button
              onClick={handleExport}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold"
            >
              📊 Export to Excel
            </button>
          )}
        </div>
      </div>

      {/* Add Split Modal */}
      {showAddSplitModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4 border border-gray-700">
            <h2 className="text-xl font-bold text-white mb-4">Add Split</h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Contract</label>
                <select
                  value={newSplit.contractId}
                  onChange={(e) => setNewSplit({ ...newSplit, contractId: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
                >
                  <option value="">Select contract...</option>
                  {contracts.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.contract_number} - {c.destination} (Remaining: {c.remaining_bushels})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1">Person</label>
                <input
                  type="text"
                  value={newSplit.person}
                  onChange={(e) => setNewSplit({ ...newSplit, person: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1">Bushels</label>
                <input
                  type="number"
                  value={newSplit.bushels}
                  onChange={(e) => setNewSplit({ ...newSplit, bushels: parseFloat(e.target.value) })}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
                />
              </div>
            </div>

            <div className="flex gap-2 mt-6">
              <button
                onClick={handleAddSplit}
                className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold"
              >
                Add Split
              </button>
              <button
                onClick={() => setShowAddSplitModal(null)}
                className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-lg"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {tickets.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          {showDeleted ? 'No deleted tickets' : 'No tickets found'}
        </div>
      ) : (
        <div className="space-y-4">
          {tickets.map((ticket) => {
            const assignedBushels = ticket.splits.reduce((sum, split) => sum + split.bushels, 0);
            const remainingBushels = ticket.bushels - assignedBushels;

            return (
              <div
                key={ticket.id}
                className={`rounded-lg p-6 border ${getCropColor(ticket.crop)}`}
              >
                {/* Ticket Info - Horizontal Layout */}
                <div className="flex items-center gap-6 mb-4 flex-wrap">
                  <div className="flex items-center gap-2">
                    <div className="text-sm text-gray-400">Date:</div>
                    <div className="text-white font-semibold">{ticket.ticket_date}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-sm text-gray-400">Ticket #:</div>
                    <div className="text-white font-semibold">{ticket.ticket_number || 'N/A'}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-sm text-gray-400">Person:</div>
                    <div className="text-white font-semibold">{ticket.person}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-sm text-gray-400">Crop:</div>
                    <div className="text-white font-semibold">{ticket.crop}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-sm text-gray-400">Bushels:</div>
                    <div className="text-white font-semibold">{ticket.bushels.toLocaleString()}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-sm text-gray-400">Through:</div>
                    <div className="text-white">{ticket.through}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-sm text-gray-400">Location:</div>
                    <div className="text-white">{ticket.delivery_location}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-sm text-gray-400">Status:</div>
                    <div className="text-white capitalize">{ticket.status.replace('_', ' ')}</div>
                  </div>
                </div>

                {/* Splits Section - Horizontal */}
                <div className="border-t border-gray-600 pt-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-4">
                      <div className="text-sm font-semibold text-gray-300">
                        Assignments ({ticket.splits.length})
                      </div>
                      {remainingBushels > 0 && (
                        <div className="text-sm text-yellow-400 font-semibold">
                          ⚠️ Unassigned: {remainingBushels.toLocaleString()} bu
                        </div>
                      )}
                      {remainingBushels === 0 && ticket.splits.length > 0 && (
                        <div className="text-sm text-green-400 font-semibold">
                          ✓ Fully Assigned
                        </div>
                      )}
                    </div>
                  </div>

                  {ticket.splits.length === 0 ? (
                    <div className="text-center py-3 text-gray-500 bg-gray-900/30 rounded text-sm">
                      No assignments yet
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {ticket.splits.map((split) => (
                        <div key={split.id} className="bg-gray-900/50 rounded p-3">
                          <div className="flex items-center gap-6 flex-wrap">
                            <div className="flex items-center gap-2">
                              <div className="text-xs text-gray-400">Contract:</div>
                              <div className="text-white text-sm font-semibold">
                                {split.contractNumber || 'Unknown'}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="text-xs text-gray-400">Person:</div>
                              {editingSplits === ticket.id ? (
                                <input
                                  type="text"
                                  value={split.person}
                                  onChange={(e) => handleUpdateSplit(split.id, 'person', e.target.value)}
                                  className="px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm w-32"
                                />
                              ) : (
                                <div className="text-white text-sm">{split.person}</div>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="text-xs text-gray-400">Bushels:</div>
                              {editingSplits === ticket.id ? (
                                <input
                                  type="number"
                                  value={split.bushels}
                                  onChange={(e) => handleUpdateSplit(split.id, 'bushels', parseFloat(e.target.value))}
                                  className="px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm w-24"
                                />
                              ) : (
                                <div className="text-white text-sm font-semibold">{split.bushels.toLocaleString()}</div>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="text-xs text-gray-400">Destination:</div>
                              <div className="text-white text-sm">{split.destination || 'N/A'}</div>
                            </div>
                            {editingSplits === ticket.id && (
                              <button
                                onClick={() => handleDeleteSplit(split.id)}
                                className="ml-auto px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-sm"
                              >
                                Delete
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="mt-3 flex gap-2 flex-wrap">
                    {editingSplits === ticket.id ? (
                      <button
                        onClick={() => setEditingSplits(null)}
                        className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded font-semibold"
                      >
                        ✓ Done
                      </button>
                    ) : (
                      <button
                        onClick={() => setEditingSplits(ticket.id)}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-semibold"
                      >
                        ✏️ Edit
                      </button>
                    )}
                    <button
                      onClick={() => openAddSplitModal(ticket.id)}
                      className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded font-semibold"
                    >
                      + Add
                    </button>
                    <button
                      onClick={() => handleRematch(ticket.id)}
                      className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded font-semibold"
                    >
                      🔄 Rematch
                    </button>
                    {showDeleted ? (
                      <>
                        <button
                          onClick={() => handleRestore(ticket.id)}
                          className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded"
                        >
                          Restore
                        </button>
                        <button
                          onClick={() => handlePermanentDelete(ticket.id)}
                          className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded"
                        >
                          Delete Forever
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => handleDelete(ticket.id)}
                        className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded ml-auto"
                      >
                        🗑️ Delete
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
