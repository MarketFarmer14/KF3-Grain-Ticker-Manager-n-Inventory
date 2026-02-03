import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';
import { ORIGIN_LOCATIONS } from '../lib/constants';

interface Ticket {
  id: string;
  ticket_date: string;
  ticket_number: string | null;
  person: string;
  crop: string;
  bushels: number;
  delivery_location: string;
  through: string;
  elevator: string | null;
  contract_id: string | null;
  status: string;
  image_url: string | null;
  notes: string | null;
  origin: string;
  moisture_percent: number | null;
}

interface Contract {
  id: string;
  contract_number: string;
  crop: string;
  destination: string;
  through: string | null;
  remaining_bushels: number;
  priority: number;
}

export const ReviewQueuePage: React.FC = () => {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [idx, setIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();

  const [form, setForm] = useState({
    ticket_date: new Date().toISOString().split('T')[0],
    ticket_number: '',
    person: '',
    crop: '',
    bushels: 0,
    delivery_location: '',
    through: 'Akron' as string,
    elevator: '',
    origin: '',
    moisture_percent: null as number | null,
    notes: '',
  });

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (tickets[idx]) {
      const t = tickets[idx];
      setForm({
        ticket_date: t.ticket_date || new Date().toISOString().split('T')[0],
        ticket_number: t.ticket_number || '',
        person: t.person || '',
        crop: t.crop || '',
        bushels: t.bushels || 0,
        delivery_location: t.delivery_location || '',
        through: t.through || 'Akron',
        elevator: t.elevator || '',
        origin: t.origin || '',
        moisture_percent: t.moisture_percent,
        notes: t.notes || '',
      });
    }
  }, [idx, tickets]);

  const load = async () => {
    try {
      const [ticketRes, contractRes] = await Promise.all([
        supabase.from('tickets').select('*').eq('status', 'needs_review').order('created_at', { ascending: true }),
        supabase.from('contracts').select('id,contract_number,crop,destination,through,remaining_bushels,priority').order('priority', { ascending: true }),
      ]);
      setTickets(ticketRes.data || []);
      setContracts(contractRes.data || []);
    } catch (e: unknown) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const findMatch = (): Contract | null => {
    const matches = contracts.filter((c) => {
      const cropMatch = c.crop.toLowerCase() === form.crop.toLowerCase();
      const destMatch = !c.destination || c.destination.toLowerCase() === form.delivery_location.toLowerCase();
      const throughMatch = c.through === 'Any' || c.through === form.through;
      return cropMatch && destMatch && throughMatch;
    });
    return matches[0] || null;
  };

  const advance = () => {
    if (idx < tickets.length - 1) setIdx(idx + 1);
    else navigate('/tickets');
  };

  const handleApprove = async () => {
    if (!form.person.trim()) return alert('Person is required');
    if (!form.crop.trim()) return alert('Crop is required');
    if (form.bushels <= 0) return alert('Bushels must be > 0');
    if (!form.delivery_location.trim()) return alert('Delivery location is required');
    if (!form.origin.trim()) return alert('Origin is required');

    setSaving(true);
    try {
      const match = findMatch();
      const currentYear = localStorage.getItem('selected_crop_year') || new Date().getFullYear().toString();
      const { error } = await supabase.from('tickets').update({
        ...form,
        status: 'approved',
        contract_id: match?.id || null,
        crop_year: currentYear,
        updated_at: new Date().toISOString(),
      }).eq('id', tickets[idx].id);
      if (error) throw error;
      advance();
    } catch (e: unknown) {
      alert('Approve failed: ' + (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleStatus = async (status: 'rejected' | 'hold') => {
    if (status === 'rejected' && !confirm('Reject this ticket?')) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('tickets').update({
        status,
        updated_at: new Date().toISOString(),
      }).eq('id', tickets[idx].id);
      if (error) throw error;
      advance();
    } catch (e: unknown) {
      alert(`${status} failed: ` + (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64"><p className="text-gray-400 text-lg">Loading…</p></div>;
  }

  if (tickets.length === 0) {
    return (
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold text-white mb-6">Review Queue</h1>
        <div className="bg-gray-800 rounded-xl p-12 text-center">
          <p className="text-gray-400 text-lg mb-4">No tickets to review</p>
          <button onClick={() => navigate('/upload')} className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium">
            Upload Tickets
          </button>
        </div>
      </div>
    );
  }

  const ticket = tickets[idx];
  const match = findMatch();

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-5">
        <h1 className="text-2xl font-bold text-white">Review Queue</h1>
        <span className="text-gray-500 text-sm">{idx + 1} of {tickets.length}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Image */}
        <div className="bg-gray-800 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Ticket Image</h3>
          {ticket.image_url ? (
            <img src={ticket.image_url} alt="Ticket" className="w-full rounded-lg" />
          ) : (
            <div className="bg-gray-700 rounded-lg p-16 text-center text-gray-500">No image</div>
          )}
        </div>

        {/* Form */}
        <div className="bg-gray-800 rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">Ticket Details</h3>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Ticket Date *</label>
            <input type="date" value={form.ticket_date} onChange={(e) => setForm({ ...form, ticket_date: e.target.value })}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm outline-none focus:border-emerald-500" />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Ticket Number</label>
            <input type="text" value={form.ticket_number} onChange={(e) => setForm({ ...form, ticket_number: e.target.value })}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm outline-none focus:border-emerald-500" />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Person *</label>
            <select value={form.person} onChange={(e) => setForm({ ...form, person: e.target.value })}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm outline-none focus:border-emerald-500">
              <option value="">Select person...</option>
              <option value="Karl">Karl</option>
              <option value="Anthony">Anthony</option>
              <option value="Ethan">Ethan</option>
              <option value="Bob">Bob</option>
              <option value="Connie">Connie</option>
              <option value="Bonnie">Bonnie</option>
              <option value="Roger">Roger</option>
              <option value="PHF">PHF</option>
              <option value="Mannix">Mannix</option>
              <option value="Routh">Routh</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Crop *</label>
            <input type="text" value={form.crop} onChange={(e) => setForm({ ...form, crop: e.target.value })}
              placeholder="Corn, Soybeans…"
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm outline-none focus:border-emerald-500" />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Bushels *</label>
            <input type="number" step="0.01" value={form.bushels} onChange={(e) => setForm({ ...form, bushels: parseFloat(e.target.value) || 0 })}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm outline-none focus:border-emerald-500" />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Delivery Location *</label>
            <input type="text" value={form.delivery_location} onChange={(e) => setForm({ ...form, delivery_location: e.target.value })}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm outline-none focus:border-emerald-500" />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Through *</label>
            <div className="flex gap-4">
              {(['Akron', 'RVC', 'Cargill'] as const).map((opt) => (
                <label key={opt} className="flex items-center cursor-pointer">
                  <input type="radio" checked={form.through === opt} onChange={() => setForm({ ...form, through: opt })} className="mr-1.5 accent-emerald-500" />
                  <span className="text-white text-sm">{opt}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Elevator</label>
            <input type="text" value={form.elevator} onChange={(e) => setForm({ ...form, elevator: e.target.value })}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm outline-none focus:border-emerald-500" />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Origin *</label>
            <select value={form.origin} onChange={(e) => setForm({ ...form, origin: e.target.value })}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm outline-none focus:border-emerald-500">
              <option value="">Select origin...</option>
              {ORIGIN_LOCATIONS.map((loc) => (
                <option key={loc} value={loc}>{loc}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Moisture %</label>
            <input type="number" step="0.01" value={form.moisture_percent || ''} onChange={(e) => setForm({ ...form, moisture_percent: e.target.value ? parseFloat(e.target.value) : null })}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm outline-none focus:border-emerald-500" />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Notes</label>
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm outline-none focus:border-emerald-500 resize-none" />
          </div>

          {/* Auto-assign indicator */}
          {match && form.crop && (
            <div className="p-2.5 bg-emerald-900/30 border border-emerald-800 rounded-lg">
              <p className="text-emerald-300 text-xs">✓ Auto-assigns to contract <strong>{match.contract_number}</strong> (priority {match.priority})</p>
            </div>
          )}
          {!match && form.crop && form.delivery_location && (
            <div className="p-2.5 bg-yellow-900/30 border border-yellow-800 rounded-lg">
              <p className="text-yellow-300 text-xs">⚠ No matching contract found — will approve without assignment</p>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-2 pt-2">
            <button onClick={handleApprove} disabled={saving} className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-600 text-white text-sm font-medium py-2.5 rounded-lg transition">
              {saving ? '…' : 'Approve'}
            </button>
            <button onClick={() => handleStatus('hold')} disabled={saving} className="flex-1 bg-yellow-600 hover:bg-yellow-700 disabled:bg-gray-600 text-white text-sm font-medium py-2.5 rounded-lg transition">
              Hold
            </button>
            <button onClick={() => handleStatus('rejected')} disabled={saving} className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-gray-600 text-white text-sm font-medium py-2.5 rounded-lg transition">
              Reject
            </button>
          </div>

          {/* Navigation */}
          <div className="flex gap-2">
            <button onClick={() => setIdx(Math.max(0, idx - 1))} disabled={idx === 0 || saving}
              className="flex-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-30 text-white text-sm py-2 rounded-lg transition">
              ← Prev
            </button>
            <button onClick={() => setIdx(Math.min(tickets.length - 1, idx + 1))} disabled={idx === tickets.length - 1 || saving}
              className="flex-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-30 text-white text-sm py-2 rounded-lg transition">
              Next →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
