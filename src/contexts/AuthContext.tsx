import React, { createContext, useContext, useState, useEffect } from 'react';

interface AuthContextType {
  isAuthenticated: boolean;
  login: (code: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    if (localStorage.getItem('grain_ticket_auth') === 'true') {
      setIsAuthenticated(true);
    }
  }, []);

  const login = async (code: string): Promise<{ success: boolean; error?: string }> => {
    const correctCode = 'Koehler3#';
    if (code === correctCode) {
      setIsAuthenticated(true);
      localStorage.setItem('grain_ticket_auth', 'true');
      return { success: true };
    }
    return { success: false, error: 'Invalid access code' };
  };

  const logout = () => {
    setIsAuthenticated(false);
    localStorage.removeItem('grain_ticket_auth');
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
