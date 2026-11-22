// Deliberately loose: the spec is a plain JSON document, and a hand-rolled
// structural type would only get in the way. Validity is enforced by
// openapi.test.ts using a real OpenAPI parser instead.
export type OpenApiObject = Record<string, unknown>
export type PathItems = Record<string, OpenApiObject>
