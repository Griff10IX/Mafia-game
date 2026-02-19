import { useState, useEffect, Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "./components/ui/sonner";
import Landing from "./pages/Landing";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import VerifyEmail from "./pages/VerifyEmail";
import Layout from "./components/Layout";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./context/ThemeContext";
import "@/App.css";

// Lazy-load authenticated pages to shrink initial bundle
const Dashboard = lazy(() => import("./pages/Dashboard"));
const UsersOnline = lazy(() => import("./pages/UsersOnline"));
const Ranking = lazy(() => import("./pages/Ranking"));
const Crimes = lazy(() => import("./pages/Crimes"));
const GTA = lazy(() => import("./pages/GTA"));
const Garage = lazy(() => import("./pages/Garage"));
const SellCars = lazy(() => import("./pages/SellCars"));
const BuyCars = lazy(() => import("./pages/BuyCars"));
const CarProfile = lazy(() => import("./pages/CarProfile"));
const ViewCar = lazy(() => import("./pages/ViewCar"));
const Jail = lazy(() => import("./pages/Jail"));
const OrganisedCrime = lazy(() => import("./pages/OrganisedCrime"));
const Attack = lazy(() => import("./pages/Attack"));
const Bodyguards = lazy(() => import("./pages/Bodyguards"));
const HitlistPage = lazy(() => import("./pages/HitlistPage"));
const FamilyPage = lazy(() => import("./pages/FamilyPage.js"));
const FamilyProfilePage = lazy(() => import("./pages/FamilyProfilePage.js"));
const Properties = lazy(() => import("./pages/Properties"));
const Casino = lazy(() => import("./pages/Casino"));
const Dice = lazy(() => import("./pages/Casinos/Dice.js"));
const Rlt = lazy(() => import("./pages/Casinos/Rlt.js"));
const Blackjack = lazy(() => import("./pages/Casinos/BlackjackPage"));
const HorseRacing = lazy(() => import("./pages/Casinos/HorseRacingPage"));
const Slots = lazy(() => import("./pages/Casinos/SlotsPage"));
const CrackSafe = lazy(() => import("./pages/CrackSafe"));
const Prestige = lazy(() => import("./pages/Prestige"));
const VideoPoker = lazy(() => import("./pages/Casinos/VideoPokerPage"));
const SportsBetting = lazy(() => import("./pages/SportsBetting"));
const Bank = lazy(() => import("./pages/Bank"));
const ArmourWeapons = lazy(() => import("./pages/ArmourWeapons"));
const Attemps = lazy(() => import("./pages/Attemps"));
const Leaderboard = lazy(() => import("./pages/Leaderboard"));
const Store = lazy(() => import("./pages/Store"));
const Admin = lazy(() => import("./pages/Admin"));
const AdminLocked = lazy(() => import("./pages/AdminLocked"));
const AutoRank = lazy(() => import("./pages/AutoRank"));
const Travel = lazy(() => import("./pages/Travel"));
const States = lazy(() => import("./pages/States"));
const MyProperties = lazy(() => import("./pages/MyProperties"));
const BoozeRun = lazy(() => import("./pages/BoozeRun.js"));
const Inbox = lazy(() => import("./pages/Inbox"));
const InboxChat = lazy(() => import("./pages/InboxChat"));
const Forum = lazy(() => import("./pages/Forum"));
const ForumTopic = lazy(() => import("./pages/ForumTopic"));
const DeadAlive = lazy(() => import("./pages/DeadAlive"));
const Profile = lazy(() => import("./pages/Profile"));
const Stats = lazy(() => import("./pages/Stats"));
const Objectives = lazy(() => import("./pages/Objectives"));
const QuickTrade = lazy(() => import("./pages/QuickTrade"));
const LockedPage = lazy(() => import("./pages/LockedPage"));

const PageLoader = () => (
  <div className="min-h-[200px] flex items-center justify-center text-primary text-sm font-heading">Loading...</div>
);

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (token) {
      setIsAuthenticated(true);
    }
    setIsLoading(false);
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-primary text-xl font-heading">Loading...</div>
      </div>
    );
  }

  return (
    <div className="App">
      <BrowserRouter>
        <ThemeProvider>
        <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route
            path="/"
            element={
              isAuthenticated ? (
                <Navigate to="/dashboard" replace />
              ) : (
                <Landing setIsAuthenticated={setIsAuthenticated} />
              )
            }
          />
          <Route
            path="/forgot-password"
            element={<ForgotPassword />}
          />
          <Route
            path="/reset-password"
            element={<ResetPassword />}
          />
          <Route
            path="/verify-email"
            element={<VerifyEmail setIsAuthenticated={setIsAuthenticated} />}
          />
          <Route
            path="/locked"
            element={
              isAuthenticated ? (
                <LockedPage />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/dashboard"
            element={
              isAuthenticated ? (
                <Layout>
                  <Dashboard />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/users-online"
            element={
              isAuthenticated ? (
                <Layout>
                  <UsersOnline />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/bank"
            element={
              isAuthenticated ? (
                <Layout>
                  <Bank />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/stats"
            element={
              isAuthenticated ? (
                <Layout>
                  <Stats />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/jail"
            element={
              isAuthenticated ? (
                <Layout>
                  <Jail />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/organised-crime"
            element={
              isAuthenticated ? (
                <Layout>
                  <OrganisedCrime />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/objectives"
            element={
              isAuthenticated ? (
                <Layout>
                  <Objectives />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/ranking"
            element={
              isAuthenticated ? (
                <Layout>
                  <Ranking />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/crimes"
            element={
              isAuthenticated ? (
                <Layout>
                  <Crimes />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/gta"
            element={
              isAuthenticated ? (
                <Layout>
                  <GTA />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/gta/car/:carId"
            element={
              isAuthenticated ? (
                <Layout>
                  <CarProfile />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/view-car"
            element={
              isAuthenticated ? (
                <Layout>
                  <ViewCar />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/garage"
            element={
              isAuthenticated ? (
                <Layout>
                  <Garage />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/sell-cars"
            element={
              isAuthenticated ? (
                <Layout>
                  <SellCars />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/buy-cars"
            element={
              isAuthenticated ? (
                <Layout>
                  <BuyCars />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/admin"
            element={
              isAuthenticated ? (
                <Layout>
                  <Admin />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/admin/locked"
            element={
              isAuthenticated ? (
                <Layout>
                  <AdminLocked />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/auto-rank"
            element={
              isAuthenticated ? (
                <Layout>
                  <AutoRank />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/attack"
            element={
              isAuthenticated ? (
                <Layout>
                  <Attack />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/attempts"
            element={
              isAuthenticated ? (
                <Layout>
                  <Attemps />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/hitlist"
            element={
              isAuthenticated ? (
                <Layout>
                  <HitlistPage />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/bodyguards"
            element={
              isAuthenticated ? (
                <Layout>
                  <Bodyguards />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/families"
            element={
              isAuthenticated ? (
                <Layout>
                  <FamilyPage />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/families/:familyId"
            element={
              isAuthenticated ? (
                <Layout>
                  <FamilyProfilePage />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/properties"
            element={
              isAuthenticated ? (
                <Layout>
                  <Properties />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/casino"
            element={
              isAuthenticated ? (
                <Layout>
                  <Casino />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/sports-betting"
            element={
              isAuthenticated ? (
                <Layout>
                  <SportsBetting />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/casino/dice"
            element={
              isAuthenticated ? (
                <Layout>
                  <ErrorBoundary>
                    <Dice />
                  </ErrorBoundary>
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/casino/rlt"
            element={
              isAuthenticated ? (
                <Layout>
                  <Rlt />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/casino/blackjack"
            element={
              isAuthenticated ? (
                <Layout>
                  <Blackjack />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/casino/horseracing"
            element={
              isAuthenticated ? (
                <Layout>
                  <ErrorBoundary>
                    <HorseRacing />
                  </ErrorBoundary>
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/casino/slots"
            element={
              isAuthenticated ? (
                <Layout>
                  <Slots />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/casino/videopoker"
            element={
              isAuthenticated ? (
                <Layout>
                  <VideoPoker />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/prestige"
            element={
              isAuthenticated ? (
                <Layout>
                  <Prestige />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/crack-safe"
            element={
              isAuthenticated ? (
                <Layout>
                  <CrackSafe />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/armour-weapons"
            element={
              isAuthenticated ? (
                <Layout>
                  <ArmourWeapons />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route path="/weapons" element={<Navigate to="/armour-weapons" replace />} />
          <Route path="/armour" element={<Navigate to="/armour-weapons" replace />} />
          <Route
            path="/leaderboard"
            element={
              isAuthenticated ? (
                <Layout>
                  <Leaderboard />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/store"
            element={
              isAuthenticated ? (
                <Layout>
                  <Store />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/quick-trade"
            element={
              isAuthenticated ? (
                <Layout>
                  <QuickTrade />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/travel"
            element={
              isAuthenticated ? (
                <Layout>
                  <Travel />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/states"
            element={
              isAuthenticated ? (
                <Layout>
                  <States />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/my-properties"
            element={
              isAuthenticated ? (
                <Layout>
                  <MyProperties />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/booze-run"
            element={
              isAuthenticated ? (
                <Layout>
                  <BoozeRun />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/forum"
            element={
              isAuthenticated ? (
                <Layout>
                  <Forum />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/forum/topic/:topicId"
            element={
              isAuthenticated ? (
                <Layout>
                  <ForumTopic />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/inbox"
            element={
              isAuthenticated ? (
                <Layout>
                  <Inbox />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/inbox/chat/:userId"
            element={
              isAuthenticated ? (
                <Layout>
                  <InboxChat />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/dead-alive"
            element={
              isAuthenticated ? (
                <Layout>
                  <DeadAlive />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/profile"
            element={
              isAuthenticated ? (
                <Layout>
                  <Profile />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/profile/:username"
            element={
              isAuthenticated ? (
                <Layout>
                  <Profile />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
        </Routes>
        </Suspense>
        </ThemeProvider>
      </BrowserRouter>
      <Toaster position="bottom-center" offset="max(16px, env(safe-area-inset-bottom, 16px))" />
    </div>
  );
}

export default App;
