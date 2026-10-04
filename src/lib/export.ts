import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { Order } from '@/services/ordersService';
import { Reservation } from '@/services/reservationsService';
import { MenuItem } from '@/services/menuService';
import { formatCurrency, parseNumber } from '@/lib/utils';

export function exportOrdersToPDF(orders: Order[], title: string) {
  const doc = new jsPDF();
  doc.setFontSize(16);
  doc.text(title, 14, 20);
  doc.setFontSize(10);
  doc.text(`Generado: ${new Date().toLocaleString('es-ES')}`, 14, 28);

  const totalSales = orders.reduce((sum, o) => sum + parseNumber(o.total), 0);
  doc.text(`Total ventas: ${formatCurrency(totalSales)}`, 14, 36);

  autoTable(doc, {
    startY: 42,
    head: [['Cliente', 'Teléfono', 'Items', 'Total', 'Estado', 'Fecha', 'Hora']],
    body: orders.map(o => [
      o.customer_name,
      o.customer_phone || '-',
      Array.isArray(o.items) ? o.items.map(i => `${i.quantity}x ${i.name}`).join(', ') : '-',
      formatCurrency(o.total),
      o.status,
      o.created_at ? new Date(o.created_at).toLocaleDateString('es-ES') : '-',
      o.time || '-'
    ]),
  });

  doc.save(`${title.toLowerCase().replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}.pdf`);
}

export function exportOrdersToExcel(orders: Order[], title: string) {
  const data = orders.map(o => ({
    Cliente: o.customer_name,
    Teléfono: o.customer_phone || '-',
    Items: Array.isArray(o.items) ? o.items.map(i => `${i.quantity}x ${i.name}`).join(', ') : '-',
    Total: typeof o.total === 'number' ? o.total : parseFloat(o.total || '0'),
    Estado: o.status,
    Fecha: o.created_at ? new Date(o.created_at).toLocaleDateString('es-ES') : '-',
    Hora: o.time || '-'
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Pedidos');
  XLSX.writeFile(wb, `${title.toLowerCase().replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}.xlsx`);
}

export function exportReservationsToPDF(reservations: Reservation[], title: string) {
  const doc = new jsPDF();
  doc.setFontSize(16);
  doc.text(title, 14, 20);
  doc.setFontSize(10);
  doc.text(`Generado: ${new Date().toLocaleString('es-ES')}`, 14, 28);

  autoTable(doc, {
    startY: 36,
    head: [['Cliente', 'Teléfono', 'Fecha', 'Hora', 'Personas', 'Mesa', 'Estado']],
    body: reservations.map(r => [
      r.customer_name,
      r.customer_phone,
      new Date(r.date).toLocaleDateString('es-ES'),
      r.time.substring(0, 5),
      r.guests,
      r.table_number || '-',
      r.status
    ]),
  });

  doc.save(`${title.toLowerCase().replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}.pdf`);
}

export function exportReservationsToExcel(reservations: Reservation[], title: string) {
  const data = reservations.map(r => ({
    Cliente: r.customer_name,
    Teléfono: r.customer_phone,
    Fecha: new Date(r.date).toLocaleDateString('es-ES'),
    Hora: r.time.substring(0, 5),
    Personas: r.guests,
    Mesa: r.table_number || '-',
    Estado: r.status
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Reservas');
  XLSX.writeFile(wb, `${title.toLowerCase().replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}.xlsx`);
}

export function exportMenuToPDF(menuItems: MenuItem[], title: string) {
  const doc = new jsPDF();
  doc.setFontSize(16);
  doc.text(title, 14, 20);
  doc.setFontSize(10);
  doc.text(`Generado: ${new Date().toLocaleString('es-ES')}`, 14, 28);

  autoTable(doc, {
    startY: 36,
    head: [['Nombre', 'Categoría', 'Precio', 'Stock', 'Disponible']],
    body: menuItems.map(m => [
      m.name,
      m.category,
      `$${m.price}`,
      m.stock,
      m.available ? 'Sí' : 'No'
    ]),
  });

  doc.save(`${title.toLowerCase().replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}.pdf`);
}

export function exportMenuToExcel(menuItems: MenuItem[], title: string) {
  const data = menuItems.map(m => ({
    Nombre: m.name,
    Categoría: m.category,
    Precio: m.price,
    Stock: m.stock,
    Disponible: m.available ? 'Sí' : 'No'
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Menú');
  XLSX.writeFile(wb, `${title.toLowerCase().replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}.xlsx`);
}
