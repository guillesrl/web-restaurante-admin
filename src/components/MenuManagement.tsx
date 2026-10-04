import { useState, useCallback, memo } from "react";
import { MenuService, MenuItem } from "@/services/menuService";
import { useMenu, useCreateMenu, useUpdateMenu, useDeleteMenu, useUpdateMenuStock } from "@/hooks/use-queries";
import { exportMenuToPDF, exportMenuToExcel } from "@/lib/export";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { Plus, Trash2, Pencil, X, FileDown, AlertTriangle } from "lucide-react";
import { STOCK_LOW_THRESHOLD } from "@/hooks/use-stock-alerts";

function MenuManagementComponent({ readOnly = false }: { readOnly?: boolean }) {
  const { data: menuItems = [], isLoading } = useMenu();
  const createMenu = useCreateMenu();
  const updateMenu = useUpdateMenu();
  const deleteMenu = useDeleteMenu();
  const updateStock = useUpdateMenuStock();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    price: "",
    category: "entrantes",
    description: "",
    stock: ""
  });

  const getCategoryBadge = (category: string | null) => {
    const normalizedCategory = category ? String(category).toLowerCase().trim() : '';
    
    const categoryStyles = {
      entrantes: 'bg-green-100 text-green-800 border-green-200',
      pescados: 'bg-blue-100 text-blue-800 border-blue-200',
      pastas: 'bg-yellow-100 text-yellow-800 border-yellow-200',
      carnes: 'bg-red-100 text-red-800 border-red-200',
      postres: 'bg-purple-100 text-purple-800 border-purple-200',
      default: 'bg-gray-100 text-gray-800 border-gray-200'
    };

    const categoryMap: Record<string, {key: keyof typeof categoryStyles, label: string}> = {
      entrante: { key: 'entrantes', label: 'Entrantes' },
      pescado: { key: 'pescados', label: 'Pescados' },
      pasta: { key: 'pastas', label: 'Pastas' },
      carne: { key: 'carnes', label: 'Carnes' },
      postre: { key: 'postres', label: 'Postres' },
      default: { key: 'default', label: 'Default' }
    };
    
    const matchedCategory = categoryMap[normalizedCategory] || { key: 'default', label: 'Otro' };
    const { key, label } = matchedCategory;

    return (
      <Badge variant="outline" className={`${categoryStyles[key]} capitalize`}>
        {label}
      </Badge>
    );
  };

  const handleEdit = (item: MenuItem) => {
    setEditingItem(item);
    setFormData({
      name: item.name || "",
      price: item.price?.toString() || "",
      category: item.category || "entrantes",
      description: item.description || "",
      stock: item.stock?.toString() || ""
    });
    setDialogOpen(true);
  };

  const handleStockUpdate = async (id: number, newStock: string) => {
    try {
      const stockNumber = parseInt(newStock);
      await updateStock.mutateAsync({ id, stock: stockNumber });
      toast({
        title: "Éxito",
        description: "Stock actualizado correctamente",
        variant: "default"
      });
    } catch (error: unknown) {
      toast({
        title: "Error",
        description: "No se pudo actualizar el stock",
        variant: "destructive"
      });
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm("¿Estás seguro de eliminar este item?")) return;
    
    try {
      await deleteMenu.mutateAsync(id);
      toast({
        title: "Éxito",
        description: "Item eliminado correctamente",
        variant: "default"
      });
    } catch (error) {
      console.error('Error deleting item:', error);
      toast({
        title: "Error",
        description: "No se pudo eliminar el item",
        variant: "destructive"
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      const itemData = {
        name: formData.name,
        price: parseFloat(formData.price),
        category: formData.category,
        description: formData.description,
        stock: parseInt(formData.stock),
        available: true
      };

      if (editingItem) {
        await updateMenu.mutateAsync({ id: editingItem.id, item: itemData });
        toast({
          title: "Éxito",
          description: "Item actualizado correctamente"
        });
      } else {
        await createMenu.mutateAsync(itemData as Omit<MenuItem, 'id' | 'created_at' | 'updated_at'>);
        toast({
          title: "Éxito",
          description: "Item creado correctamente"
        });
      }

      setDialogOpen(false);
      resetForm();
    } catch (error) {
      console.error('Error saving item:', error);
      toast({
        title: "Error",
        description: error.message || "No se pudo guardar el item",
        variant: "destructive"
      });
    }
  };


  const resetForm = () => {
    setFormData({
      name: "",
      price: "",
      category: "entrantes",
      description: "",
      stock: ""
    });
    setEditingItem(null);
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
            <CardTitle className="text-base md:text-lg">Menú</CardTitle>
            <CardDescription className="text-xs md:text-sm">
              {readOnly ? 'Consulta de platos, descripciones y existencias' : 'Administra los platos'}
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => exportMenuToPDF(menuItems, 'Reporte del Menú')}>
              <FileDown className="h-4 w-4 mr-2" />
              PDF
            </Button>
            <Button variant="outline" size="sm" onClick={() => exportMenuToExcel(menuItems, 'Reporte del Menú')}>
              <FileDown className="h-4 w-4 mr-2" />
              CSV
            </Button>
          </div>
          {!readOnly && <Dialog open={dialogOpen} onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) resetForm();
          }}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 md:mr-2" />
                <span className="hidden md:inline">Añadir Plato</span>
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editingItem ? "Editar Item" : "Nuevo Item"}</DialogTitle>
                <DialogDescription>
                  {editingItem ? "Modifica los datos del platillo" : "Añade un nuevo platillo al menú"}
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <Label htmlFor="name">Nombre</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({...formData, name: e.target.value})}
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="price">Precio ($)</Label>
                    <Input
                      id="price"
                      type="text"
                      value={formData.price}
                      onChange={(e) => setFormData({...formData, price: e.target.value})}
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="category">Categoría</Label>
                    <Select
                      value={formData.category}
                      onValueChange={(value) => setFormData({...formData, category: value})}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecciona una categoría" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="entrantes">Entrantes</SelectItem>
                        <SelectItem value="pescados">Pescados</SelectItem>
                        <SelectItem value="pastas">Pastas</SelectItem>
                        <SelectItem value="carnes">Carnes</SelectItem>
                        <SelectItem value="postres">Postres</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label htmlFor="description">Descripción</Label>
                  <Textarea
                    id="description"
                    value={formData.description}
                    onChange={(e) => setFormData({...formData, description: e.target.value})}
                    rows={3}
                  />
                </div>
                <div>
                  <Label htmlFor="stock">Stock</Label>
                  <Input
                    id="stock"
                    type="number"
                    min="0"
                    value={formData.stock}
                    onChange={(e) => setFormData({...formData, stock: e.target.value})}
                    placeholder="Cantidad en stock"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                    Cancelar
                  </Button>
                  <Button type="submit">
                    {editingItem ? "Actualizar" : "Crear"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>}
        </div>
      </CardHeader>
      <CardContent className="p-3 pt-0 md:p-6 md:pt-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead className="w-[7.5rem] px-2 whitespace-nowrap">Categoría</TableHead>
              <TableHead className="w-20 px-2 whitespace-nowrap">Precio</TableHead>
              <TableHead className="w-16 px-2 whitespace-nowrap">Stock</TableHead>
              <TableHead>Descripción</TableHead>
              {!readOnly && <TableHead className="text-right">Acciones</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {menuItems.length === 0 ? (
              <TableRow>
              <TableCell colSpan={readOnly ? 5 : 6} className="text-center text-muted-foreground">
                  No hay platos en el menú
                </TableCell>
              </TableRow>
            ) : (
              menuItems.map((item) => {
                const categoryBadge = getCategoryBadge(item.category);
                return (
                  <TableRow key={item.id}>
                    <TableCell className={`font-medium ${item.stock < 1 ? 'text-red-500' : ''}`}>
                      <div className="flex items-center gap-2">
                        {item.name}
                        {item.stock < 1 && (
                          <X className="h-4 w-4 text-red-500" />
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="w-[7.5rem] px-2 whitespace-nowrap">
                      {categoryBadge}
                    </TableCell>
                    <TableCell className="w-20 px-2 whitespace-nowrap">${item.price}</TableCell>
                    <TableCell className="w-16 px-2">
                      {readOnly ? (
                        <div className="flex items-center gap-1 font-medium" aria-label={`Stock: ${item.stock ?? 0}`}>
                          <span>{item.stock ?? 0}</span>
                          {item.stock < STOCK_LOW_THRESHOLD && (
                            <AlertTriangle className={`h-4 w-4 ${item.stock < 1 ? 'text-red-500' : 'text-amber-500'}`} />
                          )}
                        </div>
                      ) : (
                        <Input
                          type="number"
                          value={item.stock ?? ""}
                          onChange={(e) => handleStockUpdate(item.id!, e.target.value)}
                          className="w-14 h-8 px-1 text-center"
                        />
                      )}
                    </TableCell>
                    <TableCell className={readOnly ? 'max-w-[300px] whitespace-normal' : 'max-w-[300px] truncate'}>{item.description}</TableCell>
                    {!readOnly && <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleEdit(item)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(item.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export const MenuManagement = memo(MenuManagementComponent);
