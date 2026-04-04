import * as XLSX from 'xlsx';

// Export layout: Crop | Person | Date | Location | Through | Ticket Number | Bushels

interface ExportTicket {
  ticket_date: string;
  ticket_number: string | null;
  person: string;
  crop: string;
  through: string;
  delivery_location: string;
  bushels: number;
}

const HEADERS = ['Crop', 'Person', 'Date', 'Location', 'Through', 'Ticket Number', 'Bushels'];
const COL_WIDTHS = [12, 14, 12, 20, 14, 14, 12];

export const exportTicketsToExcel = (
  tickets: ExportTicket[],
  filename: string = 'grain_tickets.xlsx'
) => {
  const rows = tickets.map((t) => [
    t.crop || '',
    t.person || '',
    t.ticket_date || '',
    t.delivery_location || '',
    t.through || '',
    t.ticket_number || '',
    t.bushels,
  ]);

  const wsData = [HEADERS, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws['!cols'] = COL_WIDTHS.map((w) => ({ wch: w }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Tickets');
  XLSX.writeFile(wb, filename);
};

// Hauling Log export: Date | Owner | Crop | Destination | Ticket # | Bushels | Contract #
// Matches Excel Hauling Log sheet format for direct paste

interface HaulingLogTicket {
  ticket_date: string;
  ticket_number: string | null;
  person: string;
  crop: string;
  delivery_location: string;
  bushels: number;
  contract_number: string;
}

const HAULING_HEADERS = ['Date', 'Owner', 'Crop', 'Destination', 'Ticket #', 'Bushels', 'Contract #'];
const HAULING_COL_WIDTHS = [12, 14, 12, 20, 14, 12, 16];

export const exportHaulingLog = (
  tickets: HaulingLogTicket[],
  filename: string = 'hauling_log.xlsx'
) => {
  const rows = tickets.map((t) => [
    t.ticket_date || '',
    t.person || '',
    t.crop || '',
    t.delivery_location || '',
    t.ticket_number || '',
    t.bushels,
    t.contract_number || '',
  ]);

  const wsData = [HAULING_HEADERS, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws['!cols'] = HAULING_COL_WIDTHS.map((w) => ({ wch: w }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Hauling Log');
  XLSX.writeFile(wb, filename);
};
