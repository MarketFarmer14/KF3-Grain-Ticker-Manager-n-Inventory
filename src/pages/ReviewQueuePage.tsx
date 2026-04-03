import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { autoAssignTicket, createSpotSaleContract } from '../lib/contractMatcher';
import { Sparkles } from 'lucide-react';
import type { Database } from '../lib/database.types';

type Ticket = Database['public']['Tables']['tickets']['Row'];
type Contract = Database['public']['Tables']['contracts']['Row'];
type TicketSplitInsert = Database['public']['Tables']['ticket_splits']['Insert'];

interface ProposedSplit {
  contractId: string;
  contractNumber: string;
  person: string;
  bushels: number;
}

export function ReviewQueuePage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [aiProcessing, setAiProcessing] = useState<string | null>(null);
  const [aiUsage, setAiUsage] = useState({ count: 0, limit: 500 });
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [proposedSplits, setProposedSplits] = useState<ProposedSplit[]>([]);
  const [createSpotSale, setCreateSpotSale] = useState(false);

  const currentYear = localStorage.getItem('grain_ticket_year') || new Date().getFullYear().toString();

  useEffect(() => {
    fetchData();
    fetchAIUsage();
  }, [currentYear]);

  const fetchAIUsage = async () => {
    const { data, error } = await supabase.rpc('get_ai_usage');
    if (data && data.length > 0) {
      setAiUsage({ count: data[0].count, limit: 500 });
    }
  };

  const fetchData = async () => {
    setLoading(true);

    const [ticketsRes, contractsRes] = await Promise.all([
      supabase
        .from('tickets')
        .select('*')
        .eq('status', 'needs_review')
        .eq('crop_year', currentYear)
        .eq('deleted', false)
        .order('created_at', { ascending: false }),
      supabase
        .from('contracts')
        .select('*')
        .eq('crop_year', currentYear),
    ]);

    if (ticketsRes.error) console.error('Error fetching tickets:', ticketsRes.error);
    if (contractsRes.error) console.error('Error fetching contracts:', contractsRes.error);

    setTickets(ticketsRes.data || []);
    setContracts(contractsRes.data || []);
    setLoading(false);
  };

  const handleAIRead = async (ticket: Ticket) => {
    if (!ticket.image_url) {
      alert('No image attached to this ticket');
      return;
    }

    setAiProcessing(ticket.id);

    try {
      const response = await fetch(ticket.image_url);
      const blob = await response.blob();
      
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result as string;
          const base64 = result.split(',')[1];
          resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      const aiResponse = await fetch('/.netlify/functions/read-ticket', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ imageBase64: base64Data }),
      });

      if (!aiResponse.ok) {
        const error = await aiResponse.json();
        throw new Error(error.error || 'AI reading failed');
      }

      const extractedData = await aiResponse.json();

      if (extractedData._usage) {
        setAiUsage({ count: extractedData._usage, limit: 500 });
      }

      const updates: any = {};
      if (extractedData.ticket_date) updates.ticket_date = extractedData.ticket_date;
      if (extractedData.ticket_number) updates.ticket_number = extractedData.ticket_number;
      if (extractedData.person) updates.person = extractedData.person;
      if (extractedData.crop) updates.crop = extractedData.crop;
      if (extractedData.bushels) updates.bushels = extractedData.bushels;
      if (extractedData.delivery_location) updates.delivery_location = extractedData.delivery_location;
      if (extractedData.through) updates.through = extractedData.through;
      if (extractedData.truck) updates.truck = extractedData.truck;
      if (extractedData.moisture_percent) updates.moisture_percent = extractedData.moisture_percent;
      if (extractedData.notes) updates.notes = extractedData.notes;

      const { error: updateError } = await supabase
        .from('tickets')
        .update(updates)
        .eq('id', ticket.id);

      if (updateError) throw updateError;

      await fetchData();
      alert('AI successfully read the ticket!');
    } catch (error: any) {
      console.error('AI Read Error:', error);
      alert(`AI reading failed: ${error.message}`);
    } finally {
      setAiProcessing(null);
    }
  };

  const handleApprove = async (ticket: Ticket) => {
    // Calculate auto-assignment
    const assignmentResult = autoAssignTicket(
      {
        person: ticket.person,
        crop: ticket.crop,
        through: ticket.through,
        bushels: ticket.bushels,
      },
      contracts
    );

    // Build proposed splits
    const splits: ProposedSplit[] = assignmentResult.splits.map((split) => ({
      contractId: split.contract.id,
      contractNumber: split.contract.contract_number,
      person: split.person,
      bushels: split.bushels,
    }));

    setSelectedTicket(ticket);
    setProposedSplits(splits);
    setCreateSpotSale(assignmentResult.needsSpotSale);
    setShowConfirmModal(true);
  };

  const handleConfirmAssignment = async () => {
    if (!selectedTicket) return;

    try {
      // Create ticket splits
      const splits: TicketSplitInsert[] = proposedSplits.map((split) => ({
        ticket_id: selectedTicket.id,
        contract_id: split.contractId,
        person: split.person,
        bushels: split.bushels,
      }));

      if (splits.length > 0) {
        const { error: splitsError } = await supabase
          .from('ticket_splits')
          .insert(splits);

        if (splitsError) throw splitsError;

        // Update contract delivered bushels
        for (const split of proposedSplits) {
          const contract = contracts.find(c => c.id === split.contractId);
          if (!contract) continue;

          const newDelivered = contract.delivered_bushels + split.bushels;
          const newRemaining = contract.contracted_bushels - newDelivered;
          const newPercent = (newDelivered / contract.contracted_bushels) * 100;

          const { error: contractError } = await supabase
            .from('contracts')
            .update({
              delivered_bushels: newDelivered,
              remaining_bushels: newRemaining,
              percent_filled: newPercent,
            })
            .eq('id', split.contractId);

          if (contractError) throw contractError;
        }
      }

      // Create spot sale if user selected it
      if (createSpotSale) {
        const totalAssigned = proposedSplits.reduce((sum, s) => sum + s.bushels, 0);
        const remainder = selectedTicket.bushels - totalAssigned;

        if (remainder > 0) {
          const spotSale = createSpotSaleContract({
            person: selectedTicket.person,
            crop: selectedTicket.crop,
            through: selectedTicket.through,
            delivery_location: selectedTicket.delivery_location,
            ticket_date: selectedTicket.ticket_date,
            crop_year: selectedTicket.crop_year,
            bushels: remainder,
          });

          const { data: newContract, error: contractError } = await supabase
            .from('contracts')
            .insert(spotSale)
            .select()
            .single();

          if (contractError) throw contractError;

          const { error: spotSplitError } = await supabase
            .from('ticket_splits')
            .insert({
              ticket_id: selectedTicket.id,
              contract_id: newContract.id,
              person: selectedTicket.person,
              bushels: remainder,
            });

          if (spotSplitError) throw spotSplitError;
        }
      }

      // Update ticket status
      const { error: ticketError } = await supabase
        .from('tickets')
        .update({ status: 'approved' })
        .eq('id', selectedTicket.id);

      if (ticketError) throw ticketError;

      setShowConfirmModal(false);
      setSelectedTicket(null);
      setProposedSplits([]);
      await fetchData();
    } catch (error) {
      console.error('Approval error:', error);
      alert('Failed to approve ticket. Check console for details.');
    }
  };

  const handleUpdateSplit = (index: number, field: string, value: any) => {
    const updated = [...proposedSplits];
    updated[index] = { ...updated[index], [field]: value };
    setProposedSplits(updated);
  };

  const handleAddSplit = () => {
    if (!selectedTicket) return;
    const totalAssigned = proposedSplits.reduce((sum, s) => sum + s.bushels, 0);
    const remaining = selectedTicket.bushels - totalAssigned;

    if (remaining <= 0) {
      alert('Ticket is fully assigned');
      return;
    }

    const matchingContract = contracts.find(c => 
      c.owner === selectedTicket.person && 
      c.crop === selectedTicket.crop && 
      c.through === selectedTicket.through &&
      c.remaining_bushels > 0 &&
      !proposedSplits.find(s => s.contractId === c.id)
    );

    if (!matchingContract) {
      alert('No more matching contracts available');
      return;
    }

    setProposedSplits([...proposedSplits, {
      contractId: matchingContract.id,
      contractNumber: matchingContract.contract_number,
      person: selectedTicket.person,
      bushels: Math.min(remaining, matchingContract.remaining_bushels),
    }]);
  };

  const handleRemoveSplit = (index: number) => {
    setProposedSplits(proposedSplits.filter((_, i) => i !== index));
  };

  const handleReject = async (ticketId: string) => {
    const { error } = await supabase
      .from('tickets')
      .update({ status: 'rejected' })
      .eq('id', ticketId);

    if (error) {
      console.error('Error rejecting ticket:', error);
      alert('Failed to reject ticket');
    } else {
      await fetchData();
    }
  };

  const handleHold = async (ticketId: string) => {
    const { error } = await supabase
      .from('tickets')
      .update({ status: 'hold' })
      .eq('id', ticketId);

    if (error) {
      console.error('Error holding ticket:', error);
      alert('Failed to hold ticket');
    } else {
      await fetchData();
    }
  };

  const handleUpdateField = async (ticketId: string, field: string, value: any) => {
    const { error } = await supabase
      .from('tickets')
      .update({ [field]: value })
      .eq('id', ticketId);

    if (error) {
      console.error('Error updating ticket:', error);
    } else {
      await fetchData();
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">Loading review queue...</div>
      </div>
    );
  }

  const totalAssigned = proposedSplits.reduce((sum, s) => sum + s.bushels, 0);
  const remainder = selectedTicket ? selectedTicket.bushels - totalAssigned : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-white">Review Queue</h1>
        <div className="text-sm text-gray-400">
          {tickets.length} ticket{tickets.length !== 1 ? 's' : ''} to review
        </div>
      </div>

      {aiUsage.count >= aiUsage.limit * 0.8 && (
        <div className="bg-yellow-900/20 border border-yellow-600 rounded-lg p-4">
          <p className="text-yellow-400 text-sm">
            {aiUsage.count >= aiUsage.limit
              ? '⚠️ Monthly AI limit reached'
              : `⚠️ AI Usage: ${aiUsage.count} / ${aiUsage.limit} (${Math.round((aiUsage.count / aiUsage.limit) * 100)}%)`}
          </p>
        </div>
      )}

      {/* Confirmation Modal */}
      {showConfirmModal && selectedTicket && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-lg p-6 max-w-4xl w-full border border-gray-700 max-h-[90vh] overflow-y-auto">
            <h2 className="text-2xl font-bold text-white mb-4">Confirm Assignment</h2>
            
            <div className="bg-gray-900 rounded p-4 mb-4">
              <div className="grid grid-cols-4 gap-4 text-sm">
                <div>
                  <div className="text-gray-400">Person</div>
                  <div className="text-white font-semibold">{selectedTicket.person}</div>
                </div>
                <div>
                  <div className="text-gray-400">Crop</div>
                  <div className="text-white font-semibold">{selectedTicket.crop}</div>
                </div>
                <div>
                  <div className="text-gray-400">Total Bushels</div>
                  <div className="text-white font-semibold">{selectedTicket.bushels.toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-gray-400">Through</div>
                  <div className="text-white font-semibold">{selectedTicket.through}</div>
                </div>
              </div>
            </div>

            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-lg font-semibold text-white">Proposed Splits</h3>
                {remainder > 0 && (
                  <div className="text-yellow-400 font-semibold">
                    Unassigned: {remainder.toLocaleString()} bushels
                  </div>
                )}
              </div>

              <div className="space-y-2">
                {proposedSplits.map((split, index) => (
                  <div key={index} className="bg-gray-900 rounded p-3">
                    <div className="grid grid-cols-5 gap-3">
                      <div>
                        <label className="text-xs text-gray-400">Contract</label>
                        <select
                          value={split.contractId}
                          onChange={(e) => {
                            const contract = contracts.find(c => c.id === e.target.value);
                            if (contract) {
                              handleUpdateSplit(index, 'contractId', e.target.value);
                              handleUpdateSplit(index, 'contractNumber', contract.contract_number);
                            }
                          }}
                          className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                        >
                          {contracts
                            .filter(c => 
                              c.owner === selectedTicket.person &&
                              c.crop === selectedTicket.crop &&
                              c.through === selectedTicket.through &&
                              c.remaining_bushels > 0
                            )
                            .map(c => (
                              <option key={c.id} value={c.id}>
                                {c.contract_number} ({c.remaining_bushels} remaining)
                              </option>
                            ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-gray-400">Person</label>
                        <input
                          type="text"
                          value={split.person}
                          onChange={(e) => handleUpdateSplit(index, 'person', e.target.value)}
                          className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-gray-400">Bushels</label>
                        <input
                          type="number"
                          value={split.bushels}
                          onChange={(e) => handleUpdateSplit(index, 'bushels', parseFloat(e.target.value))}
                          className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                        />
                      </div>
                      <div className="flex items-end">
                        <button
                          onClick={() => handleRemoveSplit(index)}
                          className="w-full px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-sm"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-3 flex gap-2">
                <button
                  onClick={handleAddSplit}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded"
                >
                  + Add Split
                </button>
                <button
                  onClick={() => setCreateSpotSale(!createSpotSale)}
                  className={`px-4 py-2 rounded ${createSpotSale ? 'bg-purple-600 hover:bg-purple-700' : 'bg-gray-600 hover:bg-gray-500'} text-white`}
                >
                  {createSpotSale ? '✓ Create Spot Sale for Remainder' : 'Create Spot Sale for Remainder'}
                </button>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={handleConfirmAssignment}
                className="flex-1 px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold text-lg"
              >
                ✓ Confirm & Approve
              </button>
              <button
                onClick={() => {
                  setShowConfirmModal(false);
                  setSelectedTicket(null);
                  setProposedSplits([]);
                }}
                className="px-6 py-3 bg-gray-600 hover:bg-gray-500 text-white rounded-lg font-semibold"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {tickets.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          No tickets in review queue
        </div>
      ) : (
        <div className="space-y-4">
          {tickets.map((ticket) => (
            <div key={ticket.id} className="bg-gray-800 rounded-lg p-6 border border-gray-700">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Date</label>
                  <input
                    type="date"
                    value={ticket.ticket_date}
                    onChange={(e) => handleUpdateField(ticket.id, 'ticket_date', e.target.value)}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-1">Ticket Number</label>
                  <input
                    type="text"
                    value={ticket.ticket_number || ''}
                    onChange={(e) => handleUpdateField(ticket.id, 'ticket_number', e.target.value)}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-1">Person/Owner</label>
                  <input
                    type="text"
                    value={ticket.person}
                    onChange={(e) => handleUpdateField(ticket.id, 'person', e.target.value)}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-1">Crop</label>
                  <select
                    value={ticket.crop}
                    onChange={(e) => handleUpdateField(ticket.id, 'crop', e.target.value)}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
                  >
                    <option value="Corn">Corn</option>
                    <option value="Soybeans">Soybeans</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-1">Bushels</label>
                  <input
                    type="number"
                    value={ticket.bushels}
                    onChange={(e) => handleUpdateField(ticket.id, 'bushels', parseFloat(e.target.value))}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-1">Location</label>
                  <input
                    type="text"
                    value={ticket.delivery_location}
                    onChange={(e) => handleUpdateField(ticket.id, 'delivery_location', e.target.value)}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-1">Through</label>
                  <select
                    value={ticket.through}
                    onChange={(e) => handleUpdateField(ticket.id, 'through', e.target.value)}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
                  >
                    <option value="">Select</option>
                    <option value="Akron">Akron</option>
                    <option value="RVC">RVC</option>
                    <option value="Cargill">Cargill</option>
                    <option value="ADM">ADM</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-1">Truck #</label>
                  <input
                    type="text"
                    value={ticket.truck || ''}
                    onChange={(e) => handleUpdateField(ticket.id, 'truck', e.target.value)}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-1">Moisture %</label>
                  <input
                    type="number"
                    step="0.1"
                    value={ticket.moisture_percent || ''}
                    onChange={(e) => handleUpdateField(ticket.id, 'moisture_percent', parseFloat(e.target.value) || null)}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
                  />
                </div>
              </div>

              {ticket.notes && (
                <div className="mb-4">
                  <div className="text-sm text-gray-400">Notes</div>
                  <div className="text-white">{ticket.notes}</div>
                </div>
              )}

              {ticket.image_url && (
                <div className="mb-4">
                  <img
                    src={ticket.image_url}
                    alt="Ticket"
                    className="max-w-md rounded-lg cursor-pointer"
                    onClick={() => window.open(ticket.image_url!, '_blank')}
                  />
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                {ticket.image_url && (
                  <button
                    onClick={() => handleAIRead(ticket)}
                    disabled={aiProcessing === ticket.id || aiUsage.count >= aiUsage.limit}
                    className="flex items-center gap-2 px-6 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white rounded-lg font-semibold"
                    title={aiUsage.count >= aiUsage.limit ? 'Monthly AI limit reached' : ''}
                  >
                    <Sparkles size={20} />
                    <span>
                      {aiProcessing === ticket.id ? 'Reading...' :
                        aiUsage.count >= aiUsage.limit ? '🔒 Limit Reached' :
                        '🤖 AI Auto-Fill'}
                    </span>
                  </button>
                )}

                <button
                  onClick={() => handleApprove(ticket)}
                  className="px-6 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold"
                >
                  ✓ Approve
                </button>

                <button
                  onClick={() => handleReject(ticket.id)}
                  className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold"
                >
                  ✗ Reject
                </button>

                <button
                  onClick={() => handleHold(ticket.id)}
                  className="px-6 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg font-semibold"
                >
                  ⏸ Hold
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
