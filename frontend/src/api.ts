export type Role = "admin" | "manager" | "dispatcher" | "rider";
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
  await checkResponse(response);
  return (await response.json()) as T;
}

async function checkResponse(response: Response): Promise<void> {
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
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
}

export async function uploadFile(
  path: string,
  file: File,
  csrf: string,
): Promise<void> {
  const response = await fetch(`/api${path}`, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "X-CSRF-Token": csrf,
    },
    body: file,
  });
  await checkResponse(response);
}

export async function downloadFile(
  path: string,
  filename: string,
): Promise<void> {
  const response = await fetch(`/api${path}`, { credentials: "same-origin" });
  await checkResponse(response);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function kwd(fils: number, ar = false): string {
  return new Intl.NumberFormat(ar ? "ar-KW" : "en-KW", {
    style: "currency",
    currency: "KWD",
    minimumFractionDigits: 3,
  }).format(fils / 1000);
}
