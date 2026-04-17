import React, { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { CheckCircle2, AlertCircle, RefreshCw, UploadCloud, FileText, Briefcase, Plus, X, Download } from 'lucide-react';

const BankStatementUpload = ({ caseId, customerId, applicantId, applicantType, applicantName, walletBalance, analyzeCost, existingStatus, onComplete }) => {
    const [status, setStatus] = useState(existingStatus?.status || 'INITIATED');
    const [reportId, setReportId] = useState(existingStatus?.report_id || null);
    const [downloads, setDownloads] = useState({ excel: existingStatus?.report_excel_url, json: existingStatus?.report_json_url });
    
    // Store physical file data
    const [files, setFiles] = useState([{ fileName: '', fileBase64: '', password: '' }]);
    const [loading, setLoading] = useState(false);
    
    // UI state
    const [isUploadOpen, setIsUploadOpen] = useState(false);
    const [downloadAttempted, setDownloadAttempted] = useState(false);

    useEffect(() => {
        // Auto-fetch download links if the state is completed but links were never fetched
        if (status === 'COMPLETED' && reportId && !downloads.excel && !downloads.json && !downloadAttempted) {
            setDownloadAttempted(true);
            fetchDownloads();
        }
    }, [status, reportId, downloads, downloadAttempted]);

    const handleFileChange = (index, field, value) => {
        const newFiles = [...files];
        newFiles[index][field] = value;
        setFiles(newFiles);
    };

    const handleFileUpload = (index, e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => {
            const base64Data = reader.result.split(',')[1];
            const newFiles = [...files];
            newFiles[index].fileName = file.name;
            newFiles[index].fileBase64 = base64Data;
            setFiles(newFiles);
        };
    };

    const addFile = () => setFiles([...files, { fileName: '', fileBase64: '', password: '' }]);
    const removeFile = (index) => setFiles(files.filter((_, i) => i !== index));

    const handleAnalyze = async () => {
        const validFiles = files.filter(f => f.fileName && f.fileBase64);
        if (validFiles.length === 0) {
            return toast.error("Please select a physical PDF or Excel file to upload.");
        }

        setLoading(true);
        try {
            const payload = {
                customer_id: customerId,
                case_id: caseId,
                applicant_id: applicantId,
                files: validFiles
            };

            const res = await fetch(`http://localhost:5000/external/bank/analyze`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
                body: JSON.stringify(payload)
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to start analysis');

            toast.success("Bank Analysis Successfully Scheduled");
            setReportId(data.bankRequest.report_id);
            setStatus('ANALYZING');
            setIsUploadOpen(false); // Close the inline drop-down securely
        } catch (error) {
            toast.error(error.message);
        } finally {
            setLoading(false);
        }
    };

    const pollStatus = async () => {
        try {
            setLoading(true);
            const res = await fetch(`http://localhost:5000/external/bank/sync`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
                body: JSON.stringify({ report_id: reportId })
            });
            const data = await res.json();
            
            if (res.ok) {
                setStatus(data.status);
                if (data.status === 'COMPLETED') {
                    toast.success("Bank Analysis processing completed.");
                    await fetchDownloads();
                } else if (data.status === 'FAILED') {
                    toast.error(`Analysis failed at provider: ${data.rawStatus || 'Unknown Error'}`);
                }
            }
        } catch (error) {
            console.error("Sync error:", error);
        } finally {
            setLoading(false);
        }
    };

    const fetchDownloads = async () => {
        setStatus('LOADING_LINKS');
        try {
            const res = await fetch(`http://localhost:5000/external/bank/download`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
                body: JSON.stringify({ report_id: reportId })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to fetch download links');
            
            setDownloads(data.downloadUrls);
            setStatus('COMPLETED');
            onComplete && onComplete('COMPLETED', data.downloadUrls);
        } catch (error) {
            setStatus('FAILED_DOWNLOAD'); // Stop the loop by changing state
            toast.error(error.message);
        }
    };

    const roleLabel = applicantType === 'PRIMARY' ? 'Primary Borrower' : 'Co-Applicant';

    // RENDER HORIZONTAL ROW
    return (
        <div style={{ backgroundColor: 'var(--bg-base)', border: '1px solid #f97316', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
            {/* Summary Row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 1fr) minmax(200px, 2fr) auto', gap: 16, alignItems: 'center', padding: '16px 24px', backgroundColor: 'var(--bg-base)' }}>
                {/* Left: Name and Type */}
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>{applicantName}</span>
                    <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{roleLabel}</span>
                </div>

                {/* Middle: State indicator */}
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                    {status === 'INITIATED' && "No statement uploaded yet"}
                    {status === 'ANALYZING' && <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><RefreshCw size={14} className="spin" color="var(--warning)" /> Auto-Scanning Statements...</span>}
                    {status === 'FAILED' && <span style={{ color: 'var(--error)' }}>Failed to process. Try again.</span>}
                    {status === 'FAILED_DOWNLOAD' && <span style={{ color: 'var(--error)' }}>Analysis Complete but Failed to retrieve secure links.</span>}
                    {status === 'COMPLETED' && "Statement processed and analysed"}
                    {status === 'LOADING_LINKS' && "Retrieving secure reports..."}
                </div>

                {/* Right: Actions */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'flex-end' }}>
                    
                    {/* Status Pills */}
                    {(status === 'COMPLETED' || status === 'FAILED_DOWNLOAD') ? (
                        <span style={{ background: '#dcfce7', color: '#166534', padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                            <CheckCircle2 size={14} /> Uploaded
                        </span>
                    ) : (
                        <span style={{ background: '#fef3c7', color: '#92400e', padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600, border: '1px solid #fde68a' }}>
                            {status === 'ANALYZING' ? 'Processing' : 'Pending'}
                        </span>
                    )}

                    {/* Action Buttons */}
                    {status === 'COMPLETED' ? (
                        <div style={{ display: 'flex', gap: 8 }}>
                            {downloads.pdf && (
                                <a href={downloads.pdf} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '0 10px' }}>
                                    <FileText size={14} /> PDF
                                </a>
                            )}
                            {downloads.excel && (
                                <a href={downloads.excel} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '0 10px' }}>
                                    <Download size={14} /> Excel
                                </a>
                            )}
                            {downloads.json && (
                                <a href={downloads.json} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '0 10px', color: '#64748b' }}>
                                    <FileText size={14} /> JSON
                                </a>
                            )}
                            <button type="button" className="btn btn-secondary btn-sm" style={{ fontWeight: 600, backgroundColor: '#f8fafc', borderColor: '#cbd5e1' }} onClick={() => setIsUploadOpen(!isUploadOpen)}>
                                Replace
                            </button>
                        </div>
                    ) : status === 'FAILED_DOWNLOAD' ? (
                        <button type="button" className="btn btn-sm" style={{ backgroundColor: '#fee2e2', color: '#b91c1c', borderColor: '#fca5a5', fontWeight: 600 }} onClick={() => { setDownloadAttempted(false); fetchDownloads(); }} disabled={loading}>
                            {loading ? '...' : 'Retry Download'}
                        </button>
                    ) : status === 'ANALYZING' ? (
                        <button type="button" className="btn btn-sm" style={{ backgroundColor: '#fef3c7', color: '#92400e', borderColor: '#fcd34d', fontWeight: 600 }} onClick={pollStatus} disabled={loading}>
                            {loading ? '...' : 'Check Status'}
                        </button>
                    ) : (
                        <button type="button" className="btn btn-primary btn-sm" style={{ backgroundColor: '#7c3aed', borderColor: '#7c3aed', padding: '6px 20px', borderRadius: 6, fontWeight: 600 }} onClick={() => setIsUploadOpen(!isUploadOpen)}>
                            Upload PDF
                        </button>
                    )}
                </div>
            </div>

            {/* Expando File UI (Only visible when isUploadOpen is true) */}
            {isUploadOpen && (
                <div style={{ padding: '24px', backgroundColor: '#f8fafc', borderTop: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                        <UploadCloud size={18} color="#64748b" /> 
                        <span style={{ fontWeight: 600, fontSize: 14 }}>Upload Statements Securely</span>
                    </div>

                    {walletBalance < analyzeCost && (
                        <div style={{ padding: 12, borderRadius: 8, background: 'rgba(239,68,68,0.1)', color: 'var(--error)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, marginBottom: 16 }}>
                            <AlertCircle size={16} /> Insufficient credits. Wallet has {walletBalance}, needs {analyzeCost}.
                        </div>
                    )}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {files.map((file, index) => (
                            <div key={index} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', background: 'var(--bg-base)', padding: 16, borderRadius: 8, border: '1px solid #e2e8f0' }}>
                                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                        <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>Select Bank Statement</label>
                                        <input 
                                            type="file" 
                                            accept=".pdf,.xlsx,.xls"
                                            className="form-control" 
                                            onChange={e => handleFileUpload(index, e)} 
                                            style={{ backgroundColor: '#f1f5f9', border: '1px dashed #cbd5e1', padding: '10px' }}
                                        />
                                        {file.fileName && <div style={{ fontSize: 12, color: 'var(--success)', marginTop: 4 }}>✓ Attached: {file.fileName}</div>}
                                    </div>
                                    
                                    <input 
                                        type="text" 
                                        className="form-control" 
                                        placeholder="PDF Password (Optional - if your bank locks the statement)" 
                                        value={file.password} 
                                        onChange={e => handleFileChange(index, 'password', e.target.value)} 
                                        style={{ backgroundColor: '#f1f5f9', border: 'none', borderLeft: '3px solid #fcd34d' }}
                                    />
                                </div>
                                {files.length > 1 && (
                                    <button type="button" className="btn btn-sm btn-ghost" style={{ color: 'var(--error)', padding: '4px' }} onClick={() => removeFile(index)}>
                                        <X size={16} />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
                        <button type="button" className="btn btn-ghost btn-sm" style={{ color: '#64748b', display: 'flex', alignItems: 'center', gap: 4 }} onClick={addFile}>
                            <Plus size={16} /> Add Another File
                        </button>
                        <div style={{ display: 'flex', gap: 12 }}>
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setIsUploadOpen(false)}>Cancel</button>
                            <button type="button" className="btn btn-secondary btn-sm" style={{ borderColor: '#cbd5e1', backgroundColor: '#ffffff', color: '#334155' }} onClick={handleAnalyze} disabled={loading || walletBalance < analyzeCost}>
                                {loading ? 'Wait...' : `Analyze (~${analyzeCost} Cr)`}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default BankStatementUpload;
