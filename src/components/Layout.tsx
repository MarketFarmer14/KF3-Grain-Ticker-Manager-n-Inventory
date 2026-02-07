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

  // Smart year default: 2025 until September 1, then 2026
  const getDefaultYear = () => {
    const now = new Date();
    const currentCalendarYear = now.getFullYear();
    const month = now.getMonth(); // 0-indexed (0 = Jan, 8 = Sept)
    
    // If before September (month < 8), use previous crop year
    // If September or later (month >= 8), use current crop year
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
    // Set initial year if not set
    if (!localStorage.getItem('grain_ticket_year')) {
      const defaultYear = getDefaultYear();
      localStorage.setItem('grain_ticket_year', defaultYear);
      setCropYear(defaultYear);
    }
    
    fetchReviewCount();
  }, []);

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
    
    // Force child components to re-render by updating a key
    setRefreshKey(prev => prev + 1);
    
    // Navigate to same page to trigger useEffect refresh in child components
    const currentPath = location.pathname;
    navigate(currentPath + '?refresh=' + Date.now(), { replace: true });
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white flex">
      {/* Hamburger Menu Button - Mobile Only */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="fixed top-4 left-4 z-50 lg:hidden bg-gray-800 p-2 rounded-lg"
      >
        <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          {sidebarOpen ? (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          )}
        </svg>
      </button>

      {/* Sidebar */}
      <div className={`
        fixed lg:static inset-y-0 left-0 z-40
        w-64 bg-gray-800 p-4 flex flex-col
        transform transition-transform duration-300 ease-in-out
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-6">
            <div className="w-10 h-10 bg-green-600 rounded-lg flex items-center justify-center text-2xl">
              🌾
            </div>
            <h1 className="text-xl font-bold">Grain Tickets</h1>
          </div>

          {/* Crop Year Selector */}
          <div className="mb-6">
            <label className="block text-sm font-medium mb-2 text-gray-300">Crop Year</label>
            <select
              value={cropYear}
              onChange={(e) => handleYearChange(e.target.value)}
              className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg border border-gray-600 focus:border-green-500 focus:outline-none"
            >
              <option value="2024">2024</option>
              <option value="2025">2025</option>
              <option value="2026">2026</option>
              <option value="2027">2027</option>
              <option value="2028">2028</option>
            </select>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1">
          <NavItem to="/upload" icon="📤" label="Upload" active={location.pathname === '/upload'} onClick={() => setSidebarOpen(false)} />
          <NavItem
            to="/review"
            icon="✍️"
            label="Review"
            badge={reviewCount}
            active={location.pathname === '/review'}
            onClick={() => setSidebarOpen(false)}
          />
          <NavItem to="/tickets" icon="🎫" label="Tickets" active={location.pathname === '/tickets'} onClick={() => setSidebarOpen(false)} />
          <NavItem to="/contracts" icon="📋" label="Contracts" active={location.pathname === '/contracts'} onClick={() => setSidebarOpen(false)} />
          <NavItem to="/haul-board" icon="🚜" label="Haul Board" active={location.pathname === '/haul-board'} onClick={() => setSidebarOpen(false)} />
          <NavItem to="/inventory" icon="📊" label="Inventory" active={location.pathname === '/inventory'} onClick={() => setSidebarOpen(false)} />
        </nav>

        {/* Logout */}
        <button
          onClick={handleLogout}
          className="mt-4 w-full px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-sm font-medium"
        >
          Logout
        </button>
      </div>

      {/* Overlay - Mobile Only */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        ></div>
      )}

      {/* Main Content */}
      <div key={refreshKey} className="flex-1 overflow-auto lg:ml-0 ml-0">{children}</div>
    </div>
  );
}

function NavItem({
  to,
  icon,
  label,
  badge,
  active,
  onClick,
}: {
  to: string;
  icon: string;
  label: string;
  badge?: number;
  active?: boolean;
  onClick?: () => void;
}) {
  const navigate = useNavigate();

  const handleClick = () => {
    navigate(to);
    if (onClick) onClick(); // Close sidebar on mobile
  };

  return (
    <button
      onClick={handleClick}
      className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
        active ? 'bg-green-600 text-white' : 'text-gray-300 hover:bg-gray-700'
      }`}
    >
      <span className="text-xl">{icon}</span>
      <span className="flex-1 text-left font-medium">{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full">{badge}</span>
      )}
    </button>
  );
}
