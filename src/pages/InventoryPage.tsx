import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';

interface Contract {
  id: string;
  contract_number: string;
  crop: string;
  through: string | null;
  contracted_bushels: number;
  delivered_bushels: number;
  remaining_bushels: number;
  percent_filled: number | null;
  priority: number;
  is_template: boolean;
}

interface RecentTicket {
  id: string;
  ticket_date: string;
  ticket_number: string | null;
  person: string;
  crop: string;
  bushels: number;
  through: string;
  contracts: { contract_number: string } | null;
  updated_at: string;
}

export const InventoryPage: React.FC = () => {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [recentTickets, setRecentTickets] = useState<RecentTicket[]>([]);
  const [ticketCounts, setTicketCounts] = useState({ needs_review: 0, approved: 0, rejected: 0, hold: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);

  const load = async () => {
    try {
      const [cRes, rtRes, tcRes] = await Promise.all([
        supabase.from('contracts').select('*').eq('is_template', false).order('priority', { ascending: true }),
        supabase.from('tickets').select('id,ticket_date,ticket_number,person,crop,bushels,through,contracts(contract_number),updated_at')
          .eq('status', 'approved').order('updated_at', { ascending: false }).limit(15),
        supabase.from('tickets').select('status'),
      ]);
      setContracts(cRes.data || []);
      setRecentTickets((rtRes.data || []) as RecentTicket[]);

      const counts = { needs_review: 0, approved: 0, rejected: 0, hold: 0 };
      (tcRes.data || []).forEach((t: { status: string }) => {
        if (t.status in counts) counts[t.status as keyof typeof counts]++;
      });
      setTicketCounts(counts);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const cropBreakdown = useMemo(() => {
    const map = new Map<string, { contracted: number; delivered: number; remaining: number }>();
    contracts.forEach((c) => {
      const key = c.crop;
      const existing = map.get(key) || { contracted: 0, delivered: 0, remaining: 0 };
      existing.contracted += c.contracted_bushels;
      existing.delivered += c.delivered_bushels;
      existing.remaining += c.remaining_bushels;
      map.set(key, existing);
    });
    return Array.from(map.entries())
      .map(([crop, data]) => ({ crop, ...data }))
      .sort((a, b) => b.contracted - a.contracted);
  }, [contracts]);

  const throughBreakdown = useMemo(() => {
    const map = new Map<string, { contracted: number; delivered: number; remaining: number }>();
    contracts.forEach((c) => {
      const key = c.through || 'Any';
      const existing = map.get(key) || { contracted: 0, delivered: 0, remaining: 0 };
      existing.contracted += c.contracted_bushels;
      existing.delivered += c.delivered_bushels;
      existing.remaining += c.remaining_bushels;
      map.set(key, existing);
    });
    return Array.from(map.entries())
      .map(([through, data]) => ({ through, ...data }))
      .sort((a, b) => b.contracted - a.contracted);
  }, [contracts]);

  const totals = useMemo(() => ({
    contracted: contracts.reduce((s, c) => s + c.contracted_bushels, 0),
    delivered: contracts.reduce((s, c) => s + c.delivered_bushels, 0),
    remaining: contracts.reduce((s, c) => s + c.remaining_bushels, 0),
    activeContracts: contracts.filter((c) => c.remaining_bushels > 0).length,
    totalContracts: contracts.length,
  }), [contracts]);

  if (loading) return <div className="flex items-center justify-center h-64"><p className="text-gray-400">Loading…</p></div>;

  return (
    <div className="max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-6">Inventory</h1>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Total Contracted</p>
          <p className="text-2xl font-bold text-white">{totals.contracted.toLocaleString()}</p>
          <p className="text-xs text-gray-600">bushels</p>
        </div>
        <div className="bg-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Delivered</p>
          <p className="text-2xl font-bold text-emerald-400">{totals.delivered.toLocaleString()}</p>
          <p className="text-xs text-gray-600">
            {totals.contracted > 0 ? ((totals.delivered / totals.contracted) * 100).toFixed(1) : 0}% of total
          </p>
        </div>
        <div className="bg-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Remaining</p>
          <p className="text-2xl font-bold text-yellow-400">{totals.remaining.toLocaleString()}</p>
          <p className="text-xs text-gray-600">{totals.activeContracts} active contracts</p>
        </div>
        <div className="bg-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Ticket Status</p>
          <div className="flex gap-2 mt-1 flex-wrap">
            <span className="text-xs bg-yellow-900/50 text-yellow-300 px-2 py-0.5 rounded-full">{ticketCounts.needs_review} review</span>
            <span className="text-xs bg-emerald-900/50 text-emerald-300 px-2 py-0.5 rounded-full">{ticketCounts.approved} done</span>
            <span className="text-xs bg-blue-900/50 text-blue-300 px-2 py-0.5 rounded-full">{ticketCounts.hold} hold</span>
            <span className="text-xs bg-red-900/50 text-red-300 px-2 py-0.5 rounded-full">{ticketCounts.rejected} rejected</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Crop breakdown */}
        <div className="bg-gray-800 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-4">By Crop</h3>
          {cropBreakdown.length === 0 ? (
            <p className="text-gray-600 text-sm">No contract data</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="text-left py-2 text-gray-500 font-medium">Crop</th>
                  <th className="text-right py-2 text-gray-500 font-medium">Contracted</th>
                  <th className="text-right py-2 text-gray-500 font-medium">Delivered</th>
                  <th className="text-right py-2 text-gray-500 font-medium">Remaining</th>
                  <th className="text-right py-2 text-gray-500 font-medium">%</th>
                </tr>
              </thead>
              <tbody>
                {cropBreakdown.map((row) => {
                  const pct = row.contracted > 0 ? (row.delivered / row.contracted) * 100 : 0;
                  return (
                    <tr key={row.crop} className="border-b border-gray-700/40">
                      <td className="py-2 text-white font-medium">{row.crop}</td>
                      <td className="py-2 text-gray-300 text-right">{row.contracted.toLocaleString()}</td>
                      <td className="py-2 text-emerald-400 text-right">{row.delivered.toLocaleString()}</td>
                      <td className="py-2 text-yellow-400 text-right">{row.remaining.toLocaleString()}</td>
                      <td className="py-2 text-gray-400 text-right">{pct.toFixed(0)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Through breakdown */}
        <div className="bg-gray-800 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-4">By Elevator (Through)</h3>
          {throughBreakdown.length === 0 ? (
            <p className="text-gray-600 text-sm">No contract data</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="text-left py-2 text-gray-500 font-medium">Through</th>
                  <th className="text-right py-2 text-gray-500 font-medium">Contracted</th>
                  <th className="text-right py-2 text-gray-500 font-medium">Delivered</th>
                  <th className="text-right py-2 text-gray-500 font-medium">Remaining</th>
                </tr>
              </thead>
              <tbody>
                {throughBreakdown.map((row) => (
                  <tr key={row.through} className="border-b border-gray-700/40">
                    <td className="py-2 text-white font-medium">{row.through}</td>
                    <td className="py-2 text-gray-300 text-right">{row.contracted.toLocaleString()}</td>
                    <td className="py-2 text-emerald-400 text-right">{row.delivered.toLocaleString()}</td>
                    <td className="py-2 text-yellow-400 text-right">{row.remaining.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Recent approved tickets */}
      <div className="bg-gray-800 rounded-xl p-5 mt-6">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-4">Recent Deliveries</h3>
        {recentTickets.length === 0 ? (
          <p className="text-gray-600 text-sm">No approved tickets yet</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="text-left py-2 text-gray-500 font-medium">Date</th>
                <th className="text-left py-2 text-gray-500 font-medium">Ticket #</th>
                <th className="text-left py-2 text-gray-500 font-medium">Person</th>
                <th className="text-left py-2 text-gray-500 font-medium">Crop</th>
                <th className="text-right py-2 text-gray-500 font-medium">Bushels</th>
                <th className="text-left py-2 text-gray-500 font-medium">Through</th>
                <th className="text-left py-2 text-gray-500 font-medium">Contract</th>
              </tr>
            </thead>
            <tbody>
              {recentTickets.map((t) => (
                <tr key={t.id} className="border-b border-gray-700/40">
                  <td className="py-2 text-gray-300">{t.ticket_date}</td>
                  <td className="py-2 text-gray-300">{t.ticket_number || '—'}</td>
                  <td className="py-2 text-gray-300">{t.person}</td>
                  <td className="py-2 text-gray-300">{t.crop}</td>
                  <td className="py-2 text-gray-300 text-right">{t.bushels.toLocaleString()}</td>
                  <td className="py-2 text-gray-300">{t.through}</td>
                  <td className="py-2 text-emerald-400 text-sm">{t.contracts?.contract_number || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
