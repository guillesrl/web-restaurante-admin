import { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { Order } from "@/services/ordersService";
import { DateRange, inRange } from "@/lib/dateRange";

const STATUS_COLORS: Record<string, string> = {
  pending: "#eab308",
  preparing: "#3b82f6",
  ready: "#22c55e",
  delivered: "#6b7280",
  cancelled: "#ef4444",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Pendiente",
  preparing: "Preparando",
  ready: "Listo",
  delivered: "Entregado",
  cancelled: "Cancelado",
};

interface StatusCount {
  status: string;
  label: string;
  count: number;
}

export function OrdersByStatusChart({ orders, range }: { orders: Order[]; range: DateRange }) {
  const data = useMemo<StatusCount[]>(() => {
    const counts: Record<string, number> = {};
    orders
      .filter((order) => inRange(order.created_at, range))
      .forEach((order) => {
        const status = order.status || 'pending';
        counts[status] = (counts[status] || 0) + 1;
      });

    return Object.entries(counts).map(([status, count]) => ({
      status,
      label: STATUS_LABELS[status] || status,
      count,
    }));
  }, [orders, range]);

  if (data.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-8">
        Sin datos de pedidos aún
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="label" />
        <YAxis allowDecimals={false} />
        <Tooltip formatter={(value: number) => [value, "Pedidos"]} />
        <Bar dataKey="count" name="Pedidos" radius={[4, 4, 0, 0]}>
          {data.map((entry) => (
            <Cell
              key={entry.status}
              fill={STATUS_COLORS[entry.status] || "#6b7280"}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
