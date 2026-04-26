import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './components/AuthScreen';
import { HomeDashboard } from './HomeDashboard';
import { SignupPage } from './Signuppage';
import { LoginPage } from './Loginpage';
import { SandboxPage } from './SandboxPage';
import { LandingPage } from './Landingpage';
import { ProgressPage } from './Progresspage';
import { ProfileSettings } from './ProfileSettings';
import { LeaderboardPage } from './LeaderboardPage';
import { WelcomePage } from './WelcomePage';
import { CampaignPage } from './CampaignPage';
import CampaignInside from './CampaignInside';
// LevelOneDashboard removed — CampaignInside now handles all three phases.
import LessonActivity from './lessonactivity';
import { AdminPanel } from './AdminPanel';
import UserManualPage from './UserManualPage';
import TutorialsPage from './TutorialsPage';

// ── Impersonation banner — shown globally when an admin is previewing a user ──
const BANNER_HEIGHT = 40; // px — keep in sync with banner padding + line-height

const ImpersonationBanner: React.FC = () => {
  const { impersonatingUser, stopImpersonation, user } = useAuth();

  // While the banner is visible, add top padding to <body> so page content
  // isn't hidden behind the fixed-position banner.
  useEffect(() => {
    if (!impersonatingUser) return;
    const prev = document.body.style.paddingTop;
    document.body.style.paddingTop = `${BANNER_HEIGHT}px`;
    return () => { document.body.style.paddingTop = prev; };
  }, [impersonatingUser]);

  if (!impersonatingUser) return null;
  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
      height: `${BANNER_HEIGHT}px`, boxSizing: 'border-box',
      background: 'linear-gradient(90deg, #b45309, #92400e)',
      color: 'white', padding: '0 20px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      fontSize: '13px', fontWeight: '600', boxShadow: '0 2px 12px rgba(0,0,0,0.5)',
    }}>
      <span>
        👁️ Admin preview — viewing as <strong>{user?.playerName}</strong>
        {' '}(impersonating real admin: <strong>{impersonatingUser.playerName}</strong>)
      </span>
      <button
        onClick={stopImpersonation}
        style={{
          background: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.4)',
          color: 'white', borderRadius: '6px', padding: '4px 14px',
          cursor: 'pointer', fontSize: '12px', fontWeight: '700',
        }}
      >
        Exit Preview
      </button>
    </div>
  );
};

// ── Route guards ──────────────────────────────────────────────────────────────
const ProtectedRoute: React.FC<{ children: React.ReactElement }> = ({ children }) => {
  const { isAuthenticated, isGuest } = useAuth();
  if (!isAuthenticated && !isGuest) return <Navigate to="/login" replace />;
  return children;
};

const AdminRoute: React.FC<{ children: React.ReactElement }> = ({ children }) => {
  const { isAuthenticated, isAdmin } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!isAdmin)         return <Navigate to="/home"  replace />;
  return children;
};

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ImpersonationBanner />
        <Routes>
          {/* Public Routes */}
          <Route path="/" element={<LandingPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/welcome" element={<WelcomePage />} />
          <Route path="/leaderboard" element={<LeaderboardPage />} />
          <Route path="/manual" element={<UserManualPage />} />
          <Route path="/tutorials" element={<TutorialsPage />} />

          {/* Protected Routes */}
          <Route path="/home"     element={<ProtectedRoute><HomeDashboard /></ProtectedRoute>} />
          <Route path="/progress" element={<ProtectedRoute><ProgressPage /></ProtectedRoute>} />
          <Route path="/sandbox"  element={<ProtectedRoute><SandboxPage /></ProtectedRoute>} />
          <Route path="/profile"  element={<ProtectedRoute><ProfileSettings /></ProtectedRoute>} />

          {/* Campaign Routes — CampaignInside handles all 3 phases (beginner /
              intermediate / advanced). The old `/level/1` route was removed
              because Level 1 is no longer special-cased. */}
          <Route path="/campaign"               element={<ProtectedRoute><CampaignPage /></ProtectedRoute>} />
          <Route path="/campaign/inside/:phase" element={<ProtectedRoute><CampaignInside /></ProtectedRoute>} />
          <Route path="/lesson/:questId"        element={<ProtectedRoute><LessonActivity /></ProtectedRoute>} />

          {/* Admin Route — only accessible to users with is_admin = true */}
          <Route path="/admin" element={<AdminRoute><AdminPanel /></AdminRoute>} />
          <Route path="/admin/*" element={<AdminRoute><AdminPanel /></AdminRoute>} />

          {/* Redirects */}
          <Route path="/settings" element={<Navigate to="/home" replace />} />

          {/* Catch-all */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
};

export default App;
