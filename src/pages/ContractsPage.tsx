import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

interface Contract {
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
  start_date: string | null;
  end_date: string | null;
  priority: number;
  overfill_allowed: boolean;
  is_template: boolean;
  notes: string | null;
  crop_year: string;
}

const EMPTY_FORM = {
  contract_number: '',
  crop: '',
  buyer: '',
  destination: '',
  through: 'Any' as string,
  contracted_bushels: 0,
  start_date: '',
  end_date: '',
  priority: 5,
  overfill_allowed: true,
  is_template: false,
  notes: '',
};

export const ContractsPage: React.FC = () => {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Contract | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadContracts(); }, []);

  const loadContracts = async () => {
    try {
      const { data } = await supabase.from('contracts').select('*').order('priority', { ascending: true });
      setContracts(data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  };

  const openEdit = (c: Contract) => {
    setEditing(c);
    setForm({
      contract_number: c.contract_number,
      crop: c.crop,
      buyer: c.buyer || '',
      destination: c.destination,
      through: c.through || 'Any',
      contracted_bushels: c.contracted_bushels,
      start_date: c.start_date || '',
      end_date: c.end_date || '',
      priority: c.priority,
      overfill_allowed: c.overfill_allowed,
      is_template: c.is_template,
      notes: c.notes || '',
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.contract_number.trim()) return alert('Contract number is required');
    if (!form.crop.trim()) return alert('Crop is required');
    if (!form.destination.trim()) return alert('Destination is required');
    if (form.contracted_bushels <= 0) return alert('Contracted bushels must be > 0');

    setSaving(true);
    try {
      const currentYear = localStorage.getItem('selected_crop_year') || new Date().getFullYear().toString();
      if (editing) {
        const { error } = await supabase.from('contracts').update({
          contract_number: form.contract_number,
          crop: form.crop,
          buyer: form.buyer || null,
          destination: form.destination,
          through: form.through,
          contracted_bushels: form.contracted_bushels,
          start_date: form.start_date || null,
          end_date: form.end_date || null,
          priority: form.priority,
          overfill_allowed: form.overfill_allowed,
          is_template: form.is_template,
          notes: form.notes || null,
          updated_at: new Date().toISOString(),
        }).eq('id', editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('contracts').insert({
          contract_number: form.contract_number,
          crop: form.crop,
          buyer: form.buyer || null,
          destination: form.destination,
          through: form.through,
          contracted_bushels: form.contracted_bushels,
          delivered_bushels: 0,
          start_date: form.start_date || null,
          end_date: form.end_date || null,
          priority: form.priority,
          overfill_allowed: form.overfill_allowed,
          is_template: form.is_template,
          notes: form.notes || null,
          crop_year: currentYear,
        });
        if (error) {
          if (error.message.includes('unique') || error.message.includes('duplicate')) {
            throw new Error(`Contract number "${form.contract_number}" already exists`);
          }
          throw error;
        }
      }
      setModalOpen(false);
      await loadContracts();
    } catch (e: unknown) {
      alert((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (c: Contract) => {
    if (!confirm(`Delete contract ${c.contract_number}? Tickets assigned to it will be unlinked.`)) return;
    try {
      const { error } = await supabase.from('contracts').delete().eq('id', c.id);
      if (error) throw error;
      await loadContracts();
    } catch (e: unknown) {
      alert('Delete failed: ' + (e as Error).message);
    }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><p className="text-gray-400">Loading…</p></div>;

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-5">
        <h1 className="text-2xl font-bold text-white">Contracts</h1>
        <button onClick={openCreate} className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition">
          + New Contract
        </button>
      </div>

      <div className="bg-gray-800 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700">
              {['Contract #', 'Crop', 'Buyer', 'Destination', 'Through', 'Contracted', 'Delivered', 'Remaining', '% Filled', 'Pri'].map((h) => (
                <th key={h} className="text-left px-4 py-3 text-gray-400 font-medium whitespace-nowrap">{h}</th>
              ))}
              <th className="px-4 py-3 text-gray-400 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {contracts.map((c) => (
              <tr key={c.id} className="border-b border-gray-700/50 hover:bg-gray-750">
                <td className="px-4 py-2.5 text-emerald-400 font-medium">{c.contract_number}</td>
                <td className="px-4 py-2.5 text-gray-300">{c.crop}</td>
                <td className="px-4 py-2.5 text-gray-300">{c.buyer || '—'}</td>
                <td className="px-4 py-2.5 text-gray-300">{c.destination}</td>
                <td className="px-4 py-2.5 text-gray-300">{c.through || '—'}</td>
                <td className="px-4 py-2.5 text-gray-300">{c.contracted_bushels.toLocaleString()}</td>
                <td className="px-4 py-2.5 text-gray-300">{c.delivered_bushels.toLocaleString()}</td>
                <td className="px-4 py-2.5 text-gray-300">{c.remaining_bushels.toLocaleString()}</td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <div className="w-16 bg-gray-700 rounded-full h-1.5">
                      <div
                        className={`h-1.5 rounded-full ${(c.percent_filled || 0) >= 100 ? 'bg-emerald-500' : 'bg-blue-500'}`}
                        style={{ width: `${Math.min(100, c.percent_filled || 0)}%` }}
                      />
                    </div>
                    <span className="text-gray-400 text-xs">{(c.percent_filled || 0).toFixed(0)}%</span>
                  </div>
                </td>
                <td className="px-4 py-2.5">
                  <span className={`text-xs font-bold ${c.priority <= 3 ? 'text-red-400' : c.priority <= 6 ? 'text-yellow-400' : 'text-green-400'}`}>
                    {c.priority}
                  </span>
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap">
                  <button onClick={() => openEdit(c)} className="text-emerald-400 hover:text-emerald-300 text-xs mr-3">Edit</button>
                  <button onClick={() => handleDelete(c)} className="text-red-400 hover:text-red-300 text-xs">Del</button>
                </td>
              </tr>
            ))}
            {contracts.length === 0 && (
              <tr><td colSpan={11} className="px-4 py-8 text-center text-gray-500">No contracts yet</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-white">{editing ? 'Edit' : 'New'} Contract</h3>
              <button onClick={() => setModalOpen(false)} className="text-gray-400 hover:text-white text-xl leading-none">×</button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Contract Number *</label>
                <input type="text" value={form.contract_number} onChange={(e) => setForm({ ...form, contract_number: e.target.value })}
                  disabled={!!editing}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm outline-none focus:border-emerald-500 disabled:opacity-50" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Crop *</label>
                <input type="text" value={form.crop} onChange={(e) => setForm({ ...form, crop: e.target.value })}
                  placeholder="Corn, Soybeans…"
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm outline-none focus:border-emerald-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Buyer</label>
                <input type="text" value={form.buyer} onChange={(e) => setForm({ ...form, buyer: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm outline-none focus:border-emerald-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Destination *</label>
                <input type="text" value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm outline-none focus:border-emerald-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Through</label>
                <select value={form.through} onChange={(e) => setForm({ ...form, through: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm outline-none">
                  <option value="Any">Any</option>
                  <option value="Akron">Akron</option>
                  <option value="RVC">RVC</option>
                  <option value="Cargill">Cargill</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Contracted Bushels *</label>
                <input type="number" step="0.01" value={form.contracted_bushels} onChange={(e) => setForm({ ...form, contracted_bushels: parseFloat(e.target.value) || 0 })}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm outline-none focus:border-emerald-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Start Date</label>
                  <input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm outline-none" />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">End Date</label>
                  <input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm outline-none" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Priority (1 = most urgent, 10 = lowest)</label>
                <input type="number" min="1" max="10" value={form.priority} onChange={(e) => setForm({ ...form, priority: Math.min(10, Math.max(1, parseInt(e.target.value) || 5)) })}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm outline-none focus:border-emerald-500" />
              </div>
              <div className="flex gap-6">
                <label className="flex items-center cursor-pointer">
                  <input type="checkbox" checked={form.overfill_allowed} onChange={(e) => setForm({ ...form, overfill_allowed: e.target.checked })}
                    className="mr-2 accent-emerald-500" />
                  <span className="text-gray-300 text-sm">Overfill allowed</span>
                </label>
                <label className="flex items-center cursor-pointer">
                  <input type="checkbox" checked={form.is_template} onChange={(e) => setForm({ ...form, is_template: e.target.checked })}
                    className="mr-2 accent-emerald-500" />
                  <span className="text-gray-300 text-sm">Template</span>
                </label>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Notes</label>
                <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm outline-none focus:border-emerald-500 resize-none" />
              </div>
            </div>

            <div className="flex gap-3 mt-5">
              <button onClick={() => setModalOpen(false)} className="flex-1 bg-gray-700 hover:bg-gray-600 text-white text-sm py-2.5 rounded-lg transition">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-600 text-white text-sm font-medium py-2.5 rounded-lg transition">
                {saving ? 'Saving…' : editing ? 'Save' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
