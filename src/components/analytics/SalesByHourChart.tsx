import { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { DateRange, toISODate } from '@/lib/dateRange';
import { Order } from '@/services/ordersService';
import { formatCurrency, parseNumber } from '@/lib/utils';

// Definimos el tipo de dato para ventas por día
export interface SalesData {
  date: string;
  sales: number;
}

const COLOR_VENTAS = '#10b981';

const tooltipStyle = {
  borderRadius: 8,
  border: '1px solid hsl(var(--border))',
  fontSize: 12,
  boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
};

const SalesByDayChart: React.FC<{ orders: Order[]; range: DateRange }> = ({ orders, range }) => {
  const chartData = useMemo(() => {
    const buckets: Record<string, SalesData> = {};
    const dates: string[] = [];
    const current = new Date(range.from.getFullYear(), range.from.getMonth(), range.from.getDate());
    const last = new Date(range.to.getFullYear(), range.to.getMonth(), range.to.getDate());

    while (current <= last) {
      const date = toISODate(current);
      buckets[date] = { date, sales: 0 };
      dates.push(date);
      current.setDate(current.getDate() + 1);
    }

    orders
      .filter((order) => order.status !== 'cancelled' && order.created_at)
      .forEach((order) => {
        const date = toISODate(new Date(order.created_at!));
        if (buckets[date]) buckets[date].sales += parseNumber(order.total);
      });

    return dates.map((date) => {
      const item = buckets[date];
      const localDate = new Date(`${date}T12:00:00`);
      return { ...item, day: `${localDate.getDate()}/${localDate.getMonth() + 1}` };
    });
  }, [orders, range]);

  if (chartData.every(d => !d.sales)) {
    return <div className="text-center text-sm text-muted-foreground py-8">Sin ventas en el periodo</div>;
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="gradVentas" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={COLOR_VENTAS} stopOpacity={0.3} />
            <stop offset="100%" stopColor={COLOR_VENTAS} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
        <XAxis dataKey="day" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={16} />
        <YAxis
          tick={{ fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={44}
          tickFormatter={(value) => `${value} €`}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          labelFormatter={(value) => `Día ${value}`}
          formatter={(value: number) => [formatCurrency(value), 'Ventas']}
        />
        <Area
          type="monotone"
          dataKey="sales"
          stroke={COLOR_VENTAS}
          strokeWidth={2}
          fill="url(#gradVentas)"
          activeDot={{ r: 6 }}
          dot={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
};

export default SalesByDayChart;
