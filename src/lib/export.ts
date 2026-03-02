import * as XLSX from 'xlsx';

// Export layout: Date | Person | Elevator/Through | Delivery Point | Bushels

interface ExportTicket {
  ticket_date: string;
  person: string;
  through: string;
  delivery_location: string;
  bushels: number;
}

const HEADERS = ['Date', 'Person', 'Elevator', 'Delivery Point', 'Bushels'];
const COL_WIDTHS = [12, 14, 14, 20, 12];

export const exportTicketsToExcel = (
  tickets: ExportTicket[],
  filename: string = 'grain_tickets.xlsx'
) => {
  const rows = tickets.map((t) => [
    t.ticket_date || '',
    t.person || '',
    t.through || '',
    t.delivery_location || '',
    t.bushels,
  ]);

  const wsData = [HEADERS, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws['!cols'] = COL_WIDTHS.map((w) => ({ wch: w }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Tickets');
  XLSX.writeFile(wb, filename);
};
