import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

interface HaulContract {
  id: string;
  contract_number: string;
  crop: string;
  buyer: string | null;
  destination: string;
  through: string | null;
  contracted_bushels: number;
  delivered_bushels: number;
  remaining_bushels: number;
  percent_filled: number | null;
  priority: number;
  overfill_allowed: boolean;
  end_date: string | null;
}

const priorityColor = (p: number) => {
  if (p <= 3) return { bg: 'bg-red-900/40', border: 'border-red-700', text: 'text-red-300', badge: 'bg-red-600' };
  if (p <= 6) return { bg: 'bg-yellow-900/30', border: 'border-yellow-700', text: 'text-yellow-300', badge: 'bg-yellow-600' };
  return { bg: 'bg-green-900/30', border: 'border-green-700', text: 'text-green-300', badge: 'bg-green-600' };
};

export const HaulBoardPage: React.FC = () => {
  const [contracts, setContracts] = useState<HaulContract[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);

  const load = async () => {
    try {
      const { data } = await supabase
        .from('contracts')
        .select('id,contract_number,crop,buyer,destination,through,contracted_bushels,delivered_bushels,remaining_bushels,percent_filled,priority,overfill_allowed,end_date')
        .gt('remaining_bushels', 0)
        .order('priority', { ascending: true });
      setContracts(data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><p className="text-gray-400">Loading…</p></div>;

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex justify-between items-center mb-5">
        <h1 className="text-2xl font-bold text-white">Haul Board</h1>
        <span className="text-gray-500 text-sm">{contracts.length} contract{contracts.length !== 1 ? 's' : ''} with remaining bushels</span>
      </div>

      {contracts.length === 0 && (
        <div className="bg-gray-800 rounded-xl p-12 text-center">
          <p className="text-gray-400 text-lg">All contracts are filled</p>
          <p className="text-gray-600 text-sm mt-1">Nothing left to haul</p>
        </div>
      )}

      <div className="space-y-4">
        {contracts.map((c) => {
          const colors = priorityColor(c.priority);
          const pct = Math.min(100, c.percent_filled || 0);

          return (
            <div key={c.id} className={`rounded-xl border ${colors.border} ${colors.bg} p-5`}>
              <div className="flex justify-between items-start mb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className={`font-bold text-lg ${colors.text}`}>{c.contract_number}</h3>
                    <span className={`text-xs font-bold text-white px-2 py-0.5 rounded-full ${colors.badge}`}>
                      Priority {c.priority}
                    </span>
                    {c.overfill_allowed && (
                      <span className="text-xs text-gray-500 bg-gray-700 px-2 py-0.5 rounded-full">Overfill OK</span>
                    )}
                  </div>
                  <p className="text-gray-300 text-sm mt-0.5">
                    {c.crop} → {c.destination} {c.through && c.through !== 'Any' ? `via ${c.through}` : ''}
                    {c.buyer ? ` · ${c.buyer}` : ''}
                  </p>
                </div>
                {c.end_date && (
                  <span className="text-xs text-gray-500">Due: {c.end_date}</span>
                )}
              </div>

              {/* Progress bar */}
              <div className="mb-3">
                <div className="w-full bg-gray-700 rounded-full h-3">
                  <div
                    className={`h-3 rounded-full transition-all ${pct >= 100 ? 'bg-emerald-500' : 'bg-blue-500'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-xs text-gray-500">{pct.toFixed(1)}% filled</span>
                  <span className="text-xs text-gray-500">
                    {c.delivered_bushels.toLocaleString()} / {c.contracted_bushels.toLocaleString()} bu
                  </span>
                </div>
              </div>

              {/* Stats row */}
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-gray-800/60 rounded-lg p-3 text-center">
                  <p className="text-xs text-gray-500 mb-0.5">Contracted</p>
                  <p className="text-white font-semibold">{c.contracted_bushels.toLocaleString()}</p>
                </div>
                <div className="bg-gray-800/60 rounded-lg p-3 text-center">
                  <p className="text-xs text-gray-500 mb-0.5">Delivered</p>
                  <p className="text-emerald-400 font-semibold">{c.delivered_bushels.toLocaleString()}</p>
                </div>
                <div className="bg-gray-800/60 rounded-lg p-3 text-center">
                  <p className="text-xs text-gray-500 mb-0.5">Remaining</p>
                  <p className={`font-semibold ${colors.text}`}>{c.remaining_bushels.toLocaleString()}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
