import { useState, Suspense, lazy, useMemo, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ChefHat, ShoppingCart, Calendar, TrendingUp, Moon, Sun, BarChart3, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getToken, clearToken } from "@/lib/auth";
import { useTheme } from "next-themes";
import { useIsMobile } from "@/hooks/use-mobile";
import { useMenu, useOrders, useReservations } from "@/hooks/use-queries";
import { ChunkErrorBoundary } from "@/components/ChunkErrorBoundary";
import { StockAlertsPanel } from "@/components/StockAlertsPanel";
import { cargarDatosDashboard, calcularEstadisticas, DatosDashboard } from "@/lib/rutinas";
import { formatCurrency } from "@/lib/utils";

const MenuManagement = lazy(() => import("@/components/MenuManagement").then(m => ({ default: m.MenuManagement })));
const OrdersManagement = lazy(() => import("@/components/OrdersManagement").then(m => ({ default: m.OrdersManagement })));
const ReservationsManagement = lazy(() => import("@/components/ReservationsManagement").then(m => ({ default: m.ReservationsManagement })));
const AnalyticsPage = lazy(() => import("./dashboard/analytics"));

const TabLoader = () => (
  <div className="space-y-4 p-4">
    <Skeleton className="h-10 w-full" />
    <Skeleton className="h-48 w-full" />
    <Skeleton className="h-48 w-full" />
  </div>
);

const Index = () => {
  const [activeTab, setActiveTab] = useState("reservations");
  const { theme, setTheme } = useTheme();
  const isMobile = useIsMobile();

  const { data: menuItems = [] } = useMenu();
  const { data: orders = [], refetch: refetchOrders } = useOrders();
  const { data: allReservations = [], isLoading: isLoadingReservations } = useReservations();

  const [datosFiltrados, setDatosFiltrados] = useState<DatosDashboard>({
    pedidosHoy: [],
    pedidosMes: [],
    pedidosActivos: [],
    reservasHoy: [],
    reservasMes: [],
  });

  useEffect(() => {
    cargarDatosDashboard().then(setDatosFiltrados);
  }, [orders, allReservations]);

  const stats = useMemo(
    () => calcularEstadisticas(menuItems, datosFiltrados),
    [menuItems, datosFiltrados]
  );

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b bg-card flex-shrink-0">
        <div className="container mx-auto px-4 py-3 md:py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <ChefHat className="h-8 w-8 text-primary" />
              <div>
                <h1 className="text-lg sm:text-2xl md:text-3xl font-bold leading-tight whitespace-nowrap text-foreground">Restaurant Dashboard</h1>
                <p className="text-sm md:text-base text-muted-foreground">Sistema de gestión para restaurantes</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              >
                <Sun className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
                <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
                <span className="sr-only">Toggle theme</span>
              </Button>
              {getToken() && (
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => { clearToken(); window.location.reload(); }}
                  title="Cerrar sesión"
                >
                  <LogOut className="h-5 w-5" />
                  <span className="sr-only">Cerrar sesión</span>
                </Button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 overflow-auto">
        {/* Alertas de stock bajo */}
        <div className="pt-3 md:pt-6">
          <StockAlertsPanel />
        </div>

        {/* Stats Overview - 2x2 en móvil, 4 columnas en desktop */}
        <div className="py-3 md:py-6">
          <div className="grid grid-cols-2 gap-2 px-4 md:grid-cols-4 md:gap-4 md:container md:mx-auto">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 pb-1 md:p-6 md:pb-2">
                <CardTitle className="text-xs md:text-sm font-medium">Ventas Hoy</CardTitle>
                <TrendingUp className="h-3 w-3 md:h-4 md:w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent className="p-3 pt-0 md:p-6 md:pt-0">
                <div className="text-lg md:text-2xl font-bold">{formatCurrency(stats.totalSales)}</div>
                <p className="text-xs text-muted-foreground leading-tight">Pedidos del día</p>
                <div className="mt-1.5 pt-1.5 border-t md:mt-2 md:pt-2">
                  <div className="text-xs md:text-sm font-semibold text-muted-foreground">Mes: {formatCurrency(stats.monthlySales)}</div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 pb-1 md:p-6 md:pb-2">
                <CardTitle className="text-xs md:text-sm font-medium">Pedidos Activos</CardTitle>
                <ShoppingCart className="h-3 w-3 md:h-4 md:w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent className="p-3 pt-0 md:p-6 md:pt-0">
                <div className="text-lg md:text-2xl font-bold">{stats.activeOrders}</div>
                <p className="text-xs text-muted-foreground leading-tight">Pendientes de entrega</p>
                <div className="mt-1.5 pt-1.5 border-t md:mt-2 md:pt-2">
                  <div className="text-xs md:text-sm font-semibold text-muted-foreground">Mes: {stats.monthlyOrders} pedidos</div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 pb-1 md:p-6 md:pb-2">
                <CardTitle className="text-xs md:text-sm font-medium">Reservas Hoy</CardTitle>
                <Calendar className="h-3 w-3 md:h-4 md:w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent className="p-3 pt-0 md:p-6 md:pt-0">
                <div className="text-lg md:text-2xl font-bold">{stats.todayReservations}</div>
                <p className="text-xs text-muted-foreground leading-tight">Reservas confirmadas</p>
                <div className="mt-1.5 pt-1.5 border-t md:mt-2 md:pt-2">
                  <div className="text-xs md:text-sm font-semibold text-muted-foreground">Mes: {stats.monthlyReservations} reservas</div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 pb-1 md:p-6 md:pb-2">
                <CardTitle className="text-xs md:text-sm font-medium">Platos del Menú</CardTitle>
                <ChefHat className="h-3 w-3 md:h-4 md:w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent className="p-3 pt-0 md:p-6 md:pt-0">
                <div className="text-lg md:text-2xl font-bold">{stats.menuItems}</div>
                <p className="text-xs text-muted-foreground leading-tight">Platos disponibles</p>
                <div className="mt-1.5 pt-1.5 border-t md:mt-2 md:pt-2">
                  <div className="text-xs md:text-sm font-semibold text-muted-foreground">No disponibles: {stats.unavailableItems}</div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Tabs Content */}
        <div className={`${isMobile ? 'flex-1' : 'container mx-auto px-4'} ${isMobile ? '' : 'pb-8'}`}>
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4 h-full">
            {/* Desktop: Tabs normal arriba */}
            {!isMobile && (
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="menu" className="flex items-center gap-2">
                  <ChefHat className="h-4 w-4" />
                  Menú
                </TabsTrigger>
                <TabsTrigger value="orders" className="flex items-center gap-2">
                  <ShoppingCart className="h-4 w-4" />
                  Pedidos
                </TabsTrigger>
                <TabsTrigger value="reservations" className="flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  Reservas
                </TabsTrigger>
                <TabsTrigger value="analytics" className="flex items-center gap-2">
                  <BarChart3 className="h-4 w-4" />
                  Analíticas
                </TabsTrigger>
              </TabsList>
            )}

            {/* Mobile: Tabs en la parte inferior */}
            {isMobile && (
              <div className="flex-1 flex flex-col pb-16">
                <div className="flex-1 overflow-auto">
                  <TabsContent value="menu" className="mt-0 h-full">
                    <ChunkErrorBoundary>
                      <Suspense fallback={<TabLoader />}><MenuManagement /></Suspense>
                    </ChunkErrorBoundary>
                  </TabsContent>

                  <TabsContent value="orders" className="mt-0 h-full">
                    <ChunkErrorBoundary>
                      <Suspense fallback={<TabLoader />}><OrdersManagement /></Suspense>
                    </ChunkErrorBoundary>
                  </TabsContent>

                  <TabsContent value="reservations" className="mt-0 h-full">
                    <ChunkErrorBoundary>
                      <Suspense fallback={<TabLoader />}>
                        <ReservationsManagement
                          reservations={allReservations}
                          isLoading={isLoadingReservations}
                        />
                      </Suspense>
                    </ChunkErrorBoundary>
                  </TabsContent>

                  <TabsContent value="analytics" className="mt-0 h-full">
                    <ChunkErrorBoundary>
                      <Suspense fallback={<TabLoader />}><AnalyticsPage /></Suspense>
                    </ChunkErrorBoundary>
                  </TabsContent>
                </div>

                {/* Barra de navegación inferior fija para móviles */}
                <div className="fixed bottom-0 left-0 right-0 bg-card border-t border-border z-50">
                  <TabsList className="grid w-full grid-cols-4 h-16 rounded-none border-0 bg-transparent">
                    <TabsTrigger
                      value="menu"
                      className="flex flex-col items-center gap-1 h-full data-[state=active]:bg-primary/10 data-[state=active]:text-primary"
                    >
                      <ChefHat className="h-5 w-5" />
                      <span className="text-xs">Menú</span>
                    </TabsTrigger>
                    <TabsTrigger
                      value="orders"
                      className="flex flex-col items-center gap-1 h-full data-[state=active]:bg-primary/10 data-[state=active]:text-primary"
                    >
                      <ShoppingCart className="h-5 w-5" />
                      <span className="text-xs">Pedidos</span>
                    </TabsTrigger>
                    <TabsTrigger
                      value="reservations"
                      className="flex flex-col items-center gap-1 h-full data-[state=active]:bg-primary/10 data-[state=active]:text-primary"
                    >
                      <Calendar className="h-5 w-5" />
                      <span className="text-xs">Reservas</span>
                    </TabsTrigger>
                    <TabsTrigger
                      value="analytics"
                      className="flex flex-col items-center gap-1 h-full data-[state=active]:bg-primary/10 data-[state=active]:text-primary"
                    >
                      <BarChart3 className="h-5 w-5" />
                      <span className="text-xs">Analíticas</span>
                    </TabsTrigger>
                  </TabsList>
                </div>
              </div>
            )}

            {/* Desktop: Tabs content normal */}
            {!isMobile && (
              <>
                <TabsContent value="menu" className="space-y-4">
                  <ChunkErrorBoundary>
                    <Suspense fallback={<TabLoader />}><MenuManagement /></Suspense>
                  </ChunkErrorBoundary>
                </TabsContent>

                <TabsContent value="orders" className="space-y-4">
                  <ChunkErrorBoundary>
                    <Suspense fallback={<TabLoader />}><OrdersManagement /></Suspense>
                  </ChunkErrorBoundary>
                </TabsContent>

                <TabsContent value="reservations" className="space-y-4">
                  <ChunkErrorBoundary>
                    <Suspense fallback={<TabLoader />}>
                      <ReservationsManagement
                        reservations={allReservations}
                        isLoading={isLoadingReservations}
                      />
                    </Suspense>
                  </ChunkErrorBoundary>
                </TabsContent>

                <TabsContent value="analytics" className="space-y-4">
                  <ChunkErrorBoundary>
                    <Suspense fallback={<TabLoader />}><AnalyticsPage /></Suspense>
                  </ChunkErrorBoundary>
                </TabsContent>
              </>
            )}
          </Tabs>
        </div>
      </div>
    </div>
  );
};

export default Index;
