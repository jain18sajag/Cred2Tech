import React, { useState, useRef, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import api from '../../api/axiosInstance';

const SalarySlipUploader = ({ caseId, applicantId, applicantName }) => {
  // State for OCR summaries (3 months)
  const [months, setMonths] = useState([
    { id: 'm1', label: 'Month 1', file: null, ocrStatus: 'PENDING', result: null, isUploaded: false, documentId: null, fileName: null },
    { id: 'm2', label: 'Month 2', file: null, ocrStatus: 'PENDING', result: null, isUploaded: false, documentId: null, fileName: null },
    { id: 'm3', label: 'Month 3', file: null, ocrStatus: 'PENDING', result: null, isUploaded: false, documentId: null, fileName: null },
  ]);
  const [loadingMonth, setLoadingMonth] = useState(null);
  const [summary, setSummary] = useState(null);

  const fileInputRef = useRef(null);
  const [currentUploadMonth, setCurrentUploadMonth] = useState(null);
  const [mode, setMode] = useState('OCR'); // 'OCR' | 'MANUAL'
  const [manualEntryMonth, setManualEntryMonth] = useState(null);
  const [manualForm, setManualForm] = useState({ month: '', year: new Date().getFullYear().toString(), gross_salary: '', net_salary: '', deductions: '', employer_name: '', employee_name: applicantName || '' });

  // Fetch existing OCR results on mount
  useEffect(() => {
    // Reset state before fetching new data
    setMonths([
      { id: 'm1', label: 'Month 1', file: null, ocrStatus: 'PENDING', result: null, isUploaded: false, documentId: null, fileName: null },
      { id: 'm2', label: 'Month 2', file: null, ocrStatus: 'PENDING', result: null, isUploaded: false, documentId: null, fileName: null },
      { id: 'm3', label: 'Month 3', file: null, ocrStatus: 'PENDING', result: null, isUploaded: false, documentId: null, fileName: null },
    ]);
    setSummary(null);

    if (caseId && applicantId) {
      fetchSummary();
    }
  }, [caseId, applicantId]);

  const fetchSummary = async () => {
    try {
      const res = await api.get(`/cases/${caseId}/salary-summary?applicantId=${applicantId}`);
      if (res.data?.success && res.data.data?.length > 0) {
        // Map the existing results back to the 3 month slots if possible, 
        // or just show the summary card.
        const results = res.data.data;
        setSummary(results); // we'll just use the latest result for the summary view

        // Update local state based on what's already uploaded
        const newMonths = [...months];
        results.forEach((r, idx) => {
          if (idx < 3) {
            newMonths[idx].ocrStatus = 'COMPLETED';
            newMonths[idx].result = r;
          }
        });
        setMonths(newMonths);
      }
    } catch (error) {
      console.error('Failed to fetch salary summary:', error);
    }
  };

  const handleUploadClick = (monthId) => {
    setCurrentUploadMonth(monthId);
    fileInputRef.current.click();
  };

  const handleManualClick = (monthId) => {
    setManualEntryMonth(monthId);
    const existing = months.find(m => m.id === monthId)?.result;
    if (existing) {
      setManualForm({
        month: existing.month || '',
        year: existing.year || new Date().getFullYear().toString(),
        gross_salary: existing.gross_salary || '',
        net_salary: existing.net_salary || '',
        deductions: existing.deductions || '',
        employer_name: existing.employer_name || '',
        employee_name: existing.employee_name || applicantName || ''
      });
    } else {
      setManualForm({
        month: '',
        year: new Date().getFullYear().toString(),
        gross_salary: '',
        net_salary: '',
        deductions: '',
        employer_name: '',
        employee_name: applicantName || ''
      });
    }
  };

  const handleManualSubmit = async (e) => {
    if (e) e.preventDefault();
    if (!manualForm.month || !manualForm.gross_salary || !manualForm.net_salary) {
      toast.error('Month, Gross Salary, and Net Salary are required.');
      return;
    }
    
    setLoadingMonth(manualEntryMonth);
    try {
      const res = await api.post(`/cases/${caseId}/applicants/${applicantId}/salary-slips/manual`, manualForm);
      if (res.data?.success) {
        toast.success(`Manual entry saved for ${months.find(m => m.id === manualEntryMonth)?.label}`);
        setManualEntryMonth(null);
        fetchSummary();
      }
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to save manual entry');
      console.error(error);
    } finally {
      setLoadingMonth(null);
    }
  };

  const pollOcrStatus = async (documentId, monthIndex) => {
    let attempts = 0;
    const maxAttempts = 20; // Up to 1-2 minutes total given 3-5 sec delays

    const interval = setInterval(async () => {
      try {
        attempts++;
        const res = await api.post(`/cases/${caseId}/applicants/${applicantId}/salary-slips/${documentId}/ocr/poll`);
        
        if (res.data?.success) {
          const status = res.data.data.ocr_status;
          
          if (status === 'COMPLETED') {
            clearInterval(interval);
            if (monthIndex === -1) {
               toast.success(`Batch OCR Extracted successfully!`);
               setRunningAllOcr(false);
            } else {
               toast.success(`OCR Extracted successfully for ${months[monthIndex].label}`);
               setMonths(prev => {
                 const newM = [...prev];
                 newM[monthIndex].ocrStatus = 'COMPLETED';
                 newM[monthIndex].result = res.data.data;
                 return newM;
               });
            }
            setLoadingMonth(null);
            fetchSummary();
          } else if (status === 'FAILED') {
            clearInterval(interval);
            if (monthIndex === -1) {
               toast.error(res.data.data.error_message || 'Batch OCR processing failed.');
               setRunningAllOcr(false);
            } else {
               toast.error(res.data.data.error_message || 'Vendor OCR processing failed.');
               setMonths(prev => {
                 const newM = [...prev];
                 newM[monthIndex].ocrStatus = 'FAILED';
                 return newM;
               });
            }
            setLoadingMonth(null);
          } else if (attempts >= maxAttempts) {
            clearInterval(interval);
            toast.error('OCR polling timed out. Please try again.');
            setLoadingMonth(null);
            if (monthIndex === -1) setRunningAllOcr(false);
          }
        }
      } catch (err) {
        clearInterval(interval);
        toast.error('Error checking OCR status.');
        setLoadingMonth(null);
        if (monthIndex === -1) setRunningAllOcr(false);
      }
    }, 4000); // 4 second intervals
  };

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file || !currentUploadMonth) return;
    if (!applicantId) {
       toast.error('Applicant ID missing. Please refresh and try again.');
       return;
    }

    // Validate size on frontend
    const sizeInMB = file.size / (1024 * 1024);
    if (sizeInMB > 10) {
       toast.error('File size exceeds 10 MB limit.');
       if (fileInputRef.current) fileInputRef.current.value = '';
       return;
    }

    const ext = file.name.split('.').pop().toLowerCase();
    if (!['pdf', 'png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
       toast.error('Unsupported file type. Upload PDF, PNG, JPEG, or WEBP.');
       if (fileInputRef.current) fileInputRef.current.value = '';
       return;
    }

    const monthIndex = months.findIndex(m => m.id === currentUploadMonth);
    if (monthIndex === -1) return;

    setLoadingMonth(currentUploadMonth);

    // Create FormData
    const formData = new FormData();
    formData.append('file', file);
    formData.append('document_type', 'SALARY_SLIP');

    try {
      // 1. Upload Document
      const uploadRes = await api.post(`/cases/${caseId}/applicants/${applicantId}/salary-slips`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      const documentId = uploadRes.data?.data?.id;
      if (!documentId) throw new Error("Upload failed to return document ID");

      toast.success(`Salary slip uploaded for ${months[monthIndex].label}`);
      
      const newMonths = [...months];
      newMonths[monthIndex].isUploaded = true;
      newMonths[monthIndex].documentId = documentId;
      newMonths[monthIndex].fileName = file.name;
      setMonths(newMonths);

    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to upload salary slip');
      console.error(error);
    } finally {
      setLoadingMonth(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const [runningAllOcr, setRunningAllOcr] = useState(false);

  const handleRunAllOcr = async () => {
    setRunningAllOcr(true);
    
    const docsToProcess = months
       .map((m, i) => ({ documentId: m.documentId, month: `M${i + 1}`, year: new Date().getFullYear().toString(), isUploaded: m.isUploaded, ocrStatus: m.ocrStatus, id: m.id, label: m.label }))
       .filter(m => m.isUploaded && m.ocrStatus !== 'COMPLETED' && m.documentId);

    if (docsToProcess.length === 0) {
        setRunningAllOcr(false);
        return;
    }

    try {
        setLoadingMonth('batch'); // Disable all buttons
        const ocrRes = await api.post(`/cases/${caseId}/applicants/${applicantId}/salary-slips/ocr-batch`, {
            documentIds: docsToProcess.map(d => ({ documentId: d.documentId, month: d.month, year: d.year }))
        });

        if (ocrRes.data?.success) {
            toast('Processing batch OCR... This might take a moment.', { icon: '⏳' });
            // The backend triggers the batch and returns a job_id for the group.
            // We just need to poll the first documentId, which will resolve for the entire batch.
            pollOcrStatus(docsToProcess[0].documentId, -1);
        }
    } catch (err) {
        toast.error(err.response?.data?.error || `Failed to start batch OCR`);
        setLoadingMonth(null);
        setRunningAllOcr(false);
    }
  };

  const completedCount = months.filter(m => m.ocrStatus === 'COMPLETED').length;
  const avgNet = summary?.length > 0
    ? summary.reduce((sum, s) => sum + (s.net_salary || 0), 0) / summary.length
    : 0;

  return (
    <div>
      <input
        type="file"
        ref={fileInputRef}
        style={{ display: 'none' }}
        onChange={handleFileChange}
        accept="application/pdf,image/jpeg,image/png"
      />

      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
        <button 
          type="button"
          onClick={() => setMode('OCR')} 
          style={{ flex: 1, padding: '10px', border: mode === 'OCR' ? '2px solid #3182ce' : '1px solid #e2e8f0', background: mode === 'OCR' ? '#ebf8ff' : '#fff', fontWeight: 600, color: mode === 'OCR' ? '#2b6cb0' : '#4a5568', borderRadius: '8px', cursor: 'pointer', transition: 'all 0.2s' }}
        >
          📄 Upload OCR
        </button>
        <button 
          type="button"
          onClick={() => setMode('MANUAL')} 
          style={{ flex: 1, padding: '10px', border: mode === 'MANUAL' ? '2px solid #3182ce' : '1px solid #e2e8f0', background: mode === 'MANUAL' ? '#ebf8ff' : '#fff', fontWeight: 600, color: mode === 'MANUAL' ? '#2b6cb0' : '#4a5568', borderRadius: '8px', cursor: 'pointer', transition: 'all 0.2s' }}
        >
          ✍️ Manual Entry
        </button>
      </div>

      {manualEntryMonth && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', padding: '24px', borderRadius: '12px', width: '400px', maxWidth: '90%' }}>
            <h3 style={{ marginTop: 0, marginBottom: '16px', fontSize: '18px', fontWeight: 600 }}>Manual Salary Entry ({months.find(m => m.id === manualEntryMonth)?.label})</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', gap: '12px' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px', color: '#4A5568' }}>Month</label>
                  <select required value={manualForm.month} onChange={e => setManualForm({...manualForm, month: e.target.value})} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #E2E8F0' }}>
                    <option value="">Select Month</option>
                    <option value="January">January</option>
                    <option value="February">February</option>
                    <option value="March">March</option>
                    <option value="April">April</option>
                    <option value="May">May</option>
                    <option value="June">June</option>
                    <option value="July">July</option>
                    <option value="August">August</option>
                    <option value="September">September</option>
                    <option value="October">October</option>
                    <option value="November">November</option>
                    <option value="December">December</option>
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px', color: '#4A5568' }}>Year</label>
                  <input type="number" required value={manualForm.year} onChange={e => setManualForm({...manualForm, year: e.target.value})} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #E2E8F0' }} />
                </div>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px', color: '#4A5568' }}>Gross Salary (₹)</label>
                <input type="number" required min="0" value={manualForm.gross_salary} onChange={e => setManualForm({...manualForm, gross_salary: e.target.value})} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #E2E8F0' }} placeholder="e.g. 60000" />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px', color: '#4A5568' }}>Net Salary (₹)</label>
                <input type="number" required min="0" value={manualForm.net_salary} onChange={e => setManualForm({...manualForm, net_salary: e.target.value})} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #E2E8F0' }} placeholder="e.g. 55000" />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px', color: '#4A5568' }}>Deductions (₹)</label>
                <input type="number" min="0" value={manualForm.deductions} onChange={e => setManualForm({...manualForm, deductions: e.target.value})} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #E2E8F0' }} placeholder="e.g. 5000" />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px', color: '#4A5568' }}>Employer Name</label>
                <input type="text" value={manualForm.employer_name} onChange={e => setManualForm({...manualForm, employer_name: e.target.value})} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #E2E8F0' }} placeholder="Company Name" />
              </div>
              <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                <button type="button" onClick={() => setManualEntryMonth(null)} style={{ flex: 1, padding: '10px', background: '#EDF2F7', border: 'none', borderRadius: '6px', fontWeight: 600, color: '#4A5568', cursor: 'pointer' }}>Cancel</button>
                <button type="button" onClick={handleManualSubmit} disabled={loadingMonth !== null} style={{ flex: 1, padding: '10px', background: '#3182CE', border: 'none', borderRadius: '6px', fontWeight: 600, color: '#FFF', cursor: 'pointer' }}>{loadingMonth === manualEntryMonth ? 'Saving...' : 'Save Entry'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px', marginBottom: '16px' }}>
        {months.map((m) => (
          <div key={m.id} style={{ background: '#F7FAFC', border: '1.5px dashed #E2E8F0', borderRadius: '12px', padding: '16px', textAlign: 'center' }}>
            {m.ocrStatus === 'COMPLETED' ? (
              <>
                <div style={{ fontSize: '24px', marginBottom: '8px' }}>✅</div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#276749', marginBottom: '4px' }}>{m.label} Processed</div>
                <div style={{ fontSize: '11px', color: '#718096', marginBottom: '12px' }}>Net: ₹{m.result?.net_salary?.toLocaleString('en-IN') || 0}</div>
                <button
                  type="button"
                  style={{ background: '#E2E8F0', color: '#4A5568', border: 'none', padding: '6px 12px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, width: '100%', cursor: 'pointer' }}
                  onClick={() => mode === 'OCR' ? handleUploadClick(m.id) : handleManualClick(m.id)}
                  disabled={loadingMonth !== null}
                >
                  {mode === 'OCR' ? 'Re-upload' : 'Edit Details'}
                </button>
              </>
            ) : m.isUploaded ? (
              <>
                <div style={{ fontSize: '24px', marginBottom: '8px' }}>📄</div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#2B6CB0', marginBottom: '4px' }}>{m.label} Uploaded</div>
                <div style={{ fontSize: '11px', color: '#4A5568', marginBottom: '12px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={m.fileName || 'Salary slip document'}>
                  {m.fileName || 'Document attached'}
                </div>
                <button
                  type="button"
                  style={{ background: '#E2E8F0', color: '#4A5568', border: 'none', padding: '6px 12px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, width: '100%', cursor: 'pointer' }}
                  onClick={() => mode === 'OCR' ? handleUploadClick(m.id) : handleManualClick(m.id)}
                  disabled={loadingMonth !== null || runningAllOcr}
                >
                  {mode === 'OCR' ? 'Change File' : 'Enter Details'}
                </button>
              </>
            ) : (
              <>
                <div style={{ fontSize: '24px', marginBottom: '8px' }}>📋</div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#1A202C', marginBottom: '4px' }}>{m.label}</div>
                <div style={{ fontSize: '11px', color: '#A0AEC0', marginBottom: '12px' }}>{mode === 'OCR' ? 'Upload salary slip PDF / image' : 'Enter manual salary values'}</div>
                <button
                  type="button"
                  style={{
                    background: '#EDF2F7', color: '#4A5568', border: 'none',
                    padding: '8px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, width: '100%', cursor: loadingMonth ? 'not-allowed' : 'pointer',
                    opacity: loadingMonth === m.id ? 0.7 : 1
                  }}
                  onClick={() => mode === 'OCR' ? handleUploadClick(m.id) : handleManualClick(m.id)}
                  disabled={loadingMonth !== null || runningAllOcr}
                >
                  {loadingMonth === m.id ? (mode === 'OCR' ? 'Uploading...' : 'Saving...') : (mode === 'OCR' ? 'Upload Slip' : 'Enter Details')}
                </button>
              </>
            )}
          </div>
        ))}
      </div>

      {mode === 'OCR' && months.some(m => m.isUploaded && m.ocrStatus !== 'COMPLETED') && (
         <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
            <button 
              type="button"
              className="btn btn-lg" 
              style={{ background: 'linear-gradient(135deg, #6366F1, #8B5CF6)', color: 'white', border: 'none', width: '100%', maxWidth: '300px' }}
              onClick={handleRunAllOcr}
              disabled={runningAllOcr || loadingMonth !== null}
            >
              {runningAllOcr ? 'Processing OCR...' : 'Run OCR on Uploaded Slips ✨'}
            </button>
         </div>
      )}

      {/* OCR Result Summary Panel */}
      {completedCount > 0 && summary && summary.length > 0 && (
        <div style={{ background: 'linear-gradient(135deg, #F0FFF4, #E6FFFA)', border: '1px solid #9AE6B4', borderRadius: '12px', padding: '16px', marginTop: '4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <span style={{ fontSize: '16px' }}>✅</span>
            <span style={{ fontSize: '13px', fontWeight: 700, color: '#276749' }}>OCR Extraction Complete — {applicantName || summary[0]?.employee_name}</span>
            <span style={{ marginLeft: 'auto', background: '#C6F6D5', color: '#22543D', padding: '4px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 700 }}>
              {completedCount} slip{completedCount > 1 ? 's' : ''} processed
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
            <div style={{ background: '#fff', borderRadius: '8px', padding: '10px 14px' }}>
              <div style={{ fontSize: '10px', color: '#718096', fontWeight: 600, textTransform: 'uppercase', marginBottom: '3px' }}>Employer</div>
              <div style={{ fontSize: '13px', fontWeight: 700, color: '#1A202C' }}>{summary[0]?.employer_name || '-'}</div>
            </div>
            <div style={{ background: '#fff', borderRadius: '8px', padding: '10px 14px' }}>
              <div style={{ fontSize: '10px', color: '#718096', fontWeight: 600, textTransform: 'uppercase', marginBottom: '3px' }}>Latest Gross Salary</div>
              <div style={{ fontSize: '15px', fontWeight: 800, color: '#1A202C' }}>₹{summary[0]?.gross_salary?.toLocaleString('en-IN') || 0}</div>
              <div style={{ fontSize: '10px', color: '#A0AEC0' }}>/ month</div>
            </div>
            <div style={{ background: '#fff', borderRadius: '8px', padding: '10px 14px' }}>
              <div style={{ fontSize: '10px', color: '#718096', fontWeight: 600, textTransform: 'uppercase', marginBottom: '3px' }}>Deductions</div>
              <div style={{ fontSize: '15px', fontWeight: 800, color: '#1A202C' }}>₹{summary[0]?.deductions?.toLocaleString('en-IN') || 0}</div>
              <div style={{ fontSize: '10px', color: '#A0AEC0' }}>/ month</div>
            </div>
            <div style={{ background: '#fff', borderRadius: '8px', padding: '10px 14px', border: '2px solid #38A169', gridColumn: '1 / -1' }}>
              <div style={{ fontSize: '10px', color: '#38A169', fontWeight: 700, textTransform: 'uppercase', marginBottom: '3px' }}>Net Take-Home</div>
              <div style={{ fontSize: '17px', fontWeight: 800, color: '#38A169' }}>₹{avgNet.toLocaleString('en-IN')}</div>
              <div style={{ fontSize: '10px', color: '#718096' }}>/ month (avg {completedCount} mo)</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SalarySlipUploader;
