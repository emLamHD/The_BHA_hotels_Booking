/**
 * Formats a server-supplied Availability amount for display using the
 * server-supplied currency code. Never converts currency, never recomputes
 * the amount, and never fabricates a currency when the server omits one
 * (the generated OpenAPI schema marks `currencyCode` nullable). `Intl` is
 * used purely for display; the underlying amount/currency semantics are
 * exactly what the server returned.
 */
export function formatCurrencyAmount(
  amount: number,
  currencyCode: string | null
): string {
  if (currencyCode) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currencyCode,
      }).format(amount);
    } catch {
      // Fall through: an unrecognized/malformed currency code from the
      // server should not crash rendering — show the honest plain amount
      // with the server's currency code alongside it instead.
    }
  }

  const plain = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);

  return currencyCode ? `${plain} ${currencyCode}` : plain;
}
