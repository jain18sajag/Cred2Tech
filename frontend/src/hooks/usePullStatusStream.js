import { useState, useEffect, useRef } from 'react';
import api from '../api/axiosInstance';
import { fetchEventSource } from '@microsoft/fetch-event-source';
import { useAuth } from '../context/AuthContext';

const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api';

export function usePullStatusStream(caseId) {
    const [statuses, setStatuses] = useState({
        gst: { status: 'NOT_STARTED' },
        bank: { status: 'NOT_STARTED' },
        itr: { status: 'NOT_STARTED' },
        bureau: { status: 'NOT_STARTED', completedCount: 0, totalCount: 0 }
    });
    const { token } = useAuth();
    const [isConnected, setIsConnected] = useState(false);

    // Initial Fetch
    useEffect(() => {
        if (!caseId) return;
        
        const fetchStatuses = async () => {
            try {
                const res = await api.get(`/cases/${caseId}/pull-statuses`);
                setStatuses(res.data);
            } catch (err) {
                console.error('[SSE] Initial fetch failed:', err);
            }
        };
        fetchStatuses();
    }, [caseId]);

    // SSE Connection
    const abortControllerRef = useRef(null);

    useEffect(() => {
        if (!caseId || !token) return;

        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
        abortControllerRef.current = new AbortController();

        const connect = async () => {
            try {
                await fetchEventSource(`${BASE_URL}/cases/${caseId}/pull-status-stream`, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${token}`
                    },
                    signal: abortControllerRef.current.signal,
                    onopen(response) {
                        if (response.ok) {
                            console.log('[SSE] Connected to pull status stream');
                            setIsConnected(true);
                        } else if (response.status >= 400 && response.status < 500 && response.status !== 429) {
                            console.error('[SSE] Client error:', response.status);
                            throw new Error('Client error');
                        }
                    },
                    onmessage(event) {
                        if (event.event === 'case_status_updates') {
                            try {
                                const data = JSON.parse(event.data);
                                if (data.case_id === parseInt(caseId, 10)) {
                                    setStatuses(prev => ({
                                        ...prev,
                                        [data.pull_type.toLowerCase()]: { status: data.status }
                                    }));
                                    
                                    api.get(`/cases/${caseId}/pull-statuses`).then(res => {
                                        setStatuses(res.data);
                                    });
                                }
                            } catch (err) {
                                console.error('[SSE] Parse error:', err);
                            }
                        } else if (event.event === 'connected') {
                            console.log('[SSE] Connected confirmation:', event.data);
                        }
                    },
                    onclose() {
                        console.log('[SSE] Connection closed');
                        setIsConnected(false);
                    },
                    onerror(err) {
                        console.error('[SSE] Stream error, attempting reconnect:', err);
                        setIsConnected(false);
                        // fetchEventSource will auto-reconnect unless we throw
                    }
                });
            } catch (err) {
                console.error('[SSE] Fatal connect error:', err);
            }
        };

        connect();

        return () => {
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
                setIsConnected(false);
            }
        };
    }, [caseId, token]);

    return { statuses, isConnected };
}
