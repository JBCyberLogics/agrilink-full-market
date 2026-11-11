import AdminLogin from './AdminLogin'
import { LayoutDashboard, Users, Store, Sprout, DollarSign, LifeBuoy, ArrowLeft, LogOut, ShieldCheck } from 'lucide-react'
import ThemeToggle from '../../components/ui/ThemeToggle'

export const ADMIN_NAV = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'users', label: 'Users', icon: Users },
  { id: 'farms', label: 'Farms', icon: Store },
  { id: 'products', label: 'Products', icon: Sprout },
  { id: 'payouts', label: 'Payouts', icon: DollarSign },
  { id: 'support', label: 'Support', icon: LifeBuoy },
]

export default function AdminShell({ onAuth, user, page, onNavigate, onSignOut, onBackToShop, children }) {
  // 1. Unauthenticated or non-admin → private admin login
  if (!user || user.role !== 'Admin') {
    return (
      <AdminLogin
        onAuth={onAuth}
        onBackToShop={onBackToShop}
        notice={user ? `You are signed in as a ${user.role} (${user.email}). Sign in with an administrator account.` : ''}
      />
    )
  }

  // 2. Admin authenticated view (responsive to light & dark theme)
  return (
    <div className="agri-admin-shell min-h-[calc(100vh-72px)] bg-farmer-page text-farmer-ink flex flex-col md:flex-row transition-colors">
      {/* Sidebar */}
      <aside className="w-full md:w-64 border-b md:border-b-0 md:border-r border-farmer-line bg-paper p-4 flex flex-col justify-between shrink-0 transition-colors">
        <div>
          <div className="px-3 py-2 mb-4 border-b border-farmer-line pb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-farmer-primary text-white">
                <ShieldCheck size={18} />
              </span>
              <div>
                <p className="font-display font-bold text-sm text-farmer-ink">AgriLink Admin</p>
                <p className="text-[11px] text-farmer-muted">Control Center</p>
              </div>
            </div>
            <ThemeToggle className="h-8 w-8" size={16} />
          </div>

          <nav className="flex flex-row md:flex-col gap-1 overflow-x-auto pb-2 md:pb-0">
            {ADMIN_NAV.map((item) => {
              const active = (page ?? 'overview') === item.id
              const Icon = item.icon
              return (
                <button
                  key={item.id}
                  onClick={() => onNavigate(`admin/${item.id}`)}
                  aria-current={active ? 'page' : undefined}
                  className={`flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-xs font-medium transition shrink-0 ${
                    active
                      ? 'bg-farmer-primary text-white shadow-sm'
                      : 'text-farmer-muted hover:bg-farmer-surface hover:text-farmer-ink'
                  }`}
                >
                  <Icon size={16} />
                  <span>{item.label}</span>
                </button>
              )
            })}
          </nav>
        </div>

        {/* Bottom Actions */}
        <div className="pt-4 border-t border-farmer-line mt-4 flex flex-col gap-1.5">
          <button
            onClick={onBackToShop}
            className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-farmer-muted hover:text-farmer-ink rounded-lg hover:bg-farmer-surface transition"
          >
            <ArrowLeft size={14} />
            <span>Marketplace</span>
          </button>
          <button
            onClick={onSignOut}
            className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-rose-500 hover:text-rose-600 rounded-lg hover:bg-rose-500/10 transition"
          >
            <LogOut size={14} />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="agri-admin-content flex-1 min-w-0 p-4 md:p-8 overflow-y-auto">
        {children}
      </div>
    </div>
  )
}
