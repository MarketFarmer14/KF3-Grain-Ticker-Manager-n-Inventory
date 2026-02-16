import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import type { Database } from '../lib/database.types';

type Ticket = Database['public']['Tables']['tickets']['Row'];

export function TicketsPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [showTrash, setShowTrash] = useState(false);
  const [loading, setLoading] = useState(true);

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
      .eq('deleted', showTrash) // Show deleted if in trash view
      .order('ticket_date', { ascending: false });

    if (error) {
      console.error('Error fetching tickets:', error);
    } else {
      setTickets(data || []);
    }
    setLoading(false);
  };

  const handleSoftDelete = async (ticketId: string) => {
    if (!confirm('Move this ticket to trash? You can restore it later.')) return;

    const { error } = await supabase
      .from('tickets')
      .update({
        deleted: true,
        deleted_at: new Date().toISOString(),
        deleted_by: 'user', // Could track actual user if you add auth
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
          {showTrash ? '← Back to Tickets' : '🗑️ View Trash'}
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
                <th className="px-4 py-3 text-left text-white">Status</th>
                {showTrash && <th className="px-4 py-3 text-left text-white">Deleted</th>}
                <th className="px-4 py-3 text-center text-white">Actions</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((ticket) => {
                const isCorn = ticket.crop === 'Corn';
                const rowBgClass = showTrash
                  ? 'bg-red-900 bg-opacity-20'
                  : isCorn
                  ? 'bg-yellow-900 bg-opacity-20'
                  : 'bg-green-900 bg-opacity-20';
                const hoverClass = showTrash
                  ? 'hover:bg-red-900 hover:bg-opacity-30'
                  : isCorn
                  ? 'hover:bg-yellow-900 hover:bg-opacity-30'
                  : 'hover:bg-green-900 hover:bg-opacity-30';

                return (
                  <tr key={ticket.id} className={`border-t border-gray-700 ${rowBgClass} ${hoverClass}`}>
                    <td className="px-4 py-3 text-white">
                      {new Date(ticket.ticket_date).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-white">{ticket.ticket_number || '-'}</td>
                    <td className="px-4 py-3 text-white">{ticket.person}</td>
                    <td className="px-4 py-3 text-white font-semibold">{ticket.crop}</td>
                    <td className="px-4 py-3 text-right text-white">{ticket.bushels.toLocaleString()}</td>
                    <td className="px-4 py-3 text-white">{ticket.delivery_location}</td>
                    <td className="px-4 py-3 text-white">{ticket.through}</td>
                    <td className="px-4 py-3 text-white">{ticket.truck || '-'}</td>
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
                      ) : (
                        <button
                          onClick={() => handleSoftDelete(ticket.id)}
                          className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-sm"
                        >
                          Delete
                        </button>
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
