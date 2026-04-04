import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { findBestContract, createSpotSaleContract, autoAssignTicket } from '../lib/contractMatcher';
import type { SplitAssignment, AutoAssignmentResult } from '../lib/contractMatcher';
import { SplitTicketModal } from '../components/SplitTicketModal';
import { Sparkles } from 'lucide-react';
import { PERSON_OPTIONS, ORIGIN_LOCATIONS, normalizeTicketFields } from '../lib/constants';
import type { Database } from '../lib/database.types';

type Ticket = Database['public']['Tables']['tickets']['Row'];
type Contract = Database['public']['Tables']['contracts']['Row'];
type TicketSplitInsert = Database['public']['Tables']['ticket_splits']['Insert'];

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
  dockage: string;
  notes: string;
  origin: string;
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
    dockage: ticket.dockage ? ticket.dockage.toString() : '',
    notes: ticket.notes || '',
    origin: ticket.origin || '',
  };
}

export function ReviewQueuePage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [aiProcessing, setAiProcessing] = useState<string | null>(null);

  // Confirmation modal state
  const [confirmTicket, setConfirmTicket] = useState<Ticket | null>(null);
  const [confirmSplits, setConfirmSplits] = useState<SplitAssignment[]>([]);
  const [confirmRemainder, setConfirmRemainder] = useState(0);
  const [confirmSaving, setConfirmSaving] = useState(false);
  const [aiUsage, setAiUsage] = useState({ count: 0, limit: 500 });
  const [edits, setEdits] = useState<Record<string, EditState>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [splittingTicket, setSplittingTicket] = useState<Ticket | null>(null);

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

  const updateEdit = (ticketId: string, field: keyof EditState, value: string) => {
    setEdits((prev) => ({
      ...prev,
      [ticketId]: { ...prev[ticketId], [field]: value },
    }));
  };

  const saveEdits = async (ticketId: string) => {
    const edit = edits[ticketId];
    if (!edit) return;

    // Normalize person/crop/through to canonical casing before saving
    const normalized = normalizeTicketFields({ person: edit.person, crop: edit.crop, through: edit.through });

    setSaving(ticketId);
    const { error } = await supabase
      .from('tickets')
      .update({
        ticket_date: edit.ticket_date || new Date().toISOString().split('T')[0],
        ticket_number: edit.ticket_number || null,
        person: normalized.person,
        crop: normalized.crop,
        bushels: parseFloat(edit.bushels) || 0,
        delivery_location: edit.delivery_location,
        through: normalized.through,
        truck: edit.truck || null,
        moisture_percent: edit.moisture_percent ? parseFloat(edit.moisture_percent) : null,
        dockage: edit.dockage ? parseFloat(edit.dockage) : null,
        notes: edit.notes || null,
        origin: edit.origin || null,
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
    // Save any pending edits first
    await saveEdits(ticket.id);

    const edit = edits[ticket.id];
    if (!edit?.crop || !edit?.bushels || parseFloat(edit.bushels) === 0) {
      alert('Please fill in at least Crop and Bushels before approving.');
      return;
    }

    // Duplicate detection: check if ticket_number already exists for this crop year
    if (edit.ticket_number) {
      const { data: dupes } = await supabase
        .from('tickets')
        .select('id, ticket_number, person, ticket_date')
        .eq('ticket_number', edit.ticket_number)
        .eq('crop_year', currentYear)
        .eq('deleted', false)
        .neq('id', ticket.id);

      if (dupes && dupes.length > 0) {
        const dupeInfo = dupes.map(d => `${d.ticket_number} (${d.person}, ${d.ticket_date})`).join('\n');
        const proceed = confirm(
          `Possible duplicate! Ticket #${edit.ticket_number} already exists:\n${dupeInfo}\n\nApprove anyway?`
        );
        if (!proceed) return;

        // Flag both as duplicates
        const groupId = `DUP-${edit.ticket_number}-${currentYear}`;
        await supabase
          .from('tickets')
          .update({ duplicate_flag: true, duplicate_group: groupId })
          .in('id', [ticket.id, ...dupes.map(d => d.id)]);
      }
    }

    // Auto-assign using smallest-remaining-first logic
    const result = autoAssignTicket(
      {
        person: edit.person,
        crop: edit.crop,
        through: edit.through,
        bushels: parseFloat(edit.bushels) || 0,
      },
      contracts
    );

    // Open confirmation modal with proposed splits
    setConfirmTicket(ticket);
    setConfirmSplits(result.splits);
    setConfirmRemainder(result.remainder);
  };

  // Update a split's bushels in the confirmation modal
  const updateConfirmSplitBushels = (index: number, newBushels: number) => {
    setConfirmSplits(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], bushels: newBushels };
      // Recalculate remainder
      const totalAssigned = updated.reduce((sum, s) => sum + s.bushels, 0);
      const edit = confirmTicket ? edits[confirmTicket.id] : null;
      const ticketBushels = edit ? parseFloat(edit.bushels) || 0 : 0;
      setConfirmRemainder(Math.max(0, ticketBushels - totalAssigned));
      return updated;
    });
  };

  // Change a split's contract in the confirmation modal
  const updateConfirmSplitContract = (index: number, contractId: string) => {
    const contract = contracts.find(c => c.id === contractId);
    if (!contract) return;
    setConfirmSplits(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], contract };
      return updated;
    });
  };

  // Remove a split from the confirmation modal
  const removeConfirmSplit = (index: number) => {
    setConfirmSplits(prev => {
      const updated = prev.filter((_, i) => i !== index);
      const totalAssigned = updated.reduce((sum, s) => sum + s.bushels, 0);
      const edit = confirmTicket ? edits[confirmTicket.id] : null;
      const ticketBushels = edit ? parseFloat(edit.bushels) || 0 : 0;
      setConfirmRemainder(Math.max(0, ticketBushels - totalAssigned));
      return updated;
    });
  };

  // Add a new split in the confirmation modal
  const addConfirmSplit = () => {
    const assignable = contracts.filter(c => !c.is_spot_sale && (c.percent_filled || 0) < 100 && c.remaining_bushels > 0);
    if (assignable.length === 0) return;
    const edit = confirmTicket ? edits[confirmTicket.id] : null;
    const newSplit: SplitAssignment = {
      contract: assignable[0],
      bushels: confirmRemainder > 0 ? confirmRemainder : 0,
      person: edit?.person || confirmTicket?.person || '',
    };
    setConfirmSplits(prev => {
      const updated = [...prev, newSplit];
      const totalAssigned = updated.reduce((sum, s) => sum + s.bushels, 0);
      const ticketBushels = edit ? parseFloat(edit.bushels) || 0 : 0;
      setConfirmRemainder(Math.max(0, ticketBushels - totalAssigned));
      return updated;
    });
  };

  // Create spot sale for remainder
  const handleCreateSpotForRemainder = async () => {
    if (!confirmTicket || confirmRemainder <= 0) return;
    const edit = edits[confirmTicket.id];

    const spotContract = createSpotSaleContract({
      person: edit?.person || confirmTicket.person,
      crop: edit?.crop || confirmTicket.crop,
      through: edit?.through || confirmTicket.through,
      delivery_location: edit?.delivery_location || confirmTicket.delivery_location,
      ticket_date: edit?.ticket_date || confirmTicket.ticket_date,
      crop_year: currentYear,
      bushels: confirmRemainder,
    });

    const { data: newContract, error } = await supabase
      .from('contracts')
      .insert([spotContract])
      .select()
      .single();

    if (error) {
      alert('Failed to create spot sale: ' + error.message);
      return;
    }

    // Add as a split
    const newSplit: SplitAssignment = {
      contract: newContract,
      bushels: confirmRemainder,
      person: edit?.person || confirmTicket.person,
    };
    setConfirmSplits(prev => [...prev, newSplit]);
    setConfirmRemainder(0);
  };

  // Confirm and finalize the splits
  const handleConfirmSplits = async () => {
    if (!confirmTicket || confirmSplits.length === 0) return;
    setConfirmSaving(true);

    const edit = edits[confirmTicket.id];

    try {
      // Approve the ticket (assign to first contract for backwards compatibility)
      const { error: ticketError } = await supabase
        .from('tickets')
        .update({ status: 'approved', contract_id: confirmSplits[0].contract.id })
        .eq('id', confirmTicket.id);

      if (ticketError) throw ticketError;

      // Insert all splits into ticket_splits table
      const splitInserts = confirmSplits.map(s => ({
        ticket_id: confirmTicket.id,
        contract_id: s.contract.id,
        person: s.person,
        bushels: s.bushels,
      }));

      const { error: splitsError } = await supabase
        .from('ticket_splits')
        .insert(splitInserts);

      if (splitsError) throw splitsError;

      // Update delivered_bushels on each contract
      for (const split of confirmSplits) {
        const newDelivered = split.contract.delivered_bushels + split.bushels;
        await supabase
          .from('contracts')
          .update({ delivered_bushels: newDelivered })
          .eq('id', split.contract.id);
      }

      setConfirmTicket(null);
      setConfirmSplits([]);
      setConfirmRemainder(0);
      fetchData();
    } catch (err: any) {
      alert('Failed to finalize splits: ' + err.message);
    } finally {
      setConfirmSaving(false);
    }
  };

  const closeConfirmModal = () => {
    setConfirmTicket(null);
    setConfirmSplits([]);
    setConfirmRemainder(0);
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
                      <label className="block text-gray-400 text-xs mb-1">Dockage %</label>
                      <input
                        type="number"
                        step="0.01"
                        value={edit.dockage}
                        onChange={(e) => updateEdit(ticket.id, 'dockage', e.target.value)}
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
                    <div>
                      <label className="block text-gray-400 text-xs mb-1">Origin</label>
                      <select
                        value={edit.origin}
                        onChange={(e) => updateEdit(ticket.id, 'origin', e.target.value)}
                        className="w-full px-2 py-1.5 bg-gray-700 text-white rounded text-sm"
                      >
                        <option value="">Select origin</option>
                        {ORIGIN_LOCATIONS.map((loc) => (
                          <option key={loc} value={loc}>{loc}</option>
                        ))}
                      </select>
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
                    onClick={() => setSplittingTicket(ticket)}
                    className="px-6 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-semibold"
                  >
                    Split
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

      {/* Split Ticket Modal */}
      {splittingTicket && (
        <SplitTicketModal
          ticket={splittingTicket}
          contracts={contracts}
          onClose={() => setSplittingTicket(null)}
          onSplitComplete={() => {
            setSplittingTicket(null);
            fetchData();
          }}
        />
      )}

      {/* Assignment Confirmation Modal */}
      {confirmTicket && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <h2 className="text-2xl font-bold mb-2 text-white">Confirm Assignment</h2>
            <p className="text-gray-400 mb-4 text-sm">
              {edits[confirmTicket.id]?.person} &mdash; {edits[confirmTicket.id]?.crop} &mdash; {parseFloat(edits[confirmTicket.id]?.bushels || '0').toLocaleString()} bu
            </p>

            {confirmSplits.length === 0 ? (
              <div className="text-yellow-400 mb-4 p-3 bg-yellow-900 bg-opacity-30 rounded">
                No matching contracts found. Create a spot sale or add a split manually.
              </div>
            ) : (
              <table className="w-full mb-4">
                <thead>
                  <tr className="text-gray-400 text-xs border-b border-gray-600">
                    <th className="text-left py-2 px-2">Contract</th>
                    <th className="text-left py-2 px-2">Remaining</th>
                    <th className="text-right py-2 px-2">Assign (bu)</th>
                    <th className="text-center py-2 px-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {confirmSplits.map((split, idx) => (
                    <tr key={idx} className="border-b border-gray-700">
                      <td className="py-2 px-2">
                        <select
                          value={split.contract.id}
                          onChange={(e) => updateConfirmSplitContract(idx, e.target.value)}
                          className="w-full px-2 py-1.5 bg-gray-700 text-white rounded text-sm border border-gray-500"
                        >
                          {contracts
                            .filter(c => !c.is_spot_sale && (c.percent_filled || 0) < 100)
                            .map(c => (
                              <option key={c.id} value={c.id}>
                                #{c.contract_number} — {c.owner} {c.crop} via {c.through}
                              </option>
                            ))}
                          {split.contract.is_spot_sale && (
                            <option value={split.contract.id}>
                              #{split.contract.contract_number} (Spot Sale)
                            </option>
                          )}
                        </select>
                      </td>
                      <td className="py-2 px-2 text-gray-300 text-sm">
                        {split.contract.remaining_bushels.toLocaleString()} bu
                      </td>
                      <td className="py-2 px-2">
                        <input
                          type="number"
                          step="0.01"
                          value={split.bushels}
                          onChange={(e) => updateConfirmSplitBushels(idx, parseFloat(e.target.value) || 0)}
                          className="w-full px-2 py-1.5 bg-gray-700 text-white rounded text-sm text-right border border-gray-500"
                        />
                      </td>
                      <td className="py-2 px-2 text-center">
                        <button
                          onClick={() => removeConfirmSplit(idx)}
                          className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-xs"
                        >
                          X
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* Remainder info */}
            {confirmRemainder > 0 && (
              <div className="mb-4 p-3 bg-yellow-900 bg-opacity-30 rounded text-yellow-300 text-sm">
                {confirmRemainder.toLocaleString()} bu unassigned
              </div>
            )}

            {/* Action buttons row */}
            <div className="flex flex-wrap gap-2 mb-4">
              <button
                onClick={addConfirmSplit}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold"
              >
                + Add Split
              </button>
              {confirmRemainder > 0 && (
                <button
                  onClick={handleCreateSpotForRemainder}
                  className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-sm font-semibold"
                >
                  Create Spot Sale for Remainder ({confirmRemainder.toLocaleString()} bu)
                </button>
              )}
            </div>

            {/* Confirm / Cancel */}
            <div className="flex gap-2">
              <button
                onClick={closeConfirmModal}
                className="flex-1 px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmSplits}
                disabled={confirmSplits.length === 0 || confirmSaving}
                className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white rounded-lg font-semibold"
              >
                {confirmSaving ? 'Saving...' : 'Confirm & Approve'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
