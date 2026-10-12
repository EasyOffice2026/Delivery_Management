import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowRight,
  Bike,
  CarFront,
  ChevronRight,
  Globe2,
  LayoutDashboard,
  LogOut,
  MapPin,
  Plus,
  RefreshCw,
  ShieldCheck,
  Truck,
  Users,
  Settings2,
} from "lucide-react";
import { api, type Branch, type Role, type Session, type User } from "./api";
import { en, ar as arabic, type Key } from "./i18n";
import Hrm from "./Hrm";

type Tab =
  | "dashboard"
  | "drivers"
  | "fleet"
  | "aggregators"
  | "hrm"
  | "settings";
type Driver = {
  id: number;
  name: string;
  code: string;
  branch_id: number;
  branch_name: string;
  phone: string;
  current_stage: string;
  completed_stages: number;
  mobile_number: string;
  vehicle_type: string;
  vehicle_registration: string;
  aggregator: string;
  aggregator_rider_id: string;
};
type Vehicle = {
  id: number;
  branch_id: number;
  branch_name: string;
  registration: string;
  vehicle_type: "car" | "motorbike";
  make_model: string;
  status: "available" | "maintenance" | "retired";
  assigned: boolean;
  driver_id: number | null;
  driver_name: string | null;
};
type Aggregator = {
  id: number;
  name: string;
  integration_status: "not_connected";
};

const tabs: { key: Tab; icon: typeof Users }[] = [
  { key: "hrm", icon: ShieldCheck },
  { key: "dashboard", icon: LayoutDashboard },
  { key: "drivers", icon: Users },
  { key: "fleet", icon: Truck },
  { key: "aggregators", icon: Globe2 },
  { key: "settings", icon: Settings2 },
];
const roleLabel: Record<Role, Key> = {
  admin: "admin",
  manager: "manager",
  dispatcher: "dispatcher",
  rider: "rider",
};

export default function App() {
  const [rtl, setRtl] = useState(
    () => localStorage.getItem("dms-lang") === "ar",
  );
  const t = (key: Key) => (rtl ? arabic[key] : en[key]);
  const [session, setSession] = useState<Session | null>(null);
  const [booting, setBooting] = useState(true);
  const [demo, setDemo] = useState(false);
  const [tab, setTab] = useState<Tab>("dashboard");
  const [branch, setBranch] = useState("all");
  const [branches, setBranches] = useState<Branch[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [fleet, setFleet] = useState<Vehicle[]>([]);
  const [aggregators, setAggregators] = useState<Aggregator[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showForm, setShowForm] = useState<
    "vehicle" | "aggregator" | "branch" | "user" | null
  >(null);
  const connectionError = t("connectionError");

  useEffect(() => {
    document.documentElement.lang = rtl ? "ar" : "en";
    document.documentElement.dir = rtl ? "rtl" : "ltr";
    localStorage.setItem("dms-lang", rtl ? "ar" : "en");
  }, [rtl]);

  useEffect(() => {
    let alive = true;
    void api<{ demo: boolean }>("/health")
      .then((h) => {
        if (alive) setDemo(h.demo);
      })
      .catch(() => {});
    void api<Session>("/me")
      .then((value) => {
        if (alive) setSession(value);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setBooting(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const refresh = useCallback(() => setRevision((old) => old + 1), []);
  useEffect(() => {
    if (!session) return;
    let alive = true;
    const read = async () => {
      try {
        const locations = await api<Branch[]>("/branches");
        if (session.user.role === "rider") {
          if (alive) setBranches(locations);
          return;
        }
        const [people, vehicles, platforms, accounts] = await Promise.all([
          api<Driver[]>("/company/drivers"),
          api<Vehicle[]>("/company/fleet"),
          api<Aggregator[]>("/company/aggregators"),
          session.user.role === "admin"
            ? api<User[]>("/users")
            : Promise.resolve([]),
        ]);
        if (alive) {
          setBranches(locations);
          setDrivers(people);
          setFleet(vehicles);
          setAggregators(platforms);
          setUsers(accounts);
          setError("");
        }
      } catch (err) {
        if (alive)
          setError(err instanceof Error ? err.message : connectionError);
      }
    };
    void read();
    return () => {
      alive = false;
    };
  }, [session, revision, connectionError]);

  const update = async (
    action: () => Promise<unknown>,
    form?: HTMLFormElement,
  ) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      form?.reset();
      setShowForm(null);
      setNotice(t("saved"));
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("error"));
    } finally {
      setBusy(false);
    }
  };

  const scopedDrivers = drivers.filter(
    (d) => branch === "all" || String(d.branch_id) === branch,
  );
  const scopedFleet = fleet.filter(
    (v) => branch === "all" || String(v.branch_id) === branch,
  );
  const working = scopedDrivers.filter((d) => d.current_stage === "active");
  const canHrm =
    session?.user.role === "admin" || session?.user.role === "manager";
  const visibleTabs = tabs.filter(
    ({ key }) =>
      (key !== "hrm" || canHrm) &&
      (key !== "settings" || session?.user.role === "admin"),
  );
  const navigate = (target: Tab) => {
    if (tab === "hrm" && target !== "hrm") refresh();
    setTab(target);
    setShowForm(null);
    setError("");
    setNotice("");
  };

  const saveVehicle = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    void update(
      () =>
        api(
          "/company/fleet",
          {
            branch_id: Number(data.get("branch_id")),
            vehicle_type: data.get("vehicle_type"),
            registration: data.get("registration"),
            make_model: data.get("make_model"),
          },
          session!.csrf,
        ),
      form,
    );
  };
  const saveAggregator = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    void update(
      () =>
        api("/company/aggregators", { name: data.get("name") }, session!.csrf),
      form,
    );
  };
  const saveBranch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    void update(
      () =>
        api(
          "/branches",
          { name: data.get("name"), area: data.get("area") },
          session!.csrf,
        ),
      form,
    );
  };
  const saveUser = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const role = data.get("role");
    const access = data.getAll("branches").map(Number);
    if (role !== "admin" && !access.length) {
      setError(t("branchHint"));
      return;
    }
    void update(
      () =>
        api(
          "/users",
          {
            username: data.get("username"),
            name: data.get("name"),
            password: data.get("password"),
            role,
            branches: role === "admin" ? [] : access,
          },
          session!.csrf,
        ),
      form,
    );
  };
  const actions = (
    key: "vehicle" | "aggregator" | "branch" | "user",
    label: Key,
  ) => (
    <button
      type="button"
      className="primary"
      disabled={busy}
      onClick={() => setShowForm(showForm === key ? null : key)}
    >
      <Plus size={16} />
      {t(label)}
    </button>
  );
  const panel = (title: Key, children: ReactNode, action?: ReactNode) => (
    <section className="panel company-panel">
      <div className="panel-title">
        <h2>{t(title)}</h2>
        {action}
      </div>
      {children}
    </section>
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
            {t("brand")}
          </div>
          <div className="story-text">
            <span className="eyebrow">KUWAIT · DELIVERY COMPANY</span>
            <h1>{t("loginTitle")}</h1>
            <p>{t("loginDesc")}</p>
            <div className="story-flow">
              <Users />
              <span />
              <Bike />
              <span />
              <CarFront />
            </div>
          </div>
          <div className="story-bottom">
            <ShieldCheck size={16} />
            {t("subtitle")}
          </div>
        </div>
        <div className="login-side">
          <button className="lang-button" onClick={() => setRtl(!rtl)}>
            <Globe2 size={16} />
            {rtl ? "English" : "العربية"}
          </button>
          <form
            className="login-form"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              setBusy(true);
              setError("");
              void api<Session>("/login", {
                username: data.get("username"),
                password: data.get("password"),
              })
                .then((value) => {
                  setSession(value);
                  navigate("dashboard");
                })
                .catch((err) =>
                  setError(err instanceof Error ? err.message : t("error")),
                )
                .finally(() => setBusy(false));
            }}
          >
            <span className="eyebrow">{t("workspace")}</span>
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
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="primary wide" disabled={busy}>
              {t("signIn")}
              <ArrowRight size={16} />
            </button>
            {demo && (
              <div className="demo-login">
                <strong>{t("demo")}</strong>
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
            {t("brand")}
            <small>{t("subtitle")}</small>
          </div>
        </div>
        <div className="workspace-tag">
          <MapPin size={14} />
          {t("workspace")}
          <span>KW</span>
        </div>
        {session.user.role !== "rider" && (
          <nav aria-label={t("workspace")}>
            {visibleTabs.map(({ key, icon: Icon }) => (
              <button
                key={key}
                className={tab === key ? "active" : ""}
                onClick={() => navigate(key)}
              >
                <Icon size={19} />
                <span>{t(key)}</span>
              </button>
            ))}
          </nav>
        )}
        <div className="sidebar-bottom">
          <div className="connection-panel">
            <span className="eyebrow">TALABAT · KEETA · JAHEZ · SNOONU</span>
            <div>
              <span className="connection-dot" />
              {t("liveDisabled")}
            </div>
            <small>{t("manualNotice")}</small>
          </div>
          <div className="user-card">
            <div className="avatar">{session.user.name.charAt(0)}</div>
            <div>
              <strong>
                <bdi>{session.user.name}</bdi>
              </strong>
              <small>{t(roleLabel[session.user.role])}</small>
            </div>
            <button
              className="icon-button"
              aria-label={t("signOut")}
              disabled={busy}
              onClick={() =>
                void update(async () => {
                  await api("/logout", {}, session.csrf);
                  setSession(null);
                  setDrivers([]);
                  setFleet([]);
                  setAggregators([]);
                  setUsers([]);
                  setBranches([]);
                  setBranch("all");
                })
              }
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
            <button className="lang-button" onClick={() => setRtl(!rtl)}>
              <Globe2 size={15} />
              {rtl ? "English" : "العربية"}
            </button>
            <button
              className="icon-button"
              aria-label={t("refresh")}
              onClick={refresh}
            >
              <RefreshCw size={16} />
            </button>
          </div>
        </header>
        <div className="content company-workspace">
          <div className="page-head">
            <div>
              {tab !== "hrm" && (
                <span className="eyebrow">{t("subtitle")}</span>
              )}
              <h1>{t(tab)}</h1>
              <p>
                {t(
                  tab === "hrm"
                    ? "hrmNote"
                    : tab === "dashboard"
                      ? "overviewNote"
                      : tab === "fleet"
                        ? "fleetNote"
                        : tab === "aggregators"
                          ? "platformNote"
                          : tab === "settings"
                            ? "administrationNote"
                            : "manualNotice",
                )}
              </p>
            </div>
            {session.user.role !== "rider" && (
              <div className="page-actions">
                <select
                  aria-label={t("branch")}
                  value={branch}
                  onChange={(event) => setBranch(event.target.value)}
                >
                  <option value="all">{t("allBranches")}</option>
                  {branches.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          {tab !== "hrm" && (
            <div className="manual-banner">
              <ShieldCheck size={18} />
              <span>{t("manualNotice")}</span>
            </div>
          )}
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          {notice && (
            <div className="company-notice" role="status">
              {notice}
            </div>
          )}
          {session.user.role === "rider" &&
            panel(
              "drivers",
              <p className="company-empty">{t("driverRestricted")}</p>,
            )}
          {session.user.role !== "rider" && tab === "dashboard" && (
            <>
              <div className="stats-grid">
                {(
                  [
                    ["activeDrivers", working.length, "drivers"],
                    [
                      "onboardingDrivers",
                      scopedDrivers.length - working.length,
                      "hrm",
                    ],
                    ["fleetTotal", scopedFleet.length, "fleet"],
                    ["platformTotal", aggregators.length, "aggregators"],
                  ] as const
                ).map(([label, count, target]) => (
                  <button
                    key={label}
                    className="stat company-stat"
                    onClick={() =>
                      navigate(target === "hrm" && !canHrm ? "drivers" : target)
                    }
                  >
                    <small>{t(label)}</small>
                    <strong>{count}</strong>
                    <ArrowRight size={17} />
                  </button>
                ))}
              </div>
              <div className="company-grid">
                {panel(
                  "aggregatorSummary",
                  aggregators.length ? (
                    <div className="company-rows">
                      {aggregators.map((item) => (
                        <div className="company-row" key={item.id}>
                          <strong>{item.name}</strong>
                          <span>
                            {
                              working.filter(
                                (driver) =>
                                  driver.aggregator.toLocaleLowerCase() ===
                                  item.name.toLocaleLowerCase(),
                              ).length
                            }{" "}
                            {t("people")}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="company-empty">{t("noData")}</p>
                  ),
                )}
                {panel(
                  "fleetSummary",
                  <div className="company-rows">
                    <div className="company-row">
                      <strong>{t("car")}</strong>
                      <span>
                        {
                          scopedFleet.filter(
                            (item) => item.vehicle_type === "car",
                          ).length
                        }
                      </span>
                    </div>
                    <div className="company-row">
                      <strong>{t("motorbike")}</strong>
                      <span>
                        {
                          scopedFleet.filter(
                            (item) => item.vehicle_type === "motorbike",
                          ).length
                        }
                      </span>
                    </div>
                    <div className="company-row">
                      <strong>{t("assignedVehicles")}</strong>
                      <span>
                        {scopedFleet.filter((item) => item.assigned).length}
                      </span>
                    </div>
                  </div>,
                )}
              </div>
            </>
          )}
          {session.user.role !== "rider" && tab === "drivers" && (
            <>
              {panel(
                "drivers",
                scopedDrivers.length ? (
                  <div className="company-people">
                    {scopedDrivers.map((driver) => (
                      <article className="company-person" key={driver.id}>
                        <div className="company-person-heading">
                          <span className="hr-avatar">
                            {driver.name.charAt(0)}
                          </span>
                          <div>
                            <strong>
                              <bdi>{driver.name}</bdi>
                            </strong>
                            <small dir="ltr">{driver.code}</small>
                          </div>
                          <span className="company-pill">
                            {driver.current_stage === "active"
                              ? t("active")
                              : t("onboarding")}
                          </span>
                        </div>
                        <p>
                          {t("branch")}: {driver.branch_name}
                        </p>
                        <p>
                          {driver.current_stage === "active" ? (
                            <>
                              <strong>{driver.aggregator}</strong>
                              {driver.aggregator_rider_id && (
                                <>
                                  {" "}
                                  · <bdi>{driver.aggregator_rider_id}</bdi>
                                </>
                              )}
                            </>
                          ) : (
                            <>
                              {t("progress")}:{" "}
                              <bdi>{driver.completed_stages}/11</bdi> ·{" "}
                              {driver.current_stage in en
                                ? t(driver.current_stage as Key)
                                : driver.current_stage}
                            </>
                          )}
                        </p>
                        {driver.vehicle_registration && (
                          <p>
                            {t("vehicle")}:{" "}
                            <bdi>{driver.vehicle_registration}</bdi>
                          </p>
                        )}
                        {driver.current_stage === "active" &&
                          driver.mobile_number && (
                            <p>
                              {t("phone")}:{" "}
                              <bdi dir="ltr">{driver.mobile_number}</bdi>
                            </p>
                          )}
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="company-empty">{t("driverEmpty")}</p>
                ),
                canHrm && (
                  <button className="secondary" onClick={() => navigate("hrm")}>
                    {t("manageHrm")}
                    <ArrowRight size={15} />
                  </button>
                ),
              )}
            </>
          )}
          {session.user.role !== "rider" && tab === "fleet" && (
            <>
              {panel(
                "fleet",
                <>
                  {scopedFleet.length ? (
                    <div className="company-people">
                      {scopedFleet.map((vehicle) => (
                        <article className="company-person" key={vehicle.id}>
                          <div className="company-person-heading">
                            <span className="hr-avatar">
                              {vehicle.vehicle_type === "car" ? (
                                <CarFront size={19} />
                              ) : (
                                <Bike size={19} />
                              )}
                            </span>
                            <div>
                              <strong>
                                <bdi>{vehicle.registration}</bdi>
                              </strong>
                              <small>{t(vehicle.vehicle_type)}</small>
                            </div>
                            <span className="company-pill">
                              {vehicle.assigned
                                ? t("assigned")
                                : t(vehicle.status)}
                            </span>
                          </div>
                          <p>
                            {vehicle.make_model || t("vehicleType")} ·{" "}
                            {vehicle.branch_name}
                          </p>
                          <p>
                            {t("drivers")}:{" "}
                            {vehicle.driver_name ? (
                              <bdi>{vehicle.driver_name}</bdi>
                            ) : vehicle.assigned ? (
                              t("assigned")
                            ) : (
                              "—"
                            )}
                          </p>
                          <label className="company-select">
                            {t("availability")}
                            <select
                              value={vehicle.status}
                              disabled={busy}
                              onChange={(event) =>
                                void update(() =>
                                  api(
                                    `/company/fleet/${vehicle.id}/status`,
                                    { status: event.target.value },
                                    session.csrf,
                                  ),
                                )
                              }
                            >
                              {(
                                ["available", "maintenance", "retired"] as const
                              ).map((status) => (
                                <option key={status} value={status}>
                                  {t(status)}
                                </option>
                              ))}
                            </select>
                          </label>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="company-empty">{t("noVehicles")}</p>
                  )}
                </>,
                actions("vehicle", "addVehicle"),
              )}
              {showForm === "vehicle" && (
                <form className="panel company-form" onSubmit={saveVehicle}>
                  <h2>{t("addVehicle")}</h2>
                  <div className="company-fields">
                    <label>
                      {t("branch")}
                      <select
                        name="branch_id"
                        required
                        defaultValue={
                          branch === "all" ? branches[0]?.id : branch
                        }
                      >
                        {branches.map((location) => (
                          <option key={location.id} value={location.id}>
                            {location.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      {t("vehicleType")}
                      <select name="vehicle_type" required>
                        <option value="car">{t("car")}</option>
                        <option value="motorbike">{t("motorbike")}</option>
                      </select>
                    </label>
                    <label>
                      {t("registration")}
                      <input
                        name="registration"
                        required
                        maxLength={80}
                        dir="auto"
                      />
                    </label>
                    <label>
                      {t("makeModel")}
                      <input name="make_model" maxLength={100} dir="auto" />
                    </label>
                  </div>
                  <button className="primary" disabled={busy}>
                    {t("save")}
                  </button>
                </form>
              )}
            </>
          )}
          {session.user.role !== "rider" && tab === "aggregators" && (
            <>
              {panel(
                "aggregators",
                <div className="company-people">
                  {aggregators.map((item) => (
                    <article className="company-person" key={item.id}>
                      <div className="company-person-heading">
                        <span className="hr-avatar">
                          <Globe2 size={19} />
                        </span>
                        <strong>
                          <bdi>{item.name}</bdi>
                        </strong>
                      </div>
                      <p>
                        {t("integration")}: <strong>{t("liveDisabled")}</strong>
                      </p>
                      <p>
                        {t("people")}:{" "}
                        {
                          working.filter(
                            (driver) =>
                              driver.aggregator.toLocaleLowerCase() ===
                              item.name.toLocaleLowerCase(),
                          ).length
                        }
                      </p>
                    </article>
                  ))}
                </div>,
                session.user.role === "admin" &&
                  actions("aggregator", "addAggregator"),
              )}
              {showForm === "aggregator" && (
                <form className="panel company-form" onSubmit={saveAggregator}>
                  <h2>{t("addAggregator")}</h2>
                  <p>{t("platformNote")}</p>
                  <label>
                    {t("name")}
                    <input name="name" required maxLength={80} dir="auto" />
                  </label>
                  <button className="primary" disabled={busy}>
                    {t("save")}
                  </button>
                </form>
              )}
            </>
          )}
          {canHrm && tab === "hrm" && (
            <Hrm
              session={session}
              branches={branches}
              ar={rtl}
              branch={branch}
            />
          )}
          {session.user.role === "admin" && tab === "settings" && (
            <>
              {panel(
                "settings",
                <p className="company-empty">
                  {t("administrationNote")} {t("accountNote")}
                </p>,
              )}
              {panel(
                "branch",
                <div className="company-rows">
                  {branches.map((item) => (
                    <div className="company-row" key={item.id}>
                      <strong>
                        <bdi>{item.name}</bdi>
                      </strong>
                      <span>{item.area}</span>
                    </div>
                  ))}
                </div>,
                actions("branch", "addBranch"),
              )}
              {showForm === "branch" && (
                <form className="panel company-form" onSubmit={saveBranch}>
                  <h2>{t("addBranch")}</h2>
                  <div className="company-fields">
                    <label>
                      {t("name")}
                      <input name="name" required maxLength={100} dir="auto" />
                    </label>
                    <label>
                      {t("area")}
                      <input name="area" required maxLength={100} dir="auto" />
                    </label>
                  </div>
                  <button className="primary" disabled={busy}>
                    {t("save")}
                  </button>
                </form>
              )}
              {panel(
                "users",
                <div className="company-rows">
                  {users.map((item) => (
                    <div className="company-row" key={item.id}>
                      <strong>
                        <bdi>{item.name}</bdi>
                      </strong>
                      <span>
                        <bdi>{item.username}</bdi> · {t(roleLabel[item.role])}
                      </span>
                    </div>
                  ))}
                </div>,
                actions("user", "addUser"),
              )}
              {showForm === "user" && (
                <form className="panel company-form" onSubmit={saveUser}>
                  <h2>{t("addUser")}</h2>
                  <p>{t("accountNote")}</p>
                  <div className="company-fields">
                    <label>
                      {t("name")}
                      <input name="name" required maxLength={100} dir="auto" />
                    </label>
                    <label>
                      {t("username")}
                      <input
                        name="username"
                        required
                        pattern="[A-Za-z0-9_.-]{3,80}"
                      />
                    </label>
                    <label>
                      {t("password")}
                      <input
                        name="password"
                        type="password"
                        minLength={12}
                        required
                      />
                    </label>
                    <label>
                      {t("role")}
                      <select name="role">
                        {(["manager", "dispatcher", "admin"] as const).map(
                          (role) => (
                            <option key={role} value={role}>
                              {t(role)}
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                  </div>
                  <fieldset className="company-branch-access">
                    <legend>{t("branchAccess")}</legend>
                    {branches.map((item) => (
                      <label key={item.id}>
                        <input
                          type="checkbox"
                          name="branches"
                          value={item.id}
                        />
                        {item.name}
                      </label>
                    ))}
                  </fieldset>
                  <button className="primary" disabled={busy}>
                    {t("save")}
                  </button>
                </form>
              )}
            </>
          )}
          <footer className="page-footer">
            {t("workspace")} · KW <span>{t("manualNotice")}</span>
          </footer>
        </div>
      </main>
    </div>
  );
}
