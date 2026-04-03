import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import type { Database } from '../lib/database.types';
import * as XLSX from 'xlsx';

type Ticket = Database['public']['Tables']['tickets']['Row'];
type Contract = Database['public']['Tables']['contracts']['Row'];
type TicketSplit = Database['public']['Tables']['ticket_splits']['Row'];

interface TicketWithSplits extends Ticket {
  splits?: Array<TicketSplit & { contract?: Contract }>;
}

export function TicketsPage() {
  const [tickets, setTickets] = useState<TicketWithSplits[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDeleted, setShowDeleted] = useState(false);
  const [editingSplits, setEditingSplits] = useState<string | null>(null);
  
  const currentYear = localStorage.getItem('grain_ticket_year') || new Date().getFullYear().toString();

  useEffect(() => {
    fetchData();
  }, [currentYear, showDeleted]);

  const fetchData = async () => {
    setLoading(true);

    const deletedFilter = showDeleted ? true : false;

    const [ticketsRes, contractsRes] = await Promise.all([
      supabase
        .from('tickets')
        .select('*')
        .eq('crop_year', currentYear)
        .eq('deleted', deletedFilter)
        .order('ticket_date', { ascending: false }),
      supabase
        .from('contracts')
        .select('*')
        .eq('crop_year', currentYear),
    ]);

    if (ticketsRes.error) {
      console.error('Error fetching tickets:', ticketsRes.error);
      setTickets([]);
    } else {
      // Fetch splits for each ticket
      const ticketsWithSplits = await Promise.all(
        (ticketsRes.data || []).map(async (ticket) => {
          const { data: splits } = await supabase
            .from('ticket_splits')
            .select('*, contract:contracts(*)')
            .eq('ticket_id', ticket.id);

          return {
            ...ticket,
            splits: splits || [],
          };
        })
      );

      setTickets(ticketsWithSplits);
    }

    setContracts(contractsRes.data || []);
    setLoading(false);
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

  const handleAddSplit = async (ticketId: string) => {
    const ticket = tickets.find(t => t.id === ticketId);
    if (!ticket) return;

    // Calculate remaining bushels
    const assignedBushels = (ticket.splits || []).reduce((sum, split) => sum + split.bushels, 0);
    const remaining = ticket.bushels - assignedBushels;

    if (remaining <= 0) {
      alert('Ticket is fully assigned');
      return;
    }

    // Find a matching contract
    const matchingContract = contracts.find(c => 
      c.owner === ticket.person && 
      c.crop === ticket.crop && 
      c.through === ticket.through &&
      c.remaining_bushels > 0
    );

    if (!matchingContract) {
      alert('No matching contracts found');
      return;
    }

    const { error } = await supabase
      .from('ticket_splits')
      .insert({
        ticket_id: ticketId,
        contract_id: matchingContract.id,
        person: ticket.person,
        bushels: Math.min(remaining, matchingContract.remaining_bushels),
      });

    if (error) {
      console.error('Error adding split:', error);
      alert('Failed to add split');
    } else {
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

      {tickets.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          {showDeleted ? 'No deleted tickets' : 'No tickets found'}
        </div>
      ) : (
        <div className="space-y-4">
          {tickets.map((ticket) => {
            const assignedBushels = (ticket.splits || []).reduce((sum, split) => sum + split.bushels, 0);
            const remainingBushels = ticket.bushels - assignedBushels;

            return (
              <div
                key={ticket.id}
                className={`rounded-lg p-6 border ${getCropColor(ticket.crop)}`}
              >
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                  <div>
                    <div className="text-sm text-gray-400">Date</div>
                    <div className="text-white font-semibold">{ticket.ticket_date}</div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-400">Ticket #</div>
                    <div className="text-white font-semibold">{ticket.ticket_number || 'N/A'}</div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-400">Person</div>
                    <div className="text-white font-semibold">{ticket.person}</div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-400">Crop</div>
                    <div className="text-white font-semibold">{ticket.crop}</div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-400">Bushels</div>
                    <div className="text-white font-semibold">{ticket.bushels.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-400">Location</div>
                    <div className="text-white">{ticket.delivery_location}</div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-400">Through</div>
                    <div className="text-white">{ticket.through}</div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-400">Status</div>
                    <div className="text-white capitalize">{ticket.status.replace('_', ' ')}</div>
                  </div>
                </div>

                {/* Splits Section */}
                {ticket.splits && ticket.splits.length > 0 && (
                  <div className="mt-4 border-t border-gray-600 pt-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-sm font-semibold text-gray-300">
                        Contract Assignments ({ticket.splits.length})
                      </div>
                      {remainingBushels > 0 && (
                        <div className="text-sm text-yellow-400">
                          Remaining: {remainingBushels.toLocaleString()} bushels
                        </div>
                      )}
                    </div>

                    <div className="space-y-2">
                      {ticket.splits.map((split: any) => (
                        <div key={split.id} className="bg-gray-900/50 rounded p-3 flex items-center justify-between">
                          <div className="flex-1 grid grid-cols-4 gap-4">
                            <div>
                              <div className="text-xs text-gray-400">Contract</div>
                              <div className="text-white text-sm">
                                {split.contract?.contract_number || 'Unknown'}
                              </div>
                            </div>
                            <div>
                              <div className="text-xs text-gray-400">Person</div>
                              {editingSplits === ticket.id ? (
                                <input
                                  type="text"
                                  value={split.person}
                                  onChange={(e) => handleUpdateSplit(split.id, 'person', e.target.value)}
                                  className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                                />
                              ) : (
                                <div className="text-white text-sm">{split.person}</div>
                              )}
                            </div>
                            <div>
                              <div className="text-xs text-gray-400">Bushels</div>
                              {editingSplits === ticket.id ? (
                                <input
                                  type="number"
                                  value={split.bushels}
                                  onChange={(e) => handleUpdateSplit(split.id, 'bushels', parseFloat(e.target.value))}
                                  className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                                />
                              ) : (
                                <div className="text-white text-sm">{split.bushels.toLocaleString()}</div>
                              )}
                            </div>
                            <div>
                              <div className="text-xs text-gray-400">Destination</div>
                              <div className="text-white text-sm">
                                {split.contract?.destination || 'N/A'}
                              </div>
                            </div>
                          </div>
                          {editingSplits === ticket.id && (
                            <button
                              onClick={() => handleDeleteSplit(split.id)}
                              className="ml-4 px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-sm"
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      ))}
                    </div>

                    <div className="mt-2 flex gap-2">
                      {editingSplits === ticket.id ? (
                        <>
                          <button
                            onClick={() => setEditingSplits(null)}
                            className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-sm"
                          >
                            Done Editing
                          </button>
                          <button
                            onClick={() => handleAddSplit(ticket.id)}
                            className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm"
                          >
                            + Add Split
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => setEditingSplits(ticket.id)}
                          className="px-3 py-1 bg-gray-600 hover:bg-gray-500 text-white rounded text-sm"
                        >
                          Edit Splits
                        </button>
                      )}
                    </div>
                  </div>
                )}

                <div className="mt-4 flex gap-2">
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
                        Delete Permanently
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => handleDelete(ticket.id)}
                      className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
