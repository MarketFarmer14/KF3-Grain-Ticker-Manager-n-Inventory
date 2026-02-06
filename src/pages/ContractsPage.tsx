import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import type { Database } from '../lib/database.types';
import * as XLSX from 'xlsx';

type Contract = Database['public']['Tables']['contracts']['Row'];
type ContractInsert = Database['public']['Tables']['contracts']['Insert'];

export function ContractsPage() {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [editingContract, setEditingContract] = useState<Contract | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<any[]>([]);
  const [importing, setImporting] = useState(false);

  const [formData, setFormData] = useState<Partial<ContractInsert>>({
    contract_number: '',
    crop: '',
    buyer: '',
    destination: '',
    through: 'Any',
    contracted_bushels: 0,
    start_date: '',
    end_date: '',
    priority: 5,
    overfill_allowed: true,
    notes: '',
  });

  const currentYear = localStorage.getItem('grain_ticket_year') || new Date().getFullYear().toString();

  useEffect(() => {
    fetchContracts();
  }, [currentYear]);

  const fetchContracts = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('contracts')
      .select('*')
      .eq('crop_year', currentYear)
      .order('priority', { ascending: true });

    if (error) {
      console.error('Error fetching contracts:', error);
    } else {
      setContracts(data || []);
    }
    setLoading(false);
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

        // Map Excel columns to match your layout:
        // Owner | Elevator/Buyer | Contract# | Crop | Bushels | Price | Window Start | Window End | Delivered | Status
        const mapped = jsonData.map((row: any) => {
          const owner = row['Owner'] || '';
          const elevatorBuyer = row['Elevator/Buyer'] || '';
          const contractNum = row['Contract#'] || '';
          const crop = row['Crop'] || '';
          const bushels = parseFloat(row['Bushels'] || '0');
          const windowStart = row['Window Start'] || null;
          const windowEnd = row['Window End'] || null;

          return {
            contract_number: contractNum.toString(),
            crop: crop,
            buyer: owner, // "Owner" maps to "buyer" field (who owns the contract)
            destination: elevatorBuyer, // "Elevator/Buyer" maps to destination
            through: 'Any', // Default, can be overridden
            contracted_bushels: bushels,
            start_date: windowStart,
            end_date: windowEnd,
            priority: 5, // Default priority
            notes: `Imported from Excel`,
          };
        });

        setImportPreview(mapped);
      } catch (error) {
        alert('Error reading Excel file. Please check format and ensure column headers match exactly.');
        console.error(error);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleImport = async () => {
    if (importPreview.length === 0) return;

    setImporting(true);

    try {
      const contractsWithYear = importPreview.map((c) => ({
        ...c,
        crop_year: currentYear,
      }));

      const { error } = await supabase.from('contracts').insert(contractsWithYear);

      if (error) throw error;

      alert(`Successfully imported ${importPreview.length} contracts!`);
      setShowImportModal(false);
      setImportFile(null);
      setImportPreview([]);
      fetchContracts();
    } catch (error: any) {
      if (error.code === '23505') {
        alert('Error: Some contract numbers already exist. Please check for duplicates.');
      } else {
        alert('Import failed: ' + error.message);
      }
      console.error(error);
    } finally {
      setImporting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const dataToSave: ContractInsert = {
      ...formData,
      crop_year: currentYear,
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
        alert('Error updating contract: ' + error.message);
      } else {
        setShowModal(false);
        setEditingContract(null);
        resetForm();
        fetchContracts();
      }
    } else {
      const { error } = await supabase.from('contracts').insert([dataToSave]);

      if (error) {
        alert('Error creating contract: ' + error.message);
      } else {
        setShowModal(false);
        resetForm();
        fetchContracts();
      }
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this contract?')) return;

    const { error } = await supabase.from('contracts').delete().eq('id', id);

    if (error) {
      alert('Error deleting contract: ' + error.message);
    } else {
      fetchContracts();
    }
  };

  const resetForm = () => {
    setFormData({
      contract_number: '',
      crop: '',
      buyer: '',
      destination: '',
      through: 'Any',
      contracted_bushels: 0,
      start_date: '',
      end_date: '',
      priority: 5,
      overfill_allowed: true,
      notes: '',
    });
  };

  const openEditModal = (contract: Contract) => {
    setEditingContract(contract);
    setFormData({
      contract_number: contract.contract_number,
      crop: contract.crop,
      buyer: contract.buyer || '',
      destination: contract.destination,
      through: contract.through || 'Any',
      contracted_bushels: contract.contracted_bushels,
      start_date: contract.start_date || '',
      end_date: contract.end_date || '',
      priority: contract.priority,
      overfill_allowed: contract.overfill_allowed,
      notes: contract.notes || '',
    });
    setShowModal(true);
  };

  if (loading) {
    return <div className="p-8 text-center">Loading contracts...</div>;
  }

  return (
    <div className="p-4 md:p-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Contracts</h1>
        <div className="flex gap-2">
          <button
            onClick={() => {
              setEditingContract(null);
              resetForm();
              setShowModal(true);
            }}
            className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg flex items-center gap-2"
          >
            + New Contract
          </button>
          <button
            onClick={() => setShowImportModal(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center gap-2"
          >
            📊 Import from Excel
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full bg-gray-800 rounded-lg">
          <thead className="bg-gray-700">
            <tr>
              <th className="px-4 py-3 text-left">Priority</th>
              <th className="px-4 py-3 text-left">Contract #</th>
              <th className="px-4 py-3 text-left">Crop</th>
              <th className="px-4 py-3 text-left">Buyer</th>
              <th className="px-4 py-3 text-left">Destination</th>
              <th className="px-4 py-3 text-left">Through</th>
              <th className="px-4 py-3 text-right">Contracted</th>
              <th className="px-4 py-3 text-right">Delivered</th>
              <th className="px-4 py-3 text-right">Remaining</th>
              <th className="px-4 py-3 text-right">% Filled</th>
              <th className="px-4 py-3 text-center">Actions</th>
            </tr>
          </thead>
          <tbody>
            {contracts.map((contract) => (
              <tr key={contract.id} className="border-t border-gray-700 hover:bg-gray-750">
                <td className="px-4 py-3">{contract.priority}</td>
                <td className="px-4 py-3 font-semibold">{contract.contract_number}</td>
                <td className="px-4 py-3">{contract.crop}</td>
                <td className="px-4 py-3">{contract.buyer || '-'}</td>
                <td className="px-4 py-3">{contract.destination}</td>
                <td className="px-4 py-3">{contract.through || 'Any'}</td>
                <td className="px-4 py-3 text-right">{contract.contracted_bushels.toLocaleString()}</td>
                <td className="px-4 py-3 text-right">{contract.delivered_bushels.toLocaleString()}</td>
                <td className="px-4 py-3 text-right">{contract.remaining_bushels.toLocaleString()}</td>
                <td className="px-4 py-3 text-right">{contract.percent_filled?.toFixed(1)}%</td>
                <td className="px-4 py-3 text-center">
                  <button
                    onClick={() => openEditModal(contract)}
                    className="px-3 py-1 bg-blue-600 hover:bg-blue-700 rounded mr-2"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(contract.id)}
                    className="px-3 py-1 bg-red-600 hover:bg-red-700 rounded"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <h2 className="text-2xl font-bold mb-4">
              {editingContract ? 'Edit Contract' : 'New Contract'}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Contract Number *</label>
                  <input
                    type="text"
                    required
                    value={formData.contract_number}
                    onChange={(e) => setFormData({ ...formData, contract_number: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-700 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Crop *</label>
                  <input
                    type="text"
                    required
                    value={formData.crop}
                    onChange={(e) => setFormData({ ...formData, crop: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-700 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Buyer/Owner</label>
                  <input
                    type="text"
                    value={formData.buyer}
                    onChange={(e) => setFormData({ ...formData, buyer: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-700 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Destination *</label>
                  <input
                    type="text"
                    required
                    value={formData.destination}
                    onChange={(e) => setFormData({ ...formData, destination: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-700 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Through</label>
                  <select
                    value={formData.through}
                    onChange={(e) => setFormData({ ...formData, through: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-700 rounded-lg"
                  >
                    <option value="Akron">Akron</option>
                    <option value="RVC">RVC</option>
                    <option value="Cargill">Cargill</option>
                    <option value="Any">Any</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Contracted Bushels *</label>
                  <input
                    type="number"
                    required
                    step="0.01"
                    value={formData.contracted_bushels}
                    onChange={(e) =>
                      setFormData({ ...formData, contracted_bushels: parseFloat(e.target.value) })
                    }
                    className="w-full px-3 py-2 bg-gray-700 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Start Date</label>
                  <input
                    type="date"
                    value={formData.start_date || ''}
                    onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-700 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">End Date</label>
                  <input
                    type="date"
                    value={formData.end_date || ''}
                    onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-700 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Priority (1-10)</label>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={formData.priority}
                    onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) })}
                    className="w-full px-3 py-2 bg-gray-700 rounded-lg"
                  />
                </div>
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="overfill"
                    checked={formData.overfill_allowed}
                    onChange={(e) => setFormData({ ...formData, overfill_allowed: e.target.checked })}
                    className="mr-2"
                  />
                  <label htmlFor="overfill" className="text-sm font-medium">
                    Overfill Allowed
                  </label>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Notes</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-700 rounded-lg"
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
                  className="px-4 py-2 bg-gray-600 hover:bg-gray-700 rounded-lg"
                >
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded-lg">
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
            <h2 className="text-2xl font-bold mb-4">Import Contracts from Excel</h2>

            <div className="mb-4">
              <p className="text-gray-300 mb-2">
                Upload an Excel file (.xlsx or .xls) with these exact column headers:
              </p>
              <div className="bg-gray-700 p-3 rounded mb-4 overflow-x-auto">
                <table className="text-sm">
                  <thead>
                    <tr className="border-b border-gray-600">
                      <th className="px-2 py-1 text-left">Owner</th>
                      <th className="px-2 py-1 text-left">Elevator/Buyer</th>
                      <th className="px-2 py-1 text-left">Contract#</th>
                      <th className="px-2 py-1 text-left">Crop</th>
                      <th className="px-2 py-1 text-left">Bushels</th>
                      <th className="px-2 py-1 text-left">Window Start</th>
                      <th className="px-2 py-1 text-left">Window End</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="text-gray-400">
                      <td className="px-2 py-1">Anthony</td>
                      <td className="px-2 py-1">RVC</td>
                      <td className="px-2 py-1">8992</td>
                      <td className="px-2 py-1">Corn</td>
                      <td className="px-2 py-1">10000</td>
                      <td className="px-2 py-1">01/01/2026</td>
                      <td className="px-2 py-1">01/31/2026</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileSelect}
                className="block w-full text-sm text-gray-300
                  file:mr-4 file:py-2 file:px-4
                  file:rounded-lg file:border-0
                  file:text-sm file:font-semibold
                  file:bg-blue-600 file:text-white
                  hover:file:bg-blue-700"
              />
            </div>

            {importPreview.length > 0 && (
              <div className="mb-4">
                <h3 className="font-semibold mb-2">Preview ({importPreview.length} contracts)</h3>
                <div className="overflow-x-auto max-h-96">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-700 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left">Contract #</th>
                        <th className="px-3 py-2 text-left">Crop</th>
                        <th className="px-3 py-2 text-left">Owner</th>
                        <th className="px-3 py-2 text-left">Destination</th>
                        <th className="px-3 py-2 text-right">Bushels</th>
                        <th className="px-3 py-2 text-left">Start</th>
                        <th className="px-3 py-2 text-left">End</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importPreview.map((contract, idx) => (
                        <tr key={idx} className="border-t border-gray-700">
                          <td className="px-3 py-2">{contract.contract_number}</td>
                          <td className="px-3 py-2">{contract.crop}</td>
                          <td className="px-3 py-2">{contract.buyer}</td>
                          <td className="px-3 py-2">{contract.destination}</td>
                          <td className="px-3 py-2 text-right">
                            {contract.contracted_bushels.toLocaleString()}
                          </td>
                          <td className="px-3 py-2">{contract.start_date || '-'}</td>
                          <td className="px-3 py-2">{contract.end_date || '-'}</td>
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
                className="px-4 py-2 bg-gray-600 hover:bg-gray-700 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleImport}
                disabled={importPreview.length === 0 || importing}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
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
