import { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Order } from "@/services/ordersService";
import { DateRange, inRange } from "@/lib/dateRange";

interface DishCount {
  name: string;
  quantity: number;
}

export function TopDishesChart({ orders, range }: { orders: Order[]; range: DateRange }) {
  const data = useMemo(() => {
    const counts: Record<string, number> = {};
    orders
      .filter((order) => order.status !== 'cancelled' && inRange(order.created_at, range))
      .forEach((order) => {
        (order.items || []).forEach((item) => {
          counts[item.name] = (counts[item.name] || 0) + item.quantity;
        });
      });

    return Object.entries(counts)
      .map(([name, quantity]) => ({ name, quantity }))
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5);
  }, [orders, range]);

  if (data.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-8">
        Sin pedidos con items registrados aún
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 16, left: 8, bottom: 4 }}
      >
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis type="number" allowDecimals={false} />
        <YAxis type="category" dataKey="name" width={145} tick={{ fontSize: 11 }} />
        <Tooltip formatter={(value: number) => [value, "Unidades"]} />
        <Bar
          dataKey="quantity"
          fill="#8b5cf6"
          radius={[0, 4, 4, 0]}
          name="Unidades vendidas"
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
