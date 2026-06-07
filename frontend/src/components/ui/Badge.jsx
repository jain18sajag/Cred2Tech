import React from 'react';
import { ROLES } from '../../constants/roles';

const Badge = ({ type = 'role', value, variant, children, className = '' }) => {
  const displayValue = children || value;
  if (!displayValue) return <span style={{ color: 'var(--text-tertiary)' }}>—</span>;

  let color, bg, label;

  if (variant) {
    label = displayValue;
    if (variant === 'success') { color = 'var(--success)'; bg = 'var(--success-bg)'; }
    else if (variant === 'warning') { color = 'var(--warning)'; bg = 'var(--warning-bg)'; }
    else if (variant === 'danger') { color = 'var(--danger)'; bg = 'var(--danger-bg)'; }
    else if (variant === 'info') { color = 'var(--info)'; bg = 'var(--info-bg)'; }
    else { color = 'var(--text-secondary)'; bg = 'var(--bg-elevated)'; }
  } else if (type === 'role') {
    const role = ROLES[displayValue] || {};
    color = role.color || 'var(--text-secondary)';
    bg = role.bg || 'var(--bg-elevated)';
    label = role.name || displayValue;
  } else if (type === 'status') {
    if (displayValue === 'ACTIVE') {
      color = 'var(--success)'; bg = 'var(--success-bg)'; label = 'Active';
    } else {
      color = 'var(--text-tertiary)'; bg = 'var(--bg-elevated)'; label = 'Inactive';
    }
  } else if (type === 'level') {
    color = 'var(--info)'; bg = 'var(--info-bg)'; label = displayValue;
  } else {
    color = 'var(--text-secondary)'; bg = 'var(--bg-elevated)'; label = displayValue;
  }

  return (
    <span
      className={`badge ${className}`}
      style={{ color, backgroundColor: bg, border: `1px solid ${color}22` }}
    >
      {label}
    </span>
  );
};

export default Badge;
