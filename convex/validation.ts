// Server-side validation for patient records. Runs on every create/update
// regardless of caller (voice agent, REST client, dashboard) — the voice
// agent's own field-level checks are a UX nicety, not a security boundary.

const US_STATES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID",
  "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS",
  "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK",
  "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV",
  "WI", "WY", "DC",
]);

export type ValidationError = { field: string; message: string };

const NAME_RE = /^[A-Za-z'-]{1,50}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ZIP_RE = /^\d{5}(-\d{4})?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, "").replace(/^1(\d{10})$/, "$1");
}

function isValidPhone(raw: string): boolean {
  return /^\d{10}$/.test(normalizePhone(raw));
}

function isValidDateOfBirth(iso: string): boolean {
  if (!DATE_RE.test(iso)) return false;
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return false;
  return d.getTime() < Date.now();
}

// field-presence checks are split by create vs update: update allows partial payloads.
export function validatePatient(
  input: Record<string, unknown>,
  opts: { partial: boolean }
): ValidationError[] {
  const errors: ValidationError[] = [];
  const required = (field: string) =>
    !opts.partial && (input[field] === undefined || input[field] === null || input[field] === "");

  const str = (field: string) => input[field] as string | undefined;

  if (required("first_name")) errors.push({ field: "first_name", message: "required" });
  else if (str("first_name") !== undefined && !NAME_RE.test(str("first_name")!))
    errors.push({ field: "first_name", message: "1-50 alphabetic chars, hyphens/apostrophes only" });

  if (required("last_name")) errors.push({ field: "last_name", message: "required" });
  else if (str("last_name") !== undefined && !NAME_RE.test(str("last_name")!))
    errors.push({ field: "last_name", message: "1-50 alphabetic chars, hyphens/apostrophes only" });

  if (required("date_of_birth")) errors.push({ field: "date_of_birth", message: "required" });
  else if (str("date_of_birth") !== undefined && !isValidDateOfBirth(str("date_of_birth")!))
    errors.push({ field: "date_of_birth", message: "must be a valid past date, YYYY-MM-DD" });

  if (required("sex")) errors.push({ field: "sex", message: "required" });
  else if (
    str("sex") !== undefined &&
    !["Male", "Female", "Other", "Decline to Answer"].includes(str("sex")!)
  )
    errors.push({ field: "sex", message: "must be Male, Female, Other, or Decline to Answer" });

  if (required("phone_number")) errors.push({ field: "phone_number", message: "required" });
  else if (str("phone_number") !== undefined && !isValidPhone(str("phone_number")!))
    errors.push({ field: "phone_number", message: "must be a valid US 10-digit number" });

  if (str("email") && !EMAIL_RE.test(str("email")!))
    errors.push({ field: "email", message: "invalid email format" });

  if (required("address_line_1")) errors.push({ field: "address_line_1", message: "required" });

  if (required("city")) errors.push({ field: "city", message: "required" });
  else if (str("city") !== undefined && (str("city")!.length < 1 || str("city")!.length > 100))
    errors.push({ field: "city", message: "1-100 characters" });

  if (required("state")) errors.push({ field: "state", message: "required" });
  else if (str("state") !== undefined && !US_STATES.has(str("state")!.toUpperCase()))
    errors.push({ field: "state", message: "must be a valid 2-letter US state abbreviation" });

  if (required("zip_code")) errors.push({ field: "zip_code", message: "required" });
  else if (str("zip_code") !== undefined && !ZIP_RE.test(str("zip_code")!))
    errors.push({ field: "zip_code", message: "must be 5-digit or ZIP+4 US format" });

  if (str("emergency_contact_phone") && !isValidPhone(str("emergency_contact_phone")!))
    errors.push({ field: "emergency_contact_phone", message: "must be a valid US 10-digit number" });

  return errors;
}
