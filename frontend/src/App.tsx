import React, { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from '@/components/AuthScreen';
import { useAuth } from '@/components/AuthContext';
import { LearnerLiveSupport } from '@/components/LearnerLiveSupport';
import { OnboardingWalkthrough, ONBOARD_ACTIVE_KEY, ONBOARD_KEY, ONBOARD_STEP_KEY } from '@/components/OnboardingWalkthrough';
import { AccountRoute, AdminRoute, ProtectedRoute } from '@/routes/guards';

const HomeDashboard = lazy(() => import('@/pages/app/HomeDashboard').then(module => ({ default: module.HomeDashboard })));
const SignupPage = lazy(() => import('@/pages/public/Signuppage').then(module => ({ default: module.SignupPage })));
const LoginPage = lazy(() => import('@/pages/public/Loginpage').then(module => ({ default: module.LoginPage })));
const SandboxPage = lazy(() => import('@/pages/app/SandboxPage').then(module => ({ default: module.SandboxPage })));
const LandingPage = lazy(() => import('@/pages/public/Landingpage').then(module => ({ default: module.LandingPage })));
const ProgressPage = lazy(() => import('@/pages/app/Progresspage').then(module => ({ default: module.ProgressPage })));
const ProfileSettings = lazy(() => import('@/pages/app/ProfileSettings').then(module => ({ default: module.ProfileSettings })));
const LeaderboardPage = lazy(() => import('@/pages/app/LeaderboardPage').then(module => ({ default: module.LeaderboardPage })));
const WelcomePage = lazy(() => import('@/pages/public/WelcomePage').then(module => ({ default: module.WelcomePage })));
const CampaignPage = lazy(() => import('@/pages/app/CampaignPage').then(module => ({ default: module.CampaignPage })));
const CampaignInside = lazy(() => import('@/pages/app/CampaignInside'));
const LessonActivity = lazy(() => import('@/pages/app/lessonactivity'));
const AdminPanel = lazy(() => import('@/pages/admin/AdminPanel').then(module => ({ default: module.AdminPanel })));
const UserManualPage = lazy(() => import('@/pages/public/UserManualPage'));
const TutorialsPage = lazy(() => import('@/pages/public/TutorialsPage'));
const PatchNotesPage = lazy(() => import('@/pages/public/PatchNotesPage'));

const RouteLoading: React.FC = () => (
  <main
    aria-busy="true"
    aria-label="Loading page"
    style={{
      minHeight: '100vh',
      display: 'grid',
      placeItems: 'center',
      background: '#0d1117',
      color: '#c9d1d9',
      fontFamily: 'system-ui, sans-serif',
    }}
  >
    Loading…
  </main>
);

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
        <LearnerLiveSupport />
        <div style={{ minHeight: '100vh' }}>
          <Suspense fallback={<RouteLoading />}>
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
              <Route path="/home" element={<ProtectedRoute><HomeDashboard /></ProtectedRoute>} />
              <Route path="/sandbox" element={<ProtectedRoute><SandboxPage /></ProtectedRoute>} />

              {/* Account-only Routes — guests are redirected to sign up */}
              <Route path="/progress" element={<AccountRoute><ProgressPage /></AccountRoute>} />
              <Route path="/profile" element={<AccountRoute><ProfileSettings /></AccountRoute>} />

              {/* Campaign Routes — account required to track progress */}
              <Route path="/campaign" element={<AccountRoute><CampaignPage /></AccountRoute>} />
              <Route path="/campaign/inside/:phase" element={<AccountRoute><CampaignInside /></AccountRoute>} />
              <Route path="/lesson/:questId" element={<AccountRoute><LessonActivity /></AccountRoute>} />

              {/* Admin Route — only accessible to users with is_admin = true */}
              <Route path="/admin" element={<AdminRoute><AdminPanel /></AdminRoute>} />

              {/* Redirects */}
              <Route path="/settings" element={<Navigate to="/home" replace />} />

              {/* Catch-all */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </div>
      </AuthProvider>
    </BrowserRouter>
  );
};

export default App;
