import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { PERSON_OPTIONS, ORIGIN_LOCATIONS, normalizeTicketFields } from '../lib/constants';
import { findBestContract, autoAssignTicket } from '../lib/contractMatcher';
import type { SplitAssignment } from '../lib/contractMatcher';
import { SplitTicketModal } from '../components/SplitTicketModal';
import { exportTicketsToExcel, exportHaulingLog } from '../lib/export';
import { Download, Search } from 'lucide-react';
import type { Database } from '../lib/database.types';
import * as XLSX from 'xlsx';

type Ticket = Database['public']['Tables']['tickets']['Row'];
type Contract = Database['public']['Tables']['contracts']['Row'];
type TicketSplit = Database['public']['Tables']['ticket_splits']['Row'];
type SortField = 'ticket_date' | 'ticket_number' | 'person' | 'crop' | 'bushels' | 'delivery_location' | 'through' | 'truck' | 'dockage' | 'status';
type SortDir = 'asc' | 'desc';

interface SortRule {
  field: SortField;
  dir: SortDir;
}

interface EditState {
  ticket_date: string;
  ticket_number: string;
  person: string;
  crop: string;
  bushels: string;
  delivery_location: string;
  through: string;
  truck: string;
  dockage: string;
  moisture_percent: string;
  notes: string;
  origin: string;
}

function ticketToEdit(ticket: Ticket): EditState {
  return {
    ticket_date: ticket.ticket_date || '',
    ticket_number: ticket.ticket_number || '',
    person: ticket.person || '',
    crop: ticket.crop || '',
    bushels: ticket.bushels ? ticket.bushels.toString() : '',
    delivery_location: ticket.delivery_location || '',
    through: ticket.through || '',
    truck: ticket.truck || '',
    dockage: ticket.dockage ? ticket.dockage.toString() : '',
    moisture_percent: ticket.moisture_percent ? ticket.moisture_percent.toString() : '',
    notes: ticket.notes || '',
    origin: ticket.origin || '',
  };
}

export function TicketsPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortRules, setSortRules] = useState<SortRule[]>([{ field: 'ticket_date', dir: 'desc' }]);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [rematching, setRematching] = useState<string | null>(null);
  const [splittingTicket, setSplittingTicket] = useState<Ticket | null>(null);
  const [bulkAutoAssigning, setBulkAutoAssigning] = useState(false);
  const [showTrash, setShowTrash] = useState(false);

  // Splits data
  const [splits, setSplits] = useState<Record<string, TicketSplit[]>>({});
  const [expandedSplits, setExpandedSplits] = useState<Set<string>>(new Set());

  // Edit splits modal state
  const [editSplitsTicket, setEditSplitsTicket] = useState<Ticket | null>(null);
  const [editSplitsData, setEditSplitsData] = useState<SplitAssignment[]>([]);
  const [editSplitsRemainder, setEditSplitsRemainder] = useState(0);
  const [editSplitsSaving, setEditSplitsSaving] = useState(false);

  // Edit modal state
  const [editModalTicket, setEditModalTicket] = useState<Ticket | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);

  // Manual / batch entry modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [addMode, setAddMode] = useState<'single' | 'batch'>('batch');
  const [addSaving, setAddSaving] = useState(false);

  interface NewTicketRow {
    ticket_date: string;
    ticket_number: string;
    person: string;
    crop: string;
    bushels: string;
    delivery_location: string;
    through: string;
    truck: string;
    origin: string;
    notes: string;
  }

  const emptyRow = (): NewTicketRow => ({
    ticket_date: new Date().toISOString().split('T')[0],
    ticket_number: '',
    person: '',
    crop: '',
    bushels: '',
    delivery_location: '',
    through: '',
    truck: '',
    origin: '',
    notes: '',
  });

  const [addRows, setAddRows] = useState<NewTicketRow[]>([emptyRow()]);

  const updateAddRow = (index: number, field: keyof NewTicketRow, value: string) => {
    setAddRows(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const addNewRow = () => {
    setAddRows(prev => {
      // Copy person/crop/through/origin from last row for speed
      const last = prev[prev.length - 1];
      return [...prev, {
        ...emptyRow(),
        person: last.person,
        crop: last.crop,
        through: last.through,
        origin: last.origin,
        delivery_location: last.delivery_location,
      }];
    });
  };

  const removeAddRow = (index: number) => {
    setAddRows(prev => prev.length <= 1 ? prev : prev.filter((_, i) => i !== index));
  };

  const handleSaveNewTickets = async () => {
    const valid = addRows.filter(r => r.person && r.crop && r.bushels && parseFloat(r.bushels) > 0);
    if (valid.length === 0) {
      alert('Fill in at least Person, Crop, and Bushels for each row.');
      return;
    }

    setAddSaving(true);
    const normalized = normalizeTicketFields;

    const inserts = valid.map(r => {
      const norm = normalizeTicketFields({ person: r.person, crop: r.crop, through: r.through });
      return {
        ticket_date: r.ticket_date || new Date().toISOString().split('T')[0],
        ticket_number: r.ticket_number || null,
        person: norm.person,
        crop: norm.crop,
        bushels: parseFloat(r.bushels) || 0,
        delivery_location: r.delivery_location || '',
        through: norm.through,
        truck: r.truck || null,
        origin: r.origin || '',
        notes: r.notes || null,
        status: 'approved' as const,
        crop_year: currentYear,
        duplicate_flag: false,
        deleted: false,
        image_url: null,
        duplicate_group: null,
        moisture_percent: null,
        dockage: null,
        deleted_at: null,
        deleted_by: null,
        elevator: null,
        contract_id: null,
      };
    });

    const { error } = await supabase.from('tickets').insert(inserts);

    if (error) {
      alert('Failed to save tickets: ' + error.message);
    } else {
      alert(`${inserts.length} ticket(s) added as approved.`);
      setShowAddModal(false);
      setAddRows([emptyRow()]);
      fetchTickets();
    }
    setAddSaving(false);
  };

  // Multi-select state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState('');

  const currentYear = localStorage.getItem('grain_ticket_year') || new Date().getFullYear().toString();

  // Multi-column sort: click adds/toggles, hold nothing special - just cycles through
  const toggleSort = (field: SortField) => {
    setSortRules(prev => {
      const existing = prev.findIndex(r => r.field === field);
      if (existing >= 0) {
        // Toggle direction or remove if already desc
        const rule = prev[existing];
        if (rule.dir === 'asc') {
          const updated = [...prev];
          updated[existing] = { field, dir: 'desc' };
          return updated;
        } else {
          // Remove this sort rule (click 3rd time removes)
          return prev.filter((_, i) => i !== existing);
        }
      } else {
        // Add new sort rule
        return [...prev, { field, dir: 'asc' }];
      }
    });
  };

  const sortIndicator = (field: SortField) => {
    const idx = sortRules.findIndex(r => r.field === field);
    if (idx < 0) return '';
    const arrow = sortRules[idx].dir === 'asc' ? ' \u25B2' : ' \u25BC';
    return sortRules.length > 1 ? `${arrow}${idx + 1}` : arrow;
  };

  // Filter by search
  const filteredTickets = useMemo(() => {
    if (!searchQuery.trim()) return tickets;
    const q = searchQuery.trim().toLowerCase();
    return tickets.filter(t =>
      (t.ticket_number || '').toLowerCase().includes(q) ||
      (t.person || '').toLowerCase().includes(q) ||
      (t.notes || '').toLowerCase().includes(q) ||
      (t.delivery_location || '').toLowerCase().includes(q) ||
      (t.crop || '').toLowerCase().includes(q) ||
      (t.through || '').toLowerCase().includes(q) ||
      (t.truck || '').toLowerCase().includes(q) ||
      (t.origin || '').toLowerCase().includes(q)
    );
  }, [tickets, searchQuery]);

  // Multi-column sort
  const sortedTickets = useMemo(() => {
    if (sortRules.length === 0) return filteredTickets;
    return [...filteredTickets].sort((a, b) => {
      for (const rule of sortRules) {
        let aVal: any, bVal: any;
        switch (rule.field) {
          case 'ticket_date': aVal = a.ticket_date; bVal = b.ticket_date; break;
          case 'ticket_number': aVal = a.ticket_number || ''; bVal = b.ticket_number || ''; break;
          case 'person': aVal = a.person; bVal = b.person; break;
          case 'crop': aVal = a.crop; bVal = b.crop; break;
          case 'bushels': aVal = a.bushels; bVal = b.bushels; break;
          case 'delivery_location': aVal = a.delivery_location; bVal = b.delivery_location; break;
          case 'through': aVal = a.through; bVal = b.through; break;
          case 'truck': aVal = a.truck || ''; bVal = b.truck || ''; break;
          case 'dockage': aVal = a.dockage || 0; bVal = b.dockage || 0; break;
          case 'status': aVal = a.status; bVal = b.status; break;
          default: aVal = ''; bVal = '';
        }
        let cmp: number;
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          cmp = aVal - bVal;
        } else {
          cmp = String(aVal).localeCompare(String(bVal));
        }
        if (cmp !== 0) return rule.dir === 'asc' ? cmp : -cmp;
      }
      return 0;
    });
  }, [filteredTickets, sortRules]);

  const handleExport = () => {
    const approved = tickets.filter((t) => t.status === 'approved');
    if (approved.length === 0) {
      alert('No approved tickets to export.');
      return;
    }
    exportTicketsToExcel(approved, `grain_tickets_${currentYear}.xlsx`);
  };

  const handleHaulingLogExport = () => {
    const approved = tickets.filter((t) => t.status === 'approved');
    if (approved.length === 0) {
      alert('No approved tickets to export.');
      return;
    }
    const haulingData: { ticket_date: string; ticket_number: string | null; person: string; crop: string; delivery_location: string; bushels: number; contract_number: string; }[] = [];

    for (const t of approved) {
      const ticketSplits = splits[t.id];
      if (ticketSplits && ticketSplits.length > 0) {
        // One row per split — uses split.bushels (correct allocation)
        for (const s of ticketSplits) {
          const contract = contracts.find(c => c.id === s.contract_id);
          haulingData.push({
            ticket_date: t.ticket_date,
            ticket_number: t.ticket_number,
            person: s.person,
            crop: t.crop,
            delivery_location: t.delivery_location,
            bushels: s.bushels,
            contract_number: contract?.contract_number || '',
          });
        }
      } else {
        // Legacy ticket — no splits, use ticket directly
        const contract = contracts.find(c => c.id === t.contract_id);
        haulingData.push({
          ticket_date: t.ticket_date,
          ticket_number: t.ticket_number,
          person: t.person,
          crop: t.crop,
          delivery_location: t.delivery_location,
          bushels: t.bushels,
          contract_number: contract?.contract_number || '',
        });
      }
    }
    exportHaulingLog(haulingData, `hauling_log_${currentYear}.xlsx`);
  };

  useEffect(() => {
    fetchTickets();
  }, [currentYear, showTrash]);

  const fetchTickets = async () => {
    setLoading(true);

    const [ticketsRes, contractsRes] = await Promise.all([
      supabase
        .from('tickets')
        .select('*')
        .eq('crop_year', currentYear)
        .eq('deleted', showTrash)
        .order('ticket_date', { ascending: false }),
      supabase
        .from('contracts')
        .select('*')
        .eq('crop_year', currentYear),
    ]);

    if (ticketsRes.error) console.error('Error fetching tickets:', ticketsRes.error);
    if (contractsRes.error) console.error('Error fetching contracts:', contractsRes.error);

    setTickets(ticketsRes.data || []);
    setContracts(contractsRes.data || []);
    setSelectedIds(new Set());

    // Fetch splits for all tickets
    const ticketIds = (ticketsRes.data || []).map(t => t.id);
    if (ticketIds.length > 0) {
      const { data: splitsData } = await supabase
        .from('ticket_splits')
        .select('*')
        .in('ticket_id', ticketIds);

      if (splitsData) {
        const splitsMap: Record<string, TicketSplit[]> = {};
        splitsData.forEach(s => {
          if (!splitsMap[s.ticket_id]) splitsMap[s.ticket_id] = [];
          splitsMap[s.ticket_id].push(s);
        });
        setSplits(splitsMap);
      }
    }

    setLoading(false);
  };

  // Edit modal handlers
  const openEditModal = (ticket: Ticket) => {
    setEditModalTicket(ticket);
    setEditState(ticketToEdit(ticket));
  };

  const closeEditModal = () => {
    setEditModalTicket(null);
    setEditState(null);
  };

  const updateField = (field: keyof EditState, value: string) => {
    setEditState(prev => prev ? { ...prev, [field]: value } : prev);
  };

  const saveEdit = async () => {
    if (!editModalTicket || !editState) return;
    setSaving(true);

    const normalized = normalizeTicketFields({ person: editState.person, crop: editState.crop, through: editState.through });

    const { error } = await supabase
      .from('tickets')
      .update({
        ticket_date: editState.ticket_date || new Date().toISOString().split('T')[0],
        ticket_number: editState.ticket_number || null,
        person: normalized.person,
        crop: normalized.crop,
        bushels: parseFloat(editState.bushels) || 0,
        delivery_location: editState.delivery_location,
        through: normalized.through,
        truck: editState.truck || null,
        dockage: editState.dockage ? parseFloat(editState.dockage) : null,
        moisture_percent: editState.moisture_percent ? parseFloat(editState.moisture_percent) : null,
        notes: editState.notes || null,
        origin: editState.origin || null,
      })
      .eq('id', editModalTicket.id);

    if (error) {
      alert('Save failed: ' + error.message);
    } else {
      closeEditModal();
      fetchTickets();
    }

    setSaving(false);
  };

  const handleRematch = async (ticket: Ticket) => {
    setRematching(ticket.id);
    const result = autoAssignTicket(
      { person: ticket.person, crop: ticket.crop, through: ticket.through, bushels: ticket.bushels },
      contracts,
      splitTotals
    );

    if (result.splits.length > 0) {
      // Delete old splits
      await supabase.from('ticket_splits').delete().eq('ticket_id', ticket.id);

      // Update ticket to first contract
      await supabase
        .from('tickets')
        .update({ contract_id: result.splits[0].contract.id })
        .eq('id', ticket.id);

      // Insert new splits
      const splitInserts = result.splits.map(s => ({
        ticket_id: ticket.id,
        contract_id: s.contract.id,
        person: s.person,
        bushels: s.bushels,
      }));
      await supabase.from('ticket_splits').insert(splitInserts);

      const msg = result.splits.map(s => `#${s.contract.contract_number}: ${s.bushels.toLocaleString()} bu`).join(', ');
      alert(`Rematched: ${msg}${result.remainder > 0 ? ` (${result.remainder.toLocaleString()} bu unassigned)` : ''}`);
      fetchTickets();
    } else {
      alert('No matching contracts found for this ticket.');
    }

    setRematching(null);
  };

  const handleManualAssign = async (ticketId: string, contractId: string) => {
    const ticket = tickets.find(t => t.id === ticketId);
    if (!ticket) { setAssigningId(null); return; }

    // Update ticket's primary contract
    const { error } = await supabase
      .from('tickets')
      .update({ contract_id: contractId || null })
      .eq('id', ticketId);

    if (error) {
      alert('Failed to assign: ' + error.message);
      setAssigningId(null);
      return;
    }

    // Sync splits: delete old, create single split for full bushels on new contract
    await supabase.from('ticket_splits').delete().eq('ticket_id', ticketId);
    if (contractId) {
      await supabase.from('ticket_splits').insert({
        ticket_id: ticketId,
        contract_id: contractId,
        person: ticket.person,
        bushels: ticket.bushels,
      });
    }

    setAssigningId(null);
    fetchTickets();
  };

  // Edit Splits modal handlers
  const openEditSplits = (ticket: Ticket) => {
    const ticketSplits = splits[ticket.id] || [];
    const splitAssignments: SplitAssignment[] = ticketSplits.map(s => {
      const contract = contracts.find(c => c.id === s.contract_id);
      return {
        contract: contract || contracts[0],
        bushels: s.bushels,
        person: s.person,
      };
    }).filter(s => s.contract);

    setEditSplitsTicket(ticket);
    setEditSplitsData(splitAssignments);
    const totalAssigned = splitAssignments.reduce((sum, s) => sum + s.bushels, 0);
    setEditSplitsRemainder(Math.max(0, ticket.bushels - totalAssigned));
  };

  const updateEditSplitBushels = (index: number, newBushels: number) => {
    setEditSplitsData(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], bushels: newBushels };
      const totalAssigned = updated.reduce((sum, s) => sum + s.bushels, 0);
      setEditSplitsRemainder(Math.max(0, (editSplitsTicket?.bushels || 0) - totalAssigned));
      return updated;
    });
  };

  const updateEditSplitContract = (index: number, contractId: string) => {
    const contract = contracts.find(c => c.id === contractId);
    if (!contract) return;
    setEditSplitsData(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], contract };
      return updated;
    });
  };

  const updateEditSplitPerson = (index: number, person: string) => {
    setEditSplitsData(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], person };
      return updated;
    });
  };

  const removeEditSplit = (index: number) => {
    setEditSplitsData(prev => {
      const updated = prev.filter((_, i) => i !== index);
      const totalAssigned = updated.reduce((sum, s) => sum + s.bushels, 0);
      setEditSplitsRemainder(Math.max(0, (editSplitsTicket?.bushels || 0) - totalAssigned));
      return updated;
    });
  };

  const addEditSplit = () => {
    const assignable = contracts.filter(c => !c.is_spot_sale && getActualRemaining(c) > 0);
    if (assignable.length === 0) return;
    const newSplit: SplitAssignment = {
      contract: assignable[0],
      bushels: editSplitsRemainder > 0 ? editSplitsRemainder : 0,
      person: editSplitsTicket?.person || '',
    };
    setEditSplitsData(prev => {
      const updated = [...prev, newSplit];
      const totalAssigned = updated.reduce((sum, s) => sum + s.bushels, 0);
      setEditSplitsRemainder(Math.max(0, (editSplitsTicket?.bushels || 0) - totalAssigned));
      return updated;
    });
  };

  const saveEditSplits = async () => {
    if (!editSplitsTicket) return;
    setEditSplitsSaving(true);

    try {
      // Delete old splits
      await supabase.from('ticket_splits').delete().eq('ticket_id', editSplitsTicket.id);

      if (editSplitsData.length > 0) {
        // Update ticket contract to first split
        await supabase
          .from('tickets')
          .update({ contract_id: editSplitsData[0].contract.id })
          .eq('id', editSplitsTicket.id);

        // Insert new splits
        const splitInserts = editSplitsData.map(s => ({
          ticket_id: editSplitsTicket.id,
          contract_id: s.contract.id,
          person: s.person,
          bushels: s.bushels,
        }));
        await supabase.from('ticket_splits').insert(splitInserts);
      }

      setEditSplitsTicket(null);
      setEditSplitsData([]);
      fetchTickets();
    } catch (err: any) {
      alert('Failed to save splits: ' + err.message);
    } finally {
      setEditSplitsSaving(false);
    }
  };

  // Bulk Auto-Assign: match all unassigned approved tickets
  const handleBulkAutoAssign = async () => {
    const unassigned = tickets.filter(t => t.status === 'approved' && !t.contract_id && !t.deleted);
    if (unassigned.length === 0) {
      alert('No unassigned approved tickets to match.');
      return;
    }
    if (!confirm(`Auto-assign ${unassigned.length} unassigned approved ticket(s)?`)) return;

    setBulkAutoAssigning(true);
    let matched = 0;
    let failed = 0;

    for (const ticket of unassigned) {
      const matchResult = findBestContract(
        { person: ticket.person, crop: ticket.crop, through: ticket.through, bushels: ticket.bushels },
        contracts,
        splitTotals
      );

      if (matchResult.splits.length > 0) {
        const { error } = await supabase
          .from('tickets')
          .update({ contract_id: matchResult.splits[0].contract.id })
          .eq('id', ticket.id);
        if (!error) matched++;
        else failed++;
      }
    }

    alert(`Matched ${matched} of ${unassigned.length} tickets.${failed > 0 ? ` ${failed} failed.` : ''}`);
    fetchTickets();
    setBulkAutoAssigning(false);
  };

  // Bulk actions on selected tickets
  const handleBulkAction = async () => {
    if (selectedIds.size === 0 || !bulkAction) return;
    const ids = Array.from(selectedIds);

    if (bulkAction === 'approve' || bulkAction === 'reject' || bulkAction === 'hold') {
      const statusMap: Record<string, string> = { approve: 'approved', reject: 'rejected', hold: 'hold' };
      if (!confirm(`${bulkAction.charAt(0).toUpperCase() + bulkAction.slice(1)} ${ids.length} ticket(s)?`)) return;

      const { error } = await supabase
        .from('tickets')
        .update({ status: statusMap[bulkAction] })
        .in('id', ids);

      if (error) {
        alert('Bulk action failed: ' + error.message);
      } else {
        alert(`${ids.length} ticket(s) updated to ${statusMap[bulkAction]}.`);
        fetchTickets();
      }
    } else if (bulkAction === 'rematch') {
      if (!confirm(`Rematch ${ids.length} ticket(s) to contracts?`)) return;
      let matched = 0;
      for (const id of ids) {
        const ticket = tickets.find(t => t.id === id);
        if (!ticket) continue;
        const matchResult = findBestContract(
          { person: ticket.person, crop: ticket.crop, through: ticket.through, bushels: ticket.bushels },
          contracts,
          splitTotals
        );
        if (matchResult.splits.length > 0) {
          const { error } = await supabase
            .from('tickets')
            .update({ contract_id: matchResult.splits[0].contract.id })
            .eq('id', id);
          if (!error) matched++;
        }
      }
      alert(`Matched ${matched} of ${ids.length} ticket(s).`);
      fetchTickets();
    } else if (bulkAction === 'delete') {
      if (!confirm(`Move ${ids.length} ticket(s) to trash?`)) return;
      const { error } = await supabase
        .from('tickets')
        .update({ deleted: true, deleted_at: new Date().toISOString(), deleted_by: 'user' })
        .in('id', ids);

      if (error) {
        alert('Bulk delete failed: ' + error.message);
      } else {
        fetchTickets();
      }
    }

    setSelectedIds(new Set());
    setBulkAction('');
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === sortedTickets.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(sortedTickets.map(t => t.id)));
    }
  };

  const getContractLabel = (contractId: string | null): string => {
    if (!contractId) return 'None';
    const c = contracts.find(con => con.id === contractId);
    return c ? `#${c.contract_number}` : 'Unknown';
  };

  // Calculate actual delivered per contract from splits + legacy tickets
  const splitTotals: Record<string, number> = {};
  const ticketIdsWithSplits = new Set<string>();
  Object.values(splits).flat().forEach(s => {
    splitTotals[s.contract_id] = (splitTotals[s.contract_id] || 0) + s.bushels;
    ticketIdsWithSplits.add(s.ticket_id);
  });
  // Add legacy tickets (contract_id set, no splits)
  tickets.forEach(t => {
    if (t.contract_id && t.status === 'approved' && !t.deleted && !ticketIdsWithSplits.has(t.id)) {
      splitTotals[t.contract_id] = (splitTotals[t.contract_id] || 0) + t.bushels;
    }
  });

  const getActualRemaining = (c: Contract) => c.contracted_bushels - (splitTotals[c.id] || 0);

  const assignableContracts = contracts.filter(c => !c.is_spot_sale && getActualRemaining(c) > 0);

  const handleSoftDelete = async (ticketId: string) => {
    if (!confirm('Move this ticket to trash?')) return;

    const { error } = await supabase
      .from('tickets')
      .update({ deleted: true, deleted_at: new Date().toISOString(), deleted_by: 'user' })
      .eq('id', ticketId);

    if (error) {
      console.error('Error deleting ticket:', error);
      alert('Failed to delete ticket');
    } else {
      fetchTickets();
    }
  };

  const handleRestore = async (ticketId: string) => {
    const { error } = await supabase
      .from('tickets')
      .update({ deleted: false, deleted_at: null, deleted_by: null })
      .eq('id', ticketId);

    if (error) {
      console.error('Error restoring ticket:', error);
      alert('Failed to restore ticket');
    } else {
      fetchTickets();
    }
  };

  const handlePermanentDelete = async (ticketId: string) => {
    if (!confirm('PERMANENTLY delete this ticket? This cannot be undone!')) return;

    const { error } = await supabase
      .from('tickets')
      .delete()
      .eq('id', ticketId);

    if (error) {
      console.error('Error permanently deleting ticket:', error);
      alert('Failed to delete ticket');
    } else {
      fetchTickets();
    }
  };

  const inputClass = 'w-full px-3 py-2 bg-gray-700 text-white rounded border border-gray-500 focus:border-emerald-500 focus:outline-none';

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">Loading tickets...</div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8">
      {/* Header */}
      <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
        <h1 className="text-3xl font-bold text-white">
          {showTrash ? `Trash (${currentYear})` : `Tickets (${currentYear})`}
        </h1>
        <div className="flex flex-wrap gap-2">
          {!showTrash && (
            <>
              <button
                onClick={handleBulkAutoAssign}
                disabled={bulkAutoAssigning}
                className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 disabled:bg-gray-600 text-white rounded-lg font-semibold text-sm"
              >
                {bulkAutoAssigning ? 'Matching...' : 'Match All Unassigned'}
              </button>
              <button
                onClick={handleExport}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold text-sm"
              >
                <Download size={16} />
                Export Approved
              </button>
              <button
                onClick={handleHaulingLogExport}
                className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-semibold text-sm"
              >
                <Download size={16} />
                Export Hauling Log
              </button>
              <button
                onClick={() => { setShowAddModal(true); setAddRows([emptyRow()]); }}
                className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-lg font-semibold text-sm"
              >
                + Add Tickets
              </button>
            </>
          )}
          <button
            onClick={() => setShowTrash(!showTrash)}
            className={`px-4 py-2 rounded-lg font-semibold text-sm ${
              showTrash ? 'bg-green-600 hover:bg-green-700 text-white' : 'bg-gray-700 hover:bg-gray-600 text-white'
            }`}
          >
            {showTrash ? '\u2190 Back to Tickets' : 'View Trash'}
          </button>
        </div>
      </div>

      {/* Search Bar */}
      <div className="relative mb-4">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search tickets... (ticket #, person, location, crop, notes, origin)"
          className="w-full pl-10 pr-4 py-2 bg-gray-800 text-white rounded-lg border border-gray-600 focus:border-emerald-500 focus:outline-none"
        />
        {searchQuery && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">
            {filteredTickets.length} result{filteredTickets.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Multi-sort hint */}
      {sortRules.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-gray-400 text-xs">Sort:</span>
          {sortRules.map((rule, i) => (
            <span key={rule.field} className="px-2 py-0.5 bg-gray-700 text-gray-200 rounded text-xs">
              {rule.field.replace('_', ' ')} {rule.dir === 'asc' ? '\u25B2' : '\u25BC'}
              {sortRules.length > 1 && <span className="text-gray-400 ml-1">#{i + 1}</span>}
            </span>
          ))}
          <button
            onClick={() => setSortRules([])}
            className="text-gray-400 hover:text-white text-xs underline"
          >
            Clear sort
          </button>
        </div>
      )}

      {/* Bulk Actions Bar */}
      {selectedIds.size > 0 && !showTrash && (
        <div className="mb-4 flex flex-wrap items-center gap-3 bg-gray-800 rounded-lg p-3 border border-gray-600">
          <span className="text-white font-semibold text-sm">{selectedIds.size} selected</span>
          <select
            value={bulkAction}
            onChange={(e) => setBulkAction(e.target.value)}
            className="px-3 py-1.5 bg-gray-700 text-white rounded border border-gray-500 text-sm"
          >
            <option value="">Choose action...</option>
            <option value="approve">Approve</option>
            <option value="reject">Reject</option>
            <option value="hold">Hold</option>
            <option value="rematch">Rematch to Contracts</option>
            <option value="delete">Move to Trash</option>
          </select>
          <button
            onClick={handleBulkAction}
            disabled={!bulkAction}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white rounded text-sm font-semibold"
          >
            Apply
          </button>
          <button
            onClick={() => { setSelectedIds(new Set()); setBulkAction(''); }}
            className="text-gray-400 hover:text-white text-sm underline"
          >
            Clear selection
          </button>
        </div>
      )}

      {sortedTickets.length === 0 ? (
        <div className="text-center text-white mt-8">
          {showTrash ? 'Trash is empty' : searchQuery ? 'No tickets match your search' : 'No tickets for this year'}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full bg-gray-800 rounded-lg">
            <thead className="bg-gray-700">
              <tr>
                {!showTrash && (
                  <th className="px-3 py-3 text-white">
                    <input
                      type="checkbox"
                      checked={selectedIds.size === sortedTickets.length && sortedTickets.length > 0}
                      onChange={toggleSelectAll}
                      className="w-4 h-4"
                    />
                  </th>
                )}
                {([
                  ['ticket_date', 'Date', 'text-left'],
                  ['ticket_number', 'Ticket #', 'text-left'],
                  ['person', 'Person', 'text-left'],
                  ['crop', 'Crop', 'text-left'],
                  ['bushels', 'Bushels', 'text-right'],
                  ['delivery_location', 'Location', 'text-left'],
                  ['through', 'Through', 'text-left'],
                  ['truck', 'Truck', 'text-left'],
                  ['dockage', 'Dockage', 'text-right'],
                  ['status', 'Status', 'text-left'],
                ] as [SortField, string, string][]).map(([field, label, align]) => (
                  <th
                    key={field}
                    onClick={() => toggleSort(field)}
                    className={`px-4 py-3 ${align} text-white cursor-pointer hover:bg-gray-600 select-none`}
                  >
                    {label}{sortIndicator(field)}
                  </th>
                ))}
                <th className="px-4 py-3 text-left text-white">Contract</th>
                {showTrash && <th className="px-4 py-3 text-left text-white">Deleted</th>}
                <th className="px-4 py-3 text-center text-white">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedTickets.map((ticket) => {
                const isCorn = (ticket.crop || '').toLowerCase() === 'corn';
                const isSelected = selectedIds.has(ticket.id);
                const rowBgClass = showTrash
                  ? 'bg-red-900 bg-opacity-20'
                  : isSelected
                  ? 'bg-blue-900 bg-opacity-30'
                  : isCorn
                  ? 'bg-yellow-900 bg-opacity-20'
                  : 'bg-green-900 bg-opacity-20';
                const hoverClass = showTrash
                  ? 'hover:bg-red-900 hover:bg-opacity-30'
                  : isCorn
                  ? 'hover:bg-yellow-900 hover:bg-opacity-30'
                  : 'hover:bg-green-900 hover:bg-opacity-30';

                return (
                <React.Fragment key={ticket.id}>
                  <tr className={`border-t border-gray-700 ${rowBgClass} ${hoverClass}`}>
                    {!showTrash && (
                      <td className="px-3 py-3">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(ticket.id)}
                          className="w-4 h-4"
                        />
                      </td>
                    )}
                    <td className="px-4 py-3 text-white">
                      {new Date(ticket.ticket_date).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-white">
                      {ticket.ticket_number || '-'}
                      {ticket.duplicate_flag && (
                        <span className="ml-1 px-1.5 py-0.5 bg-orange-600 rounded text-xs font-semibold" title={`Duplicate group: ${ticket.duplicate_group}`}>DUP</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-white">{ticket.person}</td>
                    <td className="px-4 py-3 text-white font-semibold">{ticket.crop}</td>
                    <td className="px-4 py-3 text-right text-white">{ticket.bushels.toLocaleString()}</td>
                    <td className="px-4 py-3 text-white">{ticket.delivery_location}</td>
                    <td className="px-4 py-3 text-white">{ticket.through}</td>
                    <td className="px-4 py-3 text-white">{ticket.truck || '-'}</td>
                    <td className="px-4 py-3 text-right text-white">
                      {ticket.dockage ? `${ticket.dockage}%` : '-'}
                    </td>
                    <td className="px-4 py-3 text-white">
                      <span
                        className={`px-2 py-1 rounded text-xs font-semibold ${
                          ticket.status === 'approved' ? 'bg-green-600' :
                          ticket.status === 'rejected' ? 'bg-red-600' :
                          ticket.status === 'hold' ? 'bg-yellow-600' : 'bg-blue-600'
                        }`}
                      >
                        {ticket.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-white text-sm">
                      {assigningId === ticket.id ? (
                        <div className="flex flex-col gap-1">
                          <select
                            onChange={(e) => handleManualAssign(ticket.id, e.target.value)}
                            defaultValue={ticket.contract_id || ''}
                            className="w-full px-2 py-1 bg-gray-600 text-white rounded text-xs border border-gray-500"
                          >
                            <option value="">None (unassign)</option>
                            {assignableContracts.map(c => (
                              <option key={c.id} value={c.id}>
                                #{c.contract_number} — {c.owner} {c.crop} {c.through} ({getActualRemaining(c).toLocaleString()} remaining)
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={() => setAssigningId(null)}
                            className="px-2 py-0.5 bg-gray-600 hover:bg-gray-500 text-white rounded text-xs"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <span
                          onClick={() => !showTrash && setAssigningId(ticket.id)}
                          className={`cursor-pointer hover:underline ${ticket.contract_id ? 'text-emerald-400' : 'text-gray-500'}`}
                          title="Click to reassign"
                        >
                          {getContractLabel(ticket.contract_id)}
                        </span>
                      )}
                    </td>
                    {showTrash && (
                      <td className="px-4 py-3 text-white text-sm">
                        {ticket.deleted_at ? new Date(ticket.deleted_at).toLocaleDateString() : '-'}
                      </td>
                    )}
                    <td className="px-4 py-3 text-center">
                      {showTrash ? (
                        <div className="flex gap-2 justify-center">
                          <button onClick={() => handleRestore(ticket.id)} className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-sm">
                            Restore
                          </button>
                          <button onClick={() => handlePermanentDelete(ticket.id)} className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-sm">
                            Delete Forever
                          </button>
                        </div>
                      ) : (
                        <div className="flex gap-1 justify-center">
                          <button onClick={() => openEditModal(ticket)} className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs">
                            Edit
                          </button>
                          <button
                            onClick={() => handleRematch(ticket)}
                            disabled={rematching === ticket.id}
                            className="px-2 py-1 bg-yellow-600 hover:bg-yellow-700 disabled:bg-gray-600 text-white rounded text-xs"
                          >
                            {rematching === ticket.id ? '...' : 'Rematch'}
                          </button>
                          <button onClick={() => openEditSplits(ticket)} className="px-2 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-xs">
                            Edit Splits
                          </button>
                          <button onClick={() => setSplittingTicket(ticket)} className="px-2 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded text-xs">
                            Split
                          </button>
                          <button onClick={() => handleSoftDelete(ticket.id)} className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-xs">
                            Del
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                  {/* Inline splits row */}
                  {splits[ticket.id] && splits[ticket.id].length > 0 && (
                    <tr className={`border-t border-gray-600 ${rowBgClass}`}>
                      <td colSpan={showTrash ? 14 : 13} className="px-6 py-2">
                        <div className="flex flex-wrap items-center gap-3 text-xs">
                          <span className="text-gray-400 font-semibold">Splits:</span>
                          {splits[ticket.id].map((s, si) => {
                            const sc = contracts.find(c => c.id === s.contract_id);
                            return (
                              <span key={s.id} className="px-2 py-1 bg-gray-700 rounded text-gray-200">
                                #{sc?.contract_number || '?'} &mdash; {s.person} &mdash; {s.bushels.toLocaleString()} bu
                              </span>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit Ticket Modal */}
      {editModalTicket && editState && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-start mb-4">
              <h2 className="text-2xl font-bold text-white">Edit Ticket</h2>
              <button onClick={closeEditModal} className="px-3 py-1 bg-gray-600 hover:bg-gray-500 text-white rounded text-lg font-bold">X</button>
            </div>

            {editModalTicket.image_url && (
              <div className="mb-4">
                <img
                  src={editModalTicket.image_url}
                  alt="Ticket"
                  className="w-full max-h-48 object-contain rounded-lg cursor-pointer"
                  onClick={() => window.open(editModalTicket.image_url!, '_blank')}
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-4 mb-6">
              <div>
                <label className="block text-gray-400 text-xs mb-1">Date</label>
                <input type="date" value={editState.ticket_date} onChange={(e) => updateField('ticket_date', e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className="block text-gray-400 text-xs mb-1">Ticket #</label>
                <input type="text" value={editState.ticket_number} onChange={(e) => updateField('ticket_number', e.target.value)} placeholder="-" className={inputClass} />
              </div>
              <div>
                <label className="block text-gray-400 text-xs mb-1">Person</label>
                <select value={editState.person} onChange={(e) => updateField('person', e.target.value)} className={inputClass}>
                  <option value="">Select</option>
                  {PERSON_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-gray-400 text-xs mb-1">Crop</label>
                <select value={editState.crop} onChange={(e) => updateField('crop', e.target.value)} className={inputClass}>
                  <option value="">Select</option>
                  <option value="Corn">Corn</option>
                  <option value="Soybeans">Soybeans</option>
                </select>
              </div>
              <div>
                <label className="block text-gray-400 text-xs mb-1">Bushels</label>
                <input type="number" step="0.01" value={editState.bushels} onChange={(e) => updateField('bushels', e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className="block text-gray-400 text-xs mb-1">Location</label>
                <input type="text" value={editState.delivery_location} onChange={(e) => updateField('delivery_location', e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className="block text-gray-400 text-xs mb-1">Through</label>
                <select value={editState.through} onChange={(e) => updateField('through', e.target.value)} className={inputClass}>
                  <option value="">Select</option>
                  <option value="Akron">Akron</option>
                  <option value="RVC">RVC</option>
                  <option value="Cargill">Cargill</option>
                  <option value="ADM">ADM</option>
                </select>
              </div>
              <div>
                <label className="block text-gray-400 text-xs mb-1">Truck</label>
                <input type="text" value={editState.truck} onChange={(e) => updateField('truck', e.target.value)} placeholder="-" className={inputClass} />
              </div>
              <div>
                <label className="block text-gray-400 text-xs mb-1">Moisture %</label>
                <input type="number" step="0.1" value={editState.moisture_percent} onChange={(e) => updateField('moisture_percent', e.target.value)} placeholder="-" className={inputClass} />
              </div>
              <div>
                <label className="block text-gray-400 text-xs mb-1">Dockage %</label>
                <input type="number" step="0.01" value={editState.dockage} onChange={(e) => updateField('dockage', e.target.value)} placeholder="-" className={inputClass} />
              </div>
              <div>
                <label className="block text-gray-400 text-xs mb-1">Origin</label>
                <select value={editState.origin} onChange={(e) => updateField('origin', e.target.value)} className={inputClass}>
                  <option value="">Select origin</option>
                  {ORIGIN_LOCATIONS.map((loc) => <option key={loc} value={loc}>{loc}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-gray-400 text-xs mb-1">Notes</label>
                <input type="text" value={editState.notes} onChange={(e) => updateField('notes', e.target.value)} placeholder="-" className={inputClass} />
              </div>
            </div>

            <div className="flex gap-2">
              <button onClick={closeEditModal} className="flex-1 px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-lg">
                Cancel
              </button>
              <button onClick={saveEdit} disabled={saving} className="flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-600 text-white rounded-lg font-semibold">
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Split Ticket Modal */}
      {splittingTicket && (
        <SplitTicketModal
          ticket={splittingTicket}
          contracts={contracts}
          onClose={() => setSplittingTicket(null)}
          onSplitComplete={() => {
            setSplittingTicket(null);
            fetchTickets();
          }}
        />
      )}

      {/* Edit Splits Modal */}
      {editSplitsTicket && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-start mb-2">
              <h2 className="text-2xl font-bold text-white">Edit Splits</h2>
              <button
                onClick={() => { setEditSplitsTicket(null); setEditSplitsData([]); }}
                className="px-3 py-1 bg-gray-600 hover:bg-gray-500 text-white rounded text-lg font-bold"
              >
                X
              </button>
            </div>
            <p className="text-gray-400 mb-4 text-sm">
              {editSplitsTicket.person} &mdash; {editSplitsTicket.crop} &mdash; {editSplitsTicket.bushels.toLocaleString()} bu total
            </p>

            {editSplitsData.length === 0 ? (
              <div className="text-gray-400 mb-4 p-3 bg-gray-700 rounded text-sm">
                No splits yet. Click "+ Add Split" to create one.
              </div>
            ) : (
              <table className="w-full mb-4">
                <thead>
                  <tr className="text-gray-400 text-xs border-b border-gray-600">
                    <th className="text-left py-2 px-2">Contract</th>
                    <th className="text-left py-2 px-2">Person</th>
                    <th className="text-right py-2 px-2">Bushels</th>
                    <th className="text-center py-2 px-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {editSplitsData.map((split, idx) => (
                    <tr key={idx} className="border-b border-gray-700">
                      <td className="py-2 px-2">
                        <select
                          value={split.contract.id}
                          onChange={(e) => updateEditSplitContract(idx, e.target.value)}
                          className="w-full px-2 py-1.5 bg-gray-700 text-white rounded text-sm border border-gray-500"
                        >
                          {contracts
                            .filter(c => !c.is_spot_sale && getActualRemaining(c) > 0)
                            .map(c => (
                              <option key={c.id} value={c.id}>
                                #{c.contract_number} — {c.owner} {c.crop} via {c.through} ({getActualRemaining(c).toLocaleString()} rem)
                              </option>
                            ))}
                        </select>
                      </td>
                      <td className="py-2 px-2">
                        <select
                          value={split.person}
                          onChange={(e) => updateEditSplitPerson(idx, e.target.value)}
                          className="w-full px-2 py-1.5 bg-gray-700 text-white rounded text-sm border border-gray-500"
                        >
                          {PERSON_OPTIONS.map(p => (
                            <option key={p} value={p}>{p}</option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 px-2">
                        <input
                          type="number"
                          step="0.01"
                          value={split.bushels}
                          onChange={(e) => updateEditSplitBushels(idx, parseFloat(e.target.value) || 0)}
                          className="w-full px-2 py-1.5 bg-gray-700 text-white rounded text-sm text-right border border-gray-500"
                        />
                      </td>
                      <td className="py-2 px-2 text-center">
                        <button
                          onClick={() => removeEditSplit(idx)}
                          className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-xs"
                        >
                          X
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {editSplitsRemainder > 0 && (
              <div className="mb-4 p-3 bg-yellow-900 bg-opacity-30 rounded text-yellow-300 text-sm">
                {editSplitsRemainder.toLocaleString()} bu unassigned
              </div>
            )}

            <div className="flex flex-wrap gap-2 mb-4">
              <button
                onClick={addEditSplit}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold"
              >
                + Add Split
              </button>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => { setEditSplitsTicket(null); setEditSplitsData([]); }}
                className="flex-1 px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={saveEditSplits}
                disabled={editSplitsSaving}
                className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white rounded-lg font-semibold"
              >
                {editSplitsSaving ? 'Saving...' : 'Save Splits'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Tickets Modal (Manual + Batch) */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-lg p-6 max-w-6xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-2xl font-bold text-white">Add Tickets</h2>
              <div className="flex items-center gap-3">
                <span className="text-gray-400 text-sm">{addRows.length} row{addRows.length !== 1 ? 's' : ''}</span>
                <button
                  onClick={() => { setShowAddModal(false); setAddRows([emptyRow()]); }}
                  className="px-3 py-1 bg-gray-600 hover:bg-gray-500 text-white rounded text-lg font-bold"
                >
                  X
                </button>
              </div>
            </div>

            <p className="text-gray-400 text-sm mb-4">
              Tickets are saved as <span className="text-green-400 font-semibold">approved</span>. Fill rows and click Save All. Person, Crop, and Bushels are required. New rows copy Person/Crop/Through/Origin from the last row.
            </p>

            {/* Batch table */}
            <div className="overflow-x-auto mb-4">
              <table className="w-full text-sm">
                <thead className="bg-gray-700">
                  <tr>
                    <th className="px-2 py-2 text-left text-gray-300">Date</th>
                    <th className="px-2 py-2 text-left text-gray-300">Ticket #</th>
                    <th className="px-2 py-2 text-left text-gray-300">Person*</th>
                    <th className="px-2 py-2 text-left text-gray-300">Crop*</th>
                    <th className="px-2 py-2 text-right text-gray-300">Bushels*</th>
                    <th className="px-2 py-2 text-left text-gray-300">Location</th>
                    <th className="px-2 py-2 text-left text-gray-300">Through</th>
                    <th className="px-2 py-2 text-left text-gray-300">Truck</th>
                    <th className="px-2 py-2 text-left text-gray-300">Origin</th>
                    <th className="px-2 py-2 text-left text-gray-300">Notes</th>
                    <th className="px-2 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {addRows.map((row, idx) => (
                    <tr key={idx} className="border-t border-gray-700">
                      <td className="px-1 py-1">
                        <input type="date" value={row.ticket_date} onChange={(e) => updateAddRow(idx, 'ticket_date', e.target.value)}
                          className="w-full px-1 py-1 bg-gray-700 text-white rounded text-xs border border-gray-600" />
                      </td>
                      <td className="px-1 py-1">
                        <input type="text" value={row.ticket_number} onChange={(e) => updateAddRow(idx, 'ticket_number', e.target.value)}
                          placeholder="-" className="w-full px-1 py-1 bg-gray-700 text-white rounded text-xs border border-gray-600" />
                      </td>
                      <td className="px-1 py-1">
                        <select value={row.person} onChange={(e) => updateAddRow(idx, 'person', e.target.value)}
                          className="w-full px-1 py-1 bg-gray-700 text-white rounded text-xs border border-gray-600">
                          <option value="">--</option>
                          {PERSON_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                      </td>
                      <td className="px-1 py-1">
                        <select value={row.crop} onChange={(e) => updateAddRow(idx, 'crop', e.target.value)}
                          className="w-full px-1 py-1 bg-gray-700 text-white rounded text-xs border border-gray-600">
                          <option value="">--</option>
                          <option value="Corn">Corn</option>
                          <option value="Soybeans">Soybeans</option>
                        </select>
                      </td>
                      <td className="px-1 py-1">
                        <input type="number" step="0.01" value={row.bushels} onChange={(e) => updateAddRow(idx, 'bushels', e.target.value)}
                          placeholder="0" className="w-20 px-1 py-1 bg-gray-700 text-white rounded text-xs text-right border border-gray-600" />
                      </td>
                      <td className="px-1 py-1">
                        <input type="text" value={row.delivery_location} onChange={(e) => updateAddRow(idx, 'delivery_location', e.target.value)}
                          placeholder="-" className="w-full px-1 py-1 bg-gray-700 text-white rounded text-xs border border-gray-600" />
                      </td>
                      <td className="px-1 py-1">
                        <select value={row.through} onChange={(e) => updateAddRow(idx, 'through', e.target.value)}
                          className="w-full px-1 py-1 bg-gray-700 text-white rounded text-xs border border-gray-600">
                          <option value="">--</option>
                          <option value="Akron">Akron</option>
                          <option value="RVC">RVC</option>
                          <option value="Cargill">Cargill</option>
                          <option value="ADM">ADM</option>
                        </select>
                      </td>
                      <td className="px-1 py-1">
                        <input type="text" value={row.truck} onChange={(e) => updateAddRow(idx, 'truck', e.target.value)}
                          placeholder="-" className="w-16 px-1 py-1 bg-gray-700 text-white rounded text-xs border border-gray-600" />
                      </td>
                      <td className="px-1 py-1">
                        <select value={row.origin} onChange={(e) => updateAddRow(idx, 'origin', e.target.value)}
                          className="w-full px-1 py-1 bg-gray-700 text-white rounded text-xs border border-gray-600">
                          <option value="">--</option>
                          {ORIGIN_LOCATIONS.map(loc => <option key={loc} value={loc}>{loc}</option>)}
                        </select>
                      </td>
                      <td className="px-1 py-1">
                        <input type="text" value={row.notes} onChange={(e) => updateAddRow(idx, 'notes', e.target.value)}
                          placeholder="-" className="w-24 px-1 py-1 bg-gray-700 text-white rounded text-xs border border-gray-600" />
                      </td>
                      <td className="px-1 py-1 text-center">
                        {addRows.length > 1 && (
                          <button onClick={() => removeAddRow(idx)} className="px-1.5 py-0.5 bg-red-600 hover:bg-red-700 text-white rounded text-xs">X</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={addNewRow}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold"
              >
                + Add Row
              </button>
              <button
                onClick={() => { for (let i = 0; i < 5; i++) addNewRow(); }}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold"
              >
                + Add 5 Rows
              </button>
              <div className="flex-1" />
              <button
                onClick={() => { setShowAddModal(false); setAddRows([emptyRow()]); }}
                className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveNewTickets}
                disabled={addSaving}
                className="px-6 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white rounded-lg text-sm font-semibold"
              >
                {addSaving ? 'Saving...' : `Save ${addRows.filter(r => r.person && r.crop && r.bushels).length} Ticket(s)`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
