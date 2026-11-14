// COMPANY DATABASE HANDOFF POINT
//
// Replace the three functions in this file when the real company database is available.
// Keep the connection read-only and return normalized records; never expose a database client,
// SQL, credentials, table names or unrestricted query execution to the chatbot.
// The boundary in index.js validates and caps everything returned here.

/** True only after the real read-only connection is configured. */
export function configured() {
  return false;
}

/** A public label for status UI. Never include a host, database name or credential here. */
export function describe() {
  return { name: "Company database" };
}

/**
 * Map one plain-language question into a bounded set of company records.
 *
 * @param {{ query: string, limit: number }} input limit is always 1..25
 * @returns {Promise<{
 *   profile: null | { name: string, email: string, address?: string | null, defaultCurrency?: string | null },
 *   records: Array<{
 *     id: string,
 *     kind: "company"|"customer"|"product"|"service"|"pricing"|"billing"|"order"|"project"|"other",
 *     label: string,
 *     url?: string | null,
 *     updatedAt?: string | null,
 *     facts: Record<string, string|number|boolean|null>
 *   }>
 * }>} normalized context
 */
export async function getContext(_input) {
  throw new Error("The company database provider has not been implemented yet.");
}
