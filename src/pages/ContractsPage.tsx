
import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import type { Database } from '../lib/database.types';
import * as XLSX from 'xlsx';

type Contract = Database['public']['Tables']['contracts']['Row'];
type ContractInsert = Database['public']['Tables']['contracts']['Insert'];

type SortField = 'priority' | 'contract_number' | 'crop' | 'owner' | 'through' | 'destination' | 'contracted_bushels' | 'delivered_bushels' | 'remaining_bushels' | 'percent_filled';
type SortDirection = 'asc' | 'desc';

export function ContractsPage() {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showBulkEditModal, setShowBulkEditModal] = useState(false);
  const [editingContract, setEditingContract] = useState<Contract | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<any[]>([]);
  const [importing, setImporting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sortField, setSortField] = useState<SortField>('priority');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  const [formData, setFormData] = useState<Partial<ContractInsert>>({
    contract_number: '',
    crop: '',
    owner: '',
    through: '',
    destination: '',
    contracted_bushels: 0,
    start_date: '',
    end_date: '',
    priority: 5,
    overfill_allowed: true,
    notes: '',
    crop_year: '',
  });

  const [bulkEditData, setBulkEditData] = useState({
    priority: '',
    crop_year: '',
    owner: '',
    through: '',
    destination: '',
    start_date: '',
    end_date: '',
  });

  const currentYear = localStorage.getItem('grain_ticket_year') || new Date().getFullYear().toString();

  useEffect(() => {
    fetchContracts();
  }, [currentYear, sortField, sortDirection]);

  const fetchContracts = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('contracts')
      .select('*')
      .eq('crop_year', currentYear)
      .order(sortField, { ascending: sortDirection === 'asc' });

    if (error) {
      console.error('Error fetching contracts:', error);
    } else {
      setContracts(data || []);
    }
    setLoading(false);
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === contracts.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(contracts.map(c => c.id)));
    }
  };

  const toggleSelect = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const handleBulkEdit = async () => {
    if (selectedIds.size === 0) return;

    const updates: any = {};
    if (bulkEditData.priority) updates.priority = parseInt(bulkEditData.priority);
    if (bulkEditData.crop_year) updates.crop_year = bulkEditData.crop_year;
    if (bulkEditData.owner) updates.owner = bulkEditData.owner;
    if (bulkEditData.through) updates.through = bulkEditData.through;
    if (bulkEditData.destination) updates.destination = bulkEditData.destination;
    if (bulkEditData.start_date) updates.start_date = bulkEditData.start_date;
    if (bulkEditData.end_date) updates.end_date = bulkEditData.end_date;

    if (Object.keys(updates).length === 0) {
      alert('Please select at least one field to update');
      return;
    }

    try {
      const { error } = await supabase
        .from('contracts')
        .update(updates)
        .in('id', Array.from(selectedIds));

      if (error) throw error;

      alert(`Updated ${selectedIds.size} contracts`);
      setShowBulkEditModal(false);
      setSelectedIds(new Set());
      setBulkEditData({ priority: '', crop_year: '', owner: '', through: '', destination: '', start_date: '', end_date: '' });
      fetchContracts();
    } catch (error: any) {
      alert('Bulk edit failed: ' + error.message);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} contracts? This cannot be undone.`)) return;

    try {
      const { error } = await supabase
        .from('contracts')
        .delete()
        .in('id', Array.from(selectedIds));

      if (error) throw error;

      alert(`Deleted ${selectedIds.size} contracts`);
      setSelectedIds(new Set());
      fetchContracts();
    } catch (error: any) {
      alert('Bulk delete failed: ' + error.message);
    }
  };

  const convertExcelDate = (excelDate: any): string | null => {
    if (!excelDate) return null;
    if (typeof excelDate === 'string') {
      const parsed = new Date(excelDate);
      if (!isNaN(parsed.getTime())) {
        return parsed.toISOString().split('T')[0];
      }
      return null;
    }
    if (typeof excelDate === 'number') {
      const excelEpoch = new Date(1899, 11, 30);
      const jsDate = new Date(excelEpoch.getTime() + excelDate * 86400000);
      return jsDate.toISOString().split('T')[0];
    }
    return null;
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportFile(file);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = new Uint8Array(event.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(firstSheet);

        const mapped = jsonData.map((row: any) => {
          return {
            contract_number: (row['Contract#'] || '').toString(),
            crop: row['Crop'] || '',
            owner: row['Owner'] || '',
            through: row['Through'] || '',
            destination: row['Location'] || '',
            contracted_bushels: parseFloat(row['Bushels'] || '0'),
            start_date: convertExcelDate(row['Window Start']),
            end_date: convertExcelDate(row['Window End']),
            priority: 5,
            crop_year: row['Year'] || currentYear,
            notes: '',
          };
        });

        setImportPreview(mapped);
      } catch (error) {
        alert('Error reading Excel file. Check format and column headers match exactly.');
        console.error(error);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleImport = async () => {
    if (importPreview.length === 0) return;
    setImporting(true);

    try {
      const { error } = await supabase.from('contracts').insert(importPreview);
      if (error) throw error;

      alert(`Successfully imported ${importPreview.length} contracts!`);
      setShowImportModal(false);
      setImportFile(null);
      setImportPreview([]);
      fetchContracts();
    } catch (error: any) {
      if (error.code === '23505') {
        alert('Error: Some contract numbers already exist.');
      } else {
        alert('Import failed: ' + error.message);
      }
    } finally {
      setImporting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const dataToSave: ContractInsert = {
      ...formData,
      crop_year: formData.crop_year || currentYear,
      contract_number: formData.contract_number!,
      crop: formData.crop!,
      destination: formData.destination!,
      contracted_bushels: formData.contracted_bushels!,
    };

    if (editingContract) {
      const { error } = await supabase
        .from('contracts')
        .update(dataToSave)
        .eq('id', editingContract.id);

      if (error) {
        alert('Error updating: ' + error.message);
      } else {
        setShowModal(false);
        setEditingContract(null);
        resetForm();
        fetchContracts();
      }
    } else {
      const { error } = await supabase.from('contracts').insert([dataToSave]);
      if (error) {
        alert('Error creating: ' + error.message);
      } else {
        setShowModal(false);
        resetForm();
        fetchContracts();
      }
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this contract?')) return;
    const { error } = await supabase.from('contracts').delete().eq('id', id);
    if (error) {
      alert('Error deleting: ' + error.message);
    } else {
      fetchContracts();
    }
  };

  const resetForm = () => {
    setFormData({
      contract_number: '',
      crop: '',
      owner: '',
      through: '',
      destination: '',
      contracted_bushels: 0,
      start_date: '',
      end_date: '',
      priority: 5,
      overfill_allowed: true,
      notes: '',
      crop_year: currentYear,
    });
  };

  const openEditModal = (contract: Contract) => {
    setEditingContract(contract);
    setFormData({
      contract_number: contract.contract_number,
      crop: contract.crop,
      owner: contract.owner || '',
      through: contract.through || '',
      destination: contract.destination,
      contracted_bushels: contract.contracted_bushels,
      start_date: contract.start_date || '',
      end_date: contract.end_date || '',
      priority: contract.priority,
      overfill_allowed: contract.overfill_allowed,
      notes: contract.notes || '',
      crop_year: contract.crop_year,
    });
    setShowModal(true);
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <span className="text-gray-500 ml-1">↕</span>;
    return sortDirection === 'asc' ? <span className="ml-1">↑</span> : <span className="ml-1">↓</span>;
  };

  if (loading) {
    return <div className="p-8 text-center text-white">Loading contracts...</div>;
  }

  return (
    <div className="p-4 md:p-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-white">Contracts ({currentYear})</h1>
        <div className="flex gap-2">
          {selectedIds.size > 0 && (
            <>
              <button
                onClick={() => setShowBulkEditModal(true)}
                className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg"
              >
                Edit {selectedIds.size} Selected
              </button>
              <button
                onClick={handleBulkDelete}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg"
              >
                Delete {selectedIds.size} Selected
              </button>
            </>
          )}
          <button
            onClick={() => {
              setEditingContract(null);
              resetForm();
              setShowModal(true);
            }}
            className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg"
          >
            + New Contract
          </button>
          <button
            onClick={() => setShowImportModal(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
          >
            📊 Import
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full bg-gray-800 rounded-lg">
          <thead className="bg-gray-700">
            <tr>
              <th className="px-4 py-3 text-white">
                <input
                  type="checkbox"
                  checked={selectedIds.size === contracts.length && contracts.length > 0}
                  onChange={toggleSelectAll}
                  className="w-4 h-4"
                />
              </th>
              <th
                className="px-4 py-3 text-left text-white cursor-pointer hover:bg-gray-600"
                onClick={() => handleSort('priority')}
              >
                Priority <SortIcon field="priority" />
              </th>
              <th
                className="px-4 py-3 text-left text-white cursor-pointer hover:bg-gray-600"
                onClick={() => handleSort('owner')}
              >
                Owner <SortIcon field="owner" />
              </th>
              <th
                className="px-4 py-3 text-left text-white cursor-pointer hover:bg-gray-600"
                onClick={() => handleSort('contract_number')}
              >
                Contract # <SortIcon field="contract_number" />
              </th>
              <th
                className="px-4 py-3 text-left text-white cursor-pointer hover:bg-gray-600"
                onClick={() => handleSort('crop')}
              >
                Crop <SortIcon field="crop" />
              </th>
              <th
                className="px-4 py-3 text-left text-white cursor-pointer hover:bg-gray-600"
                onClick={() => handleSort('through')}
              >
                Through <SortIcon field="through" />
              </th>
              <th
                className="px-4 py-3 text-left text-white cursor-pointer hover:bg-gray-600"
                onClick={() => handleSort('destination')}
              >
                Location <SortIcon field="destination" />
              </th>
              <th
                className="px-4 py-3 text-right text-white cursor-pointer hover:bg-gray-600"
                onClick={() => handleSort('contracted_bushels')}
              >
                Contracted <SortIcon field="contracted_bushels" />
              </th>
              <th
                className="px-4 py-3 text-right text-white cursor-pointer hover:bg-gray-600"
                onClick={() => handleSort('delivered_bushels')}
              >
                Delivered <SortIcon field="delivered_bushels" />
              </th>
              <th
                className="px-4 py-3 text-right text-white cursor-pointer hover:bg-gray-600"
                onClick={() => handleSort('remaining_bushels')}
              >
                Remaining <SortIcon field="remaining_bushels" />
              </th>
              <th
                className="px-4 py-3 text-right text-white cursor-pointer hover:bg-gray-600"
                onClick={() => handleSort('percent_filled')}
              >
                % Filled <SortIcon field="percent_filled" />
              </th>
              <th className="px-4 py-3 text-center text-white">Actions</th>
            </tr>
          </thead>
          <tbody>
            {contracts.map((contract) => {
              const isCorn = contract.crop === 'Corn';
              const rowBgClass = isCorn ? 'bg-yellow-900 bg-opacity-20' : 'bg-green-900 bg-opacity-20';
              const hoverClass = isCorn ? 'hover:bg-yellow-900 hover:bg-opacity-30' : 'hover:bg-green-900 hover:bg-opacity-30';
              
              return (
                <tr key={contract.id} className={`border-t border-gray-700 ${rowBgClass} ${hoverClass}`}>
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(contract.id)}
                      onChange={() => toggleSelect(contract.id)}
                      className="w-4 h-4"
                    />
                  </td>
                  <td className="px-4 py-3 text-white">{contract.priority}</td>
                  <td className="px-4 py-3 text-white">{contract.owner || '-'}</td>
                  <td className="px-4 py-3 font-semibold text-white">{contract.contract_number}</td>
                  <td className="px-4 py-3 text-white font-semibold">{contract.crop}</td>
                  <td className="px-4 py-3 text-white">{contract.through || '-'}</td>
                  <td className="px-4 py-3 text-white">{contract.destination}</td>
                  <td className="px-4 py-3 text-right text-white">{contract.contracted_bushels.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right text-white">{contract.delivered_bushels.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right text-white">{contract.remaining_bushels.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right text-white">{contract.percent_filled?.toFixed(1)}%</td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => openEditModal(contract)}
                      className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded mr-2 text-sm"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(contract.id)}
                      className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-sm"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {contracts.length === 0 && (
        <div className="text-center text-white mt-8">
          No contracts for {currentYear}. Create one or change the crop year.
        </div>
      )}

      {/* Bulk Edit Modal */}
      {showBulkEditModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <h2 className="text-2xl font-bold mb-4 text-white">
              Bulk Edit {selectedIds.size} Contracts
            </h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1 text-white">Priority (1-10)</label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  placeholder="Leave blank to keep current"
                  value={bulkEditData.priority}
                  onChange={(e) => setBulkEditData({ ...bulkEditData, priority: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 text-white">Crop Year</label>
                <select
                  value={bulkEditData.crop_year}
                  onChange={(e) => setBulkEditData({ ...bulkEditData, crop_year: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg"
                >
                  <option value="">Keep current</option>
                  <option value="2024">2024</option>
                  <option value="2025">2025</option>
                  <option value="2026">2026</option>
                  <option value="2027">2027</option>
                  <option value="2028">2028</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 text-white">Owner</label>
                <input
                  type="text"
                  placeholder="Leave blank to keep current"
                  value={bulkEditData.owner}
                  onChange={(e) => setBulkEditData({ ...bulkEditData, owner: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 text-white">Through</label>
                <input
                  type="text"
                  placeholder="Leave blank to keep current"
                  value={bulkEditData.through}
                  onChange={(e) => setBulkEditData({ ...bulkEditData, through: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 text-white">Location</label>
                <input
                  type="text"
                  placeholder="Leave blank to keep current"
                  value={bulkEditData.destination}
                  onChange={(e) => setBulkEditData({ ...bulkEditData, destination: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 text-white">Window Start</label>
                <input
                  type="date"
                  value={bulkEditData.start_date}
                  onChange={(e) => setBulkEditData({ ...bulkEditData, start_date: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 text-white">Window End</label>
                <input
                  type="date"
                  value={bulkEditData.end_date}
                  onChange={(e) => setBulkEditData({ ...bulkEditData, end_date: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setShowBulkEditModal(false)}
                className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleBulkEdit}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg"
              >
                Update Selected
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <h2 className="text-2xl font-bold mb-4 text-white">
              {editingContract ? 'Edit Contract' : 'New Contract'}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1 text-white">Contract Number *</label>
                  <input
                    type="text"
                    required
                    value={formData.contract_number}
                    onChange={(e) => setFormData({ ...formData, contract_number: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1 text-white">Crop *</label>
                  <input
                    type="text"
                    required
                    value={formData.crop}
                    onChange={(e) => setFormData({ ...formData, crop: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1 text-white">Owner</label>
                  <input
                    type="text"
                    value={formData.owner}
                    onChange={(e) => setFormData({ ...formData, owner: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1 text-white">Through</label>
                  <input
                    type="text"
                    value={formData.through}
                    onChange={(e) => setFormData({ ...formData, through: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1 text-white">Quick Select Through</label>
                  <select
                    value=""
                    onChange={(e) => setFormData({ ...formData, through: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg"
                  >
                    <option value="">Select to auto-fill...</option>
                    <option value="Akron">Akron</option>
                    <option value="RVC">RVC</option>
                    <option value="Cargill">Cargill</option>
                    <option value="ADM">ADM</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1 text-white">Location *</label>
                  <input
                    type="text"
                    required
                    value={formData.destination}
                    onChange={(e) => setFormData({ ...formData, destination: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1 text-white">Contracted Bushels *</label>
                  <input
                    type="number"
                    required
                    step="0.01"
                    value={formData.contracted_bushels}
                    onChange={(e) =>
                      setFormData({ ...formData, contracted_bushels: parseFloat(e.target.value) })
                    }
                    className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1 text-white">Crop Year *</label>
                  <select
                    required
                    value={formData.crop_year}
                    onChange={(e) => setFormData({ ...formData, crop_year: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg"
                  >
                    <option value="">Select Year</option>
                    <option value="2024">2024</option>
                    <option value="2025">2025</option>
                    <option value="2026">2026</option>
                    <option value="2027">2027</option>
                    <option value="2028">2028</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1 text-white">Priority (1-10)</label>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={formData.priority}
                    onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) })}
                    className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1 text-white">Window Start</label>
                  <input
                    type="date"
                    value={formData.start_date || ''}
                    onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1 text-white">Window End</label>
                  <input
                    type="date"
                    value={formData.end_date || ''}
                    onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg"
                  />
                </div>
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="overfill"
                    checked={formData.overfill_allowed}
                    onChange={(e) => setFormData({ ...formData, overfill_allowed: e.target.checked })}
                    className="mr-2 w-4 h-4"
                  />
                  <label htmlFor="overfill" className="text-sm font-medium text-white">
                    Overfill Allowed
                  </label>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 text-white">Notes</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg"
                  rows={3}
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false);
                    setEditingContract(null);
                    resetForm();
                  }}
                  className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg"
                >
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg">
                  {editingContract ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Import Modal */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-lg p-6 max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <h2 className="text-2xl font-bold mb-4 text-white">Import Contracts from Excel</h2>

            <div className="mb-4">
              <p className="text-white mb-2 font-bold text-lg">
                📋 EXACT COLUMN HEADERS REQUIRED:
              </p>
              <div className="bg-gray-700 p-3 rounded mb-4 overflow-x-auto">
                <table className="text-sm text-white w-full border-collapse">
                  <thead>
                    <tr className="border-b-2 border-gray-500">
                      <th className="px-2 py-2 text-left border-r border-gray-600">Owner</th>
                      <th className="px-2 py-2 text-left border-r border-gray-600">Through</th>
                      <th className="px-2 py-2 text-left border-r border-gray-600">Location</th>
                      <th className="px-2 py-2 text-left border-r border-gray-600">Contract#</th>
                      <th className="px-2 py-2 text-left border-r border-gray-600">Crop</th>
                      <th className="px-2 py-2 text-left border-r border-gray-600">Bushels</th>
                      <th className="px-2 py-2 text-left border-r border-gray-600">Window Start</th>
                      <th className="px-2 py-2 text-left border-r border-gray-600">Window End</th>
                      <th className="px-2 py-2 text-left">Year</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="text-gray-300 text-xs">
                      <td className="px-2 py-2 border-r border-gray-600">Anthony</td>
                      <td className="px-2 py-2 border-r border-gray-600">RVC</td>
                      <td className="px-2 py-2 border-r border-gray-600">Cargill-Lacon</td>
                      <td className="px-2 py-2 border-r border-gray-600">8992</td>
                      <td className="px-2 py-2 border-r border-gray-600">Corn</td>
                      <td className="px-2 py-2 border-r border-gray-600">10000</td>
                      <td className="px-2 py-2 border-r border-gray-600">01/01/2026</td>
                      <td className="px-2 py-2 border-r border-gray-600">01/31/2026</td>
                      <td className="px-2 py-2">2025</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="bg-red-900 border-2 border-red-600 rounded p-4 mb-4">
                <p className="text-red-100 font-bold mb-2">⚠️ CRITICAL RULES:</p>
                <ul className="text-red-100 text-sm space-y-1 list-disc list-inside">
                  <li><strong>Contract#</strong> — NO SPACE before the # symbol</li>
                  <li><strong>Through</strong> — Who the grain is contracted through (RVC, ADM, etc.)</li>
                  <li><strong>Location</strong> — Delivery location (Cargill-Lacon, Chicago, etc.)</li>
                  <li><strong>Year</strong> — Crop year (2025 for 2025-26 season)</li>
                  <li><strong>Dates</strong> — Any format (Excel auto-converts)</li>
                </ul>
              </div>

              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileSelect}
                className="block w-full text-sm text-gray-300
                  file:mr-4 file:py-3 file:px-6
                  file:rounded-lg file:border-0
                  file:text-sm file:font-bold
                  file:bg-blue-600 file:text-white
                  hover:file:bg-blue-700 file:cursor-pointer"
              />
            </div>

            {importPreview.length > 0 && (
              <div className="mb-4">
                <h3 className="font-semibold mb-2 text-white text-lg">Preview ({importPreview.length} contracts)</h3>
                <div className="overflow-x-auto max-h-96 border border-gray-600 rounded">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-700 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left text-white">Owner</th>
                        <th className="px-3 py-2 text-left text-white">Contract #</th>
                        <th className="px-3 py-2 text-left text-white">Crop</th>
                        <th className="px-3 py-2 text-left text-white">Through</th>
                        <th className="px-3 py-2 text-left text-white">Location</th>
                        <th className="px-3 py-2 text-right text-white">Bushels</th>
                        <th className="px-3 py-2 text-left text-white">Year</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importPreview.map((contract, idx) => (
                        <tr key={idx} className="border-t border-gray-700">
                          <td className="px-3 py-2 text-white">{contract.owner}</td>
                          <td className="px-3 py-2 text-white">{contract.contract_number}</td>
                          <td className="px-3 py-2 text-white">{contract.crop}</td>
                          <td className="px-3 py-2 text-white">{contract.through}</td>
                          <td className="px-3 py-2 text-white">{contract.destination}</td>
                          <td className="px-3 py-2 text-right text-white">
                            {contract.contracted_bushels.toLocaleString()}
                          </td>
                          <td className="px-3 py-2 text-white">{contract.crop_year}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowImportModal(false);
                  setImportFile(null);
                  setImportPreview([]);
                }}
                className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleImport}
                disabled={importPreview.length === 0 || importing}
                className="px-6 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-bold disabled:opacity-50"
              >
                {importing ? 'Importing...' : `Import ${importPreview.length} Contracts`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
