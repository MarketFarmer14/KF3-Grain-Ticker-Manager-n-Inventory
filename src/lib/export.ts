import * as XLSX from 'xlsx';

// Updated to match your exact Excel layout:
// Date | Owner | Destination | Ticket # | Bushels | Crop | Contract #

interface ExportTicket {
  ticket_date: string;
  person: string;
  delivery_location: string;
  ticket_number: string | null;
  bushels: number;
  crop: string;
  contract_number: string | null;
}

const HEADERS = ['Date', 'Owner', 'Destination', 'Ticket #', 'Bushels', 'Crop', 'Contract #'];
const COL_WIDTHS = [12, 14, 16, 12, 10, 12, 12];

export const exportTicketsToExcel = (
  tickets: ExportTicket[],
  filename: string = 'grain_tickets.xlsx'
) => {
  // Map to exact column order: Date, Owner, Destination, Ticket #, Bushels, Crop, Contract #
  const rows = tickets.map((t) => [
    t.ticket_date || '',
    t.person || '',
    t.delivery_location || '',
    t.ticket_number || '',
    t.bushels,
    t.crop || '',
    t.contract_number || '',
  ]);

  const wsData = [HEADERS, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws['!cols'] = COL_WIDTHS.map((w) => ({ wch: w }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Tickets');
  XLSX.writeFile(wb, filename);
};
