export default function FoundationLayout({ children }) {
  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="brand"><span className="brand-mark" aria-hidden="true">+</span> Blood Donation Coordination</div>
        <span className="phase-label">Phase 1 · Foundation</span>
      </header>
      <main>{children}</main>
      <footer className="site-footer">Academic DBMS Laboratory Project <span>React · Express · MySQL</span></footer>
    </div>
  );
}
