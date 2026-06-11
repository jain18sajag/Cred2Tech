import React, { useState, useRef } from 'react';
import { X, Upload, Download, FileSpreadsheet, CheckCircle, AlertCircle } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { caseService } from '../../api/caseService';

export default function BulkUploadModal({ isOpen, onClose, onSuccess }) {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const fileInputRef = useRef(null);

  const formatINR = (amount) => {
    const value = Number(amount || 0);
    return value.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
  };


  if (!isOpen) return null;

  const handleDownloadTemplate = async () => {
    try {
      const response = await caseService.downloadBulkUploadTemplate();
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'Cred2Tech_Case_Bulk_Upload_Template.xlsx');
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success('Template downloaded successfully');
    } catch (err) {
      console.error(err);
      toast.error('Failed to download template');
    }
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
      setResult(null);
    }
  };

  const processUpload = async () => {
    if (!file) {
      toast.error('Please select a file first.');
      return;
    }

    setUploading(true);
    setResult(null);

    try {
      const response = await caseService.uploadBulkCases(file);
      const data = response.data;
      setResult(data);
      if (data.success) {
        toast.success(`Imported ${data.summary.createdCases} cases. ESR generated for ${data.summary.esrGeneratedCases || 0}.`);
        if (onSuccess) onSuccess();
      } else {
        toast.error('Failed to import cases. Check errors.');
      }
    } catch (err) {
      console.error(err);
      if (err.response && err.response.data && err.response.data.errors) {
        setResult(err.response.data);
        toast.error('Validation failed. Please check the errors list.');
      } else {
        toast.error('Error processing the file. Ensure it matches the template.');
      }
    } finally {
      setUploading(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(17, 24, 39, 0.7)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999
    }}>
      <div style={{
        background: '#fff', borderRadius: 16, width: 600, maxWidth: '90%', maxHeight: '90vh',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)', overflow: 'hidden', display: 'flex', flexDirection: 'column'
      }}>
        {/* Header */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #E5E7EB', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#111827' }}>Bulk Upload Cases</h2>
            <div style={{ fontSize: 13, color: '#6B7280', marginTop: 4 }}>Upload multi-sheet Excel files to create cases</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            <X size={20} color="#6B7280" />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 24, overflowY: 'auto' }}>
          {/* Step 1: Download Template */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#374151', marginBottom: 8 }}>Step 1: Download Template</div>
            <div style={{ fontSize: 13, color: '#6B7280', marginBottom: 12 }}>
              Download the official multi-sheet Excel template. Follow instructions in the first sheet.
            </div>
            <button
              onClick={handleDownloadTemplate}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, background: '#F3F4F6', border: '1px solid #D1D5DB',
                padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, color: '#374151', cursor: 'pointer'
              }}
            >
              <FileSpreadsheet size={16} color="#10B981" /> Download Excel Template
            </button>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid #E5E7EB', margin: '0 0 24px' }} />

          {/* Step 2: Upload File */}
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#374151', marginBottom: 8 }}>Step 2: Upload Filled File</div>
            <div
              style={{
                border: '2px dashed #D1D5DB', borderRadius: 12, padding: 32, textAlign: 'center',
                background: '#F9FAFB', cursor: 'pointer'
              }}
              onClick={() => fileInputRef.current.click()}
            >
              <Upload size={32} color="#9CA3AF" style={{ marginBottom: 12 }} />
              <div style={{ fontSize: 14, fontWeight: 600, color: '#4F46E5', marginBottom: 4 }}>
                Click to select a file
              </div>
              <div style={{ fontSize: 12, color: '#6B7280' }}>
                {file ? file.name : 'Excel (.xlsx) files only'}
              </div>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept=".xlsx"
                style={{ display: 'none' }}
              />
            </div>
          </div>

          {/* Results Summary */}
          {result && (
            <div style={{ marginTop: 24, padding: 16, background: (result.summary?.failedRows || 0) > 0 ? '#FEF2F2' : '#F0FDF4', borderRadius: 8, border: `1px solid ${(result.summary?.failedRows || 0) > 0 ? '#FCA5A5' : '#BBF7D0'}` }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6, color: (result.summary?.failedRows || 0) > 0 ? '#991B1B' : '#166534' }}>
                {(result.summary?.failedRows || 0) > 0 ? <AlertCircle size={16} /> : <CheckCircle size={16} />}
                Upload Complete
              </div>
              <div style={{ fontSize: 13, color: '#374151', display: 'flex', gap: 16 }}>
                <span>Total: <b>{result.summary?.totalRows || 0}</b></span>
                <span style={{ color: '#059669' }}>Success: <b>{result.summary?.createdCases || 0}</b></span>
                <span style={{ color: '#DC2626' }}>Failed: <b>{result.summary?.failedRows || 0}</b></span>
                <span style={{ color: '#4F46E5' }}>ESR Done: <b>{result.summary?.esrGeneratedCases || 0}</b></span>
                <span style={{ color: '#B45309' }}>ESR Failed: <b>{result.summary?.esrFailedCases || 0}</b></span>
              </div>
              {result.createdCases && result.createdCases.length > 0 && (
                <div style={{ marginTop: 12, maxHeight: 180, overflowY: 'auto', fontSize: 11, color: '#111827', background: '#fff', padding: 8, borderRadius: 4, border: '1px solid #BBF7D0' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #D1FAE5', textAlign: 'left' }}>
                        <th style={{ padding: 4 }}>Case Ref</th>
                        <th style={{ padding: 4 }}>Customer</th>
                        <th style={{ padding: 4 }}>ESR</th>
                        <th style={{ padding: 4 }}>Eligible Lenders</th>
                        <th style={{ padding: 4 }}>Final Loan Eligibility</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.createdCases.map((c, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid #ECFDF5' }}>
                          <td style={{ padding: 4 }}>{c.caseRef}</td>
                          <td style={{ padding: 4 }}>{c.customerName}</td>
                          <td style={{ padding: 4, color: c.esrGenerated ? '#059669' : '#DC2626', fontWeight: 700 }}>{c.esrGenerated ? 'Generated' : 'Failed'}</td>
                          <td style={{ padding: 4 }}>{c.eligibleLenderCount || 0}/{c.totalLenderCount || 0}</td>
                          <td style={{ padding: 4, fontWeight: 700 }}>{formatINR(c.finalLoanEligibility)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {result.errors && result.errors.length > 0 && (
                <div style={{ marginTop: 12, maxHeight: 150, overflowY: 'auto', fontSize: 11, color: '#DC2626', background: '#fff', padding: 8, borderRadius: 4, border: '1px solid #FCA5A5' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #FCA5A5', textAlign: 'left' }}>
                        <th style={{ padding: 4 }}>Row</th>
                        <th style={{ padding: 4 }}>Case Ref</th>
                        <th style={{ padding: 4 }}>Error</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.errors.map((e, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid #FEE2E2' }}>
                          <td style={{ padding: 4 }}>{e.row}</td>
                          <td style={{ padding: 4 }}>{e.caseRef}</td>
                          <td style={{ padding: 4 }}>{e.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '16px 24px', background: '#F9FAFB', borderTop: '1px solid #E5E7EB', display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
          <button
            onClick={onClose}
            style={{ padding: '8px 16px', background: '#fff', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 14, fontWeight: 600, color: '#374151', cursor: 'pointer' }}
          >
            {result ? 'Close' : 'Cancel'}
          </button>
          {!result && (
            <button
              onClick={processUpload}
              disabled={!file || uploading}
              style={{
                padding: '8px 16px', background: '#4F46E5', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, color: '#fff', cursor: 'pointer',
                opacity: (!file || uploading) ? 0.6 : 1
              }}
            >
              {uploading ? 'Processing ESR...' : 'Upload, Import & Generate ESR'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
