import { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "./components/ui/sonner";
import Landing from "./pages/Landing";
import Dashboard from "./pages/Dashboard";
import UsersOnline from "./pages/UsersOnline";
import Ranking from "./pages/Ranking";
import Crimes from "./pages/Crimes";
import GTA from "./pages/GTA";
import Garage from "./pages/Garage";
import CarProfile from "./pages/CarProfile";
import Jail from "./pages/Jail";
import OrganisedCrime from "./pages/OrganisedCrime";
import Attack from "./pages/Attack";
import Bodyguards from "./pages/Bodyguards";
import HitlistPage from "./pages/HitlistPage";
import FamilyPage from "./pages/FamilyPage.js";
import FamilyProfilePage from "./pages/FamilyProfilePage.js";
import Properties from "./pages/Properties";
import Casino from "./pages/Casino";
import Dice from "./pages/Casinos/Dice.js";
import Rlt from "./pages/Casinos/Rlt.js";
import Blackjack from "./pages/Casinos/BlackjackPage";
import HorseRacing from "./pages/Casinos/HorseRacingPage";
import SportsBetting from "./pages/SportsBetting";
import Bank from "./pages/Bank";
import ArmourWeapons from "./pages/ArmourWeapons";
import Attemps from "./pages/Attemps";
import Leaderboard from "./pages/Leaderboard";
import Store from "./pages/Store";
import Admin from "./pages/Admin";
import Travel from "./pages/Travel";
import States from "./pages/States";
import BoozeRun from "./pages/BoozeRun.js";
import Inbox from "./pages/Inbox";
import InboxChat from "./pages/InboxChat";
import DeadAlive from "./pages/DeadAlive";
import Profile from "./pages/Profile";
import Stats from "./pages/Stats";
import QuickTrade from "./pages/QuickTrade";
import Layout from "./components/Layout";
import ErrorBoundary from "./components/ErrorBoundary";
import "@/App.css";

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
                  <HorseRacing />
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
      </BrowserRouter>
      <Toaster position="bottom-center" offset="max(16px, env(safe-area-inset-bottom, 16px))" />
    </div>
  );
}

export default App;
