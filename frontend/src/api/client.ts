const DEFAULT_BASE_URL = "http://localhost:3000";

export type ApiSuccessEnvelope<T> = {
  success: true;
  data?: T;
  duplicate?: boolean;
  meta?: {
    limit: number;
    offset: number;
    total: number;
  };
};

export type ApiEnvelope<T> =
  | ApiSuccessEnvelope<T>
  | {
      success: false;
      error:
        | string
        | {
            code?: string;
            message: string;
      };
    };

export const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() || DEFAULT_BASE_URL;

export async function fetchJson<T>(path: string, options?: RequestInit): Promise<ApiSuccessEnvelope<T>> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers ?? {}),
    },
    ...options,
  });

  const json = (await response.json()) as ApiEnvelope<T>;

  if (!json.success) {
    const message = typeof json.error === "string" ? json.error : json.error.message;
    throw new Error(message);
  }

  return json;
}
