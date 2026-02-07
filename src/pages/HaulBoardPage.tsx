import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import type { Database } from '../lib/database.types';

type Contract = Database['public']['Tables']['contracts']['Row'];

type SortField = 'priority' | 'contract_number' | 'owner' | 'crop' | 'through' | 'destination' | 'percent_filled' | 'remaining_bushels' | 'end_date';
type SortDirection = 'asc' | 'desc';

export function HaulBoardPage() {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [filteredContracts, setFilteredContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [cropFilter, setCropFilter] = useState<string>('All');
  const [sortField, setSortField] = useState<SortField>('end_date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  const currentYear = localStorage.getItem('grain_ticket_year') || new Date().getFullYear().toString();

  useEffect(() => {
    fetchContracts();
  }, [currentYear]);

  useEffect(() => {
    applyFiltersAndSort();
  }, [contracts, cropFilter, sortField, sortDirection]);

  const fetchContracts = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('contracts')
      .select('*')
      .eq('crop_year', currentYear)
      .gt('remaining_bushels', 0); // Only show contracts with remaining bushels

    if (error) {
      console.error('Error fetching contracts:', error);
    } else {
      setContracts(data || []);
    }
    setLoading(false);
  };

  const applyFiltersAndSort = () => {
    let filtered = [...contracts];

    // Apply crop filter
    if (cropFilter !== 'All') {
      filtered = filtered.filter(c => c.crop === cropFilter);
    }

    // Apply sorting
    filtered.sort((a, b) => {
      let aVal: any = a[sortField];
      let bVal: any = b[sortField];

      // Handle null values
      if (aVal === null) aVal = sortDirection === 'asc' ? Infinity : -Infinity;
      if (bVal === null) bVal = sortDirection === 'asc' ? Infinity : -Infinity;

      if (sortDirection === 'asc') {
        return aVal > bVal ? 1 : -1;
      } else {
        return aVal < bVal ? 1 : -1;
      }
    });

    setFilteredContracts(filtered);
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const getUrgencyColor = (contract: Contract): string => {
    const percentFilled = contract.percent_filled || 0;
    const endDate = contract.end_date ? new Date(contract.end_date) : null;
    const today = new Date();
    const daysUntilEnd = endDate ? Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)) : 999;
    const isCorn = contract.crop === 'Corn';

    // Complete - gray regardless of crop
    if (percentFilled >= 100) return 'bg-gray-700 border-gray-600';
    
    // Urgent: deadline < 7 days and not complete - red regardless of crop
    if (daysUntilEnd < 7 && percentFilled < 100) return 'bg-red-900 border-red-600';
    
    // Normal state - color by crop
    if (isCorn) {
      return 'bg-yellow-900 border-yellow-600'; // Corn = Yellow/Gold
    } else {
      return 'bg-green-900 border-green-600'; // Soybeans = Green
    }
  };

  const getDaysUntilDeadline = (endDate: string | null): string => {
    if (!endDate) return 'No deadline';
    const end = new Date(endDate);
    const today = new Date();
    const days = Math.ceil((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    
    if (days < 0) return `${Math.abs(days)} days overdue`;
    if (days === 0) return 'Due today';
    if (days === 1) return '1 day left';
    return `${days} days left`;
  };

  const getProgressBarColor = (percentFilled: number | null): string => {
    const percent = percentFilled || 0;
    if (percent >= 100) return 'bg-gray-500';
    if (percent >= 75) return 'bg-yellow-500';
    if (percent >= 50) return 'bg-blue-500';
    return 'bg-green-500';
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <span className="text-gray-500 ml-1">↕</span>;
    return sortDirection === 'asc' ? <span className="ml-1">↑</span> : <span className="ml-1">↓</span>;
  };

  // Calculate top stats
  const totalActive = filteredContracts.length;
  const totalRemaining = filteredContracts.reduce((sum, c) => sum + c.remaining_bushels, 0);
  const dueThisWeek = filteredContracts.filter(c => {
    if (!c.end_date) return false;
    const endDate = new Date(c.end_date);
    const today = new Date();
    const days = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return days >= 0 && days <= 7;
  }).length;

  if (loading) {
    return <div className="p-8 text-center text-white">Loading haul board...</div>;
  }

  return (
    <div className="p-4 md:p-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-white mb-4">Haul Board ({currentYear})</h1>
        
        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div className="bg-gray-800 rounded-lg p-4">
            <div className="text-gray-400 text-sm">Active Contracts</div>
            <div className="text-white text-2xl font-bold">{totalActive}</div>
          </div>
          <div className="bg-gray-800 rounded-lg p-4">
            <div className="text-gray-400 text-sm">Bushels Remaining</div>
            <div className="text-white text-2xl font-bold">{totalRemaining.toLocaleString()}</div>
          </div>
          <div className="bg-gray-800 rounded-lg p-4">
            <div className="text-gray-400 text-sm">Due This Week</div>
            <div className="text-white text-2xl font-bold">{dueThisWeek}</div>
          </div>
        </div>

        {/* Crop Filter */}
        <div className="flex items-center gap-4">
          <label className="text-white font-medium">Filter by Crop:</label>
          <select
            value={cropFilter}
            onChange={(e) => setCropFilter(e.target.value)}
            className="px-4 py-2 bg-gray-700 text-white rounded-lg border border-gray-600"
          >
            <option value="All">All Crops</option>
            <option value="Corn">Corn</option>
            <option value="Soybeans">Soybeans</option>
          </select>
        </div>
      </div>

      {/* Sort Controls */}
      <div className="mb-4 flex flex-wrap gap-2">
        <button
          onClick={() => handleSort('end_date')}
          className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm"
        >
          Sort by Deadline <SortIcon field="end_date" />
        </button>
        <button
          onClick={() => handleSort('percent_filled')}
          className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm"
        >
          Sort by % Filled <SortIcon field="percent_filled" />
        </button>
        <button
          onClick={() => handleSort('priority')}
          className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm"
        >
          Sort by Priority <SortIcon field="priority" />
        </button>
        <button
          onClick={() => handleSort('remaining_bushels')}
          className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm"
        >
          Sort by Remaining <SortIcon field="remaining_bushels" />
        </button>
      </div>

      {/* Contract Cards */}
      {filteredContracts.length === 0 ? (
        <div className="text-center text-white mt-8">
          No active contracts with remaining bushels for {cropFilter === 'All' ? 'any crop' : cropFilter}.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredContracts.map((contract) => (
            <div
              key={contract.id}
              className={`rounded-lg border-2 p-4 ${getUrgencyColor(contract)}`}
            >
              {/* Header */}
              <div className="flex justify-between items-start mb-3">
                <div>
                  <div className="text-white font-bold text-lg">#{contract.contract_number}</div>
                  <div className="text-gray-300 text-sm">{contract.owner || 'No Owner'}</div>
                </div>
                <div className="text-right">
                  <div className="text-white font-semibold">{contract.crop}</div>
                  <div className="text-gray-400 text-xs">Priority: {contract.priority}</div>
                </div>
              </div>

              {/* Location Info */}
              <div className="mb-3 text-sm">
                <div className="text-gray-300">
                  <span className="font-medium">Through:</span> {contract.through || '-'}
                </div>
                <div className="text-gray-300">
                  <span className="font-medium">Location:</span> {contract.destination}
                </div>
              </div>

              {/* Progress Bar */}
              <div className="mb-3">
                <div className="flex justify-between text-xs text-gray-300 mb-1">
                  <span>{contract.percent_filled?.toFixed(1)}% Complete</span>
                  <span>{getDaysUntilDeadline(contract.end_date)}</span>
                </div>
                <div className="w-full bg-gray-700 rounded-full h-3">
                  <div
                    className={`h-3 rounded-full ${getProgressBarColor(contract.percent_filled)}`}
                    style={{ width: `${Math.min(contract.percent_filled || 0, 100)}%` }}
                  ></div>
                </div>
              </div>

              {/* Bushels */}
              <div className="grid grid-cols-3 gap-2 text-center mb-3">
                <div>
                  <div className="text-gray-400 text-xs">Contracted</div>
                  <div className="text-white font-semibold text-sm">
                    {contract.contracted_bushels.toLocaleString()}
                  </div>
                </div>
                <div>
                  <div className="text-gray-400 text-xs">Delivered</div>
                  <div className="text-white font-semibold text-sm">
                    {contract.delivered_bushels.toLocaleString()}
                  </div>
                </div>
                <div>
                  <div className="text-gray-400 text-xs">Remaining</div>
                  <div className="text-white font-semibold text-sm">
                    {contract.remaining_bushels.toLocaleString()}
                  </div>
                </div>
              </div>

              {/* Delivery Window */}
              {(contract.start_date || contract.end_date) && (
                <div className="text-xs text-gray-400 border-t border-gray-600 pt-2">
                  <div className="flex justify-between">
                    <span>Window:</span>
                    <span>
                      {contract.start_date ? new Date(contract.start_date).toLocaleDateString() : '—'} → {contract.end_date ? new Date(contract.end_date).toLocaleDateString() : '—'}
                    </span>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
