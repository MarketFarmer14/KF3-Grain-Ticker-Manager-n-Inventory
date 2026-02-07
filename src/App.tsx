import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { LoginPage } from './pages/LoginPage';
import { UploadPage } from './pages/UploadPage';
import { ReviewQueuePage } from './pages/ReviewQueuePage';
import { TicketsPage } from './pages/TicketsPage';
import { ContractsPage } from './pages/ContractsPage';
import { HaulBoardPage } from './pages/HaulBoardPage';
import { InventoryPage } from './pages/InventoryPage';
import { Layout } from './components/Layout';

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/" replace />;
  return <Layout>{children}</Layout>;
};

const App: React.FC = () => {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<LoginPage />} />
          <Route path="/upload" element={<ProtectedRoute><UploadPage /></ProtectedRoute>} />
          <Route path="/review" element={<ProtectedRoute><ReviewQueuePage /></ProtectedRoute>} />
          <Route path="/tickets" element={<ProtectedRoute><TicketsPage /></ProtectedRoute>} />
          <Route path="/contracts" element={<ProtectedRoute><ContractsPage /></ProtectedRoute>} />
          <Route path="/haul-board" element={<ProtectedRoute><HaulBoardPage /></ProtectedRoute>} />
          <Route path="/inventory" element={<ProtectedRoute><InventoryPage /></ProtectedRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
};

export default App;
