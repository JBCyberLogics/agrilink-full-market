import { useState } from 'react'
import { Users, Sprout, Receipt, Wallet, TrendingUp } from 'lucide-react'
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar, PieChart, Pie, Cell, Legend } from 'recharts'
import { users, payments, orders, products } from '../../../services/api/endpoints'
import { useLoad, toSeries, countBy, signupsByMonth, money } from '../adminData'
import { Panel, KPI, LoadState, CHART_COLORS } from '../ui'

// Replace line 9 with:
const tip = {
  contentStyle: {
    borderRadius: 12,
    border: '1px solid rgba(125,125,125,.2)',
    backgroundColor: 'rgb(var(--ag-paper))',
    color: 'rgb(var(--ag-ink))',
    fontSize: 12,
  },
}

const axis = { tick: { fontSize: 11, fill: 'currentColor' }, stroke: 'currentColor', strokeOpacity: 0.2 }
const settle = (p) => p.then((v) => v).catch(() => null)

export default function AdminOverview() {
  const [days, setDays] = useState('7day')
  const base = useLoad(async () => {
    const [overview, userList, orderList, productList, ratio] = await Promise.all([
      settle(users.dashboardOverview()), settle(users.allUsers({ limit: 500 })), settle(orders.list({ limit: 500 })),
      settle(products.list({ limit: 500 })), settle(payments.incomeRatio()),
    ])
    if (!overview && !userList && !orderList && !productList) throw { error: 'The server could not be reached. Start the backend and try again.' }
    return { overview: overview || {}, users: userList?.data || [], orders: orderList?.data || [], products: productList?.data || [], ratio }
  })
  const trend = useLoad(() => payments.incomeRatioByDays({ days }).then(toSeries), [days])

  const d = base.data
  const ov = d?.overview || {}
  const pick = (...k) => k.map((x) => ov[x]).find((v) => v !== undefined)
  const roleMix = d ? countBy(d.users, (u) => (u.role === 'seller' ? 'Farmers' : u.role === 'customer' ? 'Buyers' : 'Staff')) : []
  const orderStatus = d ? countBy(d.orders, (o) => o.status || o.deliveryStage || o.paymentStatus) : []
  const catMix = d ? countBy(d.products, (p) => p.category?.name || p.categoryName || p.cropType).slice(0, 8) : []
  const growth = d ? signupsByMonth(d.users) : []
  const monthly = toSeries(d?.ratio)
  const gmv = d?.orders.reduce((s, o) => s + (Number(o.totalPrice ?? o.totalAmount ?? o.amount) || 0), 0)

  return (
    <LoadState loading={base.loading} error={base.error} onRetry={base.reload}>
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KPI icon={Users} label="Total users" value={(pick('totalUsers', 'totalUser', 'users') ?? d?.users.length)?.toLocaleString()} hint={`${roleMix.find((r) => r.label === 'Farmers')?.value ?? 0} farmers · ${roleMix.find((r) => r.label === 'Buyers')?.value ?? 0} buyers`} />
          <KPI icon={Sprout} tone="amber" label="Produce listings" value={(pick('totalProducts', 'totalProduct') ?? d?.products.length)?.toLocaleString()} hint={`${catMix.length} categories active`} />
          <KPI icon={Receipt} tone="sky" label="Orders" value={(pick('totalOrders', 'totalOrder') ?? d?.orders.length)?.toLocaleString()} hint={d?.orders.length ? `Avg ${money(gmv / d.orders.length)}` : 'No orders yet'} />
          <KPI icon={Wallet} tone="rose" label="Platform volume" value={money(pick('totalEarning', 'totalRevenue', 'totalIncome') ?? gmv)} hint="Across recorded orders" />
        </div>

        <Panel title="Platform income" subtitle="Settled payments over time"
          action={<div className="flex rounded-lg border border-farmer-line p-0.5 text-xs">{['7day', '30day', '90day'].map((k) => (
            <button key={k} onClick={() => setDays(k)} className={`rounded-md px-2.5 py-1 font-semibold ${days === k ? 'bg-farmer-primary text-white' : 'text-farmer-muted'}`}>{k.replace('day', 'd')}</button>))}</div>}>
          <LoadState loading={trend.loading} error={trend.error} empty={!trend.data?.length} onRetry={trend.reload}>
            <div className="h-72 text-farmer-muted">
              <ResponsiveContainer>
                <AreaChart data={trend.data || []}>
                  <defs><linearGradient id="g1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2EB877" stopOpacity={0.45} /><stop offset="100%" stopColor="#2EB877" stopOpacity={0} /></linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.15} />
                  <XAxis dataKey="label" {...axis} /><YAxis {...axis} width={60} />
                  <Tooltip {...tip} formatter={(v) => money(v)} />
                  <Area type="monotone" dataKey="value" name="Income" stroke="#2EB877" strokeWidth={2.5} fill="url(#g1)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </LoadState>
        </Panel>

        <div className="grid gap-5 lg:grid-cols-3">
          <Panel title="User growth" subtitle="New farmers vs buyers per month" className="lg:col-span-2">
            <LoadState empty={!growth.length}>
              <div className="h-64 text-farmer-muted"><ResponsiveContainer>
                <BarChart data={growth}><CartesianGrid strokeDasharray="3 3" strokeOpacity={0.15} /><XAxis dataKey="label" {...axis} /><YAxis {...axis} allowDecimals={false} /><Tooltip {...tip} /><Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="Farmers" stackId="a" fill="#2EB877" radius={[0, 0, 0, 0]} /><Bar dataKey="Buyers" stackId="a" fill="#f59e0b" radius={[6, 6, 0, 0]} /></BarChart>
              </ResponsiveContainer></div>
            </LoadState>
          </Panel>
          <Panel title="Community mix" subtitle="Accounts by role">
            <LoadState empty={!roleMix.length}>
              <div className="h-64"><ResponsiveContainer><PieChart>
                <Pie data={roleMix} dataKey="value" nameKey="label" innerRadius={55} outerRadius={85} paddingAngle={3}>{roleMix.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % 6]} />)}</Pie>
                <Tooltip {...tip} /><Legend wrapperStyle={{ fontSize: 12 }} /></PieChart></ResponsiveContainer></div>
            </LoadState>
          </Panel>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title="Produce by category" subtitle="Top listing categories">
            <LoadState empty={!catMix.length}>
              <div className="h-64 text-farmer-muted"><ResponsiveContainer>
                <BarChart data={catMix} layout="vertical" margin={{ left: 20 }}><XAxis type="number" {...axis} allowDecimals={false} /><YAxis type="category" dataKey="label" {...axis} width={90} /><Tooltip {...tip} />
                  <Bar dataKey="value" name="Listings" radius={[0, 6, 6, 0]}>{catMix.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % 6]} />)}</Bar></BarChart>
              </ResponsiveContainer></div>
            </LoadState>
          </Panel>
          <Panel title="Order pipeline" subtitle="Orders by current status">
            <LoadState empty={!orderStatus.length}>
              <div className="h-64"><ResponsiveContainer><PieChart>
                <Pie data={orderStatus} dataKey="value" nameKey="label" outerRadius={90}>{orderStatus.map((_, i) => <Cell key={i} fill={CHART_COLORS[(i + 2) % 6]} />)}</Pie>
                <Tooltip {...tip} /><Legend wrapperStyle={{ fontSize: 12 }} /></PieChart></ResponsiveContainer></div>
            </LoadState>
          </Panel>
        </div>

        {monthly.length > 0 && (
          <Panel title="Income ratio" subtitle="Platform earnings by period" action={<TrendingUp size={16} className="text-farmer-brand" />}>
            <div className="h-56 text-farmer-muted"><ResponsiveContainer><BarChart data={monthly}><XAxis dataKey="label" {...axis} /><YAxis {...axis} width={60} /><Tooltip {...tip} formatter={(v) => money(v)} /><Bar dataKey="value" name="Income" fill="#0ea5e9" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></div>
          </Panel>
        )}
      </div>
    </LoadState>
  )
}
