import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

interface SpendPoint { date: string; spend: number }

export function SpendChart({ data }: { data: SpendPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
        <XAxis dataKey="date" tick={{ fill: '#8888aa', fontSize: 10 }} />
        <YAxis tick={{ fill: '#8888aa', fontSize: 10 }} tickFormatter={(v: number) => `$${v.toFixed(2)}`} />
        <Tooltip
          contentStyle={{ backgroundColor: '#1a1a2e', border: '1px solid #222240', color: '#fff' }}
          formatter={(v: number) => [`$${v.toFixed(4)}`, 'Spend']}
        />
        <Bar dataKey="spend" fill="#ff5544" radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
