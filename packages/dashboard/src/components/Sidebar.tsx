import { NavLink } from 'react-router-dom'

const navItems = [
  { to: '/', icon: '📊', label: 'Live Runs' },
  { to: '/trace', icon: '🔍', label: 'Trace Replay' },
  { to: '/budget', icon: '💰', label: 'Budget' },
  { to: '/health', icon: '🏥', label: 'Agent Health' },
  { to: '/compliance', icon: '⚖️', label: 'Compliance' },
]

export function Sidebar() {
  return (
    <nav
      className="flex flex-col w-56 shrink-0 border-r"
      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--bg-border)' }}
    >
      <div className="p-4 border-b" style={{ borderColor: 'var(--bg-border)' }}>
        <span className="text-xl font-bold" style={{ color: 'var(--accent-primary)', fontFamily: 'var(--font-mono)' }}>
          fuze
        </span>
      </div>
      <div className="flex flex-col gap-1 p-2 flex-1">
        {navItems.map(({ to, icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                isActive
                  ? 'text-white font-medium'
                  : 'hover:bg-white/5'
              }`
            }
            style={({ isActive }) => isActive ? { backgroundColor: 'var(--accent-primary)', color: 'white' } : { color: 'var(--text-secondary)' }}
          >
            <span>{icon}</span>
            <span>{label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
