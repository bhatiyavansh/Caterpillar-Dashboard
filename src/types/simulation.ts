/**
 * Compatibility alias for the digital-twin contract.
 *
 * The twin library (owned by the 3D track) imports `@/types/simulation`, while
 * the contract itself lives in `@/types/twin`. This barrel keeps both import
 * paths valid so neither side has to rewrite the other's files.
 */
export * from "./twin";
