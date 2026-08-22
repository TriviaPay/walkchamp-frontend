/** Client copy and response handling for the reviewed account-deletion request flow. */

export const DELETE_ACCOUNT_WARNING =
  "Send an account deletion request to the WalkChamp team? We will email the request to admin@miragaming.com for review. Your account will remain active until the request is processed.";

export function messageForAccountDeletionRequestResponse(
  status: number,
  body?: { error?: string; code?: string } | null,
): string {
  if (status === 429) return "Too many requests. Please wait and try again.";
  return body?.error ?? "We couldn't send your deletion request. Please try again.";
}
