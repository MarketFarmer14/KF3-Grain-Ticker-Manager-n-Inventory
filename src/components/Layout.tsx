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
    crop_year: '',
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

  // Convert Excel date serial number to YYYY-MM-DD
  const convertExcelDate = (excelDate: any): string | null => {
    if (!excelDate) return null;

    // If it's already a string date, return it
    if (typeof excelDate === 'string') {
      // Try to parse it as a date
      const parsed = new Date(excelDate);
      if (!isNaN(parsed.getTime())) {
        return parsed.toISOString().split('T')[0];
      }
      return null;
    }

    // If it's an Excel serial number
    if (typeof excelDate === 'number') {
      // Excel date system starts at 1900-01-01 (but Excel incorrectly treats 1900 as a leap year)
      const excelEpoch = new Date(1899, 11, 30); // Dec 30, 1899
      const jsDate = new Date(excelEpoch.getTime() + excelDate * 86400000); // Add days in milliseconds
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

        // Map Excel columns: Owner | Buyer | Destination | Contract# | Crop | Bushels | Window Start | Window End
        const mapped = jsonData.map((row: any) => {
          const owner = row['Owner'] || '';
          const buyer = row['Buyer'] || '';
          const destination = row['Destination'] || '';
          const contractNum = row['Contract#'] || '';
          const crop = row['Crop'] || '';
          const bushels = parseFloat(row['Bushels'] || '0');

          // Convert Excel date numbers to YYYY-MM-DD format
          const windowStart = row['Window Start']
            ? convertExcelDate(row['Window Start'])
            : null;
          const windowEnd = row['Window End']
            ? convertExcelDate(row['Window End'])
            : null;

          return {
            contract_number: contractNum.toString(),
            crop: crop,
            buyer: buyer, // "Buyer" column
            destination: destination, // "Destination" column
            through: 'Any', // Default
            contracted_bushels: bushels,
            start_date: windowStart,
            end_date: windowEnd,
            priority: 5,
            notes: owner ? `Owner: ${owner}` : '', // Store Owner in notes if needed
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
      crop_year: currentYear,
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
      crop_year: contract.crop_year,
    });
    setShowModal(true);
  };

  if (loading) {
    return <div className="p-8 text-center text-white">Loading contracts...</div>;
  }

  return (
    <div className="p-4 md:p-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-white">Contracts</h1>
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
              <th className="px-4 py-3 text-left text-white">Priority</th>
              <th className="px-4 py-3 text-left text-white">Contract #</th>
              <th className="px-4 py-3 text-left text-white">Crop</th>
              <th className="px-4 py-3 text-left text-white">Buyer</th>
              <th className="px-4 py-3 text-left text-white">Destination</th>
              <th className="px-4 py-3 text-left text-white">Through</th>
              <th className="px-4 py-3 text-right text-white">Contracted</th>
              <th className="px-4 py-3 text-right text-white">Delivered</th>
              <th className="px-4 py-3 text-right text-white">Remaining</th>
              <th className="px-4 py-3 text-right text-white">% Filled</th>
              <th className="px-4 py-3 text-center text-white">Actions</th>
            </tr>
          </thead>
          <tbody>
            {contracts.map((contract) => (
              <tr key={contract.id} className="border-t border-gray-700 hover:bg-gray-750">
                <td className="px-4 py-3 text-white">{contract.priority}</td>
                <td className="px-4 py-3 font-semibold text-white">{contract.contract_number}</td>
                <td className="px-4 py-3 text-white">{contract.crop}</td>
                <td className="px-4 py-3 text-white">{contract.buyer || '-'}</td>
                <td className="px-4 py-3 text-white">{contract.destination}</td>
                <td className="px-4 py-3 text-white">{contract.through || 'Any'}</td>
                <td className="px-4 py-3 text-right text-white">{contract.contracted_bushels.toLocaleString()}</td>
                <td className="px-4 py-3 text-right text-white">{contract.delivered_bushels.toLocaleString()}</td>
                <td className="px-4 py-3 text-right text-white">{contract.remaining_bushels.toLocaleString()}</td>
                <td className="px-4 py-3 text-right text-white">{contract.percent_filled?.toFixed(1)}%</td>
                <td className="px-4 py-3 text-center">
                  <button
                    onClick={() => openEditModal(contract)}
                    className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded mr-2"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(contract.id)}
                    className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {contracts.length === 0 && (
        <div className="text-center text-white mt-8">
          No contracts found for {currentYear}. Create one or change the crop year filter.
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
                  <label className="block text-sm font-medium mb-1 text-white">Buyer</label>
                  <input
                    type="text"
                    value={formData.buyer}
                    onChange={(e) => setFormData({ ...formData, buyer: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1 text-white">Destination *</label>
                  <input
                    type="text"
                    required
                    value={formData.destination}
                    onChange={(e) => setFormData({ ...formData, destination: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1 text-white">Through</label>
                  <select
                    value={formData.through}
                    onChange={(e) => setFormData({ ...formData, through: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg"
                  >
                    <option value="Akron">Akron</option>
                    <option value="RVC">RVC</option>
                    <option value="Cargill">Cargill</option>
                    <option value="Any">Any</option>
                  </select>
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
                  <label className="block text-sm font-medium mb-1 text-white">Start Date</label>
                  <input
                    type="date"
                    value={formData.start_date || ''}
                    onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1 text-white">End Date</label>
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
                    className="mr-2"
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
              <p className="text-gray-300 mb-2">
                Upload an Excel file (.xlsx or .xls) with these exact column headers:
              </p>
              <div className="bg-gray-700 p-3 rounded mb-4 overflow-x-auto">
                <table className="text-sm text-white">
                  <thead>
                    <tr className="border-b border-gray-600">
                      <th className="px-2 py-1 text-left">Owner</th>
                      <th className="px-2 py-1 text-left">Buyer</th>
                      <th className="px-2 py-1 text-left">Destination</th>
                      <th className="px-2 py-1 text-left">Contract#</th>
                      <th className="px-2 py-1 text-left">Crop</th>
                      <th className="px-2 py-1 text-left">Bushels</th>
                      <th className="px-2 py-1 text-left">Window Start</th>
                      <th className="px-2 py-1 text-left">Window End</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="text-gray-400">
                      <td className="px-2 py-1">Ethan</td>
                      <td className="px-2 py-1">ADM</td>
                      <td className="px-2 py-1">Chicago</td>
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
                <h3 className="font-semibold mb-2 text-white">Preview ({importPreview.length} contracts)</h3>
                <div className="overflow-x-auto max-h-96">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-700 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left text-white">Contract #</th>
                        <th className="px-3 py-2 text-left text-white">Crop</th>
                        <th className="px-3 py-2 text-left text-white">Buyer</th>
                        <th className="px-3 py-2 text-left text-white">Destination</th>
                        <th className="px-3 py-2 text-right text-white">Bushels</th>
                        <th className="px-3 py-2 text-left text-white">Start</th>
                        <th className="px-3 py-2 text-left text-white">End</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importPreview.map((contract, idx) => (
                        <tr key={idx} className="border-t border-gray-700">
                          <td className="px-3 py-2 text-white">{contract.contract_number}</td>
                          <td className="px-3 py-2 text-white">{contract.crop}</td>
                          <td className="px-3 py-2 text-white">{contract.buyer}</td>
                          <td className="px-3 py-2 text-white">{contract.destination}</td>
                          <td className="px-3 py-2 text-right text-white">
                            {contract.contracted_bushels.toLocaleString()}
                          </td>
                          <td className="px-3 py-2 text-white">{contract.start_date || '-'}</td>
                          <td className="px-3 py-2 text-white">{contract.end_date || '-'}</td>
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
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
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
