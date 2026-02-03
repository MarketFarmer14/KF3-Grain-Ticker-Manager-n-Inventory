import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { exportTicketsToExcel } from '../lib/export';
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
  crop_year: string;
  created_at: string;
  contracts: { contract_number: string } | null;
}

interface ContractOption {
  id: string;
  contract_number: string;
  crop: string;
}

const STATUS_COLORS: Record<string, string> = {
  approved: 'bg-emerald-900/50 text-emerald-300',
  needs_review: 'bg-yellow-900/50 text-yellow-300',
  rejected: 'bg-red-900/50 text-red-300',
  hold: 'bg-blue-900/50 text-blue-300',
};

export const TicketsPage: React.FC = () => {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [contractOptions, setContractOptions] = useState<ContractOption[]>([]);
  const [loading, setLoading] = useState(true);

  const [fStatus, setFStatus] = useState('all');
  const [fCrop, setFCrop] = useState('all');
  const [fThrough, setFThrough] = useState('all');
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [sortCol, setSortCol] = useState('ticket_date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const [editing, setEditing] = useState<Ticket | null>(null);
  const [editForm, setEditForm] = useState({
    ticket_date: '', ticket_number: '', person: '', crop: '',
    bushels: 0, delivery_location: '', through: 'Akron',
    elevator: '', origin: '', moisture_percent: null as number | null,
    contract_id: '', status: 'needs_review', notes: '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    try {
      const [tRes, cRes] = await Promise.all([
        supabase.from('tickets').select('*, contracts(contract_number)').order('created_at', { ascending: false }),
        supabase.from('contracts').select('id, contract_number, crop').order('contract_number'),
      ]);
      setTickets((tRes.data || []) as Ticket[]);
      setContractOptions(cRes.data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const crops = useMemo(() => [...new Set(tickets.map((t) => t.crop).filter(Boolean))].sort(), [tickets]);

  const filtered = useMemo(() => {
    let list = [...tickets];
    if (fStatus !== 'all') list = list.filter((t) => t.status === fStatus);
    if (fCrop !== 'all') list = list.filter((t) => t.crop.toLowerCase() === fCrop.toLowerCase());
    if (fThrough !== 'all') list = list.filter((t) => t.through === fThrough);
    if (search) {
      const s = search.toLowerCase();
      list = list.filter((t) =>
        (t.ticket_number?.toLowerCase().includes(s)) ||
        (t.person?.toLowerCase().includes(s))
      );
    }
    if (dateFrom) list = list.filter((t) => t.ticket_date >= dateFrom);
    if (dateTo) list = list.filter((t) => t.ticket_date <= dateTo);

    list.sort((a, b) => {
      let aVal: string | number = (a as Record<string, unknown>)[sortCol] as string | number ?? '';
      let bVal: string | number = (b as Record<string, unknown>)[sortCol] as string | number ?? '';
      if (sortCol === 'bushels') { aVal = Number(aVal); bVal = Number(bVal); }
      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return list;
  }, [tickets, fStatus, fCrop, fThrough, search, dateFrom, dateTo, sortCol, sortDir]);

  const toggleSort = (col: string) => {
    if (sortCol === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortCol(col); setSortDir('asc'); }
  };

  const sortIcon = (col: string) => sortCol === col ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';

  const openEdit = (t: Ticket) => {
    setEditing(t);
    setEditForm({
      ticket_date: t.ticket_date || '',
      ticket_number: t.ticket_number || '',
      person: t.person || '',
      crop: t.crop || '',
      bushels: t.bushels || 0,
      delivery_location: t.delivery_location || '',
      through: t.through || 'Akron',
      elevator: t.elevator || '',
      origin: t.origin || '',
      moisture_percent: t.moisture_percent,
      contract_id: t.contract_id || '',
      status: t.status || 'needs_review',
      notes: t.notes || '',
    });
  };

  const saveEdit = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('tickets').update({
        ticket_date: editForm.ticket_date,
        ticket_number: editForm.ticket_number || null,
        person: editForm.person,
        crop: editForm.crop,
        bushels: editForm.bushels,
        delivery_location: editForm.delivery_location,
        through: editForm.through,
        elevator: editForm.elevator || null,
        origin: editForm.origin,
        moisture_percent: editForm.moisture_percent,
        contract_id: editForm.contract_id || null,
        status: editForm.status as 'needs_review' | 'approved' | 'rejected' | 'hold',
        notes: editForm.notes || null,
        updated_at: new Date().toISOString(),
      }).eq('id', editing.id);
      if (error) throw error;
      setEditing(null);
      await loadAll();
    } catch (e: unknown) {
      alert('Save failed: ' + (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const deleteTicket = async (t: Ticket) => {
    if (!confirm(`Delete ticket ${t.ticket_number || t.id.slice(0, 8)}? Cannot undo.`)) return;
    try {
      const { error } = await supabase.from('tickets').delete().eq('id', t.id);
      if (error) throw error;
      await loadAll();
    } catch (e: unknown) {
      alert('Delete failed: ' + (e as Error).message);
    }
  };

  const handleExport = () => {
    exportTicketsToExcel(filtered.map((t) => ({
      ticket_date: t.ticket_date,
      person: t.person,
      delivery_location: t.delivery_location,
      ticket_number: t.ticket_number,
      bushels: t.bushels,
      crop: t.crop,
      contract_number: t.contracts?.contract_number || null,
    })));
  };

  if (loading) return <div className="flex items-center justify-center h-64"><p className="text-gray-400">Loading…</p></div>;

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-5">
        <h1 className="text-2xl font-bold text-white">Tickets</h1>
        <button onClick={handleExport} className="bg-gray-700 hover:bg-gray-600 text-white text-sm px-4 py-2 rounded-lg transition">
          📥 Export Excel
        </button>
      </div>

      {/* Filters */}
      <div className="bg-gray-800 rounded-xl p-4 mb-5 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Search</label>
          <input type="text" placeholder="Ticket # or Person" value={search} onChange={(e) => setSearch(e.target.value)}
            className="px-3 py-1.5 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm outline-none focus:border-emerald-500 w-44" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Status</label>
          <select value={fStatus} onChange={(e) => setFStatus(e.target.value)}
            className="px-3 py-1.5 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm outline-none">
            <option value="all">All</option>
            <option value="needs_review">Needs Review</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="hold">Hold</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Crop</label>
          <select value={fCrop} onChange={(e) => setFCrop(e.target.value)}
            className="px-3 py-1.5 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm outline-none">
            <option value="all">All Crops</option>
            {crops.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Through</label>
          <select value={fThrough} onChange={(e) => setFThrough(e.target.value)}
            className="px-3 py-1.5 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm outline-none">
            <option value="all">All</option>
            <option value="Akron">Akron</option>
            <option value="RVC">RVC</option>
            <option value="Cargill">Cargill</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Date From</label>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
            className="px-3 py-1.5 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm outline-none" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Date To</label>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
            className="px-3 py-1.5 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm outline-none" />
        </div>
        <button onClick={() => { setSearch(''); setFStatus('all'); setFCrop('all'); setFThrough('all'); setDateFrom(''); setDateTo(''); }}
          className="text-xs text-gray-500 hover:text-white px-2 py-1.5 rounded-lg hover:bg-gray-700 transition">
          Clear
        </button>
      </div>

      <p className="text-xs text-gray-500 mb-2">{filtered.length} ticket{filtered.length !== 1 ? 's' : ''}</p>

      {/* Table */}
      <div className="bg-gray-800 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700">
              {[
                { key: 'ticket_date', label: 'Date' },
                { key: 'ticket_number', label: '#' },
                { key: 'person', label: 'Person' },
                { key: 'crop', label: 'Crop' },
                { key: 'bushels', label: 'Bushels' },
                { key: 'delivery_location', label: 'Location' },
                { key: 'through', label: 'Through' },
              ].map((col) => (
                <th key={col.key} onClick={() => toggleSort(col.key)}
                  className="text-left px-4 py-3 text-gray-400 font-medium cursor-pointer hover:text-white whitespace-nowrap">
                  {col.label}{sortIcon(col.key)}
                </th>
              ))}
              <th className="text-left px-4 py-3 text-gray-400 font-medium whitespace-nowrap">Contract</th>
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Status</th>
              <th className="px-4 py-3 text-gray-400 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((t) => (
              <tr key={t.id} className="border-b border-gray-700/50 hover:bg-gray-750">
                <td className="px-4 py-2.5 text-gray-300 whitespace-nowrap">{t.ticket_date}</td>
                <td className="px-4 py-2.5 text-gray-300">{t.ticket_number || '—'}</td>
                <td className="px-4 py-2.5 text-gray-300">{t.person || '—'}</td>
                <td className="px-4 py-2.5 text-gray-300">{t.crop || '—'}</td>
                <td className="px-4 py-2.5 text-gray-300">{t.bushels > 0 ? t.bushels.toLocaleString() : '—'}</td>
                <td className="px-4 py-2.5 text-gray-300">{t.delivery_location || '—'}</td>
                <td className="px-4 py-2.5 text-gray-300">{t.through}</td>
                <td className="px-4 py-2.5 text-gray-300 text-xs">{t.contracts?.contract_number || '—'}</td>
                <td className="px-4 py-2.5">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[t.status] || 'bg-gray-700 text-gray-300'}`}>
                    {t.status.replace('_', ' ')}
                  </span>
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap">
                  <button onClick={() => openEdit(t)} className="text-emerald-400 hover:text-emerald-300 text-xs mr-3">Edit</button>
                  <button onClick={() => deleteTicket(t)} className="text-red-400 hover:text-red-300 text-xs">Del</button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-500">No tickets match your filters</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Edit Modal */}
      {editing && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-white">Edit Ticket</h3>
              <button onClick={() => setEditing(null)} className="text-gray-400 hover:text-white text-xl leading-none">×</button>
            </div>

            {editing.image_url && (
              <div className="mb-4 rounded-lg overflow-hidden max-h-36">
                <img src={editing.image_url} alt="Ticket" className="w-full object-contain bg-gray-900" />
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Date</label>
                <input type="date" value={editForm.ticket_date} onChange={(e) => setEditForm({ ...editForm, ticket_date: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm outline-none focus:border-emerald-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Ticket #</label>
                <input type="text" value={editForm.ticket_number} onChange={(e) => setEditForm({ ...editForm, ticket_number: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm outline-none focus:border-emerald-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Person</label>
                <select value={editForm.person} onChange={(e) => setEditForm({ ...editForm, person: e.target.value })}
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
                <label className="block text-xs text-gray-400 mb-1">Crop</label>
                <input type="text" value={editForm.crop} onChange={(e) => setEditForm({ ...editForm, crop: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm outline-none focus:border-emerald-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Bushels</label>
                <input type="number" step="0.01" value={editForm.bushels} onChange={(e) => setEditForm({ ...editForm, bushels: parseFloat(e.target.value) || 0 })}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm outline-none focus:border-emerald-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Delivery Location</label>
                <input type="text" value={editForm.delivery_location} onChange={(e) => setEditForm({ ...editForm, delivery_location: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm outline-none focus:border-emerald-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Through</label>
                <select value={editForm.through} onChange={(e) => setEditForm({ ...editForm, through: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm outline-none">
                  <option value="Akron">Akron</option>
                  <option value="RVC">RVC</option>
                  <option value="Cargill">Cargill</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Elevator</label>
                <input type="text" value={editForm.elevator} onChange={(e) => setEditForm({ ...editForm, elevator: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm outline-none focus:border-emerald-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Origin</label>
                <select value={editForm.origin} onChange={(e) => setEditForm({ ...editForm, origin: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm outline-none focus:border-emerald-500">
                  <option value="">Select origin...</option>
                  {ORIGIN_LOCATIONS.map((loc) => (
                    <option key={loc} value={loc}>{loc}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Moisture %</label>
                <input type="number" step="0.01" value={editForm.moisture_percent || ''} onChange={(e) => setEditForm({ ...editForm, moisture_percent: e.target.value ? parseFloat(e.target.value) : null })}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm outline-none focus:border-emerald-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Contract</label>
                <select value={editForm.contract_id} onChange={(e) => setEditForm({ ...editForm, contract_id: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm outline-none">
                  <option value="">— None —</option>
                  {contractOptions.map((c) => (
                    <option key={c.id} value={c.id}>{c.contract_number} ({c.crop})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Status</label>
                <select value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm outline-none">
                  <option value="needs_review">Needs Review</option>
                  <option value="approved">Approved</option>
                  <option value="rejected">Rejected</option>
                  <option value="hold">Hold</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Notes</label>
                <textarea value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} rows={2}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm outline-none focus:border-emerald-500 resize-none" />
              </div>
            </div>

            <div className="flex gap-3 mt-5">
              <button onClick={() => setEditing(null)} className="flex-1 bg-gray-700 hover:bg-gray-600 text-white text-sm py-2.5 rounded-lg transition">
                Cancel
              </button>
              <button onClick={saveEdit} disabled={saving} className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-600 text-white text-sm font-medium py-2.5 rounded-lg transition">
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
