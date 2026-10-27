import { createHmac, timingSafeEqual } from 'node:crypto';

export type NormalizedPaymentEvent = {
  eventId: string;
  paymentId: string;
  orderId: string;
  amount: number;
  currency: string;
  status: 'pending' | 'success' | 'failed' | 'cancelled';
};

export type PaymentSettlement = {
  outcome: 'invalid-signature' | 'invalid-event' | 'amount-mismatch' | 'duplicate' | 'ignored-terminal' | 'applied';
  statusPayment: 'Pending verification' | 'Paid' | 'Failed' | 'Cancelled';
  processedEventIds: string[];
};

/** Provider adapters must verify the raw request bytes before normalizing an event. */
export function verifyPaymentWebhookSignature(rawBody: string, signature: string, secret: string) {
  if (!secret || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  const supplied = Buffer.from(signature, 'hex');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

/** Pure settlement policy shared by future provider adapters and regression tests. */
export function applyVerifiedPaymentEvent(
  current: { id: string; total: number; statusPayment?: string; processedPaymentEventIds?: string[] },
  event: NormalizedPaymentEvent,
  signatureValid: boolean,
): PaymentSettlement {
  const currentStatus = (['Pending verification', 'Paid', 'Failed', 'Cancelled'].includes(current.statusPayment || '')
    ? current.statusPayment
    : 'Pending verification') as PaymentSettlement['statusPayment'];
  const processedEventIds = Array.isArray(current.processedPaymentEventIds) ? current.processedPaymentEventIds : [];
  const result = (outcome: PaymentSettlement['outcome'], statusPayment = currentStatus): PaymentSettlement => ({ outcome, statusPayment, processedEventIds });

  if (!signatureValid) return result('invalid-signature');
  if (!event || !/^[A-Za-z0-9_-]{1,120}$/.test(event.eventId) || !/^[A-Za-z0-9_-]{1,120}$/.test(event.paymentId)
    || event.orderId !== current.id || event.currency !== 'INR' || !Number.isFinite(event.amount) || event.amount <= 0
    || !['pending', 'success', 'failed', 'cancelled'].includes(event.status)) return result('invalid-event');
  if (event.amount !== current.total) return result('amount-mismatch');
  if (processedEventIds.includes(event.eventId)) return result('duplicate');
  if (currentStatus === 'Paid' && event.status !== 'success') return result('ignored-terminal');

  const nextIds = [...processedEventIds, event.eventId].slice(-200);
  const nextStatus = event.status === 'success' ? 'Paid'
    : event.status === 'failed' ? (currentStatus === 'Paid' ? 'Paid' : 'Failed')
    : event.status === 'cancelled' ? (currentStatus === 'Paid' ? 'Paid' : 'Cancelled')
    : currentStatus;
  return { outcome: 'applied', statusPayment: nextStatus, processedEventIds: nextIds };
}
