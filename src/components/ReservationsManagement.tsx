import { useRef, useState } from "react";
import { Reservation } from "@/services/reservationsService";
import { useCreateReservation, useUpdateReservationStatus } from "@/hooks/use-queries";
import { exportReservationsToPDF, exportReservationsToExcel } from "@/lib/export";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { Calendar, Clock, Users, Phone, CheckCircle, XCircle, FileDown } from "lucide-react";

interface ReservationsManagementProps {
  reservations: Reservation[];
  isLoading?: boolean;
}

export function ReservationsManagement({ reservations, isLoading }: ReservationsManagementProps) {
  const createReservation = useCreateReservation();
  const updateReservationStatus = useUpdateReservationStatus();

  const [dialogOpen, setDialogOpen] = useState(false);
  const today = new Date().toISOString().split('T')[0];
  const [filterDate, setFilterDate] = useState("");
  const [filterDayMonth, setFilterDayMonth] = useState("");
  const calendarRef = useRef<HTMLInputElement>(null);

  // El usuario teclea solo día/mes (dd/mm); el año es el actual.
  const handleDayMonthChange = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, 4);
    const formatted = digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
    setFilterDayMonth(formatted);

    if (digits.length === 4) {
      const dd = digits.slice(0, 2);
      const mm = digits.slice(2);
      const d = parseInt(dd, 10);
      const m = parseInt(mm, 10);
      if (d >= 1 && d <= 31 && m >= 1 && m <= 12) {
        setFilterDate(`${new Date().getFullYear()}-${mm}-${dd}`);
        return;
      }
    }
    setFilterDate("");
  };

  // El botón calendario permite elegir una fecha completa (incluido el año).
  const handleCalendarPick = (value: string) => {
    setFilterDate(value);
    setFilterDayMonth(value ? `${value.slice(8, 10)}/${value.slice(5, 7)}` : "");
  };
  const [formData, setFormData] = useState({
    customer_name: "",
    customer_phone: "",
    date: "",
    time: "",
    guests: "2",
    status: "confirmed" as const,
    notes: ""
  });
  const [updatingId, setUpdatingId] = useState<number | null>(null);

  const statusOptions = [
    { value: "confirmed", label: "Confirmada", color: "bg-green-500" },
    { value: "pending", label: "Pendiente", color: "bg-yellow-500" },
    { value: "cancelled", label: "Cancelada", color: "bg-red-500" },
    { value: "completed", label: "Completada", color: "bg-gray-500" }
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const reservationData = {
        customer_name: formData.customer_name,
        customer_phone: formData.customer_phone,
        date: formData.date,
        time: formData.time,
        guests: parseInt(formData.guests),
        status: formData.status,
        notes: formData.notes
      };

      await createReservation.mutateAsync(reservationData);

      toast({
        title: "Éxito",
        description: "Reserva creada correctamente"
      });

      setDialogOpen(false);
      resetForm();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "No se pudo crear la reserva";
      toast({
        title: "Error",
        description: message,
        variant: "destructive"
      });
    }
  };

  const handleUpdateReservationStatus = async (id: number, newStatus: Reservation['status']) => {
    try {
      if (updatingId === id) return;

      setUpdatingId(id);
      await updateReservationStatus.mutateAsync({ id, status: newStatus });

      toast({
        title: "Éxito",
        description: "Estado actualizado correctamente"
      });
    } catch (error: unknown) {
      toast({
        title: "Error",
        description: "No se pudo actualizar el estado",
        variant: "destructive"
      });
    } finally {
      setUpdatingId(null);
    }
  };

  const resetForm = () => {
    setFormData({
      customer_name: "",
      customer_phone: "",
      date: "",
      time: "",
      guests: "2",
      status: "confirmed" as const,
      notes: ""
    });
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'confirmed': return <CheckCircle className="h-4 w-4" />;
      case 'pending': return <Clock className="h-4 w-4" />;
      case 'cancelled': return <XCircle className="h-4 w-4" />;
      case 'completed': return <CheckCircle className="h-4 w-4" />;
      default: return null;
    }
  };

  // Filtrar y ordenar reservas:
  // - Si filterDate tiene valor, filtrar por esa fecha exacta
  // - Si filterDate está vacío, mostrar solo reservas de hoy en adelante (futuras)
  const filteredReservations = (reservations || [])
    .filter(reservation => {
      if (filterDate) {
        return reservation.date === filterDate;
      } else {
        return reservation.date >= today;
      }
    })
    .sort((a, b) => {
      const dateComparison = new Date(a.date).getTime() - new Date(b.date).getTime();
      if (dateComparison !== 0) return dateComparison;
      return (a.time || '00:00').localeCompare(b.time || '00:00');
    });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-32 mb-2" />
          <Skeleton className="h-4 w-48" />
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="p-3 md:p-6">
        <div className="flex justify-between items-center">
          <div>
            <CardTitle className="text-base md:text-lg">Reservas</CardTitle>
            <CardDescription className="text-xs md:text-sm">Administra las reservas</CardDescription>
          </div>
          <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => exportReservationsToPDF(reservations, 'Reporte de Reservas')}>
                <FileDown className="h-4 w-4 mr-1" />
                PDF
              </Button>
              <Button variant="outline" size="sm" onClick={() => exportReservationsToExcel(reservations, 'Reporte de Reservas')}>
                <FileDown className="h-4 w-4 mr-1" />
                CSV
              </Button>
            </div>
            <Dialog open={dialogOpen} onOpenChange={(open) => {
              setDialogOpen(open);
              if (!open) resetForm();
            }}>
              <DialogTrigger asChild>
                <Button>
                  Reservar Mesa
                </Button>
              </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Nueva Reserva</DialogTitle>
                <DialogDescription>
                  Registra una nueva reserva
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <Label htmlFor="customer_name">Nombre del Cliente</Label>
                  <Input
                    id="customer_name"
                    value={formData.customer_name}
                    onChange={(e) => setFormData({...formData, customer_name: e.target.value})}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="customer_phone">Teléfono</Label>
                  <Input
                    id="customer_phone"
                    type="tel"
                    value={formData.customer_phone}
                    onChange={(e) => setFormData({...formData, customer_phone: e.target.value})}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="date">Fecha</Label>
                    <Input
                      id="date"
                      type="date"
                      value={formData.date}
                      onChange={(e) => setFormData({...formData, date: e.target.value})}
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="time">Hora</Label>
                    <Input
                      id="time"
                      type="time"
                      value={formData.time}
                      onChange={(e) => setFormData({...formData, time: e.target.value})}
                      required
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="guests">Número de Personas</Label>
                    <Input
                      id="guests"
                      type="number"
                      min="1"
                      value={formData.guests}
                      onChange={(e) => setFormData({...formData, guests: e.target.value})}
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="notes">Notas</Label>
                    <Input
                      id="notes"
                      value={formData.notes || ''}
                      onChange={(e) => setFormData({...formData, notes: e.target.value})}
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                    Cancelar
                  </Button>
                  <Button type="submit">
                    Crear Reserva
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>
        <div className="flex items-center gap-2 mt-3">
          <Label htmlFor="filterDate" className="whitespace-nowrap">Buscar reservas por día:</Label>
          <Input
            id="filterDate"
            type="text"
            inputMode="numeric"
            placeholder="dd/mm"
            value={filterDayMonth}
            onChange={(e) => handleDayMonthChange(e.target.value)}
            className="w-[90px]"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => calendarRef.current?.showPicker?.()}
            aria-label="Elegir fecha del calendario"
          >
            <Calendar className="h-4 w-4" />
          </Button>
          <input
            ref={calendarRef}
            type="date"
            className="sr-only"
            tabIndex={-1}
            value={filterDate}
            onChange={(e) => handleCalendarPick(e.target.value)}
          />
        </div>
      </CardHeader>
      <CardContent className="p-3 pt-0 md:p-6 md:pt-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Hora</TableHead>
              <TableHead>Nombre</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Personas</TableHead>
              <TableHead>Teléfono</TableHead>
              <TableHead>Mesa</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredReservations.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground">
                  No hay reservas para la fecha seleccionada
                </TableCell>
              </TableRow>
            ) : (
              filteredReservations.map((reservation) => (
                <TableRow key={reservation.id}>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      {new Date(reservation.date).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      {reservation.time.substring(0, 5)}
                    </div>
                  </TableCell>
                  <TableCell className="font-medium">{reservation.customer_name}</TableCell>
                  <TableCell>
                    <Badge className={`${statusOptions.find(s => s.value === reservation.status)?.color}`}>
                      <span className="flex items-center gap-1">
                        {getStatusIcon(reservation.status)}
                        {statusOptions.find(s => s.value === reservation.status)?.label}
                      </span>
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      {reservation.guests}
                    </div>
                  </TableCell>
                  <TableCell>
                    {reservation.customer_phone && (
                      <div className="flex items-center gap-1">
                        <Phone className="h-4 w-4 text-muted-foreground" />
                        {reservation.customer_phone}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    {reservation.table_number || '-'}
                  </TableCell>
                  <TableCell className="text-right">
                    <Select
                      value={reservation.status}
                      onValueChange={(value: Reservation['status']) => handleUpdateReservationStatus(reservation.id, value)}
                    >
                      <SelectTrigger className="w-[140px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {statusOptions.map(option => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
