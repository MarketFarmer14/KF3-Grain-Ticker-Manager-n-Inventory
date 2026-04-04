import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { ORIGIN_LOCATIONS } from '../lib/constants';
import type { Database } from '../lib/database.types';

type Ticket = Database['public']['Tables']['tickets']['Row'];

export function OriginsPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrigin, setSelectedOrigin] = useState('');

  const currentYear = localStorage.getItem('grain_ticket_year') || new Date().getFullYear().toString();

  useEffect(() => {
    fetchTickets();
  }, [currentYear]);

  const fetchTickets = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('tickets')
      .select('*')
      .eq('crop_year', currentYear)
      .eq('deleted', false)
      .order('ticket_date', { ascending: false });

    if (error) {
      console.error('Error fetching tickets:', error);
    } else {
      setTickets(data || []);
    }
    setLoading(false);
  };

  // Aggregate stats across all origins
  const originStats = useMemo(() => {
    const stats = new Map<string, { loads: number; bushels: number; corn: number; soybeans: number }>();

    for (const ticket of tickets) {
      const origin = ticket.origin || 'Unknown';
      if (origin === 'upload_page' || !origin) continue; // Skip default/empty origins

      const existing = stats.get(origin) || { loads: 0, bushels: 0, corn: 0, soybeans: 0 };
      existing.loads++;
      existing.bushels += ticket.bushels || 0;
      if ((ticket.crop || '').toLowerCase() === 'corn') existing.corn += ticket.bushels || 0;
      else existing.soybeans += ticket.bushels || 0;
      stats.set(origin, existing);
    }

    return Array.from(stats.entries())
      .sort((a, b) => b[1].bushels - a[1].bushels);
  }, [tickets]);

  // Filtered tickets for selected origin
  const originTickets = useMemo(() => {
    if (!selectedOrigin) return [];
    return tickets.filter(t => t.origin === selectedOrigin);
  }, [tickets, selectedOrigin]);

  // Stats for selected origin
  const selectedStats = useMemo(() => {
    if (!selectedOrigin) return null;

    const filtered = originTickets;
    const totalBushels = filtered.reduce((sum, t) => sum + (t.bushels || 0), 0);
    const cornBushels = filtered.filter(t => (t.crop || '').toLowerCase() === 'corn').reduce((sum, t) => sum + (t.bushels || 0), 0);
    const soyBushels = filtered.filter(t => (t.crop || '').toLowerCase() !== 'corn').reduce((sum, t) => sum + (t.bushels || 0), 0);

    // By person
    const byPerson = new Map<string, { loads: number; bushels: number }>();
    for (const t of filtered) {
      const p = t.person || 'Unknown';
      const existing = byPerson.get(p) || { loads: 0, bushels: 0 };
      existing.loads++;
      existing.bushels += t.bushels || 0;
      byPerson.set(p, existing);
    }

    // By through
    const byThrough = new Map<string, { loads: number; bushels: number }>();
    for (const t of filtered) {
      const th = t.through || 'Unknown';
      const existing = byThrough.get(th) || { loads: 0, bushels: 0 };
      existing.loads++;
      existing.bushels += t.bushels || 0;
      byThrough.set(th, existing);
    }

    return {
      totalLoads: filtered.length,
      totalBushels,
      cornBushels,
      soyBushels,
      byPerson: Array.from(byPerson.entries()).sort((a, b) => b[1].bushels - a[1].bushels),
      byThrough: Array.from(byThrough.entries()).sort((a, b) => b[1].bushels - a[1].bushels),
    };
  }, [originTickets, selectedOrigin]);

  if (loading) {
    return <div className="p-8 text-center text-white">Loading origins...</div>;
  }

  return (
    <div className="p-4 md:p-8">
      <h1 className="text-3xl font-bold text-white mb-6">Origins ({currentYear})</h1>

      {/* Origin Selector */}
      <div className="mb-6">
        <label className="block text-gray-400 text-sm mb-1">Select Origin</label>
        <select
          value={selectedOrigin}
          onChange={(e) => setSelectedOrigin(e.target.value)}
          className="w-full max-w-md px-4 py-3 bg-gray-800 text-white rounded-lg border border-gray-600 focus:border-emerald-500 focus:outline-none text-lg"
        >
          <option value="">All Origins (summary view)</option>
          {ORIGIN_LOCATIONS.map((loc) => (
            <option key={loc} value={loc}>{loc}</option>
          ))}
        </select>
      </div>

      {!selectedOrigin ? (
        /* ===== ALL ORIGINS SUMMARY ===== */
        <div>
          <h2 className="text-xl font-semibold text-white mb-4">
            All Active Origins ({originStats.length})
          </h2>

          {originStats.length === 0 ? (
            <div className="text-gray-400 text-center py-8">
              No tickets with origin data yet. Origins are set when uploading tickets.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full bg-gray-800 rounded-lg">
                <thead className="bg-gray-700">
                  <tr>
                    <th className="px-4 py-3 text-left text-white">Origin</th>
                    <th className="px-4 py-3 text-right text-white">Loads</th>
                    <th className="px-4 py-3 text-right text-white">Total Bushels</th>
                    <th className="px-4 py-3 text-right text-white">Corn</th>
                    <th className="px-4 py-3 text-right text-white">Soybeans</th>
                  </tr>
                </thead>
                <tbody>
                  {originStats.map(([origin, stats]) => (
                    <tr
                      key={origin}
                      onClick={() => setSelectedOrigin(origin)}
                      className="border-t border-gray-700 hover:bg-gray-700 cursor-pointer"
                    >
                      <td className="px-4 py-3 text-emerald-400 font-semibold">{origin}</td>
                      <td className="px-4 py-3 text-right text-white">{stats.loads}</td>
                      <td className="px-4 py-3 text-right text-white font-semibold">{stats.bushels.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right text-yellow-400">{stats.corn > 0 ? stats.corn.toLocaleString() : '-'}</td>
                      <td className="px-4 py-3 text-right text-green-400">{stats.soybeans > 0 ? stats.soybeans.toLocaleString() : '-'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-700">
                  <tr>
                    <td className="px-4 py-3 text-white font-bold">Totals</td>
                    <td className="px-4 py-3 text-right text-white font-bold">
                      {originStats.reduce((sum, [, s]) => sum + s.loads, 0)}
                    </td>
                    <td className="px-4 py-3 text-right text-white font-bold">
                      {originStats.reduce((sum, [, s]) => sum + s.bushels, 0).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-yellow-400 font-bold">
                      {originStats.reduce((sum, [, s]) => sum + s.corn, 0).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-green-400 font-bold">
                      {originStats.reduce((sum, [, s]) => sum + s.soybeans, 0).toLocaleString()}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      ) : (
        /* ===== SELECTED ORIGIN DETAIL ===== */
        <div>
          <button
            onClick={() => setSelectedOrigin('')}
            className="mb-4 text-gray-400 hover:text-white text-sm underline"
          >
            &larr; Back to all origins
          </button>

          <h2 className="text-2xl font-bold text-white mb-4">{selectedOrigin}</h2>

          {selectedStats && (
            <>
              {/* Stats Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-gray-800 rounded-lg p-4">
                  <div className="text-gray-400 text-xs">Total Loads</div>
                  <div className="text-white text-2xl font-bold">{selectedStats.totalLoads}</div>
                </div>
                <div className="bg-gray-800 rounded-lg p-4">
                  <div className="text-gray-400 text-xs">Total Bushels</div>
                  <div className="text-white text-2xl font-bold">{selectedStats.totalBushels.toLocaleString()}</div>
                </div>
                <div className="bg-yellow-900 bg-opacity-30 rounded-lg p-4">
                  <div className="text-gray-400 text-xs">Corn</div>
                  <div className="text-yellow-400 text-2xl font-bold">{selectedStats.cornBushels.toLocaleString()}</div>
                </div>
                <div className="bg-green-900 bg-opacity-30 rounded-lg p-4">
                  <div className="text-gray-400 text-xs">Soybeans</div>
                  <div className="text-green-400 text-2xl font-bold">{selectedStats.soyBushels.toLocaleString()}</div>
                </div>
              </div>

              {/* Breakdowns */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                {/* By Person */}
                <div className="bg-gray-800 rounded-lg p-4">
                  <h3 className="text-white font-semibold mb-3">By Person</h3>
                  {selectedStats.byPerson.length === 0 ? (
                    <div className="text-gray-400 text-sm">No data</div>
                  ) : (
                    <div className="space-y-2">
                      {selectedStats.byPerson.map(([person, stats]) => (
                        <div key={person} className="flex justify-between items-center">
                          <span className="text-white">{person}</span>
                          <span className="text-gray-300 text-sm">
                            {stats.loads} load{stats.loads !== 1 ? 's' : ''} &middot; {stats.bushels.toLocaleString()} bu
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* By Through */}
                <div className="bg-gray-800 rounded-lg p-4">
                  <h3 className="text-white font-semibold mb-3">By Elevator (Through)</h3>
                  {selectedStats.byThrough.length === 0 ? (
                    <div className="text-gray-400 text-sm">No data</div>
                  ) : (
                    <div className="space-y-2">
                      {selectedStats.byThrough.map(([through, stats]) => (
                        <div key={through} className="flex justify-between items-center">
                          <span className="text-white">{through}</span>
                          <span className="text-gray-300 text-sm">
                            {stats.loads} load{stats.loads !== 1 ? 's' : ''} &middot; {stats.bushels.toLocaleString()} bu
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Ticket List */}
              <h3 className="text-lg font-semibold text-white mb-3">
                Tickets from {selectedOrigin} ({originTickets.length})
              </h3>
              {originTickets.length === 0 ? (
                <div className="text-gray-400 text-center py-4">No tickets from this origin</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full bg-gray-800 rounded-lg">
                    <thead className="bg-gray-700">
                      <tr>
                        <th className="px-3 py-2 text-left text-gray-300 text-sm">Date</th>
                        <th className="px-3 py-2 text-left text-gray-300 text-sm">Ticket #</th>
                        <th className="px-3 py-2 text-left text-gray-300 text-sm">Person</th>
                        <th className="px-3 py-2 text-left text-gray-300 text-sm">Crop</th>
                        <th className="px-3 py-2 text-right text-gray-300 text-sm">Bushels</th>
                        <th className="px-3 py-2 text-left text-gray-300 text-sm">Location</th>
                        <th className="px-3 py-2 text-left text-gray-300 text-sm">Through</th>
                        <th className="px-3 py-2 text-left text-gray-300 text-sm">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {originTickets.map((ticket) => {
                        const isCorn = (ticket.crop || '').toLowerCase() === 'corn';
                        return (
                          <tr key={ticket.id} className={`border-t border-gray-700 ${isCorn ? 'bg-yellow-900 bg-opacity-20' : 'bg-green-900 bg-opacity-20'}`}>
                            <td className="px-3 py-2 text-white text-sm">{new Date(ticket.ticket_date).toLocaleDateString()}</td>
                            <td className="px-3 py-2 text-white text-sm">{ticket.ticket_number || '-'}</td>
                            <td className="px-3 py-2 text-white text-sm">{ticket.person}</td>
                            <td className="px-3 py-2 text-white text-sm font-semibold">{ticket.crop}</td>
                            <td className="px-3 py-2 text-right text-white text-sm font-semibold">{ticket.bushels.toLocaleString()}</td>
                            <td className="px-3 py-2 text-white text-sm">{ticket.delivery_location}</td>
                            <td className="px-3 py-2 text-white text-sm">{ticket.through}</td>
                            <td className="px-3 py-2 text-sm">
                              <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                                ticket.status === 'approved' ? 'bg-green-600' :
                                ticket.status === 'rejected' ? 'bg-red-600' :
                                ticket.status === 'hold' ? 'bg-yellow-600' : 'bg-blue-600'
                              } text-white`}>
                                {ticket.status}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
