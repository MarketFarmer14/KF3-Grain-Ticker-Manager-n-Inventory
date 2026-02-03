import React, { useState, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { CROP_YEARS } from '../lib/constants';

interface NavItem {
  to: string;
  label: string;
  icon: string;
  badge?: number;
}

export const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [reviewCount, setReviewCount] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [cropYear, setCropYear] = useState(() => {
    return localStorage.getItem('selected_crop_year') || new Date().getFullYear().toString();
  });

  useEffect(() => {
    fetchReviewCount();
    const interval = setInterval(fetchReviewCount, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleCropYearChange = (year: string) => {
    setCropYear(year);
    localStorage.setItem('selected_crop_year', year);
    window.dispatchEvent(new Event('crop_year_changed'));
  };

  const fetchReviewCount = async () => {
    try {
      const { count } = await supabase
        .from('tickets')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'needs_review');
      setReviewCount(count || 0);
    } catch {
      // silent fail
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const navItems: NavItem[] = [
    { to: '/upload', label: 'Upload', icon: '📤' },
    { to: '/review', label: 'Review', icon: '📋', badge: reviewCount },
    { to: '/tickets', label: 'Tickets', icon: '📄' },
    { to: '/contracts', label: 'Contracts', icon: '📝' },
    { to: '/haul', label: 'Haul Board', icon: '🚛' },
    { to: '/inventory', label: 'Inventory', icon: '📊' },
  ];

  return (
    <div className="flex min-h-screen bg-gray-900">
      {/* Sidebar */}
      <aside className={`${sidebarOpen ? 'w-56' : 'w-14'} bg-gray-800 flex flex-col transition-all duration-200 flex-shrink-0`}>
        {/* Header */}
        <div className="p-4 flex items-center justify-between border-b border-gray-700">
          {sidebarOpen && (
            <h1 className="text-white font-bold text-base whitespace-nowrap">🌾 Grain Tickets</h1>
          )}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="text-gray-400 hover:text-white ml-auto"
          >
            {sidebarOpen ? '◀' : '▶'}
          </button>
        </div>

        {/* Crop Year Dropdown */}
        {sidebarOpen && (
          <div className="p-3 border-b border-gray-700">
            <label className="block text-xs text-gray-500 mb-1.5">Crop Year</label>
            <select
              value={cropYear}
              onChange={(e) => handleCropYearChange(e.target.value)}
              className="w-full px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-white text-sm outline-none focus:border-emerald-500"
            >
              {CROP_YEARS.map((year) => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </div>
        )}

        {/* Nav */}
        <nav className="flex-1 p-2">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center px-3 py-2.5 rounded-lg mb-0.5 transition text-sm
                 ${isActive ? 'bg-emerald-600 text-white' : 'text-gray-300 hover:bg-gray-700 hover:text-white'}`
              }
            >
              <span className="text-base mr-3 flex-shrink-0">{item.icon}</span>
              {sidebarOpen && <span className="whitespace-nowrap">{item.label}</span>}
              {sidebarOpen && item.badge !== undefined && item.badge > 0 && (
                <span className="ml-auto bg-red-600 text-white text-xs font-bold rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
                  {item.badge}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Logout */}
        <div className="p-2 border-t border-gray-700">
          <button
            onClick={handleLogout}
            className="flex items-center px-3 py-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700 transition w-full text-sm"
          >
            <span className="text-base mr-3">🚪</span>
            {sidebarOpen && <span>Logout</span>}
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto p-6">
        {children}
      </main>
    </div>
  );
};
