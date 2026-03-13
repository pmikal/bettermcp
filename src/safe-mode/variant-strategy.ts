export interface VariantStrategy {
  selectVariant(variants: unknown[]): unknown
}

/**
 * Selects the first variant from a oneOf/anyOf list.
 * Simplest and most deterministic strategy.
 */
export const firstVariantStrategy: VariantStrategy = {
  selectVariant(variants: unknown[]): unknown {
    return variants[0]
  },
}
