import type { FC } from 'react';
import { Link } from 'react-router-dom';

export const CampaignHeader: FC<{ userXP: number }> = ({ userXP }) => (
  <header className="campaign-header">
    <div className="campaign-header-brand">
      <span style={{ fontSize: 18 }} aria-hidden="true">🎯</span>
      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 15, letterSpacing: '-0.3px' }}>
        CodeSense Journey
      </span>
    </div>
    <div className="campaign-header-actions">
      <div className="xp-pill">
        <span style={{ fontSize: 12 }} aria-hidden="true">⚡</span>
        <span>{userXP.toLocaleString()} XP</span>
      </div>
      <Link className="campaign-exit-link" to="/home" data-testid="campaign-exit-home">← Exit to Home</Link>
    </div>
  </header>
);
