import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { PERSON_OPTIONS } from '../lib/constants';
import type { Database } from '../lib/database.types';

type Ticket = Database['public']['Tables']['tickets']['Row'];

interface EditState {
  ticket_date: string;
  ticket_number: string;
  person: string;
  crop: string;
  bushels: string;
  delivery_location: string;
  through: string;
  truck: string;
  dockage: string;
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
    dockage: (ticket as any).dockage ? (ticket as any).dockage.toString() : '',
    moisture_percent: ticket.moisture_percent ? ticket.moisture_percent.toString() : '',
    notes: ticket.notes || '',
  };
}

export function TicketsPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [showTrash, setShowTrash] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);

  const currentYear = localStorage.getItem('grain_ticket_year') || new Date().getFullYear().toString();

  useEffect(() => {
    fetchTickets();
  }, [currentYear, showTrash]);

  const fetchTickets = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('tickets')
      .select('*')
      .eq('crop_year', currentYear)
      .eq('deleted', showTrash)
      .order('ticket_date', { ascending: false });

    if (error) {
      console.error('Error fetching tickets:', error);
    } else {
      setTickets(data || []);
    }
    setLoading(false);
  };

  const startEdit = (ticket: Ticket) => {
    setEditingId(ticket.id);
    setEditState(ticketToEdit(ticket));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditState(null);
  };

  const updateField = (field: keyof EditState, value: string) => {
    setEditState((prev) => prev ? { ...prev, [field]: value } : prev);
  };

  const saveEdit = async () => {
    if (!editingId || !editState) return;
    setSaving(true);

    const { error } = await supabase
      .from('tickets')
      .update({
        ticket_date: editState.ticket_date || new Date().toISOString().split('T')[0],
        ticket_number: editState.ticket_number || null,
        person: editState.person,
        crop: editState.crop,
        bushels: parseFloat(editState.bushels) || 0,
        delivery_location: editState.delivery_location,
        through: editState.through,
        truck: editState.truck || null,
        dockage: editState.dockage ? parseFloat(editState.dockage) : null,
        moisture_percent: editState.moisture_percent ? parseFloat(editState.moisture_percent) : null,
        notes: editState.notes || null,
      })
      .eq('id', editingId);

    if (error) {
      alert('Save failed: ' + error.message);
    } else {
      setEditingId(null);
      setEditState(null);
      fetchTickets();
    }
    setSaving(false);
  };

  const handleSoftDelete = async (ticketId: string) => {
    if (!confirm('Move this ticket to trash? You can restore it later.')) return;

    const { error } = await supabase
      .from('tickets')
      .update({
        deleted: true,
        deleted_at: new Date().toISOString(),
        deleted_by: 'user',
      })
      .eq('id', ticketId);

    if (error) {
      alert('Failed to delete: ' + error.message);
    } else {
      fetchTickets();
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
      alert('Failed to restore: ' + error.message);
    } else {
      fetchTickets();
    }
  };

  const handlePermanentDelete = async (ticketId: string) => {
    if (!confirm('PERMANENTLY delete this ticket? This cannot be undone!')) return;

    const { error } = await supabase.from('tickets').delete().eq('id', ticketId);

    if (error) {
      alert('Failed to delete: ' + error.message);
    } else {
      fetchTickets();
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-white">Loading tickets...</div>;
  }

  const isEditing = (id: string) => editingId === id;
  const inputClass = 'w-full px-2 py-1 bg-gray-600 text-white rounded text-sm border border-gray-500 focus:border-emerald-500 focus:outline-none';

  return (
    <div className="p-4 md:p-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-white">
          {showTrash ? `Trash (${currentYear})` : `Tickets (${currentYear})`}
        </h1>
        <button
          onClick={() => setShowTrash(!showTrash)}
          className={`px-4 py-2 rounded-lg font-semibold ${
            showTrash
              ? 'bg-green-600 hover:bg-green-700 text-white'
              : 'bg-gray-700 hover:bg-gray-600 text-white'
          }`}
        >
          {showTrash ? '\u2190 Back to Tickets' : 'View Trash'}
        </button>
      </div>

      {tickets.length === 0 ? (
        <div className="text-center text-white mt-8">
          {showTrash ? 'Trash is empty' : 'No tickets for this year'}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full bg-gray-800 rounded-lg">
            <thead className="bg-gray-700">
              <tr>
                <th className="px-4 py-3 text-left text-white">Date</th>
                <th className="px-4 py-3 text-left text-white">Ticket #</th>
                <th className="px-4 py-3 text-left text-white">Person</th>
                <th className="px-4 py-3 text-left text-white">Crop</th>
                <th className="px-4 py-3 text-right text-white">Bushels</th>
                <th className="px-4 py-3 text-left text-white">Location</th>
                <th className="px-4 py-3 text-left text-white">Through</th>
                <th className="px-4 py-3 text-left text-white">Truck</th>
                <th className="px-4 py-3 text-right text-white">Dockage</th>
                <th className="px-4 py-3 text-left text-white">Status</th>
                {showTrash && <th className="px-4 py-3 text-left text-white">Deleted</th>}
                <th className="px-4 py-3 text-center text-white">Actions</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((ticket) => {
                const isCorn = ticket.crop === 'Corn';
                const editing = isEditing(ticket.id);
                const rowBgClass = showTrash
                  ? 'bg-red-900 bg-opacity-20'
                  : editing
                  ? 'bg-blue-900 bg-opacity-30'
                  : isCorn
                  ? 'bg-yellow-900 bg-opacity-20'
                  : 'bg-green-900 bg-opacity-20';
                const hoverClass = editing
                  ? ''
                  : showTrash
                  ? 'hover:bg-red-900 hover:bg-opacity-30'
                  : isCorn
                  ? 'hover:bg-yellow-900 hover:bg-opacity-30'
                  : 'hover:bg-green-900 hover:bg-opacity-30';

                return (
                  <tr key={ticket.id} className={`border-t border-gray-700 ${rowBgClass} ${hoverClass}`}>
                    <td className="px-4 py-3 text-white">
                      {editing && editState ? (
                        <input type="date" value={editState.ticket_date} onChange={(e) => updateField('ticket_date', e.target.value)} className={inputClass} />
                      ) : (
                        new Date(ticket.ticket_date).toLocaleDateString()
                      )}
                    </td>
                    <td className="px-4 py-3 text-white">
                      {editing && editState ? (
                        <input type="text" value={editState.ticket_number} onChange={(e) => updateField('ticket_number', e.target.value)} placeholder="-" className={inputClass} />
                      ) : (
                        <>
                          {ticket.ticket_number || '-'}
                          {ticket.duplicate_flag && (
                            <span className="ml-1 px-1.5 py-0.5 bg-orange-600 rounded text-xs font-semibold" title={`Duplicate group: ${ticket.duplicate_group}`}>DUP</span>
                          )}
                        </>
                      )}
                    </td>
                    <td className="px-4 py-3 text-white">
                      {editing && editState ? (
                        <select value={editState.person} onChange={(e) => updateField('person', e.target.value)} className={inputClass}>
                          <option value="">Select</option>
                          {PERSON_OPTIONS.map((p) => (
                            <option key={p} value={p}>{p}</option>
                          ))}
                        </select>
                      ) : (
                        ticket.person
                      )}
                    </td>
                    <td className="px-4 py-3 text-white font-semibold">
                      {editing && editState ? (
                        <select value={editState.crop} onChange={(e) => updateField('crop', e.target.value)} className={inputClass}>
                          <option value="">Select</option>
                          <option value="Corn">Corn</option>
                          <option value="Soybeans">Soybeans</option>
                        </select>
                      ) : (
                        ticket.crop
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-white">
                      {editing && editState ? (
                        <input type="number" step="0.01" value={editState.bushels} onChange={(e) => updateField('bushels', e.target.value)} className={`${inputClass} text-right`} />
                      ) : (
                        ticket.bushels.toLocaleString()
                      )}
                    </td>
                    <td className="px-4 py-3 text-white">
                      {editing && editState ? (
                        <input type="text" value={editState.delivery_location} onChange={(e) => updateField('delivery_location', e.target.value)} placeholder="-" className={inputClass} />
                      ) : (
                        ticket.delivery_location
                      )}
                    </td>
                    <td className="px-4 py-3 text-white">
                      {editing && editState ? (
                        <select value={editState.through} onChange={(e) => updateField('through', e.target.value)} className={inputClass}>
                          <option value="">Select</option>
                          <option value="Akron">Akron</option>
                          <option value="RVC">RVC</option>
                          <option value="Cargill">Cargill</option>
                          <option value="ADM">ADM</option>
                        </select>
                      ) : (
                        ticket.through
                      )}
                    </td>
                    <td className="px-4 py-3 text-white">
                      {editing && editState ? (
                        <input type="text" value={editState.truck} onChange={(e) => updateField('truck', e.target.value)} placeholder="-" className={inputClass} />
                      ) : (
                        ticket.truck || '-'
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-white">
                      {editing && editState ? (
                        <input type="number" step="0.01" value={editState.dockage} onChange={(e) => updateField('dockage', e.target.value)} placeholder="-" className={`${inputClass} text-right`} />
                      ) : (
                        (ticket as any).dockage ? `${(ticket as any).dockage}%` : '-'
                      )}
                    </td>
                    <td className="px-4 py-3 text-white">
                      <span
                        className={`px-2 py-1 rounded text-xs font-semibold ${
                          ticket.status === 'approved'
                            ? 'bg-green-600'
                            : ticket.status === 'rejected'
                            ? 'bg-red-600'
                            : ticket.status === 'hold'
                            ? 'bg-yellow-600'
                            : 'bg-blue-600'
                        }`}
                      >
                        {ticket.status}
                      </span>
                    </td>
                    {showTrash && (
                      <td className="px-4 py-3 text-white text-sm">
                        {ticket.deleted_at
                          ? new Date(ticket.deleted_at).toLocaleDateString()
                          : '-'}
                      </td>
                    )}
                    <td className="px-4 py-3 text-center">
                      {showTrash ? (
                        <div className="flex gap-2 justify-center">
                          <button
                            onClick={() => handleRestore(ticket.id)}
                            className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-sm"
                          >
                            Restore
                          </button>
                          <button
                            onClick={() => handlePermanentDelete(ticket.id)}
                            className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-sm"
                          >
                            Delete Forever
                          </button>
                        </div>
                      ) : editing ? (
                        <div className="flex gap-2 justify-center">
                          <button
                            onClick={saveEdit}
                            disabled={saving}
                            className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-600 text-white rounded text-sm font-semibold"
                          >
                            {saving ? 'Saving...' : 'Save'}
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="px-3 py-1 bg-gray-600 hover:bg-gray-500 text-white rounded text-sm"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="flex gap-2 justify-center">
                          <button
                            onClick={() => startEdit(ticket)}
                            className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleSoftDelete(ticket.id)}
                            className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-sm"
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
