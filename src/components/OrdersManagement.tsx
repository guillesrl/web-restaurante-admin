import { useState, memo, Fragment } from "react";
import { OrdersService, Order, OrderItem } from "@/services/ordersService";
import { useOrders, useCreateOrder, useUpdateOrderStatus, useMenu } from "@/hooks/use-queries";
import { exportOrdersToPDF, exportOrdersToExcel } from "@/lib/export";
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
import { Plus, Clock, CheckCircle, XCircle, AlertCircle, FileDown, ChevronRight, ChevronDown } from "lucide-react";
import { formatCurrency, parseNumber } from "@/lib/utils";
import { filterOrdersByPeriod, type OrderPeriod } from "@/lib/orderFilters";


function OrdersManagementComponent() {
  const { data: orders = [], isLoading } = useOrders();
  const { data: menuItems = [] } = useMenu();
  const createOrder = useCreateOrder();
  const updateOrderStatus = useUpdateOrderStatus();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [formData, setFormData] = useState({
    customer_name: "",
    customer_phone: "",
    customer_email: "",
    items: [] as Array<{menu_item_id: number, quantity: number}>,
    total: "",
    status: "pending" as const,
    notes: ""
  });
  const [selectedItem, setSelectedItem] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [orderPeriod, setOrderPeriod] = useState<OrderPeriod>('today');

  const statusOptions = [
    { value: "pending", label: "Pendiente", color: "bg-yellow-500" },
    { value: "preparing", label: "Preparando", color: "bg-blue-500" },
    { value: "ready", label: "Listo", color: "bg-green-500" },
    { value: "delivered", label: "Entregado", color: "bg-gray-500" },
    { value: "cancelled", label: "Cancelado", color: "bg-red-500" }
  ];

  const visibleOrders = filterOrdersByPeriod(orders, orderPeriod);

  const formatDateForDisplay = (dateString: string | null): string => {
    if (!dateString) return '--/--/----';

    try {
      // Si ya está en formato YYYY-MM-DD, convertir a DD/MM/YYYY
      if (dateString.match(/^\d{4}-\d{2}-\d{2}$/)) {
        const [year, month, day] = dateString.split('-');
        return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year}`;
      }

      // Si es formato ISO completo (YYYY-MM-DDTHH:MM:SS), extraer solo la fecha
      if (dateString.includes('T')) {
        const datePart = dateString.split('T')[0];
        if (datePart.match(/^\d{4}-\d{2}-\d{2}$/)) {
          const [year, month, day] = datePart.split('-');
          return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year}`;
        }
      }

      // Si es otro formato, intentar parsear como fecha
      const date = new Date(dateString);
      return isNaN(date.getTime()) ? '--/--/----' : date.toLocaleDateString('es-ES', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      });
    } catch {
      return '--/--/----';
    }
  };

  const formatTimeForDisplay = (timeString: string | null): string => {
    // El campo time ya viene en formato HH:MM como "16:07"
    return timeString || '--:--';
  };

  const processOrderData = (orderData: Record<string, unknown>): Order => {
    // Procesar items si vienen como string
    let processedItems: OrderItem[] = [];
    if (Array.isArray(orderData.items)) {
      processedItems = orderData.items;
    } else if (typeof orderData.items === 'string') {
      try {
        processedItems = JSON.parse(orderData.items);
      } catch {
        processedItems = [];
      }
    }

    return {
      id: orderData.id,
      customer_name: orderData.customer_name || orderData.nombre || '',
      customer_phone: orderData.customer_phone || orderData.telefono || '',
      customer_email: orderData.customer_email || '',
      items: processedItems,
      total: typeof orderData.total === 'number' ? orderData.total : parseNumber(orderData.total),
      status: orderData.status || 'pending',
      notes: orderData.notes || '',
      created_at: orderData.created_at || null,
      scheduled_for: orderData.scheduled_for || null,
      display_date: orderData.display_date || null,
      time: orderData.time || null,
      order_datetime: orderData.order_datetime || null,
      updated_at: orderData.updated_at || null
    };
  };

  const handleAddItem = () => {
    if (!selectedItem || !quantity) return;

    const menuItem = menuItems.find(item => item.id.toString() === selectedItem);
    if (!menuItem) return;

    const newItem: OrderItem = {
      id: menuItem.id,
      name: menuItem.name,
      price: menuItem.price,
      quantity: parseInt(quantity)
    };

    setFormData({
      ...formData,
      items: [...formData.items, newItem]
    });
    setSelectedItem("");
    setQuantity("1");
  };

  const removeItem = (index: number) => {
    setFormData({
      ...formData,
      items: formData.items.filter((_, i) => i !== index)
    });
  };

  const calculateTotal = () => {
    return formData.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (formData.items.length === 0) {
      toast({
        title: "Error",
        description: "Añade al menos un item a la orden",
        variant: "destructive"
      });
      return;
    }

    try {
      const orderData = {
        customer_name: formData.customer_name,
        customer_phone: formData.customer_phone,
        customer_email: formData.customer_email,
        items: formData.items,
        total: calculateTotal(),
        status: 'pending' as const,
        notes: ''
      };

      await createOrder.mutateAsync(orderData);
      
      toast({
        title: "Éxito",
        description: "Orden creada correctamente"
      });

      setDialogOpen(false);
      resetForm();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "No se pudo crear la orden";
      toast({
        title: "Error",
        description: message,
        variant: "destructive"
      });
    }
  };

  const handleUpdateOrderStatus = async (orderId: number, newStatus: Order['status']) => {
    try {
      await updateOrderStatus.mutateAsync({ id: orderId, status: newStatus });
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
    }
  };

  const resetForm = () => {
    setFormData({
      customer_name: "",
      customer_phone: "",
      customer_email: "",
      items: [],
      total: "",
      status: "pending",
      notes: ""
    });
    setSelectedItem("");
    setQuantity("1");
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending': return <Clock className="h-4 w-4" />;
      case 'preparing': return <AlertCircle className="h-4 w-4" />;
      case 'ready': return <CheckCircle className="h-4 w-4" />;
      case 'delivered': return <CheckCircle className="h-4 w-4" />;
      case 'cancelled': return <XCircle className="h-4 w-4" />;
      default: return <Clock className="h-4 w-4" />;
    }
  };

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
            <CardTitle className="text-base md:text-lg">Pedidos</CardTitle>
            <CardDescription className="text-xs md:text-sm">Administra los pedidos</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => exportOrdersToPDF(visibleOrders, 'Reporte de Pedidos')}>
              <FileDown className="h-4 w-4 mr-2" />
              PDF
            </Button>
            <Button variant="outline" size="sm" onClick={() => exportOrdersToExcel(visibleOrders, 'Reporte de Pedidos')}>
              <FileDown className="h-4 w-4 mr-2" />
              Excel
            </Button>
          </div>
          <Dialog open={dialogOpen} onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) resetForm();
          }}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 md:mr-2" />
                <span className="hidden md:inline">Nuevo Pedido</span>
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Nuevo Pedido</DialogTitle>
                <DialogDescription>
                  Crea un nuevo pedido de delivery
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
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
                      value={formData.customer_phone}
                      onChange={(e) => setFormData({...formData, customer_phone: e.target.value})}
                      required
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="customer_email">Email</Label>
                  <Input
                    id="customer_email"
                    type="email"
                    value={formData.customer_email}
                    onChange={(e) => setFormData({...formData, customer_email: e.target.value})}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Añadir Items</Label>
                  <div className="flex gap-2">
                    <Select value={selectedItem} onValueChange={setSelectedItem}>
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder="Selecciona un platillo" />
                      </SelectTrigger>
                      <SelectContent>
                        {menuItems.map(item => (
                          <SelectItem key={item.id} value={item.id.toString()}>
                            {item.name} - ${item.price}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      type="number"
                      min="1"
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value)}
                      className="w-20"
                      placeholder="Cant."
                    />
                    <Button type="button" onClick={handleAddItem}>
                      Añadir
                    </Button>
                  </div>
                </div>

                {formData.items.length > 0 && (
                  <div className="space-y-2">
                    <Label>Items del Pedido</Label>
                    <div className="border rounded-lg p-2">
                      {formData.items.map((item, index) => (
                        <div key={index} className="flex justify-between items-center py-1">
                          <span>{item.quantity}x {item.name}</span>
                          <div className="flex items-center gap-2">
                            <span>{formatCurrency(item.price * item.quantity)}</span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => removeItem(index)}
                            >
                              Eliminar
                            </Button>
                          </div>
                        </div>
                      ))}
                      <div className="border-t pt-2 mt-2 font-bold">
                        Total: {formatCurrency(calculateTotal())}
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                    Cancelar
                  </Button>
                  <Button type="submit">
                    Crear Pedido
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent className="p-3 pt-0 md:p-6 md:pt-0">
        <div className="mb-4 flex flex-wrap gap-2" aria-label="Filtrar pedidos por período">
          <Button size="sm" variant={orderPeriod === 'today' ? 'default' : 'outline'} onClick={() => setOrderPeriod('today')}>
            Hoy
          </Button>
          <Button size="sm" variant={orderPeriod === 'week' ? 'default' : 'outline'} onClick={() => setOrderPeriod('week')}>
            Semana
          </Button>
          <Button size="sm" variant={orderPeriod === 'all' ? 'default' : 'outline'} onClick={() => setOrderPeriod('all')}>
            Todos
          </Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8"></TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Teléfono</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Fecha</TableHead>
              <TableHead>Hora</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleOrders.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  No hay pedidos en el período seleccionado
                </TableCell>
              </TableRow>
            ) : (
              visibleOrders.map((order) => {
                const isExpanded = expandedId === order.id;
                return (
                <Fragment key={order.id}>
                <TableRow
                  className="cursor-pointer"
                  onClick={() => setExpandedId(isExpanded ? null : order.id)}
                >
                  <TableCell className="text-muted-foreground">
                    {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </TableCell>
                  <TableCell className="font-medium">{order.customer_name}</TableCell>
                  <TableCell>{order.customer_phone}</TableCell>
                  <TableCell>
                    <Badge className={`${statusOptions.find(s => s.value === order.status)?.color || 'bg-gray-500'}`}>
                      <span className="flex items-center gap-1">
                        {getStatusIcon(order.status || 'pending')}
                        {statusOptions.find(s => s.value === order.status)?.label || 'Pendiente'}
                      </span>
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {formatDateForDisplay(order.display_date || order.scheduled_for || order.created_at)}
                  </TableCell>
                  <TableCell>
                    {formatTimeForDisplay(order.time)}
                  </TableCell>
                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                    <Select
                      value={order.status}
                      onValueChange={(value: Order['status']) => handleUpdateOrderStatus(order.id, value)}
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
                {isExpanded && (
                  <TableRow>
                    <TableCell colSpan={7} className="bg-muted/30">
                      <div className="space-y-1 py-1">
                        {Array.isArray(order.items) && order.items.length > 0 ? (
                          order.items.map((item: OrderItem, idx: number) => (
                            <div key={idx} className="flex justify-between text-sm max-w-sm">
                              <span>{item.quantity}x {item.name}</span>
                              <span className="text-muted-foreground">{formatCurrency(parseNumber(item.price) * item.quantity)}</span>
                            </div>
                          ))
                        ) : (
                          <div className="text-sm text-muted-foreground">Items no disponibles</div>
                        )}
                        <div className="flex justify-between text-sm font-bold border-t pt-1 mt-1 max-w-sm">
                          <span>Total</span>
                          <span>{formatCurrency(order.total)}</span>
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
                </Fragment>
                );
              })
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export const OrdersManagement = memo(OrdersManagementComponent);
