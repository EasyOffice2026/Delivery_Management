import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  CheckCircle2,
  FileDown,
  FileLock2,
  LockKeyhole,
  Plus,
  RefreshCw,
  ShieldCheck,
  Users,
} from "lucide-react";
import {
  api,
  downloadFile,
  uploadFile,
  kwd,
  type Branch,
  type Session,
} from "./api";

const labels = {
  privacy:
    "Independent Delivery HRM • Admin and branch-manager access only. No connection to HRM Basic.",
  add: "Add candidate",
  candidates: "Candidates & employees",
  active: "Working operations",
  onboarding: "Onboarding",
  section: "Employee section",
  milestone: "Onboarding stage",
  rules: "Onboarding rules",
  compensation: "Salary & terms",
  documents: "Private documents",
  profile: "Profile",
  history: "HR activity",
  name: "Full name",
  nationality: "Nationality",
  passport: "Passport number",
  phone: "Contact phone (international format)",
  branch: "Branch",
  search: "Search name or employee code…",
  all: "All stages",
  empty: "No employee records yet",
  select: "Select an employee to manage onboarding.",
  save: "Save",
  cancel: "Cancel",
  loading: "Loading…",
  updated: "Saved successfully",
  error: "Could not complete the action",
  selection: "Candidate selection & passport",
  visa: "Visa issuance",
  arrival: "Employee arrival",
  medical: "Medical processing",
  iqama: "Iqama / legal residency",
  civil_id: "Civil ID issuance",
  driving_licence: "Driving licence",
  accommodation: "Accommodation / housing",
  mobile: "Mobile phone & number",
  vehicle: "Car / motorbike assignment",
  operations: "Start aggregator operations",
  pending: "Pending",
  locked: "Locked",
  in_progress: "In progress",
  completed: "Completed",
  status: "Status",
  date: "Milestone date",
  responsible: "Responsible person",
  notes: "Notes",
  reference: "Issued number / reference",
  expiry: "Expiry date (if known)",
  address: "Accommodation address",
  unit: "Room / unit / bed reference",
  mobileNumber: "Kuwait mobile number",
  handset: "Handset serial / IMEI",
  vehicleType: "Vehicle type",
  registration: "Vehicle registration",
  car: "Car",
  motorbike: "Motorbike",
  aggregator: "Aggregator",
  riderId: "Aggregator rider ID (optional)",
  choose: "Select…",
  progress: "Completed milestones",
  sequential:
    "Complete milestones in order. Completed records can be corrected with an audit trail, but cannot be reopened.",
  passportRequired:
    "Upload a passport copy in Private documents before completing candidate selection.",
  manual:
    "These are manually recorded milestones and assignments, not government approvals or aggregator account activation.",
  basic: "Monthly basic salary (KWD)",
  effective: "Terms effective from",
  benefit: "Benefit",
  deduction: "Deduction",
  amount: "Amount (KWD)",
  entryName: "Benefit / deduction description",
  entryType: "Entry type",
  frequency: "Frequency",
  monthly: "Monthly",
  one_off: "One-off",
  addTerm: "Add benefit / deduction",
  remove: "Remove",
  net: "Indicative monthly net",
  termsNote:
    "Terms only—not a payroll calculation or payment. The monthly estimate excludes one-off entries; amounts use 3 decimal places.",
  kind: "Document category",
  other: "Other",
  file: "PDF, PNG or JPEG (up to 5 MiB)",
  upload: "Upload privately",
  download: "Download",
  documentNote:
    "Files are stored privately in the Delivery database, not public links. Downloads are audited. Maximum 20 files / 25 MiB per employee. Do not use real passports in the demo.",
  noDocuments: "No documents uploaded",
  noHistory: "No activity",
  current: "Current stage",
  refresh: "Refresh HR records",
  candidate_created: "Candidate created",
  profile_updated: "Profile updated",
  compensation_updated: "Compensation updated",
  milestone_updated: "Milestone updated",
  document_uploaded: "Document uploaded",
  document_downloaded: "Document downloaded",
  precision: "Use a non-negative KWD amount with up to 3 decimal places.",
  branchFixed: "Branch transfers are not supported in this release.",
} as const;
type Label = keyof typeof labels;
const arabic: Record<Label, string> = {
  privacy:
    "موارد بشرية مستقلة للتوصيل • لمدير النظام ومدير الفرع فقط. دون اتصال بنظام الموارد البشرية الأساسي.",
  add: "إضافة مرشح",
  candidates: "المرشحون والموظفون",
  active: "عمليات العمل",
  onboarding: "إجراءات الانضمام",
  section: "قسم ملف الموظف",
  milestone: "مرحلة الانضمام",
  rules: "قواعد إجراءات الانضمام",
  compensation: "الراتب والمستحقات",
  documents: "المستندات الخاصة",
  profile: "الملف الشخصي",
  history: "سجل الموارد البشرية",
  name: "الاسم الكامل",
  nationality: "الجنسية",
  passport: "رقم جواز السفر",
  phone: "هاتف التواصل بالصيغة الدولية",
  branch: "الفرع",
  search: "ابحث بالاسم أو رقم الموظف…",
  all: "كل المراحل",
  empty: "لا توجد سجلات موظفين بعد",
  select: "اختر موظفاً لإدارة إجراءات انضمامه.",
  save: "حفظ",
  cancel: "إلغاء",
  loading: "جارٍ التحميل…",
  updated: "تم الحفظ بنجاح",
  error: "تعذر إكمال الإجراء",
  selection: "اختيار المرشح وجواز السفر",
  visa: "إصدار التأشيرة",
  arrival: "وصول الموظف",
  medical: "إجراءات الفحص الطبي",
  iqama: "الإقامة القانونية",
  civil_id: "إصدار البطاقة المدنية",
  driving_licence: "رخصة القيادة",
  accommodation: "السكن",
  mobile: "الهاتف المحمول والرقم",
  vehicle: "تخصيص سيارة أو دراجة نارية",
  operations: "بدء العمل مع منصة التوصيل",
  pending: "بانتظار الإجراء",
  locked: "مقفل",
  in_progress: "قيد الإجراء",
  completed: "مكتمل",
  status: "الحالة",
  date: "تاريخ المرحلة",
  responsible: "الشخص المسؤول",
  notes: "ملاحظات",
  reference: "الرقم أو المرجع الصادر",
  expiry: "تاريخ الانتهاء إن توفر",
  address: "عنوان السكن",
  unit: "مرجع الغرفة أو الوحدة أو السرير",
  mobileNumber: "رقم الهاتف الكويتي",
  handset: "الرقم التسلسلي للهاتف أو IMEI",
  vehicleType: "نوع المركبة",
  registration: "رقم تسجيل المركبة",
  car: "سيارة",
  motorbike: "دراجة نارية",
  aggregator: "منصة التوصيل",
  riderId: "رقم السائق لدى المنصة (اختياري)",
  choose: "اختر…",
  progress: "المراحل المكتملة",
  sequential:
    "أكمل المراحل بالترتيب. يمكن تصحيح السجلات المكتملة مع حفظ سجل النشاط، ولا يمكن إعادة فتحها.",
  passportRequired:
    "ارفع نسخة جواز السفر في المستندات الخاصة قبل إكمال اختيار المرشح.",
  manual:
    "هذه مراحل وتخصيصات مسجلة يدوياً وليست موافقات حكومية أو تفعيل حسابات منصات.",
  basic: "الراتب الأساسي الشهري (د.ك)",
  effective: "تاريخ سريان المستحقات",
  benefit: "ميزة",
  deduction: "خصم",
  amount: "المبلغ (د.ك)",
  entryName: "وصف الميزة أو الخصم",
  entryType: "نوع البند",
  frequency: "التكرار",
  monthly: "شهري",
  one_off: "لمرة واحدة",
  addTerm: "إضافة ميزة أو خصم",
  remove: "إزالة",
  net: "صافي شهري تقديري",
  termsNote:
    "مستحقات فقط وليست احتساباً لكشف الرواتب أو دفعة. التقدير الشهري لا يشمل البنود لمرة واحدة؛ المبالغ بثلاث منازل عشرية.",
  kind: "فئة المستند",
  other: "أخرى",
  file: "PDF أو PNG أو JPEG حتى 5 ميبيبايت",
  upload: "رفع خاص",
  download: "تنزيل",
  documentNote:
    "تحفظ الملفات بشكل خاص في قاعدة بيانات التوصيل دون روابط عامة. تسجل عمليات التنزيل. الحد 20 ملفاً و25 ميبيبايت لكل موظف. لا تستخدم جوازات حقيقية في التجربة.",
  noDocuments: "لم تُرفع مستندات",
  noHistory: "لا يوجد نشاط",
  current: "المرحلة الحالية",
  refresh: "تحديث سجلات الموارد البشرية",
  candidate_created: "إنشاء مرشح",
  profile_updated: "تحديث الملف",
  compensation_updated: "تحديث المستحقات",
  milestone_updated: "تحديث مرحلة",
  document_uploaded: "رفع مستند",
  document_downloaded: "تنزيل مستند",
  precision: "أدخل مبلغاً غير سالب بالدينار الكويتي حتى ثلاث منازل عشرية.",
  branchFixed: "نقل الموظفين بين الفروع غير مدعوم في هذا الإصدار.",
};
type T = (key: Label) => string;
const stages = [
  "selection",
  "visa",
  "arrival",
  "medical",
  "iqama",
  "civil_id",
  "driving_licence",
  "accommodation",
  "mobile",
  "vehicle",
  "operations",
] as const;
type StageName = (typeof stages)[number];
type Stage = {
  stage: StageName;
  status: "pending" | "in_progress" | "completed";
  occurred_on?: string;
  responsible?: string;
  notes?: string;
  details?: Record<string, string>;
  updated_at?: string;
};
type Entry = {
  kind: "benefit" | "deduction";
  name: string;
  amount_fils: number;
  frequency: "monthly" | "one_off";
};
type Terms = {
  basic_fils: number;
  effective_from: string;
  entries: Entry[];
  monthly_net_fils: number;
};
type Employee = {
  id: number;
  code: string;
  branch_id: number;
  name: string;
  nationality: string;
  passport_number: string;
  phone: string;
  current_stage: StageName | "active";
  completed_stages: number;
  compensation: Terms | null;
  updated_at: string;
};
type Document = { id: number; kind: Label; filename: string; size: number };
type Detail = Employee & {
  stages: Stage[];
  documents: Document[];
  history: {
    id: number;
    event: string;
    created_at: string;
    actor: string;
    detail: { stage?: StageName };
  }[];
};
type Pane = "onboarding" | "compensation" | "documents" | "profile" | "history";
type Run = (action: () => Promise<unknown>) => Promise<void>;
const today = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kuwait" });

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="hr-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function toFils(value: string, message: string) {
  if (!/^\d+(\.\d{1,3})?$/.test(value)) throw new Error(message);
  const [whole, decimal = ""] = value.split(".");
  const fils = Number(whole) * 1000 + Number(decimal.padEnd(3, "0"));
  if (!Number.isSafeInteger(fils) || fils > 100_000_000)
    throw new Error(message);
  return fils;
}

export default function Hrm({
  session,
  branches,
  ar,
  branch,
}: {
  session: Session;
  branches: Branch[];
  ar: boolean;
  branch: string;
}) {
  const t: T = (key) => (ar ? arabic[key] : labels[key]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [aggregators, setAggregators] = useState<string[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [pane, setPane] = useState<Pane>("onboarding");
  const [stageName, setStageName] = useState<StageName>("selection");
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let alive = true;
    void api<{ name: string }[]>("/company/aggregators")
      .then((items) => {
        if (alive) setAggregators(items.map((item) => item.name));
      })
      .catch((err) => {
        if (alive)
          setError(err instanceof Error ? err.message : "Request failed");
      });
    return () => {
      alive = false;
    };
  }, [session.csrf]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    api<Employee[]>("/hrm/employees", undefined, undefined, controller.signal)
      .then((rows) => {
        if (!controller.signal.aborted) setEmployees(rows);
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "Request failed");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [session.csrf, version]);
  useEffect(() => {
    if (selected === null) return;
    const controller = new AbortController();
    api<Detail>(
      `/hrm/employees/${selected}`,
      undefined,
      undefined,
      controller.signal,
    )
      .then((row) => {
        if (!controller.signal.aborted) {
          setDetail(row);
          setStageName(
            row.current_stage === "active" ? "operations" : row.current_stage,
          );
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "Request failed");
      });
    return () => controller.abort();
  }, [selected, session.csrf, version]);
  const run: Run = async (action) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      setVersion((v) => v + 1);
      setNotice(t("updated"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("error"));
    } finally {
      setBusy(false);
    }
  };
  const visible = employees.filter(
    (e) =>
      (branch === "all" || e.branch_id === Number(branch)) &&
      (!stageFilter || e.current_stage === stageFilter) &&
      `${e.name} ${e.code}`.toLowerCase().includes(search.toLowerCase()),
  );
  const current =
    detail?.id === selected &&
    (branch === "all" || detail.branch_id === Number(branch))
      ? detail
      : null;
  const state = current?.stages.find((s) => s.stage === stageName);
  const remaining =
    current?.current_stage === "active"
      ? stages.length
      : stages.indexOf(current?.current_stage ?? "selection");
  const selectEmployee = (id: number) => {
    setSelected(id);
    setPane("onboarding");
    setError("");
    setNotice("");
  };
  return (
    <div className="hr-workspace">
      <div className="hr-heading">
        <div className="hr-access-note">
          <ShieldCheck size={18} />
          <p>{t("privacy")}</p>
        </div>
        <div className="hr-actions">
          <button
            className="secondary"
            disabled={busy}
            onClick={() => setVersion((v) => v + 1)}
            aria-label={t("refresh")}
          >
            <RefreshCw size={16} />
          </button>
          <button
            className="primary"
            disabled={busy || !branches.length}
            onClick={() => setAdding(!adding)}
          >
            <Plus size={16} />
            {t("add")}
          </button>
        </div>
      </div>
      {error && (
        <div className="hr-error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="hr-success" role="status">
          {notice}
        </div>
      )}
      {adding && (
        <section className="panel">
          <h3>{t("add")}</h3>
          <EmployeeForm
            branches={branches}
            branch={branch}
            t={t}
            busy={busy}
            onCancel={() => setAdding(false)}
            onSubmit={(data) =>
              run(async () => {
                const row = await api<{ id: number }>(
                  "/hrm/employees",
                  data,
                  session.csrf,
                );
                setSelected(row.id);
                setPane("onboarding");
                setAdding(false);
              })
            }
          />
        </section>
      )}
      <div className="hr-layout">
        <section className="panel hr-list">
          <div className="hr-employee-picker">
            <Field label={t("candidates")}>
              <select
                value={
                  selected !== null && visible.some((e) => e.id === selected)
                    ? selected
                    : ""
                }
                disabled={busy}
                onChange={(event) => selectEmployee(Number(event.target.value))}
              >
                <option value="" disabled>
                  {t("choose")}
                </option>
                {visible.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.code} · {e.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="hr-list-tools">
            <input
              aria-label={t("search")}
              placeholder={t("search")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              aria-label={t("current")}
              value={stageFilter}
              onChange={(e) => setStageFilter(e.target.value)}
            >
              <option value="">{t("all")}</option>
              {stages.map((s) => (
                <option key={s} value={s}>
                  {t(s)}
                </option>
              ))}
              <option value="active">{t("active")}</option>
            </select>
          </div>
          <span className="hr-count">
            {visible.length} · {t("candidates")}
          </span>
          {loading && !employees.length ? (
            <p>{t("loading")}</p>
          ) : !visible.length ? (
            <div className="hr-empty">
              <Users size={28} />
              <p>{t("empty")}</p>
            </div>
          ) : (
            <div className="hr-list-people">
              {visible.map((e) => (
                <button
                  key={e.id}
                  className={`hr-person ${selected === e.id ? "selected" : ""}`}
                  disabled={busy}
                  onClick={() => selectEmployee(e.id)}
                >
                  <span className="hr-avatar">{e.name.charAt(0)}</span>
                  <span>
                    <strong>
                      <bdi>{e.name}</bdi>
                    </strong>
                    <small>
                      <bdi>{e.code}</bdi> ·{" "}
                      {branches.find((b) => b.id === e.branch_id)?.name}
                    </small>
                    <span
                      className={`hr-chip ${e.current_stage === "active" ? "completed" : "in_progress"}`}
                    >
                      {t(e.current_stage)}
                    </span>
                  </span>
                  <span className="hr-count">
                    <bdi>{e.completed_stages}/11</bdi>
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
        <section className="panel hr-detail">
          {!current ? (
            <div className="hr-empty">
              <Users size={36} />
              <p>
                {selected === null || detail?.id === selected
                  ? t("select")
                  : t("loading")}
              </p>
            </div>
          ) : (
            <>
              <div className="hr-summary">
                <div>
                  <span className="eyebrow">{current.code}</span>
                  <h2>
                    <bdi>{current.name}</bdi>
                  </h2>
                  <p>
                    {current.nationality} ·{" "}
                    {branches.find((b) => b.id === current.branch_id)?.name}
                  </p>
                </div>
                <div className="hr-completion">
                  <strong>
                    <bdi>{current.completed_stages}/11</bdi>
                  </strong>
                  <span>{t("progress")}</span>
                </div>
              </div>
              <progress
                className="hr-progress"
                max={11}
                value={current.completed_stages}
                aria-label={t("progress")}
              />
              <div className="hr-pane-picker">
                <Field label={t("section")}>
                  <select
                    value={pane}
                    disabled={busy}
                    onChange={(event) => setPane(event.target.value as Pane)}
                  >
                    {(
                      [
                        "onboarding",
                        "compensation",
                        "documents",
                        "profile",
                        "history",
                      ] as const
                    ).map((p) => (
                      <option key={p} value={p}>
                        {t(p)}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="hr-tabs" role="tablist">
                {(
                  [
                    "onboarding",
                    "compensation",
                    "documents",
                    "profile",
                    "history",
                  ] as const
                ).map((p) => (
                  <button
                    key={p}
                    role="tab"
                    aria-selected={pane === p}
                    disabled={busy}
                    onClick={() => setPane(p)}
                    className={pane === p ? "selected" : ""}
                  >
                    {t(p)}
                  </button>
                ))}
              </div>
              {pane === "onboarding" && (
                <>
                  <div className="hr-stage-picker">
                    <Field label={t("milestone")}>
                      <select
                        value={stageName}
                        disabled={busy}
                        onChange={(event) =>
                          setStageName(event.target.value as StageName)
                        }
                      >
                        {current.stages.map((s, i) => (
                          <option
                            key={s.stage}
                            value={s.stage}
                            disabled={i > remaining}
                          >
                            {i + 1}. {t(s.stage)} · {t(s.status)}
                            {i > remaining ? ` · ${t("locked")}` : ""}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <div className="hr-onboarding">
                    <nav className="hr-stage-grid" aria-label={t("milestone")}>
                      {current.stages.map((s, i) => (
                        <button
                          key={s.stage}
                          disabled={busy || i > remaining}
                          aria-pressed={s.stage === stageName}
                          onClick={() => setStageName(s.stage)}
                          className={`hr-stage ${s.status} ${i > remaining ? "locked" : ""} ${s.stage === stageName ? "selected" : ""}`}
                        >
                          <span className="hr-stage-index">
                            {s.status === "completed" ? (
                              <CheckCircle2 size={16} />
                            ) : (
                              i + 1
                            )}
                          </span>
                          <strong>{t(s.stage)}</strong>
                          <small className="hr-stage-status">
                            {i > remaining && <LockKeyhole size={12} />}
                            {t(s.status)}
                            {i > remaining && ` · ${t("locked")}`}
                          </small>
                        </button>
                      ))}
                    </nav>
                    {state && (
                      <StageForm
                        key={`${current.id}-${state.stage}-${state.updated_at}`}
                        state={state}
                        t={t}
                        responsible={session.user.name}
                        aggregators={aggregators}
                        busy={busy}
                        onSubmit={(data) =>
                          run(() =>
                            api(
                              `/hrm/employees/${current.id}/stages/${state.stage}`,
                              data,
                              session.csrf,
                            ),
                          )
                        }
                      />
                    )}
                  </div>
                  <details className="hr-guidance">
                    <summary>{t("rules")}</summary>
                    <p className="hr-note">{t("sequential")}</p>
                    <p className="hr-note">{t("manual")}</p>
                  </details>
                </>
              )}
              {pane === "compensation" && (
                <CompensationForm
                  key={`${current.id}-${current.updated_at}`}
                  terms={current.compensation}
                  t={t}
                  ar={ar}
                  busy={busy}
                  onSubmit={(data) =>
                    run(() =>
                      api(
                        `/hrm/employees/${current.id}/compensation`,
                        data,
                        session.csrf,
                      ),
                    )
                  }
                />
              )}
              {pane === "documents" && (
                <Documents
                  employee={current}
                  t={t}
                  session={session}
                  busy={busy}
                  run={run}
                />
              )}
              {pane === "profile" && (
                <>
                  <p className="hr-note">{t("branchFixed")}</p>
                  <EmployeeForm
                    key={`${current.id}-${current.updated_at}`}
                    employee={current}
                    branches={branches}
                    branch={branch}
                    t={t}
                    busy={busy}
                    onSubmit={(data) =>
                      run(() =>
                        api(
                          `/hrm/employees/${current.id}/profile`,
                          data,
                          session.csrf,
                        ),
                      )
                    }
                  />
                </>
              )}
              {pane === "history" && (
                <div className="hr-history">
                  {current.history.length ? (
                    current.history.map((h) => (
                      <article key={h.id}>
                        <strong>
                          {h.event in labels ? t(h.event as Label) : h.event}
                          {h.detail.stage ? ` · ${t(h.detail.stage)}` : ""}
                        </strong>
                        <small>
                          {h.actor} ·{" "}
                          {new Date(h.created_at).toLocaleString(
                            ar ? "ar-KW" : "en-GB",
                            { timeZone: "Asia/Kuwait" },
                          )}
                        </small>
                      </article>
                    ))
                  ) : (
                    <p>{t("noHistory")}</p>
                  )}
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function EmployeeForm({
  employee,
  branches,
  branch,
  t,
  busy,
  onSubmit,
  onCancel,
}: {
  employee?: Employee;
  branches: Branch[];
  branch: string;
  t: T;
  busy: boolean;
  onSubmit: (data: unknown) => Promise<void>;
  onCancel?: () => void;
}) {
  return (
    <form
      className="hr-form"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        void onSubmit({
          name: data.get("name"),
          nationality: data.get("nationality"),
          passport_number: data.get("passport_number"),
          phone: data.get("phone"),
          branch_id: Number(data.get("branch_id")),
        });
      }}
    >
      <fieldset disabled={busy}>
        <div className="hr-fields">
          <Field label={t("name")}>
            <input
              name="name"
              dir="auto"
              required
              maxLength={160}
              defaultValue={employee?.name}
            />
          </Field>
          <Field label={t("nationality")}>
            <input
              name="nationality"
              dir="auto"
              required
              maxLength={80}
              defaultValue={employee?.nationality}
            />
          </Field>
          <Field label={t("passport")}>
            <input
              name="passport_number"
              required
              minLength={3}
              maxLength={40}
              pattern="[A-Za-z0-9-]+"
              defaultValue={employee?.passport_number}
            />
          </Field>
          <Field label={t("phone")}>
            <input
              name="phone"
              type="tel"
              maxLength={20}
              pattern="\+[0-9]{7,15}"
              defaultValue={employee?.phone}
            />
          </Field>
          <Field label={t("branch")}>
            <select
              name="branch_id"
              defaultValue={
                employee?.branch_id ??
                (branch === "all" ? branches[0]?.id : Number(branch))
              }
            >
              {branches
                .filter((b) => !employee || b.id === employee.branch_id)
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
            </select>
          </Field>
        </div>
        <div className="hr-actions">
          <button className="primary">{t("save")}</button>
          {onCancel && (
            <button type="button" className="secondary" onClick={onCancel}>
              {t("cancel")}
            </button>
          )}
        </div>
      </fieldset>
    </form>
  );
}

function StageForm({
  state,
  t,
  responsible,
  aggregators,
  busy,
  onSubmit,
}: {
  state: Stage;
  t: T;
  responsible: string;
  aggregators: string[];
  busy: boolean;
  onSubmit: (data: unknown) => Promise<void>;
}) {
  const [status, setStatus] = useState(
    state.status === "pending" ? "in_progress" : state.status,
  );
  const legal = ["visa", "iqama", "civil_id", "driving_licence"].includes(
    state.stage,
  );
  const completed = status === "completed";
  const details = state.details ?? {};
  const [aggregator, setAggregator] = useState(details.aggregator ?? "");
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const values: Record<string, string> = {};
    for (const [key, value] of f.entries())
      if (key.startsWith("detail_") && value)
        values[key.slice(7)] = String(value);
    void onSubmit({
      status,
      occurred_on: f.get("occurred_on"),
      responsible: f.get("responsible"),
      notes: f.get("notes"),
      details: values,
    });
  };
  const input = (key: string, label: Label, required = false, max = 100) => (
    <Field label={t(label)}>
      <input
        name={`detail_${key}`}
        defaultValue={details[key]}
        required={completed && required}
        maxLength={max}
      />
    </Field>
  );
  return (
    <form className="hr-form hr-milestone" onSubmit={submit}>
      <h3>{t(state.stage)}</h3>
      {state.stage === "selection" && (
        <p className="hr-note">{t("passportRequired")}</p>
      )}
      <fieldset disabled={busy}>
        <div className="hr-fields">
          <Field label={t("status")}>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as typeof status)}
            >
              <option
                value="in_progress"
                disabled={state.status === "completed"}
              >
                {t("in_progress")}
              </option>
              <option value="completed">{t("completed")}</option>
            </select>
          </Field>
          <Field label={t("date")}>
            <input
              name="occurred_on"
              type="date"
              required
              max={completed ? today() : undefined}
              defaultValue={state.occurred_on ?? today()}
            />
          </Field>
          <Field label={t("responsible")}>
            <input
              name="responsible"
              required
              maxLength={100}
              defaultValue={state.responsible ?? responsible}
            />
          </Field>
          {(legal || state.stage === "medical") &&
            input("reference", "reference", legal)}
          {legal && (
            <Field label={t("expiry")}>
              <input
                name="detail_expires_on"
                type="date"
                defaultValue={details.expires_on}
              />
            </Field>
          )}
          {state.stage === "accommodation" && (
            <>
              {input("accommodation_address", "address", true, 500)}
              {input("unit", "unit")}
            </>
          )}
          {state.stage === "mobile" && (
            <>
              <Field label={t("mobileNumber")}>
                <input
                  name="detail_mobile_number"
                  type="tel"
                  placeholder="+96550000000"
                  pattern="\+965[0-9]{8}"
                  required={completed}
                  maxLength={20}
                  defaultValue={details.mobile_number}
                />
              </Field>
              {input("handset_id", "handset", true, 80)}
            </>
          )}
          {state.stage === "vehicle" && (
            <>
              <Field label={t("vehicleType")}>
                <select
                  name="detail_vehicle_type"
                  required={completed}
                  defaultValue={details.vehicle_type ?? ""}
                >
                  <option value="">{t("choose")}</option>
                  <option value="car">{t("car")}</option>
                  <option value="motorbike">{t("motorbike")}</option>
                </select>
              </Field>
              {input("vehicle_registration", "registration", true, 80)}
            </>
          )}
          {state.stage === "operations" && (
            <>
              <Field label={t("aggregator")}>
                <select
                  name="detail_aggregator"
                  required={completed}
                  value={aggregator}
                  onChange={(event) => setAggregator(event.target.value)}
                >
                  <option value="">{t("choose")}</option>
                  {aggregators.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </Field>
              {input("aggregator_rider_id", "riderId")}
            </>
          )}
        </div>
        <Field label={t("notes")}>
          <textarea
            name="notes"
            dir="auto"
            maxLength={1000}
            defaultValue={state.notes}
            rows={3}
          />
        </Field>
        <button className="primary">{t("save")}</button>
      </fieldset>
    </form>
  );
}

function CompensationForm({
  terms,
  t,
  ar,
  busy,
  onSubmit,
}: {
  terms: Terms | null;
  t: T;
  ar: boolean;
  busy: boolean;
  onSubmit: (data: unknown) => Promise<void>;
}) {
  const [entries, setEntries] = useState(() =>
    (terms?.entries ?? []).map((e) => ({
      ...e,
      amount: (e.amount_fils / 1000).toFixed(3),
    })),
  );
  const [error, setError] = useState("");
  return (
    <form
      className="hr-form"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        try {
          const values = entries.map((entry) => ({
            kind: entry.kind,
            name: entry.name,
            frequency: entry.frequency,
            amount_fils: toFils(entry.amount, t("precision")),
          }));
          setError("");
          void onSubmit({
            basic_fils: toFils(String(f.get("basic")), t("precision")),
            effective_from: f.get("effective"),
            entries: values,
          });
        } catch (err) {
          setError(err instanceof Error ? err.message : t("error"));
        }
      }}
    >
      <p className="hr-note">{t("termsNote")}</p>
      {error && (
        <p role="alert" className="hr-error">
          {error}
        </p>
      )}
      <fieldset disabled={busy}>
        <div className="hr-fields">
          <Field label={t("basic")}>
            <input
              name="basic"
              inputMode="decimal"
              required
              pattern="[0-9]+(\.[0-9]{1,3})?"
              defaultValue={terms ? (terms.basic_fils / 1000).toFixed(3) : ""}
            />
          </Field>
          <Field label={t("effective")}>
            <input
              name="effective"
              type="date"
              required
              defaultValue={terms?.effective_from ?? today()}
            />
          </Field>
        </div>
        {entries.map((entry, i) => (
          <div key={i} className="hr-term">
            <Field label={t("entryType")}>
              <select
                value={entry.kind}
                onChange={(e) =>
                  setEntries((rows) =>
                    rows.map((r, j) =>
                      j === i
                        ? { ...r, kind: e.target.value as Entry["kind"] }
                        : r,
                    ),
                  )
                }
              >
                <option value="benefit">{t("benefit")}</option>
                <option value="deduction">{t("deduction")}</option>
              </select>
            </Field>
            <Field label={t("entryName")}>
              <input
                required
                maxLength={100}
                value={entry.name}
                onChange={(e) =>
                  setEntries((rows) =>
                    rows.map((r, j) =>
                      j === i ? { ...r, name: e.target.value } : r,
                    ),
                  )
                }
              />
            </Field>
            <Field label={t("amount")}>
              <input
                required
                inputMode="decimal"
                pattern="[0-9]+(\.[0-9]{1,3})?"
                value={entry.amount}
                onChange={(e) =>
                  setEntries((rows) =>
                    rows.map((r, j) =>
                      j === i ? { ...r, amount: e.target.value } : r,
                    ),
                  )
                }
              />
            </Field>
            <Field label={t("frequency")}>
              <select
                value={entry.frequency}
                onChange={(e) =>
                  setEntries((rows) =>
                    rows.map((r, j) =>
                      j === i
                        ? {
                            ...r,
                            frequency: e.target.value as Entry["frequency"],
                          }
                        : r,
                    ),
                  )
                }
              >
                <option value="monthly">{t("monthly")}</option>
                <option value="one_off">{t("one_off")}</option>
              </select>
            </Field>
            <button
              type="button"
              className="secondary"
              onClick={() =>
                setEntries((rows) => rows.filter((_, j) => j !== i))
              }
            >
              {t("remove")}
            </button>
          </div>
        ))}
        <div className="hr-actions">
          <button
            type="button"
            className="secondary"
            disabled={entries.length >= 30}
            onClick={() =>
              setEntries((rows) => [
                ...rows,
                {
                  kind: "benefit",
                  name: "",
                  amount_fils: 0,
                  amount: "",
                  frequency: "monthly",
                },
              ])
            }
          >
            <Plus size={16} />
            {t("addTerm")}
          </button>
          <button className="primary">{t("save")}</button>
        </div>
      </fieldset>
      {terms && (
        <div className="hr-net">
          <span>{t("net")}</span>
          <strong>{kwd(terms.monthly_net_fils, ar)}</strong>
        </div>
      )}
    </form>
  );
}

function Documents({
  employee,
  t,
  session,
  busy,
  run,
}: {
  employee: Detail;
  t: T;
  session: Session;
  busy: boolean;
  run: Run;
}) {
  const [file, setFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState("passport");
  const upload = (e: FormEvent) => {
    e.preventDefault();
    if (!file) return;
    void run(async () => {
      if (file.size > 5 * 1024 * 1024) throw new Error(t("file"));
      await uploadFile(
        `/hrm/employees/${employee.id}/documents?${new URLSearchParams({ kind, filename: file.name })}`,
        file,
        session.csrf,
      );
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
    });
  };
  return (
    <>
      <p className="hr-note">
        <FileLock2 size={16} /> {t("documentNote")}
      </p>
      <form className="hr-form" onSubmit={upload}>
        <fieldset disabled={busy}>
          <div className="hr-fields">
            <Field label={t("kind")}>
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                {(
                  [
                    "passport",
                    "visa",
                    "medical",
                    "iqama",
                    "civil_id",
                    "driving_licence",
                    "other",
                  ] as const
                ).map((k) => (
                  <option key={k} value={k}>
                    {t(k)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("file")}>
              <input
                ref={fileInput}
                type="file"
                accept=".pdf,.png,.jpg,.jpeg"
                required
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </Field>
          </div>
          <button className="primary" disabled={!file}>
            {t("upload")}
          </button>
        </fieldset>
      </form>
      <div className="hr-files">
        {employee.documents.length ? (
          employee.documents.map((d) => (
            <article key={d.id}>
              <FileLock2 size={21} />
              <div>
                <strong>{d.filename}</strong>
                <small>
                  {t(d.kind)} · {(d.size / 1024).toFixed(1)} KB
                </small>
              </div>
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    downloadFile(
                      `/hrm/employees/${employee.id}/documents/${d.id}`,
                      d.filename,
                    ),
                  )
                }
              >
                <FileDown size={16} />
                {t("download")}
              </button>
            </article>
          ))
        ) : (
          <p>{t("noDocuments")}</p>
        )}
      </div>
    </>
  );
}
