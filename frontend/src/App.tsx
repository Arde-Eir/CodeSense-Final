import React from 'react';
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
import LevelOneDashboard from './levelonedashboard';
import LessonActivity from './lessonactivity';

const ProtectedRoute: React.FC<{ children: React.ReactElement }> = ({ children }) => {
  const { isAuthenticated, isGuest } = useAuth();
  if (!isAuthenticated && !isGuest) {
    return <Navigate to="/login" replace />;
  }
  return children;
};

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public Routes */}
          <Route path="/" element={<LandingPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/welcome" element={<WelcomePage />} />
          <Route path="/leaderboard" element={<LeaderboardPage />} />

          {/* Protected Routes */}
          <Route path="/home" element={<ProtectedRoute><HomeDashboard /></ProtectedRoute>} />
          <Route path="/progress" element={<ProtectedRoute><ProgressPage /></ProtectedRoute>} />
          <Route path="/sandbox" element={<ProtectedRoute><SandboxPage /></ProtectedRoute>} />
          <Route path="/profile" element={<ProtectedRoute><ProfileSettings /></ProtectedRoute>} />

          {/* ── FIX: Campaign Routes — most specific FIRST, parameterised LAST ──
              /campaign/inside          → CampaignInside (no phase param, defaults to 'beginner')
              /campaign/inside/:phase   → CampaignInside with phase param
              /level/1                  → LevelOneDashboard
              /lesson/:questId          → LessonActivity
              /campaign                 → CampaignPage (exact, no param)
              /campaign/:phase          → CampaignPage with phase param — must be LAST so
                                          "inside" is never swallowed as :phase
          */}
          <Route path="/campaign" element={<ProtectedRoute><CampaignPage /></ProtectedRoute>} />
          <Route path="/campaign/inside" element={<ProtectedRoute><CampaignInside /></ProtectedRoute>} />
          <Route path="/campaign/inside/:phase" element={<ProtectedRoute><CampaignInside /></ProtectedRoute>} />
          <Route path="/level/1" element={<ProtectedRoute><LevelOneDashboard /></ProtectedRoute>} />
          <Route path="/lesson/:questId" element={<ProtectedRoute><LessonActivity /></ProtectedRoute>} />
          {/* :phase LAST — static segments always win in React Router v6, but being
              explicit prevents future confusion if new sub-routes are added */}
          <Route path="/campaign/:phase" element={<ProtectedRoute><CampaignPage /></ProtectedRoute>} />

          {/* Redirects */}
          <Route path="/settings" element={<Navigate to="/home" replace />} />

          {/* Catch-all — exactly one, at the very bottom */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
};

export default App;