import { useState, useCallback, useEffect, useRef, lazy, Suspense } from "react";
import { RotateCw } from "lucide-react";
import Navbar from "../components/layout/Navbar";
import AuthModal from "../features/auth/components/AuthModal";
import Hero from "../features/marketplace/components/Hero";
import Marketplace from "../features/marketplace/components/Marketplace";
import FarmerShell from "../features/farmer/FarmerShell";
import BuyerShell from "../features/buyer/BuyerShell";
import Overview from "../features/farmer/pages/Overview";
import MarketIntelligence from "../features/farmer/pages/MarketIntelligence";
import MyProduce from "../features/farmer/pages/MyProduce";
import FarmProfile from "../features/farmer/pages/FarmProfile";
import FarmerOrders from "../features/orders/pages/FarmerOrders";
import FarmerInquiries from "../features/inquiries/pages/FarmerInquiries";
import FarmerSettings from "../features/settings/pages/FarmerSettings";
import ContactPage from "../features/support/pages/Contact";
import HowItWorks from "../features/support/pages/HowItWorks";
import AboutPage from "../features/support/pages/About";
import StartSelling from "../features/support/pages/StartSelling";
import BuyerOverview from "../features/buyer/pages/Overview";
import BuyerBrowse from "../features/buyer/pages/Browse";
import BuyerPriceCompare from "../features/buyer/pages/PriceCompare";
import BuyerRequests from "../features/buyer/pages/Requests";
import BuyerSaved from "../features/buyer/pages/Saved";
import BuyerOrders from "../features/orders/pages/BuyerOrders";
import BuyerInquiries from "../features/inquiries/pages/BuyerInquiries";
import BuyerProfile from "../features/buyer/pages/Profile";
import BuyerSettings from "../features/settings/pages/BuyerSettings";
import FAQ from "../features/support/pages/FAQ";
import InfoPage from "../features/support/pages/InfoPage";
import { ThemeProvider } from "./providers/theme";

/* Shared AI pages */
const AIAdvisor = lazy(() => import("../features/ai/pages/AIAdvisor"));
const AIAssistant = lazy(() => import("../features/ai/pages/AIAssistant"));
const AIRecommendations = lazy(() => import("../features/ai/pages/AIRecommendations"));

/* Farmer AI pages */
const AICropInsights = lazy(() => import("../features/ai/pages/farmer/AICropInsights"));
const AIPriceRecommendation = lazy(() => import("../features/ai/pages/farmer/AIPriceRecommendation"));
const AIListingImprovement = lazy(() => import("../features/ai/pages/farmer/AIListingImprovement"));
const AIBuyerMatching = lazy(() => import("../features/ai/pages/farmer/AIBuyerMatching"));
const AIHarvestPlanner = lazy(() => import("../features/ai/pages/farmer/AIHarvestPlanner"));
const AINetProfitAdvisor = lazy(() => import("../features/ai/pages/farmer/AINetProfitAdvisor"));
const AIDiagnostics = lazy(() => import("../features/ai/pages/AIDiagnostics"));

/* Buyer AI pages */
const AIProduceFinder = lazy(() => import("../features/ai/pages/buyer/AIProduceFinder"));
const AISupplierMatching = lazy(() => import("../features/ai/pages/buyer/AISupplierMatching"));
const AIPurchasePlanning = lazy(() => import("../features/ai/pages/buyer/AIPurchasePlanning"));
import Footer from "../components/layout/Footer";
import Checkout from "../features/cart/pages/Checkout";
import NotFound from "../features/support/pages/NotFound";
import {
  me as fetchMe,
  logout as clearLocalAuth,
  invalidateServerSession as apiLogout,
} from "../features/auth/services/authService";
import Browse, { EMPTY_FILTERS } from "../features/buyer/pages/Browse";
import { parseHash } from "../router/routes";
import { clearServerCart } from "../features/cart/services/cartService";
import { AUTH_STORAGE_KEYS, onSessionExpired } from "../services/api/client";
import { cart as cartApi } from "../services/api/endpoints";

const EMPTY_CHECKOUT_ADDRESS = { phone: '', line1: '', line2: '', city: '', county: '', postal: '' };
const AGRILINK_CONTROL_URL = String(
  import.meta.env.VITE_AGRILINK_CONTROL_URL || (import.meta.env.DEV ? "http://localhost:5173" : ""),
).trim().replace(/\/+$/, "");

function AdminWorkspaceLink() {
  return (
    <section className="mx-auto max-w-2xl px-5 py-16 text-center" aria-labelledby="control-heading">
      <h1 id="control-heading" className="font-display text-2xl font-bold text-ink">AgriLink Control</h1>
      <p className="mt-3 text-muted">Administration is available in the separate AgriLink Control workspace.</p>
      {AGRILINK_CONTROL_URL ? (
        <a className="mt-6 inline-flex rounded-xl bg-brand px-5 py-3 font-semibold text-white" href={`${AGRILINK_CONTROL_URL}/dashboard`}>
          Open AgriLink Control
        </a>
      ) : (
        <p className="mt-6" role="status">The AgriLink Control URL is not configured for this deployment.</p>
      )}
    </section>
  );
}

/* Auth boot panel — shown on protected routes while the boot session
   check (httpOnly cookie restore via GET /api/auth/me) is still in
   flight. Prevents the shells from flashing their signed-out access
   gate before flipping to the dashboard on refresh. */
function AuthBoot() {
  return (
    <div
      className="min-h-[calc(100vh-72px)] bg-farmer-page px-4 py-16"
      aria-busy="true"
    >
      <div
        role="status"
        className="mx-auto max-w-md rounded-2xl border border-line/80 bg-paper p-8 text-center shadow-sm"
      >
        <RotateCw
          size={26}
          aria-hidden="true"
          className="mx-auto animate-spin text-brand"
        />
        <h2 className="mt-3 font-display text-lg font-bold text-ink">
          Checking your session…
        </h2>
        <p className="mt-1 text-sm text-muted">
          Restoring your sign in from the secure session cookie.
        </p>
      </div>
    </div>
  );
}

export default function App() {
  // ------------------------------------------------------------------ state
  const [user, setUser] = useState(null); // { name, email, role: 'Buyer' | 'Farmer' | 'Admin' }, server-verified session
  const [route, setRoute] = useState(parseHash); // 'shop' | 'farmer/<page>' | 'buyer/<page>' | 'admin/<page>'
  const [authOpen, setAuthOpen] = useState(false);
  const [authPreset, setAuthPreset] = useState(null); // { tab, role }, pre-selects modal state
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState([]); // [{ productId, name, price, unit, image, stock, qty }]
  const cartRef = useRef(cart);
  useEffect(() => { cartRef.current = cart; }, [cart]);
  const [checkoutAddress, setCheckoutAddress] = useState(EMPTY_CHECKOUT_ADDRESS);
  const [hydrated, setHydrated] = useState(false); // localStorage cart restored
  /* Auth boot: the fresh mount looks identical to "signed out" until the
     cookie-restore check answers. authReady turns true once the boot check
     settles (fetchMe resolve/reject or demo fallback), so protected routes
     show a loading state instead of flashing an access panel before
     flipping to the dashboard. */
  const [authReady, setAuthReady] = useState(false);

  /* Where a farmer wanted to go before being asked to sign in — restored
     after a successful auth. A ref so the boot effect can read it too. */
  const returnTo = useRef(null);
  /* Generation counter bumped on sign-out: any in-flight session restore
     (or demo login) that resolves AFTER a logout is ignored, so a stale
     response can never re-authenticate the UI (session security). */
  const sessionEpoch = useRef(0);

  // ------------------------------------------------------------------ cart
  /* Persist the cart to a versioned localStorage key so it survives
     refreshes. Restored data is validated before use; corrupted storage
     is ignored. No tokens, payment credentials or other sensitive data
     are ever persisted. */
  const CART_STORAGE_KEY = "agrilink_cart_v1";
  const CART_OWNER_KEY = "agrilink_cart_owner_v1";

  const cartLineFromApi = (item) => {
    const product = item?.product ?? item ?? {};
    const productId = item?.productId ?? product?.id ?? product?._id;
    const rawPrice = item?.price ?? product?.price;
    const rawStock = item?.stock ?? product?.stock;
    const rawQuantity = item?.quantity ?? item?.qty;
    const price = rawPrice == null || rawPrice === '' || !Number.isFinite(Number(rawPrice)) || Number(rawPrice) <= 0 ? null : Number(rawPrice);
    const stock = rawStock == null || rawStock === '' || !Number.isFinite(Number(rawStock)) || Number(rawStock) < 0 ? null : Number(rawStock);
    const quantity = rawQuantity == null || rawQuantity === '' || !Number.isFinite(Number(rawQuantity)) || Number(rawQuantity) <= 0 ? null : Number(rawQuantity);
    const unit = item?.unit ?? product?.unit ?? null;
    return productId ? {
      productId: String(productId), name: item?.name ?? product?.name ?? 'Listing details unavailable',
      price, unit: typeof unit === 'string' && unit.trim() ? unit : null,
      image: item?.image ?? product?.image ?? '', stock, qty: quantity,
      unavailable: item?.unavailable === true || price === null || stock === null || !unit,
    } : null;
  };
  const serverCartLines = async () => {
    const result = await cartApi.get();
    return (Array.isArray(result?.items) ? result.items : []).map(cartLineFromApi).filter(Boolean);
  };

  const loadCart = useCallback(() => {
    try {
      const raw = localStorage.getItem(CART_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const valid = parsed.filter(
        (i) =>
          i &&
          typeof i.productId === "string" &&
          typeof i.name === "string" &&
          typeof i.price === "number" &&
          i.price > 0 &&
          typeof i.unit === "string" &&
          typeof i.qty === "number" &&
          i.qty >= 1 &&
          typeof i.stock === "number" &&
          i.qty <= i.stock,
      );
      setCart(valid);
    } catch {
      /* corrupted or unreadable storage — start with an empty cart */
    }
    setHydrated(true);
  }, []);

  const saveCart = useCallback((c) => {
    try {
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(c));
    } catch {
      /* storage unavailable or quota exceeded — cart lives in memory only */
    }
  }, []);

  useEffect(() => {
    loadCart();
  }, [loadCart]);

  useEffect(() => {
    if (!hydrated) return;
    saveCart(cart);
  }, [cart, hydrated, saveCart]);

  const addToCart = useCallback((product) => {
    if (user?.role === 'Buyer') {
      void cartApi.add(product.id, 1).then(async () => setCart(await serverCartLines())).catch((error) => setNotice(error?.error || 'This item could not be added to your cart.'));
      return;
    }
    setCart((prev) => {
      const found = prev.find((i) => i.productId === product.id);
      /* respect the farmer's real stock: never allow more than is listed */
      if (found)
        return prev.map((i) =>
          i.productId === product.id
            ? { ...i, qty: Math.min(i.qty + 1, product.stock) }
            : i,
        );
      return [
        ...prev,
        {
          productId: product.id,
          name: product.name,
          price: product.price,
          unit: product.unit.split(" ")[0],
          image: product.image,
          stock: product.stock,
          qty: 1,
        },
      ];
    });
  }, [user?.role]);

  const changeQty = useCallback((productId, delta) => {
    if (user?.role === 'Buyer') {
      const current = cartRef.current.find((item) => item.productId === productId);
      if (!current) return;
      const next = current.qty + delta;
      const operation = next < 1 ? cartApi.removeProduct(productId) : cartApi.update(productId, next);
      void operation.then(async () => setCart(await serverCartLines())).catch((error) => setNotice(error?.error || 'Your cart quantity could not be updated.'));
      return;
    }
    setCart((prev) =>
      prev
        .map((i) =>
          i.productId === productId
            ? { ...i, qty: Math.min(Math.max(i.qty + delta, 1), i.stock ?? 99) }
            : i,
        )
        .filter((i) => i.qty > 0),
    );
  }, [user?.role]);

  const removeFromCart = useCallback(
    (productId) => {
      if (user?.role === 'Buyer') {
        void cartApi.removeProduct(productId).then(async () => setCart(await serverCartLines())).catch((error) => setNotice(error?.error || 'The item could not be removed.'));
      } else setCart((prev) => prev.filter((i) => i.productId !== productId));
    },
    [user?.role],
  );

  const clearCart = useCallback(async () => {
    if (user?.role === 'Buyer') await clearServerCart();
    setCart([]);
  }, [user?.role]);

  useEffect(() => {
    if (!user?.id || user.role !== 'Buyer') return undefined;
    let active = true;
    void (async () => {
      try {
        const savedOwner = localStorage.getItem(CART_OWNER_KEY);
        const guestItems = savedOwner ? [] : cartRef.current;
        let serverItems = await serverCartLines();
        const existing = new Set(serverItems.map((item) => item.productId));
        for (const item of guestItems) {
          if (!existing.has(item.productId)) {
            await cartApi.add(item.productId, item.qty);
            existing.add(item.productId);
          }
        }
        serverItems = await serverCartLines();
        if (active) {
          localStorage.setItem(CART_OWNER_KEY, user.id);
          setCart(serverItems);
        }
      } catch (error) {
        if (active) setNotice(error?.error || 'Your saved cart could not be loaded from the server.');
      }
    })();
    return () => { active = false; };
  }, [user?.id, user?.role]);

  const cartCount = cart.reduce((sum, i) => sum + (Number.isFinite(i.qty) ? i.qty : 0), 0);

  /* ---------------------------------------------------------------- routes */
  const goRoute = useCallback((next) => {
    if (next !== parseHash()) {
      const routeChange = new Event("agrilink:before-route-change", { cancelable: true });
      if (!window.dispatchEvent(routeChange)) return;
    }
    setRoute(next);
    const hash = next === "shop" ? "#shop" : `#/${next}`;
    if (window.location.hash !== hash) history.replaceState(null, "", hash);
    window.scrollTo(0, 0);
  }, []);

  /* Buyer dashboard: Browse's filter state lives at app level so the
     Overview's "Find Produce" form can jump straight into a pre-filtered
     Browse (and "clear filters" has a single source of truth). */
  const [browseFilters, setBrowseFilters] = useState(EMPTY_FILTERS);
  const jumpToBrowse = useCallback(
    (patch = {}) => {
      setBrowseFilters({ ...EMPTY_FILTERS, ...patch });
      goRoute("buyer/produce");
    },
    [goRoute],
  );

  /* Browser back/forward and manual hash edits stay in sync. Scrolling to
     the top matches goRoute() so hash-anchor links (footer/nav CTAs) land
     the user at the start of the destination page, like the buttons do. */
  useEffect(() => {
    const onHash = () => {
      setRoute(parseHash());
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const openAuth = useCallback((preset = {}) => {
    setAuthPreset(preset);
    setAuthOpen(true);
  }, []);

  /* Checkout gate: signed in buyers go straight to checkout; anonymous
     users open the login modal and return here after signing in. */
  const openCheckout = useCallback(() => {
    if (!user) {
      returnTo.current = "shop/checkout";
      openAuth({ tab: "login" });
      return;
    }
    goRoute("shop/checkout");
  }, [user, goRoute, openAuth]);

  /* Restore the server-issued HttpOnly cookie session. Query parameters can
     never create or substitute for an authenticated identity. */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("demo")) {
      params.delete("demo");
      const cleanSearch = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${cleanSearch ? `?${cleanSearch}` : ""}${window.location.hash}`);
    }
    if (params.get("auth")) openAuth();

    // The server cookie decides whether a session exists.
    fetchMe()
      .then((u) => {
        if (u && sessionEpoch.current === 0) handleAuth(u);
      })
      /* A confirmed 401 means the stored JWT is expired/invalid: purge the
         stale cookie server side so it can never authenticate again.
         Network failures (status 0) are NOT treated as logout — the user
         keeps whatever session the cookie really holds (retry on refresh). */
      .catch((err) => {
        if (err?.status === 401 || err?.code === 'SESSION_REALM_MISMATCH') apiLogout().catch(() => {});
      })
      .finally(() => setAuthReady(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------------ auth
  /* Every successful login/signup/restore routes by the SERVER-returned
     role — but never steals a deep link the app is already showing:
     • fresh login from a public page → each role lands on its own
       dashboard (farmer dashboard / buyer dashboard / admin overview)
     • session restored while sitting on #/farmer/*, #/buyer/* or
       #/admin/* → the deep link survives the reload
     • a saved "returnTo" (the page the user was blocked from) wins over
       all of the above for its own role */
  const handleAuth = useCallback(
    (authUser) => {
      const storedCartOwner = localStorage.getItem(CART_OWNER_KEY);
      const identityChanged = (user?.id && authUser?.id && user.id !== authUser.id)
        || (storedCartOwner && authUser?.id && storedCartOwner !== authUser.id);
      if (identityChanged) {
        sessionEpoch.current += 1;
        setCart([]);
        localStorage.removeItem(CART_STORAGE_KEY);
        localStorage.removeItem(CART_OWNER_KEY);
        setCheckoutAddress(EMPTY_CHECKOUT_ADDRESS);
      }
      setUser(authUser);
      setAuthOpen(false);
      const target = returnTo.current;
      returnTo.current = null;
      const current = parseHash();
      /* checkout deep link restored after login/signup */
      if (target === "shop/checkout") {
        goRoute("shop/checkout");
        return;
      }
      if (authUser?.role === "Farmer") {
        const deep = current.startsWith("farmer/")
          ? current
          : target && target.startsWith("farmer/")
            ? target
            : "farmer/dashboard";
        goRoute(deep);
      } else if (authUser?.role === "Admin") {
        if (AGRILINK_CONTROL_URL) window.location.replace(`${AGRILINK_CONTROL_URL}/dashboard`);
        else goRoute("admin/overview");
      } else {
        const deep = current.startsWith("buyer/")
          ? current
          : target && target.startsWith("buyer/")
            ? target
            : "buyer/dashboard";
        goRoute(deep);
      }
    },
    [goRoute, user],
  );

  const [notice, setNotice] = useState(null); // sign-out confirmation (aria-live)

  const signOut = useCallback(async () => {
    /* Invalidate pending session restores before waiting on the backend so a
       slow /me response cannot bring the protected shell back after Home. */
    sessionEpoch.current += 1;
    let serverConfirmed = false;
    try {
      const result = await apiLogout();
      serverConfirmed = result?.serverInvalidated === true;
    } catch {
      /* The backend logout contract is currently unavailable. Clear this
         browser's auth state below, but do not claim server invalidation. */
    }
    storageLogoutHandled.current = true;
    clearLocalAuth();
    setUser(null);
    setCart([]);
    localStorage.removeItem(CART_OWNER_KEY);
    returnTo.current = null;
    setCheckoutAddress(EMPTY_CHECKOUT_ADDRESS);
    goRoute("shop");
    setNotice(
      serverConfirmed
        ? "You are signed out."
        : "Signed out on this device. Server session invalidation could not be confirmed.",
    );
  }, [goRoute]);

  const onHome = useCallback(() => {
    if (user) return signOut();
    if (!authReady) {
      return signOut();
    }
    goRoute('shop');
  }, [authReady, clearLocalAuth, goRoute, signOut, user]);

  /* A non-sensitive cross-tab event synchronizes cookie-session logout. */
  const storageLogoutHandled = useRef(false);
  useEffect(() => {
    if (user) storageLogoutHandled.current = false;
  }, [user]);

  useEffect(() => {
    const onIdentityChanged = () => {
      if (!user) return;
      const epoch = ++sessionEpoch.current;
      setUser(null);
      setCart([]);
      localStorage.removeItem(CART_STORAGE_KEY);
      localStorage.removeItem(CART_OWNER_KEY);
      setCheckoutAddress(EMPTY_CHECKOUT_ADDRESS);
      setAuthReady(false);
      fetchMe()
        .then((nextUser) => {
          if (epoch !== sessionEpoch.current) return;
          if (nextUser) handleAuth(nextUser);
          else { goRoute('shop'); setNotice('The marketplace session changed. Sign in again to continue.'); }
        })
        .catch(() => {
          if (epoch === sessionEpoch.current) {
            goRoute('shop');
            setNotice('The marketplace session could not be restored. Sign in again to continue.');
          }
        })
        .finally(() => setAuthReady(true));
    };
    const onSessionEnded = () => {
      if (!user || storageLogoutHandled.current) return;
      storageLogoutHandled.current = true;
      sessionEpoch.current += 1;
      setUser(null);
      setCart([]);
      localStorage.removeItem(CART_STORAGE_KEY);
      localStorage.removeItem(CART_OWNER_KEY);
      returnTo.current = null;
      setCheckoutAddress(EMPTY_CHECKOUT_ADDRESS);
      goRoute('shop');
      setNotice('Your session ended in another tab.');
    };
    const onStorage = (event) => {
      if (event.key !== AUTH_STORAGE_KEYS.event || !event.newValue) return;
      if (event.newValue.startsWith('signed-out:')) onSessionEnded();
      else if (event.newValue.startsWith('identity-changed:')) onIdentityChanged();
    };
    let channel;
    try { channel = new BroadcastChannel('agrilink.marketplace.session'); channel.onmessage = (event) => { if (event.data?.type === 'signed-out') onSessionEnded(); else if (event.data?.type === 'identity-changed') onIdentityChanged(); }; } catch { /* unsupported browser */ }
    window.addEventListener('storage', onStorage);
    return () => { window.removeEventListener('storage', onStorage); channel?.close(); };
  }, [goRoute, user]);

  useEffect(() => onSessionExpired(() => {
    if (!user || storageLogoutHandled.current) return;
    storageLogoutHandled.current = true;
    sessionEpoch.current += 1;
    setUser(null);
    setCart([]);
    localStorage.removeItem(CART_STORAGE_KEY);
    localStorage.removeItem(CART_OWNER_KEY);
    returnTo.current = null;
    setCheckoutAddress(EMPTY_CHECKOUT_ADDRESS);
    goRoute('shop');
    setNotice('Your Farmer/Buyer session expired or belongs to another AgriLink app. Sign in again.');
  }), [goRoute, user]);

  const syncAccountProfile = useCallback((profile) => {
    setUser((current) => current ? {
      ...current,
      name: profile.fullName || current.name,
      email: profile.email || current.email,
      image: profile.image ?? current.image,
    } : current);
  }, []);

  const accountDeleted = useCallback(() => {
    sessionEpoch.current += 1;
    setUser(null);
    returnTo.current = null;
    goRoute('shop');
    setNotice('Your AgriLink account has been deleted.');
  }, [goRoute]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  // ----------------------------------------------------------------- render
  const page = route.startsWith("farmer/")
    ? route.slice("farmer/".length)
    : null;
  const buyerPage = route.startsWith("buyer/")
    ? route.slice("buyer/".length)
    : null;

  const farmerPage = {
    dashboard: <Overview onNavigate={goRoute} />,
    "market-intelligence": <MarketIntelligence />,
    produce: <MyProduce />,
    inquiries: <FarmerInquiries />,
    orders: <FarmerOrders />,
    profile: <FarmProfile onNavigate={goRoute} />,
    settings: <FarmerSettings onDeleted={accountDeleted} onProfileUpdated={syncAccountProfile} />,
    "ai-market-advisor": <AIAdvisor />,
    "ai-agricultural-assistant": <AIAssistant />,
    "ai-recommendations": <AIRecommendations userRole="farmer" />,
    "ai-crop-insights": <AICropInsights />,
    "ai-price-recommendation": <AIPriceRecommendation />,
    "ai-listing-improvement": <AIListingImprovement />,
    "ai-buyer-matching": <AIBuyerMatching />,
    "ai-harvest-planner": <AIHarvestPlanner />,
    "ai-net-profit-advisor": <AINetProfitAdvisor />,
  }[page ?? "dashboard"] ?? <Overview onNavigate={goRoute} />;

  const buyerNode = {
    dashboard: <BuyerOverview onJumpToBrowse={jumpToBrowse} />,
    produce: (
      <BuyerBrowse filters={browseFilters} onFiltersChange={setBrowseFilters} />
    ),
    "price-comparison": <BuyerPriceCompare />,
    requests: <BuyerRequests />,
    inquiries: <BuyerInquiries />,
    saved: <BuyerSaved onBrowse={() => jumpToBrowse()} />,
    orders: <BuyerOrders />,
    profile: <BuyerProfile onNavigate={goRoute} />,
    settings: <BuyerSettings onDeleted={accountDeleted} onProfileUpdated={syncAccountProfile} />,
    "ai-market-advisor": <AIAdvisor />,
    "ai-agricultural-assistant": <AIAssistant />,
    "ai-recommendations": <AIRecommendations userRole="buyer" />,
    "ai-produce-finder": <AIProduceFinder />,
    "ai-supplier-matching": <AISupplierMatching />,
    "ai-purchase-planning": <AIPurchasePlanning />,
  }[buyerPage ?? "dashboard"] ?? (
    <BuyerOverview onJumpToBrowse={jumpToBrowse} />
  );

  return (
    <ThemeProvider>
      <div className="agri-app-frame min-h-screen">
        <Navbar
          user={user}
          booting={!authReady}
          route={route}
          onRoute={goRoute}
          onHome={onHome}
          search={search}
          onSearch={setSearch}
          cart={cart}
          cartCount={cartCount}
          onQty={changeQty}
          onCheckout={openCheckout}
          onClearCart={clearCart}
          onSignIn={() => openAuth()}
          onSignOut={signOut}
        />

        {/* offset for the fixed navbar (main row + mobile search row) */}
        <main className="pt-[136px] md:pt-[72px]">
          <Suspense fallback={<div className="min-h-64 p-10 text-center text-muted" role="status">Loading workspace…</div>}>
          {/* while the boot session check is in flight, protected routes
            render a loading state — never a flash of the signed-out gate
            followed by the dashboard */}
          {!authReady &&
          (route.startsWith("farmer/") ||
            route.startsWith("buyer/") ||
            route.startsWith("admin/")) ? (
            <AuthBoot />
          ) : route === "dev/ai-diagnostics" && import.meta.env.DEV ? (
            <AIDiagnostics />
          ) : route === "shop/checkout" ? (
            !user ? (
              <Checkout
                user={null}
                onSignIn={() => {
                  returnTo.current = "shop/checkout";
                  openAuth({ tab: "login" });
                }}
              />
            ) : (
              <Checkout
                cart={cart}
                user={user}
                onQty={changeQty}
                onRemove={removeFromCart}
                onBack={() => goRoute("shop")}
                onAddMoreItems={() => goRoute("shop")}
                address={checkoutAddress}
                onAddressChange={setCheckoutAddress}
                onOrderPlaced={() => setCart([])}
              />
            )
          ) : route === "contact" ? (
            <ContactPage onOpenAuth={openAuth} />
          ) : route === "how-it-works" ? (
            <HowItWorks />
          ) : route === "faq" ? (
            <FAQ />
          ) : route === "about" ? (
            <AboutPage />
          ) : route === "start-selling" ? (
            <StartSelling
              user={user}
              onOpenAuth={openAuth}
              onNavigate={goRoute}
            />
          ) : route.startsWith("info/") ? (
            <InfoPage id={route.slice(5)} onNavigate={goRoute} />
          ) : route === "not-found" ? (
            <NotFound user={user} onRoute={goRoute} />
          ) : route === "shop" ? (
            <>
              {/* hero CTA pre-picks the Farmer card: "Join as a Farmer" leads
                straight into farmer signup */}
              <Hero
                onJoin={() => openAuth({ tab: "signup", role: "Farmer" })}
              />
              <Marketplace
                search={search}
                onClearSearch={() => setSearch("")}
                onAddToCart={addToCart}
              />
            </>
          ) : route.startsWith("admin/") ? (
            <AdminWorkspaceLink />
          ) : route.startsWith("buyer/") ? (
            <BuyerShell
              key={user?.id ?? 'signed-out'}
              user={user}
              page={buyerPage}
              onNavigate={goRoute}
              onSignOut={signOut}
              /* the access guard remembers the buyer route, so after
               sign in the user lands where they intended */
              onOpenAuth={(preset) => {
                returnTo.current = route;
                openAuth(preset);
              }}
              onBackToShop={() => goRoute("shop")}
              onFarmerDashboard={() => goRoute("farmer/dashboard")}
            >
              {buyerNode}
            </BuyerShell>
          ) : (
            <FarmerShell
              key={user?.id ?? 'signed-out'}
              user={user}
              page={page}
              onNavigate={goRoute}
              onSignOut={signOut}
              /* the access guard remembers the farmer route, so after
               sign in the user lands where they intended */
              onOpenAuth={(preset) => {
                returnTo.current = route;
                openAuth(preset);
              }}
              onBackToShop={() => goRoute("shop")}
            >
              {farmerPage}
            </FarmerShell>
          )}
          </Suspense>
          {/* The marketing footer belongs to the public-side chrome (shop,
            checkout, public content pages). Farmer/Buyer/Admin dashboard
            routes — including their signed-out access gates — render
            without it; the shells' own full-height layout fills the
            viewport instead. */}
          {!route.startsWith("farmer/") &&
            !route.startsWith("buyer/") &&
            !route.startsWith("admin/") && (
              <Footer onLogin={() => openAuth({ tab: "login" })} />
            )}
        </main>

        {/* Sign-out (etc.) confirmation — aria-live so screen readers hear it */}
        {notice && (
          <div
            role="status"
            aria-live="polite"
            className="fixed bottom-4 left-1/2 z-[70] -translate-x-1/2 rounded-xl border border-line/70 bg-paper px-4 py-2.5 text-sm font-medium text-ink shadow-lg"
          >
            {notice}
          </div>
        )}

        <AuthModal
          open={authOpen}
          onClose={() => setAuthOpen(false)}
          onAuth={handleAuth}
          initialTab={authPreset?.tab ?? "login"}
          initialRole={authPreset?.role ?? null}
        />
      </div>
    </ThemeProvider>
  );
}
