import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export function Layout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { logout } = useAuth();
  const [reviewCount, setReviewCount] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // Smart year default: 2025 until September 1, then 2026
  const getDefaultYear = () => {
    const now = new Date();
    const currentCalendarYear = now.getFullYear();
    const month = now.getMonth();
    if (month < 8) {
      return (currentCalendarYear - 1).toString();
    } else {
      return currentCalendarYear.toString();
    }
  };

  const [cropYear, setCropYear] = useState(() => {
    const stored = localStorage.getItem('grain_ticket_year');
    return stored || getDefaultYear();
  });

  useEffect(() => {
    if (!localStorage.getItem('grain_ticket_year')) {
      const defaultYear = getDefaultYear();
      localStorage.setItem('grain_ticket_year', defaultYear);
      setCropYear(defaultYear);
    }
    fetchReviewCount();
  }, []);

  // Close mobile sidebar on route change
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  const fetchReviewCount = async () => {
    const { count } = await supabase
      .from('tickets')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'needs_review');
    setReviewCount(count || 0);
  };

  const handleYearChange = (year: string) => {
    setCropYear(year);
    localStorage.setItem('grain_ticket_year', year);
    setRefreshKey(prev => prev + 1);
    const currentPath = location.pathname;
    navigate(currentPath + '?refresh=' + Date.now(), { replace: true });
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const sidebarWidth = collapsed ? 'w-16' : 'w-64';

  return (
    <div className="min-h-screen bg-gray-900 text-white flex">
      {/* Mobile hamburger */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="fixed top-3 left-3 z-50 lg:hidden bg-gray-800 p-2 rounded-lg shadow-lg"
        aria-label="Toggle menu"
      >
        <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          {sidebarOpen ? (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          )}
        </svg>
      </button>

      {/* Sidebar — fixed on all sizes, collapsible on desktop */}
      <div className={`
        fixed inset-y-0 left-0 z-40
        ${sidebarOpen ? 'w-64 translate-x-0' : '-translate-x-full'}
        lg:translate-x-0 ${sidebarWidth}
        bg-gray-800 flex flex-col
        transition-all duration-300 ease-in-out
        overflow-hidden
      `}>
        {/* Header */}
        <div className={`p-4 ${collapsed ? 'px-2' : ''}`}>
          <div className="flex items-center gap-2 mb-4">
            <div className="w-10 h-10 bg-green-600 rounded-lg flex items-center justify-center text-2xl flex-shrink-0">
              🌾
            </div>
            {!collapsed && <h1 className="text-lg font-bold whitespace-nowrap">Grain Tickets</h1>}
          </div>

          {/* Crop Year Selector */}
          {!collapsed ? (
            <div className="mb-2">
              <label className="block text-xs font-medium mb-1 text-gray-400">Crop Year</label>
              <select
                value={cropYear}
                onChange={(e) => handleYearChange(e.target.value)}
                className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg border border-gray-600 focus:border-green-500 focus:outline-none text-sm"
              >
                <option value="2024">2024</option>
                <option value="2025">2025</option>
                <option value="2026">2026</option>
                <option value="2027">2027</option>
                <option value="2028">2028</option>
              </select>
            </div>
          ) : (
            <div className="mb-2 text-center">
              <span className="text-xs text-gray-400 font-bold">{cropYear}</span>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className={`flex-1 space-y-1 ${collapsed ? 'px-1' : 'px-3'} overflow-y-auto`}>
          <NavItem to="/upload" icon="📤" label="Upload" active={location.pathname === '/upload'} collapsed={collapsed} />
          <NavItem to="/review" icon="✍️" label="Review" badge={reviewCount} active={location.pathname === '/review'} collapsed={collapsed} />
          <NavItem to="/tickets" icon="🎫" label="Tickets" active={location.pathname === '/tickets'} collapsed={collapsed} />
          <NavItem to="/contracts" icon="📋" label="Contracts" active={location.pathname === '/contracts'} collapsed={collapsed} />
          <NavItem to="/haul-board" icon="🚜" label="Haul Board" active={location.pathname === '/haul-board'} collapsed={collapsed} />
          <NavItem to="/inventory" icon="📊" label="Inventory" active={location.pathname === '/inventory'} collapsed={collapsed} />
          <NavItem to="/origins" icon="🏗️" label="Origins" active={location.pathname === '/origins'} collapsed={collapsed} />
        </nav>

        {/* Bottom: collapse toggle + logout */}
        <div className={`p-3 ${collapsed ? 'px-1' : ''} space-y-2`}>
          {/* Collapse toggle — desktop only */}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="hidden lg:flex w-full items-center justify-center px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm text-gray-300"
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7M19 19l-7-7 7-7" />
              </svg>
            )}
            {!collapsed && <span className="ml-2">Collapse</span>}
          </button>

          <button
            onClick={handleLogout}
            className={`w-full flex items-center justify-center gap-2 px-3 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-sm font-medium ${collapsed ? 'px-1' : ''}`}
          >
            {collapsed ? '🚪' : 'Logout'}
          </button>
        </div>
      </div>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main content — offset by sidebar width */}
      <div
        key={refreshKey}
        className={`flex-1 overflow-auto transition-all duration-300 ${collapsed ? 'lg:ml-16' : 'lg:ml-64'} ml-0`}
      >
        {/* Mobile top spacer for hamburger */}
        <div className="h-14 lg:hidden" />
        {children}
      </div>
    </div>
  );
}

function NavItem({
  to,
  icon,
  label,
  badge,
  active,
  collapsed,
}: {
  to: string;
  icon: string;
  label: string;
  badge?: number;
  active?: boolean;
  collapsed?: boolean;
}) {
  const navigate = useNavigate();

  return (
    <button
      onClick={() => navigate(to)}
      title={collapsed ? label : undefined}
      className={`w-full flex items-center ${collapsed ? 'justify-center relative' : ''} gap-3 px-3 py-2.5 rounded-lg transition-colors ${
        active ? 'bg-green-600 text-white' : 'text-gray-300 hover:bg-gray-700'
      }`}
    >
      <span className="text-lg flex-shrink-0">{icon}</span>
      {!collapsed && <span className="flex-1 text-left font-medium text-sm">{label}</span>}
      {!collapsed && badge !== undefined && badge > 0 && (
        <span className="bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">{badge}</span>
      )}
      {collapsed && badge !== undefined && badge > 0 && (
        <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">{badge}</span>
      )}
    </button>
  );
}
