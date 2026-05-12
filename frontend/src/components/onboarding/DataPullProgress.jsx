import React from 'react';
import { CheckCircle2, AlertCircle, Loader2, RefreshCw, Clock } from 'lucide-react';

const DataPullProgress = ({ 
  label, 
  status, 
  onRetry, 
  onStart, 
  loading = false, 
  error = null,
  cost = 0,
  description = null
}) => {
  const getStatusConfig = () => {
    switch (status) {
      case 'COMPLETE':
        return {
          icon: <CheckCircle2 size={18} color="#10B981" />,
          color: '#10B981',
          bg: '#ECFDF5',
          text: 'Complete'
        };
      case 'PROCESSING':
        return {
          icon: <Loader2 size={18} className="animate-spin" color="#3B82F6" />,
          color: '#3B82F6',
          bg: '#EFF6FF',
          text: 'Processing...'
        };
      case 'FAILED':
        return {
          icon: <AlertCircle size={18} color="#EF4444" />,
          color: '#EF4444',
          bg: '#FEF2F2',
          text: 'Failed'
        };
      case 'PENDING':
        return {
          icon: <Clock size={18} color="#F59E0B" />,
          color: '#F59E0B',
          bg: '#FFFBEB',
          text: 'Pending'
        };
      default:
        return {
          icon: <RefreshCw size={18} color="#6B7280" />,
          color: '#6B7280',
          bg: '#F3F4F6',
          text: 'Not Started'
        };
    }
  };

  const config = getStatusConfig();

  return (
    <div style={{ 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'space-between', 
      padding: '12px 16px', 
      background: 'white', 
      border: '1px solid var(--border)', 
      borderRadius: 12,
      marginBottom: 12
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ 
          width: 36, 
          height: 36, 
          borderRadius: 10, 
          background: config.bg, 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center' 
        }}>
          {config.icon}
        </div>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{label}</span>
            <span style={{ 
              fontSize: 11, 
              fontWeight: 600, 
              padding: '2px 8px', 
              borderRadius: 20, 
              background: config.bg, 
              color: config.color,
              textTransform: 'uppercase'
            }}>
              {config.text}
            </span>
          </div>
          {description && <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>{description}</p>}
          {error && <p style={{ fontSize: 11, color: '#EF4444', marginTop: 2, fontWeight: 500 }}>⚠️ {error}</p>}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {status === 'COMPLETE' ? (
          <CheckCircle2 size={20} color="#10B981" />
        ) : (
          <button 
            type="button" 
            className={`btn btn-sm ${status === 'FAILED' ? 'btn-secondary' : 'btn-primary'}`}
            disabled={loading || status === 'PROCESSING'}
            onClick={status === 'FAILED' ? onRetry : onStart}
            style={status !== 'FAILED' ? { background: '#10B981', color: 'white', border: 'none' } : {}}
          >
            {loading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : status === 'FAILED' ? (
              'Retry'
            ) : (
              `Pull ${cost > 0 ? `(${cost} Cr)` : ''}`
            )}
          </button>
        )}
      </div>
    </div>
  );
};

export default DataPullProgress;
