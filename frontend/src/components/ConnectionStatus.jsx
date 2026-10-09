const labels = { checking: 'Checking', connected: 'Connected', unavailable: 'Unavailable' };

export default function ConnectionStatus({ title, description, status }) {
  return (
    <article className="connection-card">
      <div className="connection-card-heading">
        <h3>{title}</h3>
        <span className={`status status-${status.state}`}>
          <span className="status-dot" aria-hidden="true" />
          {labels[status.state]}
        </span>
      </div>
      <p className="service-description">{description}</p>
      <p className="status-message" role="status" aria-live="polite">{status.message}</p>
    </article>
  );
}
