export type Role = "admin" | "manager" | "kitchen" | "dispatcher" | "rider";
export type User = {
  id: number;
  username: string;
  name: string;
  role: Role;
  branches: number[];
  available: number;
};
export type Session = { user: User; csrf: string };
export type Branch = { id: number; name: string; area: string };
export type Rider = {
  id: number;
  name: string;
  branches: number[];
  available: number;
  active_jobs: number;
};
export type Item = { name: string; quantity: number };
export type Order = {
  id: number;
  branch_id: number;
  branch_name: string;
  source: "talabat" | "keeta" | "direct";
  external_id?: string;
  delivery_mode: "platform" | "own";
  status: string;
  customer_name: string;
  phone: string;
  area: string;
  address: string;
  items?: Item[];
  total_fils?: number;
  notes?: string;
  prep_minutes: number;
  created_at: string;
  updated_at: string;
  is_demo: number;
  sync_status: string;
  job_id: number | null;
  rider_id: number | null;
  rider_name: string | null;
  job_status: string | null;
  failure_reason: string | null;
  proof: string | null;
};
export type Audit = {
  id: number;
  actor: string;
  event: string;
  detail: Record<string, unknown>;
  created_at: string;
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(
  path: string,
  body?: unknown,
  csrf?: string,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    signal,
    headers: {
      "Content-Type": "application/json",
      ...(csrf ? { "X-CSRF-Token": csrf } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) {
    const detail = data.detail;
    throw new ApiError(
      response.status,
      typeof detail === "string"
        ? detail
        : Array.isArray(detail)
          ? detail.map((d: { msg: string }) => d.msg).join("; ")
          : "Request failed",
    );
  }
  return data as T;
}

export function kwd(fils: number, ar = false): string {
  return new Intl.NumberFormat(ar ? "ar-KW" : "en-KW", {
    style: "currency",
    currency: "KWD",
    minimumFractionDigits: 3,
  }).format(fils / 1000);
}

export function isLate(order: Order, clock: number): boolean {
  return (
    !["ready", "handed_over", "cancelled"].includes(order.status) &&
    clock - Date.parse(order.created_at) > order.prep_minutes * 60_000
  );
}
