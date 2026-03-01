import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { findBestContract, createSpotSaleContract } from '../lib/contractMatcher';
import { Sparkles } from 'lucide-react';
import type { Database } from '../lib/database.types';

type Ticket = Database['public']['Tables']['tickets']['Row'];
type Contract = Database['public']['Tables']['contracts']['Row'];

export function ReviewQueuePage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [showOverfillModal, setShowOverfillModal] = useState(false);
  const [overfillDecision, setOverfillDecision] = useState<'roll' | 'keep' | 'spot' | null>(null);
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
      // Fetch the image and convert to base64
      const response = await fetch(ticket.image_url);
      const blob = await response.blob();
      
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result as string;
          const base64 = result.split(',')[1]; // Remove data:image/jpeg;base64, prefix
          resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      // Call Netlify function
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

      // Update usage display
      if (extractedData._usage) {
        setAiUsage({ count: extractedData._usage, limit: extractedData._limit || 500 });
      }

      // Update ticket in database with AI-extracted data
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
        const { error } = await supabase
          .from('tickets')
          .update(updates)
          .eq('id', ticket.id);

        if (error) throw error;

        alert('✅ Ticket data extracted and updated! Please review before approving.');
        fetchData(); // Refresh to show updated data
      } else {
        alert('⚠️ No data could be extracted from the image');
      }
    } catch (error: any) {
      alert('AI reading failed: ' + error.message);
      console.error('AI Error:', error);
    } finally {
      setAiProcessing(null);
    }
  };

  const handleApprove = async (ticket: Ticket) => {
    // Find best matching contract
    const matchResult = findBestContract(
      {
        person: ticket.person,
        crop: ticket.crop,
        through: ticket.through,
        delivery_location: ticket.delivery_location,
      },
      contracts
    );

    if (matchResult.matchType === 'spot') {
      // No matching contract - create spot sale
      const spotContract = createSpotSaleContract({
        person: ticket.person,
        crop: ticket.crop,
        through: ticket.through,
        delivery_location: ticket.delivery_location,
        ticket_date: ticket.ticket_date,
        crop_year: ticket.crop_year,
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

      // Assign ticket to new spot sale contract
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

    // Check if contract will be overfilled
    const contract = matchResult.contract!;
    const newDelivered = contract.delivered_bushels + ticket.bushels;
    const willOverfill = newDelivered > contract.contracted_bushels;

    if (willOverfill && !contract.overfill_allowed) {
      // Show overfill decision modal
      setSelectedTicket(ticket);
      setShowOverfillModal(true);
      return;
    }

    // Normal approval - assign to contract
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

    const matchResult = findBestContract(
      {
        person: selectedTicket.person,
        crop: selectedTicket.crop,
        through: selectedTicket.through,
        delivery_location: selectedTicket.delivery_location,
      },
      contracts
    );

    const contract = matchResult.contract!;

    if (overfillDecision === 'keep') {
      const { error } = await supabase
        .from('tickets')
        .update({ status: 'approved', contract_id: contract.id })
        .eq('id', selectedTicket.id);

      if (error) {
        alert('Failed: ' + error.message);
      } else {
        setShowOverfillModal(false);
        setSelectedTicket(null);
        setOverfillDecision(null);
        fetchData();
      }
    } else if (overfillDecision === 'roll') {
      const remainingContracts = contracts.filter(
        (c) =>
          c.id !== contract.id &&
          c.owner === selectedTicket.person &&
          c.crop === selectedTicket.crop &&
          c.through === selectedTicket.through &&
          (c.percent_filled || 0) < 100
      );

      if (remainingContracts.length === 0) {
        alert('No other contracts available. Creating spot sale instead.');
        const spotContract = createSpotSaleContract({
          person: selectedTicket.person,
          crop: selectedTicket.crop,
          through: selectedTicket.through,
          delivery_location: selectedTicket.delivery_location,
          ticket_date: selectedTicket.ticket_date,
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
        person: selectedTicket.person,
        crop: selectedTicket.crop,
        through: selectedTicket.through,
        delivery_location: selectedTicket.delivery_location,
        ticket_date: selectedTicket.ticket_date,
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
      <h1 className="text-3xl font-bold text-white mb-6">Review Queue ({currentYear})</h1>

      {tickets.length === 0 ? (
        <div className="text-center text-white mt-8">No tickets need review</div>
      ) : (
        <div className="space-y-4">
          {tickets.map((ticket) => (
            <div key={ticket.id} className="bg-gray-800 rounded-lg p-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                <div>
                  <div className="text-gray-400 text-sm">Date</div>
                  <div className="text-white font-semibold">
                    {new Date(ticket.ticket_date).toLocaleDateString()}
                  </div>
                </div>
                <div>
                  <div className="text-gray-400 text-sm">Person</div>
                  <div className="text-white font-semibold">{ticket.person}</div>
                </div>
                <div>
                  <div className="text-gray-400 text-sm">Crop</div>
                  <div className="text-white font-semibold">{ticket.crop}</div>
                </div>
                <div>
                  <div className="text-gray-400 text-sm">Bushels</div>
                  <div className="text-white font-semibold">{ticket.bushels.toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-gray-400 text-sm">Location</div>
                  <div className="text-white font-semibold">{ticket.delivery_location}</div>
                </div>
                <div>
                  <div className="text-gray-400 text-sm">Through</div>
                  <div className="text-white font-semibold">{ticket.through}</div>
                </div>
                {ticket.truck && (
                  <div>
                    <div className="text-gray-400 text-sm">Truck</div>
                    <div className="text-white font-semibold">{ticket.truck}</div>
                  </div>
                )}
                {ticket.moisture_percent && (
                  <div>
                    <div className="text-gray-400 text-sm">Moisture</div>
                    <div className="text-white font-semibold">{ticket.moisture_percent}%</div>
                  </div>
                )}
              </div>

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

              {ticket.notes && (
                <div className="mb-4">
                  <div className="text-gray-400 text-sm">Notes</div>
                  <div className="text-white">{ticket.notes}</div>
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
              </div>
            </div>
          ))}
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
