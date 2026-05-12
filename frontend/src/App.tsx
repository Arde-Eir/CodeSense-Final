import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './components/AuthScreen';
import { OnboardingWalkthrough, ONBOARD_KEY } from './components/OnboardingWalkthrough';
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
import PatchNotesPage from './PatchNotesPage';

// ── Impersonation banner — shown globally when an admin is previewing a user ──
const BANNER_HEIGHT = 40; // px — keep in sync with banner padding + line-height

const ImpersonationBanner: React.FC = () => {
  const { impersonatingUser, stopImpersonation, user } = useAuth();
  const navigate = useNavigate();

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
        👁️ Admin preview — you are <strong>{impersonatingUser.playerName}</strong>
        {' '}viewing as <strong>{user?.playerName}</strong>
      </span>
      <button
        onClick={() => { stopImpersonation(); navigate('/admin'); }}
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

// Allows any session — both real accounts AND guest sessions.
const ProtectedRoute: React.FC<{ children: React.ReactElement }> = ({ children }) => {
  const { isAuthenticated, isGuest } = useAuth();
  if (!isAuthenticated && !isGuest) return <Navigate to="/login" replace />;
  return children;
};

// Requires a real account — guests are redirected to sign up.
const AccountRoute: React.FC<{ children: React.ReactElement }> = ({ children }) => {
  const { isAuthenticated, isGuest } = useAuth();
  if (!isAuthenticated || isGuest) return <Navigate to="/signup" replace />;
  return children;
};

const AdminRoute: React.FC<{ children: React.ReactElement }> = ({ children }) => {
  const { isAuthenticated, isAdmin, impersonatingUser } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  // During impersonation isAdmin=false, but impersonatingUser holds the real
  // admin — allow access so stopImpersonation can navigate back to /admin.
  if (!isAdmin && !impersonatingUser) return <Navigate to="/home" replace />;
  return children;
};

// ── Tour controller — lives outside <Routes> so the overlay persists across ──
// all page navigations. Auto-shows for new accounts; responds to the global
// 'cs-replay-tour' event dispatched by the profile-menu "Replay Welcome Tour"
// button. Guests never see the tour.
const TourController: React.FC = () => {
  const { user, isGuest, isAdmin } = useAuth();
  const [showTour, setShowTour] = useState(false);

  // Auto-trigger for new users (localStorage key not yet set).
  useEffect(() => {
    if (!user || isGuest) return;
    try {
      if (localStorage.getItem(ONBOARD_KEY) !== 'done') {
        const t = setTimeout(() => setShowTour(true), 800);
        return () => clearTimeout(t);
      }
    } catch { /* localStorage unavailable */ }
  }, [user?.id, isGuest]);

  // Allow any page to trigger a replay via a custom event.
  useEffect(() => {
    const handler = () => { if (user && !isGuest) setShowTour(true); };
    window.addEventListener('cs-replay-tour', handler);
    return () => window.removeEventListener('cs-replay-tour', handler);
  }, [user, isGuest]);

  if (!showTour || !user || isGuest) return null;
  return (
    <OnboardingWalkthrough
      isAdmin={isAdmin}
      onFinish={() => setShowTour(false)}
    />
  );
};

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <AuthProvider>
        <TourController />
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
          <Route path="/patch-notes" element={<PatchNotesPage />} />

          {/* Protected Routes — guests allowed */}
          <Route path="/home"    element={<ProtectedRoute><HomeDashboard /></ProtectedRoute>} />
          <Route path="/sandbox" element={<ProtectedRoute><SandboxPage /></ProtectedRoute>} />

          {/* Account-only Routes — guests are redirected to sign up */}
          <Route path="/progress" element={<AccountRoute><ProgressPage /></AccountRoute>} />
          <Route path="/profile"  element={<AccountRoute><ProfileSettings /></AccountRoute>} />

          {/* Campaign Routes — account required to track progress */}
          <Route path="/campaign"               element={<AccountRoute><CampaignPage /></AccountRoute>} />
          <Route path="/campaign/inside/:phase" element={<AccountRoute><CampaignInside /></AccountRoute>} />
          <Route path="/lesson/:questId"        element={<AccountRoute><LessonActivity /></AccountRoute>} />

          {/* Admin Route — only accessible to users with is_admin = true */}
          <Route path="/admin" element={<AdminRoute><AdminPanel /></AdminRoute>} />

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