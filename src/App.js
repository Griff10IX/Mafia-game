import { useState, useEffect, Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route, Navigate, useParams } from "react-router-dom";
import { ThemedToaster } from "./components/ThemedToaster";
import Landing from "./pages/Landing";
import StaffLogin from "./pages/StaffLogin";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import VerifyEmail from "./pages/VerifyEmail";
import VerifyComplete from "./pages/VerifyComplete";
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
const DailyRewards = lazy(() => import("./pages/DailyRewards"));
const Prestige = lazy(() => import("./pages/Prestige"));
const VideoPoker = lazy(() => import("./pages/Casinos/VideoPokerPage"));
const MDG = lazy(() => import("./pages/Casinos/MDGPage"));
const MPBlackjack = lazy(() => import("./pages/Casinos/MPBlackjackPage"));
const MPBlackjackGame = lazy(() => import("./pages/Casinos/MPBlackjackGamePage"));
const MPPoker = lazy(() => import("./pages/Casinos/MPPokerPage"));
const MPPokerGame = lazy(() => import("./pages/Casinos/MPPokerGamePage"));
const SportsBetting = lazy(() => import("./pages/SportsBetting"));
const StockMarket = lazy(() => import("./pages/StockMarket"));
const Bank = lazy(() => import("./pages/Bank"));
const ArmourWeapons = lazy(() => import("./pages/ArmourWeapons"));
const ShootingRange = lazy(() => import("./pages/ShootingRange"));
const ShootingRange3D = lazy(() => import("./pages/ShootingRange3D"));
const Attemps = lazy(() => import("./pages/Attemps"));
const Leaderboard = lazy(() => import("./pages/Leaderboard"));
const MiniGamesLeaderboard = lazy(() => import("./pages/MiniGamesLeaderboard"));
const Minesweeper = lazy(() => import("./pages/Minesweeper"));
const Battleships = lazy(() => import("./pages/Battleships"));
const TheGetaway = lazy(() => import("./pages/TheGetaway"));
const Store = lazy(() => import("./pages/Store"));
const Admin = lazy(() => import("./pages/Admin"));
const AdminLocked = lazy(() => import("./pages/AdminLocked"));
const AdminUsersOnline = lazy(() => import("./pages/AdminUsersOnline"));
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
const MyStats = lazy(() => import("./pages/MyStats"));
const MyInventory = lazy(() => import("./pages/MyInventory"));
const Objectives = lazy(() => import("./pages/Objectives"));
const Missions = lazy(() => import("./pages/Missions"));
const LootBox = lazy(() => import("./pages/LootBox"));
const QuickTrade = lazy(() => import("./pages/QuickTrade"));
const LockedPage = lazy(() => import("./pages/LockedPage"));
const IPRules = lazy(() => import("./pages/IPRules"));
const HelpDesk = lazy(() => import("./pages/HelpDesk"));
const IllegalBusiness = lazy(() => import("./pages/IllegalBusiness"));
const Gauntlet = lazy(() => import("./pages/Gauntlet"));
const Boxing = lazy(() => import("./pages/Boxing"));
const Racing = lazy(() => import("./pages/Racing"));
const Snake = lazy(() => import("./pages/Snake"));

const PageLoader = () => (
  <div className="min-h-[200px] flex items-center justify-center text-primary text-sm font-heading">Loading...</div>
);

// Redirect helpers for parameterized routes
function ProfileRedirect() {
  const { username } = useParams();
  return <Navigate to={username ? `/account/profile/${username}` : '/account/profile'} replace />;
}
function FamilyRedirect() {
  const { familyId } = useParams();
  return <Navigate to={`/game/family/${familyId}`} replace />;
}
function CarProfileRedirect() {
  const { carId } = useParams();
  return <Navigate to={`/cars/profile/${carId}`} replace />;
}
function InboxChatRedirect() {
  const { userId } = useParams();
  return <Navigate to={`/social/chat/${userId}`} replace />;
}
function ForumTopicRedirect() {
  const { topicId } = useParams();
  return <Navigate to={`/social/forum/${topicId}`} replace />;
}
function BoxingArenaRedirect() {
  const { matchId } = useParams();
  return <Navigate to={`/casino/mini-games/boxing/${matchId}`} replace />;
}
function ShootingRangePlayRedirect() {
  const { weaponId } = useParams();
  return <Navigate to={weaponId ? `/casino/mini-games/shooting-range/play/${weaponId}` : '/casino/mini-games/shooting-range/play'} replace />;
}

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
                <Navigate to="/account/dashboard" replace />
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
            path="/verify-complete"
            element={<VerifyComplete />}
          />
          <Route
            path="/staff-entrance"
            element={
              isAuthenticated ? (
                <Navigate to="/account/dashboard" replace />
              ) : (
                <StaffLogin setIsAuthenticated={setIsAuthenticated} />
              )
            }
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
            path="/account/dashboard"
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
          <Route path="/dashboard" element={<Navigate to="/account/dashboard" replace />} />
          <Route
            path="/game/users-online"
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
          <Route path="/users-online" element={<Navigate to="/game/users-online" replace />} />
          {/* ═══ MONEY GROUP ═══ */}
          <Route
            path="/money/bank"
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
            path="/money/stocks"
            element={
              isAuthenticated ? (
                <Layout>
                  <StockMarket />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          {/* Money redirects */}
          <Route path="/bank" element={<Navigate to="/money/bank" replace />} />
          <Route path="/stock-market" element={<Navigate to="/money/stocks" replace />} />
          <Route
            path="/game/stats"
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
          <Route path="/stats" element={<Navigate to="/game/stats" replace />} />
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
            path="/account/objectives"
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
          <Route path="/objectives" element={<Navigate to="/account/objectives" replace />} />
          <Route
            path="/account/missions"
            element={
              isAuthenticated ? (
                <Layout>
                  <Missions />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route path="/missions" element={<Navigate to="/account/missions" replace />} />
          <Route
            path="/money/loot-box"
            element={
              isAuthenticated ? (
                <Layout>
                  <LootBox />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route path="/loot-box" element={<Navigate to="/money/loot-box" replace />} />
          <Route
            path="/game/ranking"
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
          <Route path="/ranking" element={<Navigate to="/game/ranking" replace />} />
          {/* ═══ CRIME GROUP ═══ */}
          <Route
            path="/crime/crimes"
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
            path="/crime/jail"
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
            path="/crime/gta"
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
          {/* Crime redirects */}
          <Route path="/crimes" element={<Navigate to="/crime/crimes" replace />} />
          <Route path="/jail" element={<Navigate to="/crime/jail" replace />} />
          <Route path="/gta" element={<Navigate to="/crime/gta" replace />} />
          {/* ═══ CARS GROUP ═══ */}
          <Route
            path="/cars/garage"
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
            path="/cars/buy"
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
            path="/cars/sell"
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
            path="/cars/view"
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
            path="/cars/profile/:carId"
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
          {/* Cars redirects */}
          <Route path="/garage" element={<Navigate to="/cars/garage" replace />} />
          <Route path="/buy-cars" element={<Navigate to="/cars/buy" replace />} />
          <Route path="/sell-cars" element={<Navigate to="/cars/sell" replace />} />
          <Route path="/view-car" element={<Navigate to="/cars/view" replace />} />
          <Route path="/gta/car/:carId" element={<CarProfileRedirect />} />
          {/* ═══ STAFF ROLE GROUP ═══ */}
          <Route
            path="/staffrole/admin"
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
            path="/staffrole/mod"
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
            path="/staffrole/locked"
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
            path="/staffrole/users-online"
            element={
              isAuthenticated ? (
                <Layout>
                  <AdminUsersOnline />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          {/* Staff redirects */}
          <Route path="/admin" element={<Navigate to="/staffrole/admin" replace />} />
          <Route path="/admin/locked" element={<Navigate to="/staffrole/locked" replace />} />
          <Route path="/admin/users-online" element={<Navigate to="/staffrole/users-online" replace />} />
          <Route
            path="/account/autorank"
            element={
              isAuthenticated ? (
                <Layout>
                  <ErrorBoundary>
                    <AutoRank />
                  </ErrorBoundary>
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route path="/auto-rank" element={<Navigate to="/account/autorank" replace />} />
          {/* ═══ KILL GROUP ═══ */}
          <Route
            path="/kill/attack"
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
            path="/kill/bodyguards"
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
            path="/kill/hitlist"
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
            path="/kill/attempts"
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
            path="/kill/armour-weapons"
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
          {/* Kill redirects */}
          <Route path="/attack" element={<Navigate to="/kill/attack" replace />} />
          <Route path="/bodyguards" element={<Navigate to="/kill/bodyguards" replace />} />
          <Route path="/hitlist" element={<Navigate to="/kill/hitlist" replace />} />
          <Route path="/attempts" element={<Navigate to="/kill/attempts" replace />} />
          <Route path="/armour-weapons" element={<Navigate to="/kill/armour-weapons" replace />} />
          <Route path="/weapons" element={<Navigate to="/kill/armour-weapons" replace />} />
          <Route path="/armour" element={<Navigate to="/kill/armour-weapons" replace />} />
          {/* ═══ FAMILY GROUP ═══ */}
          <Route
            path="/game/family/list"
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
            path="/game/family/:familyId"
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
          {/* Family redirects */}
          <Route path="/families" element={<Navigate to="/game/family/list" replace />} />
          <Route path="/families/:familyId" element={<FamilyRedirect />} />
          <Route
            path="/money/property"
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
          <Route path="/properties" element={<Navigate to="/money/property" replace />} />
          <Route path="/property" element={<Navigate to="/money/property" replace />} />
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
            path="/casino/mdg"
            element={
              isAuthenticated ? (
                <Layout>
                  <MDG />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/casino/mp-blackjack"
            element={
              isAuthenticated ? (
                <Layout>
                  <MPBlackjack />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/casino/mp-blackjack/game/:gameId"
            element={
              isAuthenticated ? (
                <Layout>
                  <MPBlackjackGame />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/casino/mp-poker"
            element={
              isAuthenticated ? (
                <Layout>
                  <MPPoker />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/casino/mp-poker/game/:gameId"
            element={
              isAuthenticated ? (
                <Layout>
                  <MPPokerGame />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/money/crack-safe"
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
          <Route path="/crack-safe" element={<Navigate to="/money/crack-safe" replace />} />
          <Route
            path="/game/daily-rewards"
            element={
              isAuthenticated ? (
                <Layout>
                  <DailyRewards />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route path="/daily-rewards" element={<Navigate to="/game/daily-rewards" replace />} />
          {/* ═══ GAMES GROUP ═══ */}
          <Route
            path="/casino/mini-games/snake"
            element={
              isAuthenticated ? (
                <Layout>
                  <Snake />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/casino/mini-games/battleships"
            element={
              isAuthenticated ? (
                <Layout>
                  <Battleships />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/casino/mini-games/the-getaway"
            element={
              isAuthenticated ? (
                <Layout>
                  <TheGetaway />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/casino/mini-games/minesweeper"
            element={
              isAuthenticated ? (
                <Layout>
                  <Minesweeper />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/casino/mini-games/flappy"
            element={
              isAuthenticated ? (
                <Layout>
                  <Gauntlet />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/casino/mini-games/shooting-range"
            element={
              isAuthenticated ? (
                <Layout>
                  <ShootingRange />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/casino/mini-games/shooting-range/play/:weaponId?"
            element={
              isAuthenticated ? (
                <Layout>
                  <ShootingRange3D />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/casino/mini-games/leaderboard"
            element={
              isAuthenticated ? (
                <Layout>
                  <MiniGamesLeaderboard />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/casino/mini-games/boxing"
            element={
              isAuthenticated ? (
                <Layout>
                  <Boxing />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/casino/mini-games/boxing/:matchId"
            element={
              isAuthenticated ? (
                <Layout>
                  <Boxing />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/casino/mini-games/racing"
            element={
              isAuthenticated ? (
                <Layout>
                  <Racing />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          {/* Games redirects */}
          <Route path="/snake" element={<Navigate to="/casino/mini-games/snake" replace />} />
          <Route path="/battleships" element={<Navigate to="/casino/mini-games/battleships" replace />} />
          <Route path="/the-getaway" element={<Navigate to="/casino/mini-games/the-getaway" replace />} />
          <Route path="/minesweeper" element={<Navigate to="/casino/mini-games/minesweeper" replace />} />
          <Route path="/flappygangster" element={<Navigate to="/casino/mini-games/flappy" replace />} />
          <Route path="/gauntlet" element={<Navigate to="/casino/mini-games/flappy" replace />} />
          <Route path="/shooting-range" element={<Navigate to="/casino/mini-games/shooting-range" replace />} />
          <Route path="/shooting-range/play/:weaponId?" element={<ShootingRangePlayRedirect />} />
          <Route path="/minigames-leaderboard" element={<Navigate to="/casino/mini-games/leaderboard" replace />} />
          <Route path="/boxing" element={<Navigate to="/casino/mini-games/boxing" replace />} />
          <Route path="/boxing/arena/:matchId" element={<BoxingArenaRedirect />} />
          <Route path="/racing" element={<Navigate to="/casino/mini-games/racing" replace />} />
          <Route
            path="/game/leaderboard"
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
          <Route path="/leaderboard" element={<Navigate to="/game/leaderboard" replace />} />
          <Route
            path="/game/store"
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
          <Route path="/store" element={<Navigate to="/game/store" replace />} />
          <Route
            path="/money/quick-trade"
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
          <Route path="/quick-trade" element={<Navigate to="/money/quick-trade" replace />} />
          <Route
            path="/game/travel"
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
          <Route path="/travel" element={<Navigate to="/game/travel" replace />} />
          <Route
            path="/game/states"
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
          <Route path="/states" element={<Navigate to="/game/states" replace />} />
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
            path="/money/booze-run"
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
          <Route path="/booze-run" element={<Navigate to="/money/booze-run" replace />} />
          <Route
            path="/money/racket"
            element={
              isAuthenticated ? (
                <Layout>
                  <IllegalBusiness />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route path="/racket" element={<Navigate to="/money/racket" replace />} />
          {/* ═══ SOCIAL GROUP ═══ */}
          <Route
            path="/social/inbox"
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
            path="/social/chat/:userId"
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
            path="/social/forum"
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
            path="/social/forum/:topicId"
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
            path="/game/help-desk"
            element={
              isAuthenticated ? (
                <Layout>
                  <HelpDesk />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route path="/help-desk" element={<Navigate to="/game/help-desk" replace />} />
          {/* Social redirects */}
          <Route path="/inbox" element={<Navigate to="/social/inbox" replace />} />
          <Route path="/inbox/chat/:userId" element={<InboxChatRedirect />} />
          <Route path="/forum" element={<Navigate to="/social/forum" replace />} />
          <Route path="/forum/topic/:topicId" element={<ForumTopicRedirect />} />
          <Route
            path="/game/dead-alive"
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
          <Route path="/dead-alive" element={<Navigate to="/game/dead-alive" replace />} />
          {/* ═══ ACCOUNT GROUP ═══ */}
          <Route
            path="/account/profile"
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
            path="/account/profile/:username"
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
            path="/account/stats"
            element={
              isAuthenticated ? (
                <Layout>
                  <MyStats />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/account/inventory"
            element={
              isAuthenticated ? (
                <Layout>
                  <MyInventory />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/account/prestige"
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
            path="/account/settings"
            element={
              isAuthenticated ? (
                <Layout>
                  <IPRules />
                </Layout>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          {/* Account redirects */}
          <Route path="/profile" element={<ProfileRedirect />} />
          <Route path="/profile/:username" element={<ProfileRedirect />} />
          <Route path="/my-stats" element={<Navigate to="/account/stats" replace />} />
          <Route path="/inventory" element={<Navigate to="/account/inventory" replace />} />
          <Route path="/prestige" element={<Navigate to="/account/prestige" replace />} />
          <Route path="/ip-rules" element={<Navigate to="/account/settings" replace />} />
        </Routes>
        </Suspense>
        </ThemeProvider>
      </BrowserRouter>
      <ThemedToaster />
    </div>
  );
}

export default App;
