// Turns a thrown API error into something worth showing a patient.

/**
 * `apiRequest` rejects with `Error("<status>: <raw body>")`, and the body is usually JSON.
 * Shown as-is that reaches the patient as `400: {"message":"..."}`, so this unwraps it
 * back to the sentence the server actually wrote.
 */
export function readableError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const withoutStatus = raw.replace(/^\d{3}:\s*/, "").trim();
  try {
    const parsed = JSON.parse(withoutStatus);
    if (parsed && typeof parsed.message === "string") return parsed.message;
  } catch {
    // Body was not JSON — use it as-is.
  }
  return withoutStatus || "Something went wrong. Please try again.";
}
