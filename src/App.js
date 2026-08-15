import { useState, useEffect, Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route, Navigate, Outlet, useParams, useLocation } from "react-router-dom";

/** Legacy `/store?...` links keep query string when redirecting to `/game/store`. */
function RedirectStoreToGameStore() {
  const { search } = useLocation();
  return <Navigate to={`/game/store${search}`} replace />;
}

/** Legacy `/loot-box?...` keeps query (tier/tutorial) when redirecting. */
function RedirectLootBoxToMoney() {
  const { search } = useLocation();
  return <Navigate to={`/money/loot-box${search}`} replace />;
}
import { ThemedToaster } from "./components/ThemedToaster";
import LandingRedesign from "./pages/Auth/Landing";
import LandingClassic from "./pages/Auth/Landing.classic";
import PreRegister from "./pages/Auth/PreRegister";
import StaffLogin from "./pages/Auth/StaffLogin";
import ForgotPassword from "./pages/Auth/ForgotPassword";
import ResetPassword from "./pages/Auth/ResetPassword";
import VerifyEmail from "./pages/Auth/VerifyEmail";
import VerifyComplete from "./pages/Auth/VerifyComplete";
import SpotifyCallback from "./pages/Auth/SpotifyCallback";
import Layout from "./components/Layout";
import ErrorBoundary from "./components/ErrorBoundary";
import GamblingSelfBanGate from "./components/GamblingSelfBanGate";
import ServerUnavailableOverlay from "./components/ServerUnavailableOverlay";
import { ThemeProvider } from "./context/ThemeContext";
import { initToastObservability } from "./components/ui/sonner";
import "@/App.css";
import { prefetchDashboardData } from "./utils/dashboardSessionCache";
import { preloadRoute } from "./utils/routePreload";
import { SLOTS_FEATURE_ENABLED } from "./config/gameFeatures";
import { USE_LANDING_CLASSIC } from "./config/landing";

/** Flip `USE_LANDING_CLASSIC` in `src/config/landing.js` to restore the previous login UI. */
const Landing = USE_LANDING_CLASSIC ? LandingClassic : LandingRedesign;

// Lazy-load authenticated pages to shrink initial bundle
// Account pages
const Dashboard = lazy(() => import("./pages/Account/Dashboard"));
const AutoRank = lazy(() => import("./pages/Account/AutoRank"));
const IPRules = lazy(() => import("./pages/Account/IPRules"));
const Missions = lazy(() => import("./pages/Account/Missions"));
const MyInventory = lazy(() => import("./pages/Account/MyInventory"));
const MyStats = lazy(() => import("./pages/Account/MyStats"));
const GameEvents = lazy(() => import("./pages/Account/GameEvents"));
const Objectives = lazy(() => import("./pages/Account/Objectives"));
const Prestige = lazy(() => import("./pages/Account/Prestige"));
const Profile = lazy(() => import("./pages/Account/Profile"));
const Referral = lazy(() => import("./pages/Account/Referral"));

// Auth pages
const LockedPage = lazy(() => import("./pages/Auth/LockedPage"));
const RulesAccept = lazy(() => import("./pages/Auth/RulesAccept"));

// Cars pages
const BuyCars = lazy(() => import("./pages/Cars/BuyCars"));
const CarProfile = lazy(() => import("./pages/Cars/CarProfile"));
const Garage = lazy(() => import("./pages/Cars/Garage"));
const SellCars = lazy(() => import("./pages/Cars/SellCars"));
const ViewCar = lazy(() => import("./pages/Cars/ViewCar"));

// Crime pages
const Crimes = lazy(() => import("./pages/Crime/Crimes"));
const GTA = lazy(() => import("./pages/Crime/GTA"));
const Jail = lazy(() => import("./pages/Crime/Jail"));
const OrganisedCrime = lazy(() => import("./pages/Crime/OrganisedCrime"));

// Game pages
const DailyRewards = lazy(() => import("./pages/Game/DailyRewards"));
const DeadAlive = lazy(() => import("./pages/Game/DeadAlive"));
const FamilyPage = lazy(() => import("./pages/Game/FamilyPage"));
const FamilyProfilePage = lazy(() => import("./pages/Game/FamilyProfilePage"));
const HelpDesk = lazy(() => import("./pages/Game/HelpDesk"));
const GameGuideChat = lazy(() => import("./pages/Game/GameGuideChat"));
const Leaderboard = lazy(() => import("./pages/Game/Leaderboard"));
const Ranking = lazy(() => import("./pages/Game/Ranking"));
const RankingBadges = lazy(() => import("./pages/Game/RankingBadges"));
const States = lazy(() => import("./pages/Game/States"));
const Stats = lazy(() => import("./pages/Game/Stats"));
const Store = lazy(() => import("./pages/Game/Store"));
const GamePass = lazy(() => import("./pages/Game/GamePass"));
const Travel = lazy(() => import("./pages/Game/Travel"));
const UsersOnline = lazy(() => import("./pages/Game/UsersOnline"));

// Kill pages
const ArmourWeapons = lazy(() => import("./pages/Kill/ArmourWeapons"));
const Attack = lazy(() => import("./pages/Kill/Attack"));
const Attemps = lazy(() => import("./pages/Kill/Attemps"));
const CombatTimeline = lazy(() => import("./pages/Kill/CombatTimeline"));
const WitnessStatements = lazy(() => import("./pages/Kill/WitnessStatements"));
const Bodyguards = lazy(() => import("./pages/Kill/Bodyguards"));
const HitlistPage = lazy(() => import("./pages/Kill/HitlistPage"));
const HitmanForHire = lazy(() => import("./pages/Kill/HitmanForHire"));

// MiniGames pages
const Battleships = lazy(() => import("./pages/MiniGames/Battleships"));
const Boxing = lazy(() => import("./pages/MiniGames/Boxing"));
const Gauntlet = lazy(() => import("./pages/MiniGames/Gauntlet"));
const Minesweeper = lazy(() => import("./pages/MiniGames/Minesweeper"));
const MiniGamesLeaderboard = lazy(() => import("./pages/MiniGames/MiniGamesLeaderboard"));
const Racing = lazy(() => import("./pages/MiniGames/Racing"));
const ShootingRange = lazy(() => import("./pages/MiniGames/ShootingRange"));
const ShootingRange3D = lazy(() => import("./pages/MiniGames/ShootingRange3D"));
const Snake = lazy(() => import("./pages/MiniGames/Snake"));
const TheGetaway = lazy(() => import("./pages/MiniGames/TheGetaway"));
const FamilyRun = lazy(() => import("./pages/MiniGames/FamilyRun"));
const WhackACopper = lazy(() => import("./pages/MiniGames/WhackACopper"));
const Famiglia = lazy(() => import("./pages/MiniGames/Famiglia"));
const EightBallPool = lazy(() => import("./pages/MiniGames/EightBallPool"));

// Money pages
const Bank = lazy(() => import("./pages/Money/Bank"));
const BoozeRun = lazy(() => import("./pages/Money/BoozeRun"));
const CrackSafe = lazy(() => import("./pages/Money/CrackSafe"));
const IllegalBusiness = lazy(() => import("./pages/Money/IllegalBusiness"));
const Distillery = lazy(() => import("./pages/Money/Distillery"));
const LootBox = lazy(() => import("./pages/Money/LootBox"));
const MyProperties = lazy(() => import("./pages/Money/MyProperties"));
const Properties = lazy(() => import("./pages/Money/Properties"));
const QuickTrade = lazy(() => import("./pages/Money/QuickTrade"));
const Lottery = lazy(() => import("./pages/Money/Lottery"));
const StockMarket = lazy(() => import("./pages/Money/StockMarket"));
const GraveRobber = lazy(() => import("./pages/Money/GraveRobber"));
const WeedEmpire = lazy(() => import("./pages/Money/WeedEmpire"));

// Social pages
const Forum = lazy(() => import("./pages/Social/Forum"));
const ForumTopic = lazy(() => import("./pages/Social/ForumTopic"));
const GameIdeas = lazy(() => import("./pages/Social/GameIdeas"));
const Inbox = lazy(() => import("./pages/Social/Inbox"));
const InboxChat = lazy(() => import("./pages/Social/InboxChat"));
const ImageHost = lazy(() => import("./pages/Social/ImageHost"));

// StaffRole pages
const AdminShell = lazy(() => import("./pages/StaffRole/AdminShell"));

// Casinos pages
const Casino = lazy(() => import("./pages/Casinos/Casino"));
const Dice = lazy(() => import("./pages/Casinos/Dice"));
const Rlt = lazy(() => import("./pages/Casinos/Rlt"));
const Blackjack = lazy(() => import("./pages/Casinos/BlackjackPage"));
const HorseRacing = lazy(() => import("./pages/Casinos/HorseRacingPage"));
const Slots = lazy(() => import("./pages/Casinos/SlotsPage"));
const Keno = lazy(() => import("./pages/Casinos/KenoPage"));
const CoinFlip = lazy(() => import("./pages/Casinos/CoinFlipPage"));
const VideoPoker = lazy(() => import("./pages/Casinos/VideoPokerPage"));
const WheelOfFortune = lazy(() => import("./pages/Casinos/WheelOfFortunePage"));
const MDG = lazy(() => import("./pages/Casinos/MDGPage"));
const GamblingBan = lazy(() => import("./pages/Casinos/GamblingBan"));
const EntertainerHub = lazy(() => import("./pages/Game/EntertainerHub"));
const HelpDeskHub = lazy(() => import("./pages/Game/HelpDeskHub"));
const MPBlackjack = lazy(() => import("./pages/Casinos/MPBlackjackPage"));
const MPBlackjackGame = lazy(() => import("./pages/Casinos/MPBlackjackGamePage"));
const MPPoker = lazy(() => import("./pages/Casinos/MPPokerPage"));
const MPPokerGame = lazy(() => import("./pages/Casinos/MPPokerGamePage"));
const SportsBetting = lazy(() => import("./pages/Casinos/SportsBetting"));
const LastManStanding = lazy(() => import("./pages/Casinos/LastManStanding"));

/** Gambling self-exclusion: notice = claim/ownership still work; lock-page = overlay on bet-only games. */
const withGamblingBan = (node, mode = 'notice') => (
  <GamblingSelfBanGate mode={mode}>{node}</GamblingSelfBanGate>
);

/**
 * Suspense gap while a lazy chunk downloads.
 * Silent chrome shell only — never empty (reads as a black screen on mobile) and no "Loading…" text.
 */
const PageLoader = () => (
  <div className="space-y-3 mobile-page-root px-3.5 py-3 max-w-[900px] mx-auto min-h-[45vh]" style={{ backgroundColor: 'var(--noir-content, #1a1a1a)' }} aria-hidden>
    <div className="h-3 w-2/3 max-w-xs rounded bg-zinc-800/70" />
    <div className="rounded-md border border-primary/20 bg-zinc-900/40 overflow-hidden">
      <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20">
        <div className="h-2.5 w-20 rounded bg-primary/25" />
      </div>
      <div className="p-2.5 flex gap-3">
        <div className="flex-1 h-8 rounded bg-zinc-800/50" />
        <div className="flex-1 h-8 rounded bg-zinc-800/50" />
        <div className="flex-1 h-8 rounded bg-zinc-800/50" />
      </div>
    </div>
    <div className="rounded-md border border-primary/20 bg-zinc-900/40 overflow-hidden">
      <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20">
        <div className="h-2.5 w-16 rounded bg-primary/25" />
      </div>
      <div className="p-3 space-y-2">
        <div className="h-3 w-full rounded bg-zinc-800/50" />
        <div className="h-3 w-5/6 rounded bg-zinc-800/40" />
        <div className="h-3 w-2/3 rounded bg-zinc-800/30" />
      </div>
    </div>
  </div>
);


function AuthenticatedShell() {
  return (
    <Layout>
      <Suspense fallback={<PageLoader />}>
        <Outlet />
      </Suspense>
    </Layout>
  );
}


// Redirect helpers for parameterized routes
function ProfileRedirect() {
  const { username } = useParams();
  const location = useLocation();
  const search = location.search || '';
  // Must encode: hitlist NPC usernames contain `#id` — raw `#` would start a URL fragment and drop the suffix.
  const seg = username != null && username !== '' ? encodeURIComponent(username) : '';
  return <Navigate to={seg ? `/account/profile/${seg}${search}` : `/account/profile${search}`} replace />;
}
function FamilyRedirect() {
  const { familyId } = useParams();
  return <Navigate to={`/game/family/${familyId}`} replace />;
}
function CarProfileRedirect() {
  const { carId } = useParams();
  return <Navigate to={`/cars/profile/${carId}`} replace />;
}
function ViewCarRedirect() {
  const { search } = useLocation();
  return <Navigate to={`/cars/view${search}`} replace />;
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
function AttackShortcutRedirect() {
  const { search } = useLocation();
  return <Navigate to={`/kill/attack${search}`} replace />;
}

/** Sync with localStorage on first paint so refresh on a deep link does not briefly treat the user as logged out (which redirected to / then /account/dashboard). */
function readIsAuthenticatedFromStorage() {
  try {
    return Boolean(localStorage.getItem('token'));
  } catch {
    return false;
  }
}

/** Only warm dashboard cache on the dashboard route — not every authenticated page (that starves lazy route chunks). */
function shouldPrefetchDashboard(pathname) {
  const p = pathname || '';
  return p === '/account/dashboard' || p === '/dashboard';
}

function DashboardPrefetchGate({ isAuthenticated }) {
  const location = useLocation();
  useEffect(() => {
    if (!isAuthenticated || !shouldPrefetchDashboard(location.pathname)) return undefined;
    const t = setTimeout(() => prefetchDashboardData({ force: true }), 400);
    return () => clearTimeout(t);
  }, [isAuthenticated, location.pathname]);
  return null;
}

/** Start lazy chunk download as soon as the route is known (before Suspense children render). */
function RouteChunkPreloadGate() {
  const location = useLocation();
  preloadRoute(location.pathname);
  return null;
}

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(readIsAuthenticatedFromStorage);

  useEffect(() => {
    initToastObservability();
  }, []);

  useEffect(() => {
    try {
      sessionStorage.removeItem("login_locked");
    } catch (_) {}
  }, []);

  return (
    <div className="App">
      <ServerUnavailableOverlay />
      <BrowserRouter future={{ v7_startTransition: true }}>
        <ThemeProvider>
        <DashboardPrefetchGate isAuthenticated={isAuthenticated} />
        <RouteChunkPreloadGate />
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
          <Route path="/preregister" element={<PreRegister />} />
          <Route
            path="/register"
            element={
              isAuthenticated ? (
                <Navigate to="/account/dashboard" replace />
              ) : (
                <Landing setIsAuthenticated={setIsAuthenticated} defaultTab="register" />
              )
            }
          />
          <Route
            path="/login"
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
            path="/spotify-callback"
            element={
              isAuthenticated ? (
                <SpotifyCallback />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/staff-entrance"
            element={<StaffLogin setIsAuthenticated={setIsAuthenticated} />}
          />
          <Route
            path="/locked"
            element={
              isAuthenticated ? (
                <Suspense fallback={<PageLoader />}>
                  <LockedPage />
                </Suspense>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/account/rules-acceptance"
            element={
              isAuthenticated ? (
                <Suspense fallback={<PageLoader />}>
                  <RulesAccept />
                </Suspense>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />

          <Route path="/dashboard" element={<Navigate to="/account/dashboard" replace />} />

          <Route path="/users-online" element={<Navigate to="/game/users-online" replace />} />
          {/* ═══ MONEY GROUP ═══ */}


          {/* Money redirects */}
          <Route path="/bank" element={<Navigate to="/money/bank" replace />} />
          <Route path="/stock-market" element={<Navigate to="/money/stocks" replace />} />

          <Route path="/stats" element={<Navigate to="/game/stats" replace />} />

          <Route path="/oc" element={<Navigate to="/organised-crime" replace />} />

          <Route path="/objectives" element={<Navigate to="/account/objectives" replace />} />

          <Route path="/missions" element={<Navigate to="/account/missions" replace />} />

          <Route path="/loot-box" element={<RedirectLootBoxToMoney />} />

          <Route path="/ranking" element={<Navigate to="/game/ranking" replace />} />

          {/* ═══ CRIME GROUP ═══ */}



          {/* Crime redirects */}
          <Route path="/crimes" element={<Navigate to="/crime/crimes" replace />} />
          <Route path="/jail" element={<Navigate to="/crime/jail" replace />} />
          <Route path="/gta" element={<Navigate to="/crime/gta" replace />} />
          {/* ═══ CARS GROUP ═══ */}





          {/* Cars redirects */}
          <Route path="/garage" element={<Navigate to="/cars/garage" replace />} />
          <Route path="/buy-cars" element={<Navigate to="/cars/buy" replace />} />
          <Route path="/sell-cars" element={<Navigate to="/cars/sell" replace />} />
          <Route path="/view-car" element={<ViewCarRedirect />} />
          <Route path="/gta/car/:carId" element={<CarProfileRedirect />} />
          {/* ═══ STAFF ROLE GROUP ═══ */}


          <Route path="/auto-rank" element={<Navigate to="/account/autorank" replace />} />
          {/* ═══ KILL GROUP ═══ */}








          {/* Kill redirects */}
          <Route path="/attack" element={<AttackShortcutRedirect />} />
          <Route path="/bodyguards" element={<Navigate to="/kill/bodyguards" replace />} />
          <Route path="/hitlist" element={<Navigate to="/kill/hitlist" replace />} />
          <Route path="/attempts" element={<Navigate to="/kill/attempts" replace />} />
          <Route path="/combat-timeline" element={<Navigate to="/kill/combat-timeline" replace />} />
          <Route path="/witness-statements" element={<Navigate to="/kill/witness-statements" replace />} />
          <Route path="/armour-weapons" element={<Navigate to="/kill/armour-weapons" replace />} />
          <Route path="/weapons" element={<Navigate to="/kill/armour-weapons" replace />} />
          <Route path="/armour" element={<Navigate to="/kill/armour-weapons" replace />} />
          {/* ═══ FAMILY GROUP ═══ */}


          {/* Family redirects */}
          <Route path="/families" element={<Navigate to="/game/family/list" replace />} />
          <Route path="/families/:familyId" element={<FamilyRedirect />} />

          <Route path="/properties" element={<Navigate to="/money/property" replace />} />
          <Route path="/property" element={<Navigate to="/money/property" replace />} />















          <Route path="/crack-safe" element={<Navigate to="/money/crack-safe" replace />} />

          <Route path="/grave-robber" element={<Navigate to="/money/grave-robber" replace />} />

          <Route path="/daily-rewards" element={<Navigate to="/game/daily-rewards" replace />} />




          {/* ═══ GAMES GROUP ═══ */}















          {/* Games redirects */}
          <Route path="/snake" element={<Navigate to="/casino/mini-games/snake" replace />} />
          <Route path="/battleships" element={<Navigate to="/casino/mini-games/battleships" replace />} />
          <Route path="/the-getaway" element={<Navigate to="/casino/mini-games/the-getaway" replace />} />
          <Route path="/family-run" element={<Navigate to="/casino/mini-games/family-run" replace />} />
          <Route path="/famiglia" element={<Navigate to="/casino/mini-games/famiglia" replace />} />
          <Route path="/minesweeper" element={<Navigate to="/casino/mini-games/minesweeper" replace />} />
          <Route path="/flappygangster" element={<Navigate to="/casino/mini-games/flappy" replace />} />
          <Route path="/gauntlet" element={<Navigate to="/casino/mini-games/flappy" replace />} />
          <Route path="/shooting-range" element={<Navigate to="/casino/mini-games/shooting-range" replace />} />
          <Route path="/shooting-range/play/:weaponId?" element={<ShootingRangePlayRedirect />} />
          <Route path="/minigames-leaderboard" element={<Navigate to="/casino/mini-games/leaderboard" replace />} />
          <Route path="/boxing" element={<Navigate to="/casino/mini-games/boxing" replace />} />
          <Route path="/boxing/arena/:matchId" element={<BoxingArenaRedirect />} />
          <Route path="/racing" element={<Navigate to="/casino/mini-games/racing" replace />} />
          <Route path="/8-ball-pool" element={<Navigate to="/casino/mini-games/8-ball-pool" replace />} />

          <Route path="/leaderboard" element={<Navigate to="/game/leaderboard" replace />} />


          <Route path="/store" element={<RedirectStoreToGameStore />} />

          <Route path="/quick-trade" element={<Navigate to="/money/quick-trade" replace />} />

          <Route path="/travel" element={<Navigate to="/game/travel" replace />} />

          <Route path="/states" element={<Navigate to="/game/states" replace />} />


          <Route path="/booze-run" element={<Navigate to="/money/booze-run" replace />} />



          <Route path="/racket" element={<Navigate to="/money/racket" replace />} />
          <Route path="/distillery" element={<Navigate to="/money/distillery" replace />} />
          <Route path="/weed-empire" element={<Navigate to="/money/weed-empire" replace />} />

          <Route path="/lottery" element={<Navigate to="/money/lottery" replace />} />
          {/* ═══ SOCIAL GROUP ═══ */}






          <Route path="/help-desk" element={<Navigate to="/game/help-desk" replace />} />
          <Route path="/guide" element={<Navigate to="/game/guide" replace />} />
          {/* Social redirects */}
          <Route path="/inbox" element={<Navigate to="/social/inbox" replace />} />
          <Route path="/inbox/chat/:userId" element={<InboxChatRedirect />} />
          <Route path="/forum" element={<Navigate to="/social/forum" replace />} />
          <Route path="/forum/topic/:topicId" element={<ForumTopicRedirect />} />

          <Route path="/game-ideas" element={<Navigate to="/game/game-ideas" replace />} />

          <Route path="/dead-alive" element={<Navigate to="/game/dead-alive" replace />} />
          {/* ═══ ACCOUNT GROUP ═══ */}




          <Route path="/game-events" element={<Navigate to="/account/game-events" replace />} />




          {/* Account redirects */}
          <Route path="/profile" element={<ProfileRedirect />} />
          <Route path="/profile/:username" element={<ProfileRedirect />} />
          <Route path="/my-stats" element={<Navigate to="/account/stats" replace />} />
          <Route path="/inventory" element={<Navigate to="/account/inventory" replace />} />
          <Route path="/prestige" element={<Navigate to="/account/prestige" replace />} />
          <Route path="/ip-rules" element={<Navigate to="/account/settings" replace />} />
                  <Route
            element={
              isAuthenticated ? (
                <AuthenticatedShell />
              ) : (
                <Navigate to="/" replace />
              )
            }
          >
            <Route
              path="/account/dashboard"
              element={
              <Dashboard />
              }
            />
            <Route
              path="/game/users-online"
              element={
              <UsersOnline />
              }
            />
            <Route
              path="/money/bank"
              element={
              <Bank />
              }
            />
            <Route
              path="/money/stocks"
              element={
              <StockMarket />
              }
            />
            <Route
              path="/game/stats"
              element={
              <Stats />
              }
            />
            <Route
              path="/organised-crime"
              element={
              <OrganisedCrime />
              }
            />
            <Route
              path="/account/objectives"
              element={
              <Objectives />
              }
            />
            <Route
              path="/account/missions"
              element={
              <Missions />
              }
            />
            <Route
              path="/money/loot-box"
              element={
              <LootBox />
              }
            />
            <Route
              path="/game/ranking"
              element={
              <Ranking />
              }
            />
            <Route
              path="/game/ranking/badges"
              element={
              <RankingBadges />
              }
            />
            <Route
              path="/crime/crimes"
              element={
              <Crimes />
              }
            />
            <Route
              path="/crime/jail"
              element={
              <Jail />
              }
            />
            <Route
              path="/crime/gta"
              element={
              <GTA />
              }
            />
            <Route
              path="/cars/garage"
              element={
              <Garage />
              }
            />
            <Route
              path="/cars/buy"
              element={
              <BuyCars />
              }
            />
            <Route
              path="/cars/sell"
              element={
              <SellCars />
              }
            />
            <Route
              path="/cars/view"
              element={
              <ViewCar />
              }
            />
            <Route
              path="/cars/profile/:carId"
              element={
              <CarProfile />
              }
            />
            <Route
              path="/tjjeujr3wa/:section?"
              element={
              <AdminShell />
              }
            />
            <Route
              path="/account/autorank"
              element={
              <ErrorBoundary>
                <AutoRank />
              </ErrorBoundary>
              }
            />
            <Route
              path="/kill/attack"
              element={
              <ErrorBoundary>
                <Attack />
              </ErrorBoundary>
              }
            />
            <Route
              path="/kill/bodyguards"
              element={
              <Bodyguards />
              }
            />
            <Route
              path="/kill/hitlist"
              element={
              <HitlistPage />
              }
            />
            <Route
              path="/kill/hitman"
              element={
              <ErrorBoundary>
                <HitmanForHire />
              </ErrorBoundary>
              }
            />
            <Route
              path="/kill/attempts"
              element={
              <Attemps />
              }
            />
            <Route
              path="/kill/combat-timeline"
              element={
              <CombatTimeline />
              }
            />
            <Route
              path="/kill/witness-statements"
              element={
              <WitnessStatements />
              }
            />
            <Route
              path="/kill/armour-weapons"
              element={
              <ArmourWeapons />
              }
            />
            <Route
              path="/game/family/list"
              element={
              <FamilyPage />
              }
            />
            <Route
              path="/game/family/:familyId"
              element={
              <FamilyProfilePage />
              }
            />
            <Route
              path="/money/property"
              element={
              <Properties />
              }
            />
            <Route
              path="/casino"
              element={
              <Casino />
              }
            />
            <Route
              path="/sports-betting"
              element={
              withGamblingBan(<SportsBetting />, 'notice')
              }
            />
            <Route
              path="/last-man-standing"
              element={
              withGamblingBan(<LastManStanding />, 'lock-page')
              }
            />
            <Route
              path="/casino/dice"
              element={
              withGamblingBan(
              <ErrorBoundary>
                <Dice />
              </ErrorBoundary>,
              'notice',
              )
              }
            />
            <Route
              path="/casino/rlt"
              element={
              withGamblingBan(<Rlt />, 'notice')
              }
            />
            <Route
              path="/casino/blackjack"
              element={
              withGamblingBan(<Blackjack />, 'notice')
              }
            />
            <Route
              path="/casino/horseracing"
              element={
              withGamblingBan(
              <ErrorBoundary>
                <HorseRacing />
              </ErrorBoundary>,
              'notice',
              )
              }
            />
            <Route
              path="/casino/keno"
              element={
              withGamblingBan(
              <ErrorBoundary>
                <Keno />
              </ErrorBoundary>,
              'lock-page',
              )
              }
            />
            <Route
              path="/casino/coin-flip"
              element={
              withGamblingBan(
              <ErrorBoundary>
                <CoinFlip />
              </ErrorBoundary>,
              'lock-page',
              )
              }
            />
            <Route
              path="/casino/wheel"
              element={
              withGamblingBan(
              <ErrorBoundary>
                <WheelOfFortune />
              </ErrorBoundary>
              , 'notice')
              }
            />
            <Route
              path="/casino/videopoker"
              element={
              withGamblingBan(<VideoPoker />, 'notice')
              }
            />
            <Route
              path="/casino/mdg"
              element={
              withGamblingBan(<MDG />, 'notice')
              }
            />
            <Route
              path="/casino/gambling-ban"
              element={
              <ErrorBoundary>
                <GamblingBan />
              </ErrorBoundary>
              }
            />
            <Route
              path="/casino/mp-blackjack"
              element={
              withGamblingBan(<MPBlackjack />, 'lock-page')
              }
            />
            <Route
              path="/casino/mp-blackjack/game/:gameId"
              element={
              withGamblingBan(<MPBlackjackGame />, 'lock-page')
              }
            />
            <Route
              path="/casino/mp-poker"
              element={
              withGamblingBan(<MPPoker />, 'lock-page')
              }
            />
            <Route
              path="/casino/mp-poker/game/:gameId"
              element={
              withGamblingBan(<MPPokerGame />, 'lock-page')
              }
            />
            <Route
              path="/money/crack-safe"
              element={
              <CrackSafe />
              }
            />
            <Route
              path="/money/grave-robber"
              element={
              <GraveRobber />
              }
            />
            <Route
              path="/game/daily-rewards"
              element={
              <DailyRewards />
              }
            />
            <Route
              path="/game/entertainer"
              element={
              <EntertainerHub />
              }
            />
            <Route
              path="/game/help-desk-hub"
              element={
              <HelpDeskHub />
              }
            />
            {/* World Cup 2026 retired — history lives in Admin Tools → World Cup */}
            <Route path="/game/world-cup/staff" element={<Navigate to="/account/dashboard" replace />} />
            <Route path="/game/world-cup" element={<Navigate to="/account/dashboard" replace />} />
            <Route
              path="/casino/mini-games/snake"
              element={
              <Snake />
              }
            />
            <Route
              path="/casino/mini-games/battleships"
              element={
              <Battleships />
              }
            />
            <Route
              path="/casino/mini-games/the-getaway"
              element={
              <TheGetaway />
              }
            />
            <Route
              path="/casino/mini-games/family-run"
              element={
              <FamilyRun />
              }
            />
            <Route
              path="/casino/mini-games/whack-a-copper"
              element={
              <WhackACopper />
              }
            />
            <Route
              path="/casino/mini-games/famiglia"
              element={
              <Famiglia />
              }
            />
            <Route
              path="/casino/mini-games/minesweeper"
              element={
              <Minesweeper />
              }
            />
            <Route
              path="/casino/mini-games/flappy"
              element={
              <Gauntlet />
              }
            />
            <Route
              path="/casino/mini-games/shooting-range"
              element={
              <ShootingRange />
              }
            />
            <Route
              path="/casino/mini-games/shooting-range/play/:weaponId?"
              element={
              <ShootingRange3D />
              }
            />
            <Route
              path="/casino/mini-games/8-ball-pool"
              element={
              <EightBallPool />
              }
            />
            <Route
              path="/casino/mini-games/leaderboard"
              element={
              <MiniGamesLeaderboard />
              }
            />
            <Route
              path="/casino/mini-games/boxing"
              element={
              <Boxing />
              }
            />
            <Route
              path="/casino/mini-games/boxing/:matchId"
              element={
              <Boxing />
              }
            />
            <Route
              path="/casino/mini-games/racing"
              element={
              <Racing />
              }
            />
            <Route
              path="/game/leaderboard"
              element={
              <Leaderboard />
              }
            />
            <Route
              path="/game/store"
              element={
              <Store />
              }
            />
            <Route
              path="/game-pass"
              element={
              <GamePass />
              }
            />
            <Route
              path="/money/quick-trade"
              element={
              <QuickTrade />
              }
            />
            <Route
              path="/game/travel"
              element={
              <Travel />
              }
            />
            <Route
              path="/game/states"
              element={
              <States />
              }
            />
            <Route
              path="/my-properties"
              element={
              <MyProperties />
              }
            />
            <Route
              path="/money/booze-run"
              element={
              <BoozeRun />
              }
            />
            <Route
              path="/money/racket"
              element={
              <IllegalBusiness />
              }
            />
            <Route
              path="/money/distillery"
              element={
              <Distillery />
              }
            />
            <Route
              path="/money/weed-empire"
              element={
              <WeedEmpire />
              }
            />
            <Route
              path="/money/lottery"
              element={
              <Lottery />
              }
            />
            <Route
              path="/social/inbox"
              element={
              <Inbox />
              }
            />
            <Route
              path="/social/chat/:userId"
              element={
              <InboxChat />
              }
            />
            <Route
              path="/social/forum"
              element={
              <Forum />
              }
            />
            <Route
              path="/social/forum/:topicId"
              element={
              <ForumTopic />
              }
            />
            <Route
              path="/social/image-host"
              element={
              <ImageHost />
              }
            />
            <Route
              path="/game/help-desk"
              element={
              <HelpDesk />
              }
            />
            <Route
              path="/game/guide"
              element={
              <GameGuideChat />
              }
            />
            <Route
              path="/game/game-ideas"
              element={
              <GameIdeas />
              }
            />
            <Route
              path="/game/dead-alive"
              element={
              <DeadAlive />
              }
            />
            <Route
              path="/account/profile"
              element={
              <Profile />
              }
            />
            <Route
              path="/account/profile/:username"
              element={
              <Profile />
              }
            />
            <Route
              path="/account/stats"
              element={
              <MyStats />
              }
            />
            <Route
              path="/account/game-events"
              element={
              <GameEvents />
              }
            />
            <Route
              path="/account/inventory"
              element={
              <MyInventory />
              }
            />
            <Route
              path="/account/prestige"
              element={
              <Prestige />
              }
            />
            <Route
              path="/account/settings"
              element={
              <IPRules />
              }
            />
            <Route
              path="/account/referral"
              element={
              <Referral />
              }
            />
            <Route
              path="/casino/slots"
              element={
                SLOTS_FEATURE_ENABLED ? withGamblingBan(<Slots />, 'notice') : <Navigate to="/casino" replace />
              }
            />
          </Route>
        </Routes>
        </ThemeProvider>
      </BrowserRouter>
      <ThemedToaster />
    </div>
  );
}

export default App;
