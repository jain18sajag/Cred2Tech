import React, { useState, useEffect } from 'react';
import PageHeader from '../components/ui/PageHeader';
import IncentiveSummaryTable from '../components/financials/IncentiveSummaryTable';
import LenderCommissionFilters from '../components/financials/LenderCommissionFilters';
import LenderCommissionCard from '../components/financials/LenderCommissionCard';
import GenerateInvoiceModal from '../components/financials/GenerateInvoiceModal';
import UpdateInvoiceStatusModal from '../components/financials/UpdateInvoiceStatusModal';
import { getLenderCommissions } from '../api/commissionOperationsService';
import LoadingSpinner from '../components/ui/LoadingSpinner';

export default function LenderCommissionPage() {
  const [filters, setFilters] = useState({
    month: '',
    lenderName: 'All Lenders',
    product: 'All Products',
    search: ''
  });

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState({
    summaryData: [],
    lendersData: [],
    availableMonths: [],
    availableLenders: [],
    hasAnyRecords: false
  });

  const [showGenerateInvoice, setShowGenerateInvoice] = useState(false);
  const [statusModalCase, setStatusModalCase] = useState(null); // When set, opens the update modal

  useEffect(() => {
    fetchCommissions();
  }, [filters.month, filters.lenderName, filters.product]);

  // Debounced search effect
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchCommissions();
    }, 500);
    return () => clearTimeout(timer);
  }, [filters.search]);

  const fetchCommissions = async () => {
    try {
      setLoading(true);
      const res = await getLenderCommissions(filters);
      if (res.success) {
        setData(res.data);
        // Automatically set the month filter to the most recent if not already set
        if (!filters.month && res.data.availableMonths.length > 0) {
          setFilters(prev => ({ ...prev, month: res.data.availableMonths[0] }));
        }
      }
    } catch (error) {
      console.error("Failed to load lender commissions", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: '1120px', margin: '0 auto', paddingBottom: '60px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <PageHeader
          title="Lender Commission"
          subtitle="Track and invoice expected commissions from lending partners"
        />
        <button 
          style={{
            background: '#111827',
            color: '#fff',
            border: 'none',
            borderRadius: '8px',
            padding: '10px 20px',
            fontSize: '14px',
            fontWeight: '600',
            cursor: 'pointer',
            marginTop: '24px'
          }}
          onClick={() => setShowGenerateInvoice(true)}
        >
          + Generate Invoice
        </button>
      </div>

      {loading && data.lendersData.length === 0 ? (
        <div style={{ padding: '60px', textAlign: 'center' }}>
          <LoadingSpinner size={32} />
        </div>
      ) : (
        <>
          <IncentiveSummaryTable summaryData={data.summaryData} />
          
          <LenderCommissionFilters 
            filters={filters} 
            setFilters={setFilters} 
            availableMonths={data.availableMonths}
            availableLenders={data.availableLenders}
          />

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {data.lendersData.length === 0 ? (
              <div style={{ padding: '40px', textAlign: 'center', color: '#6B7280', background: '#fff', borderRadius: '12px', border: '1px solid #E5E7EB' }}>
                {!data.hasAnyRecords 
                  ? "No commission ledger entries found. Create a disbursement first to generate commission." 
                  : "Records exist but current filters exclude them."}
              </div>
            ) : (
              data.lendersData.map(lender => (
                <LenderCommissionCard 
                  key={lender.lender_name} 
                  lender={lender} 
                  onUpdateClick={(caseRow) => setStatusModalCase(caseRow)}
                />
              ))
            )}
          </div>
        </>
      )}

      {showGenerateInvoice && (
        <GenerateInvoiceModal 
          onClose={() => setShowGenerateInvoice(false)}
          availableMonths={data.availableMonths}
          availableLenders={data.availableLenders}
          onSuccess={() => {
            setShowGenerateInvoice(false);
            fetchCommissions();
          }}
        />
      )}

      {statusModalCase && (
        <UpdateInvoiceStatusModal 
          caseData={statusModalCase}
          onClose={() => setStatusModalCase(null)}
          onSuccess={() => {
            setStatusModalCase(null);
            fetchCommissions();
          }}
        />
      )}
    </div>
  );
}
