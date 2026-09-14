/**
 * Read a route parameter as a single string.
 *
 * `@types/express` v5 types `req.params` values as `string | string[]`, because Express 5 can
 * surface a repeated parameter as an array. None of our routes declare a repeatable segment,
 * but the type is still the honest one, and an id that arrived as an array must not be
 * stringified into `"a,b"` and then used in an access check — that would be a lookup for a
 * project that does not exist, which is the safe answer but for the wrong reason.
 *
 * So: take the value only when it is genuinely a single string, and otherwise return "",
 * which every caller already treats as "no such project".
 */
export function param(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}
