import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  Bike,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  ClipboardList,
  Globe2,
  LayoutDashboard,
  LogOut,
  MapPin,
  Package,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Truck,
  Users,
  UtensilsCrossed,
  X,
  AlertTriangle,
  BarChart3,
} from "lucide-react";
import {
  api,
  ApiError,
  isLate,
  kwd,
  type Audit,
  type Branch,
  type Order,
  type Rider,
  type Role,
  type Session,
  type User,
} from "./api";
import { ar as arabic, en, type Key } from "./i18n";
import Hrm from "./Hrm";

type Tab =
  | "dashboard"
  | "orders"
  | "kitchen"
  | "dispatch"
  | "riders"
  | "reports"
  | "settings"
  | "hrm"
  | "myJobs";
type Modal =
  | { type: "order"; id: number }
  | { type: "new" }
  | { type: "import" }
  | { type: "branch" }
  | { type: "user" }
  | {
      type: "action";
      id: number;
      action: "cancelled" | "delivered" | "failed";
    };
type T = (key: Key) => string;
const icons = {
  dashboard: LayoutDashboard,
  orders: ClipboardList,
  kitchen: UtensilsCrossed,
  dispatch: Truck,
  riders: Users,
  reports: BarChart3,
  settings: Settings2,
  hrm: Users,
  myJobs: Bike,
};
const nextStage: Record<string, { status: string; label: Key }> = {
  new: { status: "accepted", label: "accept" },
  accepted: { status: "preparing", label: "startPrep" },
  preparing: { status: "ready", label: "markReady" },
  ready: { status: "handed_over", label: "handover" },
};
const roleLabel: Record<Role, Key> = {
  admin: "admin",
  manager: "manager",
  kitchen: "kitchenRole",
  dispatcher: "dispatcher",
  rider: "rider",
};
const headers =
  "branch_id,source,external_id,delivery_mode,customer_name,phone,area,address,item,quantity,total_kwd,prep_minutes,notes";

function download(name: string, content: string) {
  const url = URL.createObjectURL(
    new Blob(["\ufeff" + content], { type: "text/csv;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
function csvCell(value: unknown): string {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
function Badge({ value, t }: { value: string; t: T }) {
  return (
    <span className={`badge ${value}`}>
      <span />
      {value in en ? t(value as Key) : value}
    </span>
  );
}
function Empty({ t }: { t: T }) {
  return (
    <div className="empty">
      <Package size={34} />
      <h3>{t("empty")}</h3>
      <p>{t("emptyDesc")}</p>
    </div>
  );
}
function ModalFrame({
  title,
  children,
  close,
  busy,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  busy: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) close();
      }}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label="Close"
          disabled={busy}
          onClick={close}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export default function App() {
  const [ar, setAr] = useState(() => localStorage.getItem("dms-lang") === "ar");
  const t: T = (key) => (ar ? arabic[key] : en[key]);
  const [session, setSession] = useState<Session | null>(null);
  const [booting, setBooting] = useState(true);
  const [demo, setDemo] = useState(false);
  const [tab, setTab] = useState<Tab>("dashboard");
  const [branches, setBranches] = useState<Branch[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [riders, setRiders] = useState<Rider[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [branch, setBranch] = useState("all");
  const [source, setSource] = useState("all");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [clock, setClock] = useState(Date.now());
  const [modal, setModal] = useState<Modal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loadError, setLoadError] = useState(false);
  const loadController = useRef<AbortController | null>(null);
  const resetWorkspace = useCallback(() => {
    loadController.current?.abort();
    setOrders([]);
    setBranches([]);
    setRiders([]);
    setUsers([]);
    setModal(null);
    setBranch("all");
    setSource("all");
    setStatus("all");
    setSearch("");
    setNotice("");
    setError("");
  }, []);

  useEffect(() => {
    document.documentElement.lang = ar ? "ar" : "en";
    document.documentElement.dir = ar ? "rtl" : "ltr";
    localStorage.setItem("dms-lang", ar ? "ar" : "en");
  }, [ar]);
  useEffect(() => {
    let alive = true;
    api<{ demo: boolean }>("/health")
      .then((h) => {
        if (alive) setDemo(h.demo);
      })
      .catch(() => {
        if (alive) setLoadError(true);
      });
    api<Session>("/me")
      .then((s) => {
        if (alive) {
          setSession(s);
          if (s.user.role === "rider") setTab("myJobs");
        }
      })
      .catch((e) => {
        if (alive && !(e instanceof ApiError && e.status === 401))
          setLoadError(true);
      })
      .finally(() => {
        if (alive) setBooting(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const reload = useCallback(async () => {
    if (!session) return;
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    try {
      const [b, o, r, u] = await Promise.all([
        api<Branch[]>("/branches", undefined, undefined, controller.signal),
        api<Order[]>("/orders", undefined, undefined, controller.signal),
        ["admin", "manager", "dispatcher"].includes(session.user.role)
          ? api<Rider[]>("/riders", undefined, undefined, controller.signal)
          : Promise.resolve([]),
        session.user.role === "admin"
          ? api<User[]>("/users", undefined, undefined, controller.signal)
          : Promise.resolve([]),
      ]);
      if (controller.signal.aborted) return;
      setBranches(b);
      setOrders(o);
      setRiders(r);
      setUsers(u);
      setLoadError(false);
    } catch (e) {
      if (controller.signal.aborted) return;
      if (e instanceof ApiError && e.status === 401) {
        resetWorkspace();
        setSession(null);
      } else setLoadError(true);
    }
  }, [session, resetWorkspace]);
  useEffect(() => {
    void reload();
    const id = setInterval(() => {
      setClock(Date.now());
      void reload();
    }, 20_000);
    return () => {
      clearInterval(id);
      loadController.current?.abort();
    };
  }, [reload]);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(id);
  }, [notice]);

  const mutate = async (path: string, body: unknown, close = true) => {
    setBusy(true);
    setError("");
    try {
      await api(path, body, session?.csrf);
      await reload();
      if (close) setModal(null);
      setNotice(t("updated"));
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : t("error"));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const open = (value: Modal) => {
    setError("");
    setModal(value);
  };
  const time = (date: string) =>
    new Date(date).toLocaleTimeString(ar ? "ar-KW" : "en-GB", {
      timeZone: "Asia/Kuwait",
      hour: "2-digit",
      minute: "2-digit",
    });
  const visible = orders.filter(
    (o) => branch === "all" || String(o.branch_id) === branch,
  );
  const filtered = visible.filter(
    (o) =>
      (source === "all" || o.source === source) &&
      (status === "all" || o.status === status) &&
      `${o.external_id ?? o.id} ${o.customer_name} ${o.items?.map((i) => i.name).join(" ")}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const role = session?.user.role;
  const canCreate =
    role === "admin" || role === "manager" || role === "dispatcher";
  const canKitchen =
    role === "admin" || role === "manager" || role === "kitchen";
  const canDispatch =
    role === "admin" || role === "manager" || role === "dispatcher";
  const tabs: Tab[] =
    role === "rider"
      ? ["myJobs"]
      : role === "kitchen"
        ? ["dashboard", "orders", "kitchen"]
        : role === "dispatcher"
          ? ["dashboard", "orders", "dispatch", "riders", "reports"]
          : [
              "dashboard",
              "orders",
              "kitchen",
              "dispatch",
              "riders",
              "reports",
              "hrm",
              ...(role === "admin" ? ["settings" as Tab] : []),
            ];
  const active = visible.filter(
    (o) => !["cancelled", "handed_over"].includes(o.status),
  );
  const late = visible.filter((o) => isLate(o, clock));
  const jobs = visible.filter(
    (o) => o.delivery_mode === "own" && o.job_status !== "cancelled",
  );
  const free = riders.filter(
    (r) =>
      r.available &&
      !r.active_jobs &&
      (branch === "all" || r.branches.includes(Number(branch))),
  );
  const selected =
    modal?.type === "order" ? orders.find((o) => o.id === modal.id) : undefined;
  const orderTable = (rows: Order[], compact = false) =>
    rows.length ? (
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t("order")}</th>
              <th>{t("source")}</th>
              {!compact && <th>{t("branch")}</th>}
              <th>{t("stage")}</th>
              <th>{t("delivery")}</th>
              <th>{t("amount")}</th>
              <th>{t("received")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.id}>
                <td>
                  <button
                    className="order-link"
                    onClick={() => open({ type: "order", id: o.id })}
                  >
                    {o.external_id || `#${o.id}`}
                  </button>
                  <small>
                    {o.items
                      ?.map((i) => `${i.quantity} × ${i.name}`)
                      .join(", ")}
                  </small>
                </td>
                <td>
                  <Badge value={o.source} t={t} />
                </td>
                {!compact && <td>{o.branch_name}</td>}
                <td>
                  <Badge value={o.status} t={t} />
                  {isLate(o, clock) && (
                    <small className="late-text">
                      <Clock3 size={11} />
                      {t("delayed")}
                    </small>
                  )}
                </td>
                <td>
                  <span className="delivery-label">
                    {o.delivery_mode === "own" ? (
                      <Bike size={15} />
                    ) : (
                      <Truck size={15} />
                    )}
                    {t(o.delivery_mode)}
                  </span>
                </td>
                <td className="money">{kwd(o.total_fils ?? 0, ar)}</td>
                <td className="muted">{time(o.created_at)}</td>
                <td>
                  <button
                    className="icon-button"
                    aria-label={`${t("details")} ${o.external_id}`}
                    onClick={() => open({ type: "order", id: o.id })}
                  >
                    <ChevronRight size={17} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <Empty t={t} />
    );

  if (booting)
    return (
      <div className="loading">
        <RefreshCw className="spin" />
        {t("loading")}
      </div>
    );
  if (!session)
    return (
      <div className="login-layout">
        <div className="login-story">
          <div className="brand-lockup">
            <div className="brand-mark">
              D<span />
            </div>
            DeliveryOS
          </div>
          <div className="story-text">
            <span className="eyebrow">KUWAIT · RESTAURANTS · FLEET</span>
            <h1>{t("loginTitle")}</h1>
            <p>{t("loginDesc")}</p>
            <div className="story-flow">
              <Package />
              <span />
              <UtensilsCrossed />
              <span />
              <Bike />
            </div>
          </div>
          <div className="story-bottom">
            <ShieldCheck size={16} />
            {t("subtitle")}
          </div>
        </div>
        <div className="login-side">
          <button className="lang-button" onClick={() => setAr(!ar)}>
            <Globe2 size={16} />
            {ar ? "English" : "العربية"}
          </button>
          <form
            className="login-form"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              const f = new FormData(e.currentTarget);
              try {
                const s = await api<Session>("/login", {
                  username: f.get("username"),
                  password: f.get("password"),
                });
                resetWorkspace();
                setSession(s);
                setTab(s.user.role === "rider" ? "myJobs" : "dashboard");
                setLoadError(false);
              } catch (e) {
                setError(e instanceof Error ? e.message : t("error"));
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="eyebrow">{t("workspace")}</div>
            <h2>{t("signIn")}</h2>
            <p className="muted">{t("subtitle")}</p>
            <label>
              {t("username")}
              <input
                name="username"
                autoComplete="username"
                required
                defaultValue={demo ? "admin" : ""}
              />
            </label>
            <label>
              {t("password")}
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
                defaultValue={demo ? "DevDemo!2026" : ""}
              />
            </label>
            {(error || loadError) && (
              <div className="error" role="alert">
                {error || t("connectionError")}
              </div>
            )}
            <button className="primary wide" disabled={busy}>
              {t("signIn")}
              <ArrowRight size={17} />
            </button>
            {demo && (
              <div className="demo-login">
                <span>{t("demo")}</span>
                <p dir="auto">{t("demoAccess")}</p>
              </div>
            )}
          </form>
        </div>
      </div>
    );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark">
            D<span />
          </div>
          <div>
            DeliveryOS<small>{t("subtitle")}</small>
          </div>
        </div>
        <div className="workspace-tag">
          <MapPin size={14} />
          {t("workspace")}
          <span>KW</span>
        </div>
        <nav>
          {tabs.map((key) => {
            const Icon = icons[key];
            return (
              <button
                key={key}
                className={tab === key ? "active" : ""}
                onClick={() => {
                  setTab(key);
                  setSearch("");
                  setSource("all");
                  setStatus("all");
                }}
              >
                <Icon size={19} />
                <span>{t(key)}</span>
                {key === "orders" && (
                  <b>{orders.filter((o) => o.status === "new").length}</b>
                )}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="connection-panel">
            <span className="eyebrow">TALABAT + KEETA</span>
            <div>
              <span className="connection-dot" />
              {t("liveDisabled")}
            </div>
            <small>{t("manual")}</small>
          </div>
          <div className="user-card">
            <div className="avatar">{session.user.name.charAt(0)}</div>
            <div>
              <strong>{session.user.name}</strong>
              <small>{t(roleLabel[session.user.role])}</small>
            </div>
            <button
              className="icon-button"
              aria-label={t("signOut")}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api("/logout", {}, session.csrf);
                  resetWorkspace();
                  setSession(null);
                } catch (e) {
                  setError(e instanceof Error ? e.message : t("error"));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="breadcrumb">
            {t("workspace")}
            <ChevronRight size={14} />
            <strong>{t(tab)}</strong>
          </div>
          <div className="topbar-actions">
            <span className="kuwait-clock">
              {new Date(clock).toLocaleDateString(ar ? "ar-KW" : "en-GB", {
                timeZone: "Asia/Kuwait",
                day: "numeric",
                month: "short",
              })}{" "}
              · {time(new Date(clock).toISOString())}
            </span>
            <button className="lang-button" onClick={() => setAr(!ar)}>
              <Globe2 size={15} />
              {ar ? "English" : "العربية"}
            </button>
            <button
              className="icon-button"
              aria-label={t("refresh")}
              onClick={() => void reload()}
            >
              <RefreshCw size={16} />
            </button>
          </div>
        </header>
        <div className="content">
          <div className="page-head">
            <div>
              <span className="eyebrow">{t("subtitle")}</span>
              <h1>{tab === "dashboard" ? t("welcome") : t(tab)}</h1>
              <p>
                {tab === "dashboard"
                  ? t("intro")
                  : tab === "kitchen"
                    ? t("kitchenNote")
                    : tab === "dispatch"
                      ? t("ownOnly")
                      : tab === "reports"
                        ? t("reportNote")
                        : t("workspace")}
              </p>
            </div>
            <div className="page-actions">
              {role !== "rider" && (
                <select
                  aria-label={t("branch")}
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                >
                  <option value="all">{t("allBranches")}</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              )}
              {canCreate && tab !== "hrm" && (
                <button
                  className="primary"
                  onClick={() => open({ type: "new" })}
                >
                  <Plus size={17} />
                  {t("newOrder")}
                </button>
              )}
              {role === "rider" && (
                <button
                  className={session.user.available ? "secondary" : "primary"}
                  disabled={busy}
                  onClick={async () => {
                    const updated = await mutate("/availability", {
                      available: !session.user.available,
                    });
                    if (!updated) return;
                    try {
                      const s = await api<Session>("/me");
                      setSession(s);
                    } catch (e) {
                      setError(e instanceof Error ? e.message : t("error"));
                    }
                  }}
                >
                  <span
                    className={
                      session.user.available ? "online-dot" : "offline-dot"
                    }
                  />
                  {t(session.user.available ? "toggleOffline" : "toggleOnline")}
                </button>
              )}
            </div>
          </div>
          <div className="manual-banner">
            <AlertTriangle size={16} />
            <span>{t("manualNotice")}</span>
            {demo && <b>{t("demo")}</b>}
          </div>
          {loadError && (
            <div className="error" role="alert">
              {t("connectionError")}{" "}
              <button onClick={() => void reload()}>{t("refresh")}</button>
            </div>
          )}
          {error && !modal && (
            <div className="error" role="alert">
              {error}
            </div>
          )}

          {tab === "dashboard" && (
            <>
              <div className="stats-grid">
                {(
                  [
                    {
                      label: "activeOrders",
                      value: active.length,
                      icon: Package,
                    },
                    {
                      label: "preparing",
                      value: visible.filter((o) => o.status === "preparing")
                        .length,
                      icon: UtensilsCrossed,
                    },
                    {
                      label: "unassigned",
                      value: jobs.filter((o) => o.job_status === "pending")
                        .length,
                      icon: Bike,
                    },
                    {
                      label: "onRoad",
                      value: jobs.filter((o) => o.job_status === "picked_up")
                        .length,
                      icon: Truck,
                    },
                  ] as const
                ).map((s, i) => (
                  <div
                    className={`stat ${i === 0 ? "featured" : ""}`}
                    key={s.label}
                  >
                    <div>
                      <span>{t(s.label)}</span>
                      <s.icon size={19} />
                    </div>
                    <strong>{String(s.value).padStart(2, "0")}</strong>
                    <small>
                      {i === 0
                        ? `${late.length} ${t("delayed")}`
                        : t("localStatus")}
                    </small>
                  </div>
                ))}
              </div>
              <div className="dashboard-grid">
                <section className="panel channels">
                  <div className="panel-title">
                    <h2>{t("channels")}</h2>
                    <span className="subtle-chip">
                      {visible.length} {t("count")}
                    </span>
                  </div>
                  <div className="channel-list">
                    {(["talabat", "keeta", "direct"] as const).map((s) => {
                      const group = visible.filter((o) => o.source === s);
                      return (
                        <div className="channel-row" key={s}>
                          <div className={`channel-icon ${s}`}>
                            {s === "direct" ? (
                              <UtensilsCrossed size={20} />
                            ) : s === "talabat" ? (
                              "t"
                            ) : (
                              "K"
                            )}
                          </div>
                          <div className="channel-info">
                            <strong>{t(s)}</strong>
                            <div className="progress-track">
                              <div
                                style={{
                                  width: `${visible.length ? (group.length / visible.length) * 100 : 0}%`,
                                }}
                              />
                            </div>
                          </div>
                          <div className="channel-total">
                            <strong>
                              {kwd(
                                group
                                  .filter((o) => o.status !== "cancelled")
                                  .reduce(
                                    (sum, o) => sum + (o.total_fils ?? 0),
                                    0,
                                  ),
                                ar,
                              )}
                            </strong>
                            <small>
                              {group.length} {t("count")}
                            </small>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="panel-foot">
                    <ShieldCheck size={14} />
                    {t("manual")}
                  </div>
                </section>
                <section className="panel attention">
                  <div className="panel-title">
                    <h2>{t("alertTitle")}</h2>
                    <span className="alert-count">{late.length}</span>
                  </div>
                  {late.length ? (
                    late.slice(0, 3).map((o) => (
                      <button
                        className="attention-row"
                        key={o.id}
                        onClick={() => open({ type: "order", id: o.id })}
                      >
                        <div className="warning-icon">
                          <Clock3 size={18} />
                        </div>
                        <div>
                          <strong>{o.external_id}</strong>
                          <small>
                            {o.branch_name} · {t(o.source)}
                          </small>
                        </div>
                        <b>
                          {Math.floor(
                            (clock - Date.parse(o.created_at)) / 60000,
                          )}{" "}
                          {t("minutes")}
                        </b>
                      </button>
                    ))
                  ) : (
                    <div className="clear-alert">
                      <CheckCircle2 size={24} />
                      <p>{t("alertClear")}</p>
                    </div>
                  )}
                </section>
              </div>
              <section className="panel">
                <div className="panel-title">
                  <h2>{t("recent")}</h2>
                  <button
                    className="text-button"
                    onClick={() => setTab("orders")}
                  >
                    {t("viewAll")}
                    <ArrowRight size={15} />
                  </button>
                </div>
                {orderTable(visible.slice(0, 6), true)}
              </section>
            </>
          )}

          {tab === "orders" && (
            <section className="panel">
              <div className="filterbar">
                <div className="search-box">
                  <Search size={17} />
                  <input
                    aria-label={t("search")}
                    placeholder={t("search")}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <select
                  aria-label={t("source")}
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                >
                  <option value="all">{t("allPlatforms")}</option>
                  {(["talabat", "keeta", "direct"] as const).map((s) => (
                    <option key={s} value={s}>
                      {t(s)}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={t("stage")}
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option value="all">{t("allStatuses")}</option>
                  {(
                    [
                      "new",
                      "accepted",
                      "preparing",
                      "ready",
                      "handed_over",
                      "cancelled",
                    ] as const
                  ).map((s) => (
                    <option key={s} value={s}>
                      {t(s)}
                    </option>
                  ))}
                </select>
                {canCreate && (
                  <button
                    className="secondary"
                    onClick={() => open({ type: "import" })}
                  >
                    <ArrowDownToLine size={15} />
                    {t("import")}
                  </button>
                )}
                <span className="muted">
                  {filtered.length} {t("count")}
                </span>
              </div>
              {orderTable(filtered)}
            </section>
          )}

          {tab === "kitchen" && (
            <div className="kanban">
              {(["new", "accepted", "preparing", "ready"] as const).map((s) => (
                <section className="kanban-column" key={s}>
                  <div className="column-title">
                    <span className={`stage-dot ${s}`} />
                    <h2>{t(s)}</h2>
                    <b>{visible.filter((o) => o.status === s).length}</b>
                  </div>
                  <div className="kanban-cards">
                    {visible
                      .filter((o) => o.status === s)
                      .map((o) => (
                        <article
                          className={`order-card ${isLate(o, clock) ? "overdue" : ""}`}
                          key={o.id}
                        >
                          <div className="card-top">
                            <Badge value={o.source} t={t} />
                            <span
                              className={
                                isLate(o, clock) ? "late-text" : "muted"
                              }
                            >
                              <Clock3 size={13} />
                              {Math.max(
                                0,
                                Math.floor(
                                  (clock - Date.parse(o.created_at)) / 60000,
                                ),
                              )}{" "}
                              {t("minutes")}
                            </span>
                          </div>
                          <button
                            className="order-link"
                            onClick={() => open({ type: "order", id: o.id })}
                          >
                            {o.external_id}
                          </button>
                          <small className="muted">{o.branch_name}</small>
                          <ul>
                            {o.items?.map((item, i) => (
                              <li key={i}>
                                <b>{item.quantity}×</b>
                                {item.name}
                              </li>
                            ))}
                          </ul>
                          {o.notes && <p className="card-note">{o.notes}</p>}
                          <div className="card-bottom">
                            <span className="delivery-label">
                              <Bike size={14} />
                              {t(o.delivery_mode)}
                            </span>
                            {nextStage[s] &&
                              !(s === "ready" && o.delivery_mode === "own") && (
                                <button
                                  className="secondary small"
                                  disabled={busy}
                                  onClick={() =>
                                    void mutate(
                                      `/orders/${o.id}/status`,
                                      { status: nextStage[s].status },
                                      false,
                                    )
                                  }
                                >
                                  {t(nextStage[s].label)}
                                  <ArrowRight size={14} />
                                </button>
                              )}
                          </div>
                        </article>
                      ))}
                    {!visible.some((o) => o.status === s) && (
                      <div className="column-empty">{t("empty")}</div>
                    )}
                  </div>
                </section>
              ))}
            </div>
          )}

          {(tab === "dispatch" || tab === "myJobs") && (
            <>
              <div className="dispatch-summary">
                <span>
                  <span className="online-dot" />
                  {tab === "dispatch"
                    ? `${free.length} ${t("availableRiders")}`
                    : t(session.user.available ? "online" : "offline")}
                </span>
                <span>
                  {
                    jobs.filter((o) =>
                      ["pending", "assigned", "picked_up"].includes(
                        o.job_status ?? "",
                      ),
                    ).length
                  }{" "}
                  {t("activeJobs")}
                </span>
              </div>
              <div className="job-grid">
                {jobs.length ? (
                  jobs.map((o) => (
                    <article
                      className={`panel job-card ${o.job_status === "delivered" ? "job-complete" : ""}`}
                      key={o.id}
                    >
                      <div className="card-top">
                        <Badge value={o.job_status ?? "pending"} t={t} />
                        <Badge value={o.source} t={t} />
                      </div>
                      <h2>{role === "rider" ? `#${o.id}` : o.external_id}</h2>
                      <div className="job-route">
                        <div>
                          <span className="route-dot start" />
                          <strong>{o.branch_name}</strong>
                          <small>{t(o.status as Key)}</small>
                        </div>
                        <div>
                          <span className="route-dot end" />
                          <strong>{o.area}</strong>
                          <small>{o.address}</small>
                        </div>
                      </div>
                      <div className="customer-line">
                        <Users size={15} />
                        <span>{o.customer_name}</span>
                        <a href={`tel:${o.phone}`} dir="ltr">
                          {o.phone}
                        </a>
                      </div>
                      {o.rider_name && (
                        <div className="assigned-name">
                          <Bike size={16} />
                          {o.rider_name}
                        </div>
                      )}
                      {canDispatch &&
                        ["pending", "assigned"].includes(o.job_status ?? "") &&
                        !["new", "cancelled"].includes(o.status) && (
                          <label className="assign-select">
                            <span>
                              {t(
                                o.job_status === "assigned"
                                  ? "reassignment"
                                  : "assignRider",
                              )}
                            </span>
                            <select
                              aria-label={`${t("assignRider")} ${o.external_id}`}
                              disabled={busy}
                              value=""
                              onChange={(e) => {
                                if (e.target.value)
                                  void mutate(
                                    `/jobs/${o.job_id}/assign`,
                                    { rider_id: Number(e.target.value) },
                                    false,
                                  );
                              }}
                            >
                              <option value="">{t("selectRider")}</option>
                              {riders
                                .filter(
                                  (r) =>
                                    r.available &&
                                    (!r.active_jobs || r.id === o.rider_id) &&
                                    r.branches.includes(o.branch_id),
                                )
                                .map((r) => (
                                  <option key={r.id} value={r.id}>
                                    {r.name}
                                  </option>
                                ))}
                            </select>
                          </label>
                        )}
                      {o.job_status === "assigned" && (
                        <button
                          className="primary wide"
                          disabled={busy || o.status !== "ready"}
                          onClick={() =>
                            void mutate(
                              `/jobs/${o.job_id}/status`,
                              { status: "picked_up" },
                              false,
                            )
                          }
                        >
                          <Package size={15} />
                          {t("pickup")}
                        </button>
                      )}
                      {o.job_status === "picked_up" && (
                        <div className="job-actions">
                          <button
                            className="primary"
                            disabled={busy}
                            onClick={() =>
                              open({
                                type: "action",
                                id: o.id,
                                action: "delivered",
                              })
                            }
                          >
                            <Check size={16} />
                            {t("complete")}
                          </button>
                          <button
                            className="danger-text"
                            disabled={busy}
                            onClick={() =>
                              open({
                                type: "action",
                                id: o.id,
                                action: "failed",
                              })
                            }
                          >
                            {t("fail")}
                          </button>
                        </div>
                      )}
                      {o.failure_reason && (
                        <p className="error">{o.failure_reason}</p>
                      )}
                      {o.proof && (
                        <p className="proof">
                          <CheckCircle2 size={14} />
                          {o.proof}
                        </p>
                      )}
                    </article>
                  ))
                ) : (
                  <div className="panel">
                    <Empty t={t} />
                  </div>
                )}
              </div>
            </>
          )}

          {tab === "riders" && (
            <div className="rider-grid">
              {riders
                .filter(
                  (r) =>
                    branch === "all" || r.branches.includes(Number(branch)),
                )
                .map((r) => (
                  <article className="panel rider-card" key={r.id}>
                    <div className="rider-card-head">
                      <div className="rider-avatar">
                        <Bike size={26} />
                      </div>
                      <Badge
                        value={
                          r.active_jobs
                            ? "busy"
                            : r.available
                              ? "online"
                              : "offline"
                        }
                        t={t}
                      />
                    </div>
                    <h2>{r.name}</h2>
                    <p className="muted">
                      {r.branches
                        .map((id) => branches.find((b) => b.id === id)?.name)
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    <div className="rider-meta">
                      <span>{t("activeJobs")}</span>
                      <strong>{r.active_jobs}</strong>
                    </div>
                    <div className="rider-meta">
                      <span>{t("completed")}</span>
                      <strong>
                        {
                          visible.filter(
                            (o) =>
                              o.rider_id === r.id &&
                              o.job_status === "delivered",
                          ).length
                        }
                      </strong>
                    </div>
                  </article>
                ))}
              {!riders.length && <Empty t={t} />}
            </div>
          )}

          {tab === "reports" && (
            <>
              <div className="report-summary">
                <div>
                  <span>{t("revenue")}</span>
                  <strong>
                    {kwd(
                      visible
                        .filter((o) => o.status !== "cancelled")
                        .reduce((s, o) => s + (o.total_fils ?? 0), 0),
                      ar,
                    )}
                  </strong>
                </div>
                <div>
                  <span>{t("totalOrders")}</span>
                  <strong>{visible.length}</strong>
                </div>
                <div>
                  <span>{t("cancellations")}</span>
                  <strong>
                    {visible.filter((o) => o.status === "cancelled").length}
                  </strong>
                </div>
                <button
                  className="secondary"
                  onClick={() =>
                    download(
                      "delivery-orders.csv",
                      "order_id,reference,source,branch,status,delivery_status,total_kwd,created_at\n" +
                        visible
                          .map((o) =>
                            [
                              o.id,
                              o.external_id,
                              o.source,
                              o.branch_name,
                              o.status,
                              o.job_status,
                              ((o.total_fils ?? 0) / 1000).toFixed(3),
                              o.created_at,
                            ]
                              .map(csvCell)
                              .join(","),
                          )
                          .join("\n"),
                    )
                  }
                >
                  <ArrowDownToLine size={15} />
                  {t("export")}
                </button>
              </div>
              {[
                {
                  title: "reportBySource" as Key,
                  groups: ["talabat", "keeta", "direct"].map((s) => ({
                    name: t(s as Key),
                    rows: visible.filter((o) => o.source === s),
                  })),
                },
                {
                  title: "reportByBranch" as Key,
                  groups: branches
                    .filter((b) => branch === "all" || String(b.id) === branch)
                    .map((b) => ({
                      name: b.name,
                      rows: visible.filter((o) => o.branch_id === b.id),
                    })),
                },
              ].map((section) => (
                <section className="panel report-panel" key={section.title}>
                  <div className="panel-title">
                    <h2>{t(section.title)}</h2>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>
                            {t(
                              section.title === "reportBySource"
                                ? "source"
                                : "branch",
                            )}
                          </th>
                          <th>{t("count")}</th>
                          <th>{t("completed")}</th>
                          <th>{t("cancellations")}</th>
                          <th>{t("revenue")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {section.groups.map((g) => (
                          <tr key={g.name}>
                            <td>
                              <strong>{g.name}</strong>
                            </td>
                            <td>{g.rows.length}</td>
                            <td>
                              {
                                g.rows.filter((o) =>
                                  o.delivery_mode === "own"
                                    ? o.job_status === "delivered"
                                    : o.status === "handed_over",
                                ).length
                              }
                            </td>
                            <td>
                              {
                                g.rows.filter((o) => o.status === "cancelled")
                                  .length
                              }
                            </td>
                            <td className="money">
                              {kwd(
                                g.rows
                                  .filter((o) => o.status !== "cancelled")
                                  .reduce((s, o) => s + (o.total_fils ?? 0), 0),
                                ar,
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ))}
            </>
          )}

          {tab === "hrm" && session && (
            <Hrm
              session={session}
              branches={branches}
              ar={ar}
              branch={branch}
            />
          )}

          {tab === "settings" && (
            <>
              <section className="panel">
                <div className="panel-title">
                  <h2>{t("integrations")}</h2>
                  <span className="subtle-chip">{t("liveDisabled")}</span>
                </div>
                <p className="settings-note">{t("integrationNote")}</p>
                <div className="integration-grid">
                  {[
                    {
                      source: "talabat",
                      url: "https://integration.talabat.com/en/documentation/",
                    },
                    {
                      source: "keeta",
                      url: "https://api-docs.mykeeta.com/apis/standard/docs/orderintegrationguide",
                    },
                  ].map((i) => (
                    <div className="integration-card" key={i.source}>
                      <Badge value={i.source} t={t} />
                      <strong>{t("liveDisabled")}</strong>
                      <a href={i.url} target="_blank" rel="noreferrer">
                        {t("integrationDocs")}
                        <ArrowRight size={14} />
                      </a>
                    </div>
                  ))}
                </div>
              </section>
              <section className="panel">
                <div className="panel-title">
                  <h2>{t("branches")}</h2>
                  <button
                    className="secondary"
                    onClick={() => open({ type: "branch" })}
                  >
                    <Plus size={15} />
                    {t("addBranch")}
                  </button>
                </div>
                <div className="branch-list">
                  {branches.map((b) => (
                    <div key={b.id}>
                      <MapPin size={18} />
                      <strong>{b.name}</strong>
                      <span>{b.area}</span>
                      <small>#{b.id}</small>
                    </div>
                  ))}
                </div>
              </section>
              <section className="panel">
                <div className="panel-title">
                  <h2>{t("users")}</h2>
                  <button
                    className="secondary"
                    onClick={() => open({ type: "user" })}
                  >
                    <Plus size={15} />
                    {t("addUser")}
                  </button>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{t("name")}</th>
                        <th>{t("username")}</th>
                        <th>{t("role")}</th>
                        <th>{t("branchAccess")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((u) => (
                        <tr key={u.id}>
                          <td>{u.name}</td>
                          <td>{u.username}</td>
                          <td>{t(roleLabel[u.role])}</td>
                          <td>
                            {u.role === "admin"
                              ? t("allBranches")
                              : u.branches
                                  .map(
                                    (id) =>
                                      branches.find((b) => b.id === id)?.name,
                                  )
                                  .join(", ")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
          <footer className="page-footer">
            <span>DeliveryOS / KW</span>
            <span>{t("date")} · KWD</span>
            <span>{t("manual")}</span>
          </footer>
        </div>
      </main>
      {notice && (
        <div className="toast" role="status">
          <CheckCircle2 size={17} />
          {notice}
        </div>
      )}
      {modal && (
        <ModalFrame
          title={
            modal.type === "order"
              ? t("details")
              : modal.type === "new"
                ? t("newOrder")
                : modal.type === "import"
                  ? t("importTitle")
                  : modal.type === "branch"
                    ? t("addBranch")
                    : modal.type === "user"
                      ? t("addUser")
                      : t(
                          modal.action === "cancelled"
                            ? "cancelOrder"
                            : modal.action === "failed"
                              ? "fail"
                              : "complete",
                        )
          }
          close={() => {
            setModal(null);
            setError("");
          }}
          busy={busy}
        >
          {error && (
            <div className="error modal-error" role="alert">
              {error}
            </div>
          )}
          {modal.type === "new" && (
            <OrderForm
              t={t}
              branches={branches}
              defaultBranch={branch}
              busy={busy}
              submit={(body) => void mutate("/orders", body)}
            />
          )}
          {modal.type === "order" && selected && (
            <OrderDetail
              order={selected}
              t={t}
              ar={ar}
              busy={busy}
              canKitchen={canKitchen}
              canCancel={role === "admin" || role === "manager"}
              act={(body) =>
                void mutate(`/orders/${selected.id}/status`, body, false)
              }
              cancel={() =>
                open({ type: "action", id: selected.id, action: "cancelled" })
              }
            />
          )}
          {modal.type === "import" && (
            <ImportForm
              t={t}
              branchId={branches[0]?.id ?? 1}
              busy={busy}
              submit={async (content) => {
                setBusy(true);
                setError("");
                try {
                  const result = await api<{
                    created: number;
                    skipped: number;
                  }>("/orders/import", { content }, session.csrf);
                  await reload();
                  setModal(null);
                  setNotice(
                    `${t("importResult")}: ${result.created} ${t("created")}, ${result.skipped} ${t("skipped")}`,
                  );
                } catch (e) {
                  setError(e instanceof Error ? e.message : t("error"));
                } finally {
                  setBusy(false);
                }
              }}
            />
          )}
          {modal.type === "branch" && (
            <form
              className="modal-body form"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void mutate("/branches", {
                  name: f.get("name"),
                  area: f.get("area"),
                });
              }}
            >
              <label>
                {t("name")}
                <input name="name" required maxLength={100} />
              </label>
              <label>
                {t("area")}
                <input name="area" required maxLength={100} />
              </label>
              <button className="primary" disabled={busy}>
                {t("save")}
              </button>
            </form>
          )}
          {modal.type === "user" && (
            <UserForm
              t={t}
              branches={branches}
              busy={busy}
              submit={(body) => void mutate("/users", body)}
            />
          )}
          {modal.type === "action" && (
            <form
              className="modal-body form"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                const o = orders.find((o) => o.id === modal.id);
                if (!o) return;
                void mutate(
                  modal.action === "cancelled"
                    ? `/orders/${o.id}/status`
                    : `/jobs/${o.job_id}/status`,
                  {
                    status: modal.action,
                    ...(modal.action === "delivered"
                      ? { proof: f.get("text") }
                      : { reason: f.get("text") }),
                  },
                );
              }}
            >
              <label>
                {t(
                  modal.action === "delivered"
                    ? "proof"
                    : modal.action === "failed"
                      ? "failureReason"
                      : "cancellationReason",
                )}
                <textarea
                  name="text"
                  required
                  maxLength={500}
                  placeholder={
                    modal.action === "delivered" ? t("proofHint") : ""
                  }
                />
              </label>
              {modal.action === "cancelled" && (
                <p className="hint">{t("manualNotice")}</p>
              )}
              <button className="primary" disabled={busy}>
                {t("save")}
              </button>
            </form>
          )}
        </ModalFrame>
      )}
    </div>
  );
}

function OrderForm({
  t,
  branches,
  defaultBranch,
  busy,
  submit,
}: {
  t: T;
  branches: Branch[];
  defaultBranch: string;
  busy: boolean;
  submit: (body: unknown) => void;
}) {
  const [source, setSource] = useState("direct");
  const [mode, setMode] = useState("own");
  const [validation, setValidation] = useState("");
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const price = String(f.get("total")).trim();
    if (!/^\d+(\.\d{1,3})?$/.test(price)) {
      setValidation(t("total") + ": 0.000");
      return;
    }
    const [whole, fraction = ""] = price.split(".");
    const fils = Number(whole) * 1000 + Number(fraction.padEnd(3, "0"));
    const items = String(f.get("items"))
      .split("\n")
      .filter((s) => s.trim())
      .map((line) => {
        const match = line.trim().match(/^(\d+)\s*[x×]\s*(.+)$/i);
        return {
          name: match ? match[2] : line.trim(),
          quantity: match ? Number(match[1]) : 1,
        };
      });
    submit({
      branch_id: Number(f.get("branch_id")),
      source,
      delivery_mode: mode,
      external_id: String(f.get("external_id")).trim(),
      customer_name: mode === "own" ? f.get("customer_name") : "",
      phone: mode === "own" ? f.get("phone") : "",
      area: mode === "own" ? f.get("area") : "",
      address: mode === "own" ? f.get("address") : "",
      items,
      total_fils: fils,
      prep_minutes: Number(f.get("prep_minutes")),
      notes: f.get("notes"),
    });
  };
  return (
    <form className="modal-body form" onSubmit={onSubmit}>
      <div className="form-grid">
        <label>
          {t("branch")}
          <select
            name="branch_id"
            defaultValue={
              defaultBranch !== "all" ? defaultBranch : branches[0]?.id
            }
            required
          >
            <option value="">{t("select")}</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("source")}
          <select
            value={source}
            onChange={(e) => {
              setSource(e.target.value);
              if (e.target.value === "direct") setMode("own");
            }}
          >
            <option value="direct">{t("direct")}</option>
            <option value="talabat">{t("talabat")}</option>
            <option value="keeta">{t("keeta")}</option>
          </select>
        </label>
        <label>
          {t("externalId")}
          <input name="external_id" required maxLength={100} />
        </label>
        <label>
          {t("mode")}
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="own">{t("own")}</option>
            {source !== "direct" && (
              <option value="platform">{t("platform")}</option>
            )}
          </select>
        </label>
      </div>
      {mode === "own" ? (
        <div className="form-grid">
          <label>
            {t("customer")}
            <input name="customer_name" required maxLength={160} />
          </label>
          <label>
            {t("phone")}
            <input
              name="phone"
              type="tel"
              required
              pattern="\+965[0-9]{8}"
              placeholder="+965XXXXXXXX"
              dir="ltr"
            />
          </label>
          <label>
            {t("area")}
            <input name="area" required maxLength={100} />
          </label>
          <label>
            {t("address")}
            <input name="address" required maxLength={500} />
          </label>
        </div>
      ) : (
        <p className="info-note">{t("platformPrivacy")}</p>
      )}
      <label>
        {t("items")}
        <textarea name="items" required placeholder={t("itemHint")} />
      </label>
      <div className="form-grid">
        <label>
          {t("total")}
          <input
            name="total"
            type="number"
            min="0"
            max="100000"
            step="0.001"
            required
            placeholder="0.000"
          />
        </label>
        <label>
          {t("prepTime")}
          <input
            name="prep_minutes"
            type="number"
            min="1"
            max="180"
            defaultValue={20}
            required
          />
        </label>
      </div>
      <label>
        {t("notes")}
        <textarea name="notes" maxLength={1000} />
      </label>
      {validation && <div className="error">{validation}</div>}
      <p className="hint">{t("manualNotice")}</p>
      <button className="primary" disabled={busy || !branches.length}>
        {t("save")}
        <ArrowRight size={15} />
      </button>
    </form>
  );
}

function OrderDetail({
  order: o,
  t,
  ar,
  busy,
  canKitchen,
  canCancel,
  act,
  cancel,
}: {
  order: Order;
  t: T;
  ar: boolean;
  busy: boolean;
  canKitchen: boolean;
  canCancel: boolean;
  act: (body: unknown) => void;
  cancel: () => void;
}) {
  const [history, setHistory] = useState<Audit[]>([]);
  const [historyError, setHistoryError] = useState("");
  useEffect(() => {
    let alive = true;
    api<Audit[]>(`/orders/${o.id}/audit`)
      .then((data) => {
        if (alive) {
          setHistory(data);
          setHistoryError("");
        }
      })
      .catch((e) => {
        if (alive) setHistoryError(e instanceof Error ? e.message : "Error");
      });
    return () => {
      alive = false;
    };
  }, [o.id, o.updated_at, o.status, o.job_status]);
  const next = nextStage[o.status];
  return (
    <div className="modal-body">
      <div className="detail-heading">
        <div>
          <h2>{o.external_id}</h2>
          <p>{o.branch_name}</p>
        </div>
        <Badge value={o.source} t={t} />
        <Badge value={o.status} t={t} />
      </div>
      <div className="detail-chips">
        <span>{t(o.delivery_mode)}</span>
        <span>{t("manual")}</span>
        {o.is_demo ? <span>{t("training")}</span> : null}
      </div>
      <ul className="detail-items">
        {o.items?.map((i, index) => (
          <li key={index}>
            <strong>
              {i.quantity} × {i.name}
            </strong>
          </li>
        ))}
      </ul>
      <div className="detail-total">
        <span>{t("amount")}</span>
        <strong>{kwd(o.total_fils ?? 0, ar)}</strong>
      </div>
      {o.notes && <p className="info-note">{o.notes}</p>}
      {o.delivery_mode === "own" && o.customer_name && (
        <div className="detail-customer">
          <h3>{t("customer")}</h3>
          <p>
            {o.customer_name} · <span dir="ltr">{o.phone}</span>
          </p>
          <p>
            {o.area} · {o.address}
          </p>
          {o.job_status && <Badge value={o.job_status} t={t} />}
          {o.rider_name && <p>{o.rider_name}</p>}
        </div>
      )}
      <div className="detail-actions">
        {canKitchen &&
          next &&
          !(o.delivery_mode === "own" && next.status === "handed_over") && (
            <button
              className="primary"
              disabled={busy}
              onClick={() => act({ status: next.status })}
            >
              {t(next.label)}
              <ArrowRight size={16} />
            </button>
          )}
        {canCancel && !["handed_over", "cancelled"].includes(o.status) && (
          <button className="danger-text" disabled={busy} onClick={cancel}>
            {t("cancelOrder")}
          </button>
        )}
      </div>
      <h3 className="history-title">{t("history")}</h3>
      {historyError && <p className="error">{historyError}</p>}
      <div className="timeline">
        {history.map((a) => (
          <div key={a.id}>
            <span className="timeline-dot" />
            <strong>
              {a.detail.to
                ? t(a.detail.to as Key)
                : a.event === "rider_assigned"
                  ? t("assignRider")
                  : t("received")}
            </strong>
            <small>
              {a.actor} ·{" "}
              {new Date(a.created_at).toLocaleString(ar ? "ar-KW" : "en-GB", {
                timeZone: "Asia/Kuwait",
              })}
            </small>
            {a.detail.reason ? <p>{String(a.detail.reason)}</p> : null}
            {a.detail.proof ? <p>{String(a.detail.proof)}</p> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function ImportForm({
  t,
  branchId,
  busy,
  submit,
}: {
  t: T;
  branchId: number;
  busy: boolean;
  submit: (content: string) => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  return (
    <form
      className="modal-body form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!file) return;
        if (file.size > 500_000) {
          setError("Maximum 500 KB");
          return;
        }
        try {
          await submit(await file.text());
        } catch {
          setError(t("error"));
        }
      }}
    >
      <p className="info-note">{t("importNote")}</p>
      <button
        className="secondary"
        type="button"
        onClick={() =>
          download(
            "delivery-import-template.csv",
            `${headers}\n${branchId},direct,EXAMPLE-001,own,Fictional Customer,+96550000000,Sharq,"Block 2 Street 4 Building 8",Chicken shawarma,2,5.500,20,Training example\n`,
          )
        }
      >
        <ArrowDownToLine size={15} />
        {t("template")}
      </button>
      <label>
        {t("csvFile")}
        <input
          type="file"
          accept=".csv,text/csv"
          required
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </label>
      {error && <p className="error">{error}</p>}
      <button className="primary" disabled={busy || !file}>
        {t("import")}
      </button>
    </form>
  );
}

function UserForm({
  t,
  branches,
  busy,
  submit,
}: {
  t: T;
  branches: Branch[];
  busy: boolean;
  submit: (body: unknown) => void;
}) {
  const [role, setRole] = useState<Role>("rider");
  return (
    <form
      className="modal-body form"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        submit({
          username: f.get("username"),
          name: f.get("name"),
          password: f.get("password"),
          role,
          branches: f.getAll("branches").map(Number),
        });
      }}
    >
      <div className="form-grid">
        <label>
          {t("name")}
          <input name="name" required maxLength={100} />
        </label>
        <label>
          {t("username")}
          <input
            name="username"
            required
            minLength={3}
            maxLength={80}
            pattern="[a-zA-Z0-9_.-]+"
            autoComplete="off"
          />
        </label>
        <label>
          {t("password")}
          <input
            name="password"
            type="password"
            required
            minLength={12}
            maxLength={200}
            autoComplete="new-password"
            placeholder={t("passwordRule")}
          />
        </label>
        <label>
          {t("role")}
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
          >
            {(
              ["rider", "dispatcher", "kitchen", "manager", "admin"] as const
            ).map((r) => (
              <option key={r} value={r}>
                {t(roleLabel[r])}
              </option>
            ))}
          </select>
        </label>
      </div>
      <fieldset>
        <legend>{t("branchAccess")}</legend>
        {branches.map((b) => (
          <label className="checkbox" key={b.id}>
            <input
              type="checkbox"
              name="branches"
              value={b.id}
              disabled={role === "admin"}
            />
            {b.name}
          </label>
        ))}
        {role === "admin" && <p>{t("allBranches")}</p>}
      </fieldset>
      <button className="primary" disabled={busy}>
        {t("save")}
      </button>
    </form>
  );
}
