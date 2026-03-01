import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { findBestContract, createSpotSaleContract } from '../lib/contractMatcher';
import { Sparkles } from 'lucide-react';
import { PERSON_OPTIONS } from '../lib/constants';
import type { Database } from '../lib/database.types';

type Ticket = Database['public']['Tables']['tickets']['Row'];
type Contract = Database['public']['Tables']['contracts']['Row'];

interface EditState {
  ticket_date: string;
  ticket_number: string;
  person: string;
  crop: string;
  bushels: string;
  delivery_location: string;
  through: string;
  truck: string;
  moisture_percent: string;
  notes: string;
}

function ticketToEdit(ticket: Ticket): EditState {
  return {
    ticket_date: ticket.ticket_date || '',
    ticket_number: ticket.ticket_number || '',
    person: ticket.person || '',
    crop: ticket.crop || '',
    bushels: ticket.bushels ? ticket.bushels.toString() : '',
    delivery_location: ticket.delivery_location || '',
    through: ticket.through || '',
    truck: ticket.truck || '',
    moisture_percent: ticket.moisture_percent ? ticket.moisture_percent.toString() : '',
    notes: ticket.notes || '',
  };
}

export function ReviewQueuePage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [showOverfillModal, setShowOverfillModal] = useState(false);
  const [overfillDecision, setOverfillDecision] = useState<'roll' | 'keep' | 'spot' | null>(null);
  const [aiProcessing, setAiProcessing] = useState<string | null>(null);
  const [aiUsage, setAiUsage] = useState({ count: 0, limit: 500 });
  const [edits, setEdits] = useState<Record<string, EditState>>({});
  const [saving, setSaving] = useState<string | null>(null);

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

    const ticketData = ticketsRes.data || [];
    setTickets(ticketData);
    setContracts(contractsRes.data || []);

    // Initialize edit state for each ticket
    const editMap: Record<string, EditState> = {};
    ticketData.forEach((t) => {
      editMap[t.id] = ticketToEdit(t);
    });
    setEdits(editMap);

    setLoading(false);
  };

  const updateEdit = (ticketId: string, field: keyof EditState, value: string) => {
    setEdits((prev) => ({
      ...prev,
      [ticketId]: { ...prev[ticketId], [field]: value },
    }));
  };

  const saveEdits = async (ticketId: string) => {
    const edit = edits[ticketId];
    if (!edit) return;

    setSaving(ticketId);
    const { error } = await supabase
      .from('tickets')
      .update({
        ticket_date: edit.ticket_date || new Date().toISOString().split('T')[0],
        ticket_number: edit.ticket_number || null,
        person: edit.person,
        crop: edit.crop,
        bushels: parseFloat(edit.bushels) || 0,
        delivery_location: edit.delivery_location,
        through: edit.through,
        truck: edit.truck || null,
        moisture_percent: edit.moisture_percent ? parseFloat(edit.moisture_percent) : null,
        notes: edit.notes || null,
      })
      .eq('id', ticketId);

    if (error) {
      alert('Save failed: ' + error.message);
    }
    setSaving(null);
  };

  const handleAIRead = async (ticket: Ticket) => {
    if (!ticket.image_url) {
      alert('No image attached to this ticket');
      return;
    }

    setAiProcessing(ticket.id);

    try {
      // Send image URL directly to Netlify function (server-side, no CORS)
      const aiResponse = await fetch('/.netlify/functions/read-ticket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: ticket.image_url }),
      });

      if (!aiResponse.ok) {
        const error = await aiResponse.json();
        throw new Error(error.error || 'AI reading failed');
      }

      const extractedData = await aiResponse.json();

      // Update usage display
      if (extractedData._usage) {
        setAiUsage({ count: extractedData._usage, limit: extractedData._limit || 500 });
      }

      // Update local edit state with AI-extracted data (user can review/edit before saving)
      setEdits((prev) => {
        const current = prev[ticket.id] || ticketToEdit(ticket);
        return {
          ...prev,
          [ticket.id]: {
            ticket_date: extractedData.ticket_date || current.ticket_date,
            ticket_number: extractedData.ticket_number || current.ticket_number,
            person: extractedData.person || current.person,
            crop: extractedData.crop || current.crop,
            bushels: extractedData.bushels ? extractedData.bushels.toString() : current.bushels,
            delivery_location: extractedData.delivery_location || current.delivery_location,
            through: extractedData.through || current.through,
            truck: extractedData.truck || current.truck,
            moisture_percent: extractedData.moisture_percent ? extractedData.moisture_percent.toString() : current.moisture_percent,
            notes: extractedData.notes || current.notes,
          },
        };
      });

      // Also save to database immediately
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

      if (Object.keys(updates).length > 0) {
        await supabase.from('tickets').update(updates).eq('id', ticket.id);
      }

      alert('AI filled the fields! Review and edit if needed, then Approve.');
    } catch (error: any) {
      alert('AI reading failed: ' + error.message);
      console.error('AI Error:', error);
    } finally {
      setAiProcessing(null);
    }
  };

  const handleApprove = async (ticket: Ticket) => {
    // Save any pending edits first
    await saveEdits(ticket.id);

    const edit = edits[ticket.id];
    if (!edit?.crop || !edit?.bushels || parseFloat(edit.bushels) === 0) {
      alert('Please fill in at least Crop and Bushels before approving.');
      return;
    }

    // Use the edited values for contract matching
    const matchResult = findBestContract(
      {
        person: edit.person,
        crop: edit.crop,
        through: edit.through,
        delivery_location: edit.delivery_location,
      },
      contracts
    );

    if (matchResult.matchType === 'spot') {
      const spotContract = createSpotSaleContract({
        person: edit.person,
        crop: edit.crop,
        through: edit.through,
        delivery_location: edit.delivery_location,
        ticket_date: edit.ticket_date,
        crop_year: currentYear,
      });

      const { data: newContract, error: contractError } = await supabase
        .from('contracts')
        .insert([spotContract])
        .select()
        .single();

      if (contractError) {
        alert('Failed to create spot sale contract: ' + contractError.message);
        return;
      }

      const { error: ticketError } = await supabase
        .from('tickets')
        .update({ status: 'approved', contract_id: newContract.id })
        .eq('id', ticket.id);

      if (ticketError) {
        alert('Failed to approve ticket: ' + ticketError.message);
      } else {
        alert('Created spot sale contract and approved ticket!');
        fetchData();
      }
      return;
    }

    const contract = matchResult.contract!;
    const newDelivered = contract.delivered_bushels + (parseFloat(edit.bushels) || ticket.bushels);
    const willOverfill = newDelivered > contract.contracted_bushels;

    if (willOverfill && !contract.overfill_allowed) {
      setSelectedTicket(ticket);
      setShowOverfillModal(true);
      return;
    }

    const { error } = await supabase
      .from('tickets')
      .update({ status: 'approved', contract_id: contract.id })
      .eq('id', ticket.id);

    if (error) {
      alert('Failed to approve: ' + error.message);
    } else {
      fetchData();
    }
  };

  const handleOverfillDecision = async () => {
    if (!selectedTicket || !overfillDecision) return;

    const edit = edits[selectedTicket.id];
    const matchResult = findBestContract(
      {
        person: edit?.person || selectedTicket.person,
        crop: edit?.crop || selectedTicket.crop,
        through: edit?.through || selectedTicket.through,
        delivery_location: edit?.delivery_location || selectedTicket.delivery_location,
      },
      contracts
    );

    const contract = matchResult.contract!;

    if (overfillDecision === 'keep') {
      const { error } = await supabase
        .from('tickets')
        .update({ status: 'approved', contract_id: contract.id })
        .eq('id', selectedTicket.id);

      if (!error) {
        setShowOverfillModal(false);
        setSelectedTicket(null);
        setOverfillDecision(null);
        fetchData();
      } else {
        alert('Failed: ' + error.message);
      }
    } else if (overfillDecision === 'roll') {
      const remainingContracts = contracts.filter(
        (c) =>
          c.id !== contract.id &&
          c.owner === (edit?.person || selectedTicket.person) &&
          c.crop === (edit?.crop || selectedTicket.crop) &&
          c.through === (edit?.through || selectedTicket.through) &&
          (c.percent_filled || 0) < 100
      );

      if (remainingContracts.length === 0) {
        alert('No other contracts available. Creating spot sale instead.');
        const spotContract = createSpotSaleContract({
          person: edit?.person || selectedTicket.person,
          crop: edit?.crop || selectedTicket.crop,
          through: edit?.through || selectedTicket.through,
          delivery_location: edit?.delivery_location || selectedTicket.delivery_location,
          ticket_date: edit?.ticket_date || selectedTicket.ticket_date,
          crop_year: selectedTicket.crop_year,
        });

        const { data: newContract, error: contractError } = await supabase
          .from('contracts')
          .insert([spotContract])
          .select()
          .single();

        if (contractError) {
          alert('Failed to create spot sale: ' + contractError.message);
          return;
        }

        const { error: ticketError } = await supabase
          .from('tickets')
          .update({ status: 'approved', contract_id: newContract.id })
          .eq('id', selectedTicket.id);

        if (!ticketError) {
          setShowOverfillModal(false);
          setSelectedTicket(null);
          setOverfillDecision(null);
          fetchData();
        }
      } else {
        const nextContract = remainingContracts.sort((a, b) => {
          const aDate = a.end_date ? new Date(a.end_date).getTime() : Infinity;
          const bDate = b.end_date ? new Date(b.end_date).getTime() : Infinity;
          return aDate - bDate;
        })[0];

        const { error } = await supabase
          .from('tickets')
          .update({ status: 'approved', contract_id: nextContract.id })
          .eq('id', selectedTicket.id);

        if (!error) {
          setShowOverfillModal(false);
          setSelectedTicket(null);
          setOverfillDecision(null);
          fetchData();
        }
      }
    } else if (overfillDecision === 'spot') {
      const spotContract = createSpotSaleContract({
        person: edit?.person || selectedTicket.person,
        crop: edit?.crop || selectedTicket.crop,
        through: edit?.through || selectedTicket.through,
        delivery_location: edit?.delivery_location || selectedTicket.delivery_location,
        ticket_date: edit?.ticket_date || selectedTicket.ticket_date,
        crop_year: selectedTicket.crop_year,
      });

      const { data: newContract, error: contractError } = await supabase
        .from('contracts')
        .insert([spotContract])
        .select()
        .single();

      if (contractError) {
        alert('Failed to create spot sale: ' + contractError.message);
        return;
      }

      const { error: ticketError } = await supabase
        .from('tickets')
        .update({ status: 'approved', contract_id: newContract.id })
        .eq('id', selectedTicket.id);

      if (!ticketError) {
        setShowOverfillModal(false);
        setSelectedTicket(null);
        setOverfillDecision(null);
        fetchData();
      }
    }
  };

  const handleReject = async (ticketId: string) => {
    if (!confirm('Reject this ticket?')) return;

    const { error } = await supabase
      .from('tickets')
      .update({ status: 'rejected' })
      .eq('id', ticketId);

    if (error) {
      alert('Failed to reject: ' + error.message);
    } else {
      fetchData();
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-white">Loading review queue...</div>;
  }

  return (
    <div className="p-4 md:p-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-white">Review Queue ({currentYear})</h1>
        <div className="text-sm text-gray-400">
          AI Usage: {aiUsage.count}/{aiUsage.limit}
        </div>
      </div>

      {tickets.length === 0 ? (
        <div className="text-center text-white mt-8">No tickets need review</div>
      ) : (
        <div className="space-y-6">
          {tickets.map((ticket) => {
            const edit = edits[ticket.id] || ticketToEdit(ticket);

            return (
              <div key={ticket.id} className="bg-gray-800 rounded-lg p-6">
                {/* Image + AI Button row */}
                <div className="flex flex-col md:flex-row gap-4 mb-4">
                  {ticket.image_url && (
                    <div className="md:w-1/3">
                      <img
                        src={ticket.image_url}
                        alt="Ticket"
                        className="w-full rounded-lg cursor-pointer"
                        onClick={() => window.open(ticket.image_url!, '_blank')}
                      />
                    </div>
                  )}

                  {/* Editable Fields */}
                  <div className="flex-1 grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-gray-400 text-xs mb-1">Date</label>
                      <input
                        type="date"
                        value={edit.ticket_date}
                        onChange={(e) => updateEdit(ticket.id, 'ticket_date', e.target.value)}
                        className="w-full px-2 py-1.5 bg-gray-700 text-white rounded text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-400 text-xs mb-1">Ticket #</label>
                      <input
                        type="text"
                        value={edit.ticket_number}
                        onChange={(e) => updateEdit(ticket.id, 'ticket_number', e.target.value)}
                        placeholder="—"
                        className="w-full px-2 py-1.5 bg-gray-700 text-white rounded text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-400 text-xs mb-1">Person</label>
                      <select
                        value={edit.person}
                        onChange={(e) => updateEdit(ticket.id, 'person', e.target.value)}
                        className="w-full px-2 py-1.5 bg-gray-700 text-white rounded text-sm"
                      >
                        <option value="">Select</option>
                        {PERSON_OPTIONS.map((p) => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-gray-400 text-xs mb-1">Crop</label>
                      <select
                        value={edit.crop}
                        onChange={(e) => updateEdit(ticket.id, 'crop', e.target.value)}
                        className="w-full px-2 py-1.5 bg-gray-700 text-white rounded text-sm"
                      >
                        <option value="">Select</option>
                        <option value="Corn">Corn</option>
                        <option value="Soybeans">Soybeans</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-gray-400 text-xs mb-1">Bushels</label>
                      <input
                        type="number"
                        step="0.01"
                        value={edit.bushels}
                        onChange={(e) => updateEdit(ticket.id, 'bushels', e.target.value)}
                        placeholder="0"
                        className="w-full px-2 py-1.5 bg-gray-700 text-white rounded text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-400 text-xs mb-1">Location</label>
                      <input
                        type="text"
                        value={edit.delivery_location}
                        onChange={(e) => updateEdit(ticket.id, 'delivery_location', e.target.value)}
                        placeholder="e.g., Cargill-Lacon"
                        className="w-full px-2 py-1.5 bg-gray-700 text-white rounded text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-400 text-xs mb-1">Through</label>
                      <select
                        value={edit.through}
                        onChange={(e) => updateEdit(ticket.id, 'through', e.target.value)}
                        className="w-full px-2 py-1.5 bg-gray-700 text-white rounded text-sm"
                      >
                        <option value="">Select</option>
                        <option value="Akron">Akron</option>
                        <option value="RVC">RVC</option>
                        <option value="Cargill">Cargill</option>
                        <option value="ADM">ADM</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-gray-400 text-xs mb-1">Truck</label>
                      <input
                        type="text"
                        value={edit.truck}
                        onChange={(e) => updateEdit(ticket.id, 'truck', e.target.value)}
                        placeholder="—"
                        className="w-full px-2 py-1.5 bg-gray-700 text-white rounded text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-400 text-xs mb-1">Moisture %</label>
                      <input
                        type="number"
                        step="0.1"
                        value={edit.moisture_percent}
                        onChange={(e) => updateEdit(ticket.id, 'moisture_percent', e.target.value)}
                        placeholder="—"
                        className="w-full px-2 py-1.5 bg-gray-700 text-white rounded text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-400 text-xs mb-1">Notes</label>
                      <input
                        type="text"
                        value={edit.notes}
                        onChange={(e) => updateEdit(ticket.id, 'notes', e.target.value)}
                        placeholder="—"
                        className="w-full px-2 py-1.5 bg-gray-700 text-white rounded text-sm"
                      />
                    </div>
                  </div>
                </div>

                {/* Action Buttons */}
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
                         aiUsage.count >= aiUsage.limit ? 'Limit Reached' :
                         'AI Auto-Fill'}
                      </span>
                    </button>
                  )}
                  <button
                    onClick={() => saveEdits(ticket.id)}
                    disabled={saving === ticket.id}
                    className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white rounded-lg font-semibold"
                  >
                    {saving === ticket.id ? 'Saving...' : 'Save Edits'}
                  </button>
                  <button
                    onClick={() => handleApprove(ticket)}
                    className="px-6 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => handleReject(ticket.id)}
                    className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold"
                  >
                    Reject
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Overfill Decision Modal */}
      {showOverfillModal && selectedTicket && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-lg p-6 max-w-md w-full">
            <h2 className="text-2xl font-bold mb-4 text-white">Contract Will Be Overfilled</h2>
            <p className="text-gray-300 mb-6">
              This ticket will put the contract over its contracted amount. What would you like to do?
            </p>

            <div className="space-y-3 mb-6">
              <button
                onClick={() => setOverfillDecision('roll')}
                className={`w-full px-4 py-3 rounded-lg text-left ${
                  overfillDecision === 'roll'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                <div className="font-semibold">Roll to Next Contract</div>
                <div className="text-sm">Find another matching contract for this load</div>
              </button>

              <button
                onClick={() => setOverfillDecision('keep')}
                className={`w-full px-4 py-3 rounded-lg text-left ${
                  overfillDecision === 'keep'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                <div className="font-semibold">Keep on This Contract</div>
                <div className="text-sm">Allow overfill on current contract</div>
              </button>

              <button
                onClick={() => setOverfillDecision('spot')}
                className={`w-full px-4 py-3 rounded-lg text-left ${
                  overfillDecision === 'spot'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                <div className="font-semibold">Create Spot Sale</div>
                <div className="text-sm">Make this a new spot sale contract</div>
              </button>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => {
                  setShowOverfillModal(false);
                  setSelectedTicket(null);
                  setOverfillDecision(null);
                }}
                className="flex-1 px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleOverfillDecision}
                disabled={!overfillDecision}
                className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white rounded-lg font-semibold"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
