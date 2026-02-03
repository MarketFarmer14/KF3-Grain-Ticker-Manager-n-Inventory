import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export const LoginPage: React.FC = () => {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const result = await login(code);
    if (result.success) {
      navigate('/upload');
    } else {
      setError(result.error || 'Invalid access code');
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
      <div className="bg-gray-800 rounded-xl shadow-2xl p-8 w-full max-w-md">
        <div className="flex justify-center mb-6">
          <div className="w-16 h-16 bg-emerald-600 rounded-xl flex items-center justify-center text-3xl">
            🌾
          </div>
        </div>

        <h1 className="text-2xl font-bold text-white text-center mb-1">Grain Ticket System</h1>
        <p className="text-gray-400 text-center mb-8 text-sm">Enter your access code to continue</p>

        <form onSubmit={handleSubmit}>
          <div className="mb-5">
            <label className="block text-sm font-medium text-gray-300 mb-2">Access Code</label>
            <input
              type="password"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white
                         focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none transition"
              placeholder="Enter code"
              autoComplete="off"
              required
            />
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-900/40 border border-red-700 rounded-lg text-red-300 text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-600 text-white
                       font-medium py-3 rounded-lg transition cursor-pointer disabled:cursor-not-allowed"
          >
            {loading ? 'Verifying...' : 'Access System'}
          </button>
        </form>
      </div>
    </div>
  );
};
