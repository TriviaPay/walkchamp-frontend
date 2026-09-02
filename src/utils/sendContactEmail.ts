import { authFetch } from "@/utils/authFetch";
import { toUserFacingErrorFromResponse } from "@/utils/userFacingError";

export type ContactFormData = {
  name: string;
  email: string;
  message: string;
  subject?: string;
};

/**
 * Submit support/contact via WalkChamp backend (rate-limited, validated).
 * Replaces direct FormSubmit client calls.
 */
export async function sendContactEmail(data: ContactFormData): Promise<void> {
  const res = await authFetch("/api/support/contact", {
    method: "POST",
    retryOnUnauthorized: true,
    body: JSON.stringify({
      name: data.name.trim(),
      email: data.email.trim(),
      message: data.message.trim(),
      subject: data.subject?.trim(),
    }),
  });

  if (!res.ok) {
    throw new Error(await toUserFacingErrorFromResponse(res, "generic"));
  }

  const result = (await res.json()) as { success?: boolean };
  if (!result.success) {
    throw new Error("We couldn't send your message. Please try again.");
  }
}
