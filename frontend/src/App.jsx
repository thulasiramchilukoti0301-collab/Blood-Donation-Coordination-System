import { useCallback, useEffect, useRef, useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import ConnectionStatus from './components/ConnectionStatus';
import FoundationLayout from './layouts/FoundationLayout';
import { checkHealth } from './services/health';

const checking = { state: 'checking', message: 'Waiting for a health-check response…' };

function FoundationHome() {
  const [backend, setBackend] = useState(checking);
  const [database, setDatabase] = useState(checking);
  const [lastChecked, setLastChecked] = useState(null);
  const controller = useRef(null);
  const busy = backend.state === 'checking' || database.state === 'checking';

  const refresh = useCallback(async () => {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setBackend(checking);
    setDatabase(checking);
    await Promise.all([
      checkHealth('/health', request.signal).then((result) => {
        if (!request.signal.aborted) setBackend(result);
      }),
      checkHealth('/health/db', request.signal).then((result) => {
        if (!request.signal.aborted) setDatabase(result);
      }),
    ]);
    if (!request.signal.aborted) setLastChecked(new Date());
  }, []);

  useEffect(() => {
    void refresh();
    return () => controller.current?.abort();
  }, [refresh]);

  return (
    <FoundationLayout>
      <section className="intro">
        <p className="eyebrow">A connected foundation for coordinated care</p>
        <h1>Blood Donation<br />Coordination System</h1>
        <p className="intro-description">An academic project to bring donors, blood bank staff, and hospitals together through a coordinated donation network.</p>
        <div className="foundation-note"><span className="note-mark" aria-hidden="true">01</span><p>The project foundation is ready. This development page verifies service connectivity as the application takes shape.</p></div>
      </section>

      <section className="connectivity" aria-labelledby="connectivity-title" aria-busy={busy}>
        <div className="section-heading">
          <div><p className="eyebrow">Live service checks</p><h2 id="connectivity-title">Connection status</h2></div>
          <button type="button" onClick={refresh} disabled={busy}>{busy ? 'Checking…' : 'Check again'}</button>
        </div>
        <div className="connection-grid">
          <ConnectionStatus title="Backend API" description="Express application" status={backend} />
          <ConnectionStatus title="Database" description="MySQL connectivity" status={database} />
        </div>
        <p className="check-time">{lastChecked ? `Last checked at ${lastChecked.toLocaleTimeString()}` : 'Checking the configured services…'}</p>
      </section>
    </FoundationLayout>
  );
}

function NotFound() {
  return <FoundationLayout><section className="intro"><h1>Page not found</h1><p>Only the foundation page is available in this phase.</p><a href="/">Return to the foundation page</a></section></FoundationLayout>;
}

export default function App() {
  return <Routes><Route path="/" element={<FoundationHome />} /><Route path="*" element={<NotFound />} /></Routes>;
}
