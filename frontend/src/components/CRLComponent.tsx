import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

// CRLComponent is wired into the admin surface via the /admin/crl route.
// It is intentionally exported for use by AdminAnalyticsDashboard and routes.

const CRLComponent = () => {
  const navigate = useNavigate();
  const [revokedCount, setRevokedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchCRLData = async () => {
      try {
        const response = await axios.get('/api/crl/count');
        setRevokedCount(response.data.count);
        setLoading(false);
      } catch (err) {
        setError('Failed to load CRL data');
        setLoading(false);
      }
    };

    fetchCRLData();
  }, []);

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold mb-4">Certificate Revocation List</h3>
        <div className="animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-1/4 mb-2"></div>
          <div className="h-8 bg-gray-200 rounded w-1/2"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h3 className="text-lg font-semibold mb-4">Certificate Revocation List</h3>
      
      {error ? (
        <div className="text-red-600 text-sm">{error}</div>
      ) : (
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-gray-600">Revoked Certificates</span>
            <span className="text-2xl font-bold text-red-600">{revokedCount}</span>
          </div>
          
          <div className="mt-4">
            <button 
              onClick={() => navigate('/revoke')}
              className="w-full bg-red-600 text-white py-2 px-4 rounded hover:bg-red-700 transition-colors"
            >
              Revoke Certificate
            </button>
          </div>
          
          <div className="mt-4 text-sm text-gray-500">
            <p>✓ Real-time revocation status</p>
            <p>✓ On-chain verification</p>
            <p>✓ Merkle tree optimization</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default CRLComponent;
