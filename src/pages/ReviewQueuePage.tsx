import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { autoAssignTicket, createSpotSaleContract } from '../lib/contractMatcher';
import { Sparkles } from 'lucide-react';
import type { Database } from '../lib/database.types';

type Ticket = Database['public']['Tables']['tickets']['Row'];
type Contract = Database['public']['Tables']['contracts']['Row'];
type TicketSplitInsert = Database['public']['Tables']['ticket_splits']['Insert'];

export function ReviewQueuePage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [aiProcessing, setAiProcessing] = useState<string | null>(null);
  const [aiUsage, setAiUsage] = useState({ count: 0, limit: 500 });

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
    try {
      // Auto-assign ticket across contracts (smallest remaining first)
      const assignmentResult = autoAssignTicket(
        {
          person: ticket.person,
          crop: ticket.crop,
          through: ticket.through,
          bushels: ticket.bushels,
        },
        contracts
      );

      // Create ticket splits
      const splits: TicketSplitInsert[] = assignmentResult.splits.map((split) => ({
        ticket_id: ticket.id,
        contract_id: split.contract.id,
        person: split.person,
        bushels: split.bushels,
      }));

      if (splits.length > 0) {
        const { error: splitsError } = await supabase
          .from('ticket_splits')
          .insert(splits);

        if (splitsError) throw splitsError;

        // Update contract delivered bushels
        for (const split of assignmentResult.splits) {
          const newDelivered = split.contract.delivered_bushels + split.bushels;
          const newRemaining = split.contract.contracted_bushels - newDelivered;
          const newPercent = (newDelivered / split.contract.contracted_bushels) * 100;

          const { error: contractError } = await supabase
            .from('contracts')
            .update({
              delivered_bushels: newDelivered,
              remaining_bushels: newRemaining,
              percent_filled: newPercent,
            })
            .eq('id', split.contract.id);

          if (contractError) throw contractError;
        }
      }

      // If remainder, create spot sale
      if (assignmentResult.needsSpotSale && assignmentResult.remainder > 0) {
        const spotSale = createSpotSaleContract({
          person: ticket.person,
          crop: ticket.crop,
          through: ticket.through,
          delivery_location: ticket.delivery_location,
          ticket_date: ticket.ticket_date,
          crop_year: ticket.crop_year,
          bushels: assignmentResult.remainder,
        });

        const { data: newContract, error: contractError } = await supabase
          .from('contracts')
          .insert(spotSale)
          .select()
          .single();

        if (contractError) throw contractError;

        // Create split for spot sale
        const { error: spotSplitError } = await supabase
          .from('ticket_splits')
          .insert({
            ticket_id: ticket.id,
            contract_id: newContract.id,
            person: ticket.person,
            bushels: assignmentResult.remainder,
          });

        if (spotSplitError) throw spotSplitError;
      }

      // Update ticket status
      const { error: ticketError } = await supabase
        .from('tickets')
        .update({ status: 'approved' })
        .eq('id', ticket.id);

      if (ticketError) throw ticketError;

      await fetchData();
    } catch (error) {
      console.error('Approval error:', error);
      alert('Failed to approve ticket. Check console for details.');
    }
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
