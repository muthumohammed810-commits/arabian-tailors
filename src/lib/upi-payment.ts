export function createUpiPaymentUrl(upiId: string, amount: number, orderRef: string) {
  const payee = upiId.trim();
  if (!payee || !Number.isFinite(amount) || amount <= 0 || !orderRef.trim()) return null;

  const params = new URLSearchParams({
    pa: payee,
    pn: 'Arabian Tailors',
    am: amount.toFixed(2),
    cu: 'INR',
    tr: orderRef,
    tn: `Arabian Tailors order ${orderRef}`,
  });

  return `upi://pay?${params.toString()}`;
}
