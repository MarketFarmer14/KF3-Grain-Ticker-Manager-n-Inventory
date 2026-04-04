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
