import React, { useState, useEffect } from 'react';
import PageHeader from '../components/ui/PageHeader';
import IncentiveSummaryTable from '../components/financials/IncentiveSummaryTable';
import IncentiveFilters from '../components/financials/IncentiveFilters';
import IncentiveEmployeeCard from '../components/financials/IncentiveEmployeeCard';
import { getSalesIncentives } from '../api/commissionOperationsService';
import LoadingSpinner from '../components/ui/LoadingSpinner';

export default function SalesIncentivePage() {
  const [filters, setFilters] = useState({
    month: '',
    teamMember: 'All Members',
    product: 'All Products',
    search: ''
  });

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState({
    summaryData: [],
    employeesData: [],
    availableMonths: [],
    availableTeamMembers: []
  });

  useEffect(() => {
    fetchIncentives();
  }, [filters.month, filters.teamMember, filters.product]);

  // Debounced search effect
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchIncentives();
    }, 500);
    return () => clearTimeout(timer);
  }, [filters.search]);

  const fetchIncentives = async () => {
    try {
      setLoading(true);
      const res = await getSalesIncentives(filters);
      if (res.success) {
        setData(res.data);
        // Automatically set the month filter to the most recent if not already set
        if (!filters.month && res.data.availableMonths.length > 0) {
          setFilters(prev => ({ ...prev, month: res.data.availableMonths[0] }));
        }
      }
    } catch (error) {
      console.error("Failed to load sales incentives", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: '1120px', margin: '0 auto', paddingBottom: '60px' }}>
      <PageHeader
        title="Sales Incentive"
        subtitle="Performance incentives & bonuses for team members — tracking & payout"
      />

      {loading && data.employeesData.length === 0 ? (
        <div style={{ padding: '60px', textAlign: 'center' }}>
          <LoadingSpinner size={32} />
        </div>
      ) : (
        <>
          <IncentiveSummaryTable summaryData={data.summaryData} />
          
          <IncentiveFilters 
            filters={filters} 
            setFilters={setFilters} 
            availableMonths={data.availableMonths}
            availableTeamMembers={data.availableTeamMembers}
          />

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {data.employeesData.length === 0 ? (
              <div style={{ padding: '40px', textAlign: 'center', color: '#6B7280', background: '#fff', borderRadius: '12px', border: '1px solid #E5E7EB' }}>
                No incentive records found for the selected filters.
              </div>
            ) : (
              data.employeesData.map(emp => (
                <IncentiveEmployeeCard key={emp.id} employee={emp} />
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
