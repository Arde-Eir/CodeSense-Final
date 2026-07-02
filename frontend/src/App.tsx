import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { AuthProvider } from '@/components/AuthScreen';
import { useAuth } from '@/components/AuthContext';
import { OnboardingWalkthrough, ONBOARD_ACTIVE_KEY, ONBOARD_KEY, ONBOARD_STEP_KEY } from '@/components/OnboardingWalkthrough';
import { AccountRoute, AdminRoute, ProtectedRoute } from '@/routes/guards';
import { HomeDashboard } from '@/pages/app/HomeDashboard';
import { SignupPage } from '@/pages/public/Signuppage';
import { LoginPage } from '@/pages/public/Loginpage';
import { SandboxPage } from '@/pages/app/SandboxPage';
import { LandingPage } from '@/pages/public/Landingpage';
import { ProgressPage } from '@/pages/app/Progresspage';
import { ProfileSettings } from '@/pages/app/ProfileSettings';
import { LeaderboardPage } from '@/pages/app/LeaderboardPage';
import { WelcomePage } from '@/pages/public/WelcomePage';
import { CampaignPage } from '@/pages/app/CampaignPage';
import CampaignInside from '@/pages/app/CampaignInside';
// LevelOneDashboard removed — CampaignInside now handles all three phases.
import LessonActivity from '@/pages/app/lessonactivity';
import { AdminPanel } from '@/pages/admin/AdminPanel';
import UserManualPage from '@/pages/public/UserManualPage';
import TutorialsPage from '@/pages/public/TutorialsPage';
import PatchNotesPage from '@/pages/public/PatchNotesPage';

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

// ── Tour controller — lives outside <Routes> so the overlay persists across ──
// all page navigations. Auto-shows for new accounts; responds to the global
// 'cs-replay-tour' event dispatched by the profile-menu "Replay Welcome Tour"
// button. Guests can start the tour manually from the same menu.
const TourController: React.FC = () => {
  const { user, isGuest, isAdmin } = useAuth();
  const [tourSession, setTourSession] = useState(0);
  const [showTour, setShowTour] = useState(() => {
    try {
      return localStorage.getItem(ONBOARD_ACTIVE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  // Auto-trigger for new users (localStorage key not yet set).
  useEffect(() => {
    if (!user || isGuest) return;
    try {
      if (localStorage.getItem(ONBOARD_ACTIVE_KEY) === 'true') {
        return;
      }
      if (localStorage.getItem(ONBOARD_KEY) !== 'done') {
        localStorage.setItem(ONBOARD_ACTIVE_KEY, 'true');
        localStorage.setItem(ONBOARD_STEP_KEY, '0');
        const t = setTimeout(() => setShowTour(true), 800);
        return () => clearTimeout(t);
      }
    } catch { /* localStorage unavailable */ }
  }, [user, user?.id, isGuest]);

  useEffect(() => {
    if (!isGuest) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      if (localStorage.getItem(ONBOARD_ACTIVE_KEY) === 'true') {
        timer = setTimeout(() => setShowTour(true), 0);
      }
    } catch { /* localStorage unavailable */ }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [isGuest]);

  // Allow any page to trigger a replay via a custom event.
  useEffect(() => {
    const handler = () => {
      try {
        localStorage.setItem(ONBOARD_ACTIVE_KEY, 'true');
        localStorage.setItem(ONBOARD_STEP_KEY, '0');
      } catch { /* localStorage unavailable */ }
      setTourSession(session => session + 1);
      if (user || isGuest) setShowTour(true);
    };
    window.addEventListener('cs-replay-tour', handler);
    return () => window.removeEventListener('cs-replay-tour', handler);
  }, [user, isGuest]);

  if (!showTour || (!user && !isGuest)) return null;
  return (
    <OnboardingWalkthrough
      key={tourSession}
      isAdmin={isAdmin}
      isGuest={isGuest}
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
