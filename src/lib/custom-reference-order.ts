export const CUSTOM_REFERENCE_ADVANCE = 500;
export const CUSTOM_REFERENCE_ORDER_TYPE = 'custom_reference_photo' as const;

/** The ₹500 advance is included in an Abaya model's total, never added to it. */
export function remainingAfterReferenceAdvance(modelTotal: number) {
  if (!Number.isFinite(modelTotal) || modelTotal < CUSTOM_REFERENCE_ADVANCE) return null;
  return Math.round((modelTotal - CUSTOM_REFERENCE_ADVANCE) * 100) / 100;
}

/** Customers may use an uploaded Abaya reference instead of choosing a catalog model. */
export function canContinueAbayaReferenceChoice(hasSelectedProduct: boolean, hasUploadedPhoto: boolean, uploadPending: boolean) {
  return hasSelectedProduct || (hasUploadedPhoto && !uploadPending);
}

/** Model/style selection never blocks progress; a photo may replace it or be omitted. */
export function isRequiredCustomizationSelectionMissing(required: boolean, selected: boolean, isModelSelection: boolean, referencePhotoNotSaved: boolean) {
  return (required && !selected && !isModelSelection) || (isModelSelection && referencePhotoNotSaved);
}

export type CustomReferenceOrderFields = {
  orderType: typeof CUSTOM_REFERENCE_ORDER_TYPE;
  estimatedTotal: number;
  advanceAmount: typeof CUSTOM_REFERENCE_ADVANCE;
  advanceStatus: string;
  finalPrice: number | null;
  finalPriceConfirmed: boolean;
  remainingBalance: number | null;
};

/** The order type is assigned by the server only after its private photo URL is validated. */
export function createCustomReferenceOrderFields(estimatedTotal: number): CustomReferenceOrderFields {
  if (!Number.isFinite(estimatedTotal) || estimatedTotal < 0) throw new TypeError('Invalid custom-order estimate.');
  return {
    orderType: CUSTOM_REFERENCE_ORDER_TYPE,
    estimatedTotal,
    advanceAmount: CUSTOM_REFERENCE_ADVANCE,
    advanceStatus: 'Pending verification',
    finalPrice: null,
    finalPriceConfirmed: false,
    remainingBalance: null,
  };
}

/** UPI asks only for the configured advance; a catalog estimate is never presented as final. */
export function customerPaymentAmount(order: { orderType?: unknown; advanceAmount?: unknown; total?: unknown }): number | null {
  if (order.orderType === CUSTOM_REFERENCE_ORDER_TYPE) {
    return order.advanceAmount === CUSTOM_REFERENCE_ADVANCE ? CUSTOM_REFERENCE_ADVANCE : null;
  }
  return typeof order.total === 'number' && Number.isFinite(order.total) && order.total > 0 ? order.total : null;
}

/** Apply an Admin-reviewed all-in final order amount without trusting the customer request. */
export function updateCustomReferenceFinalPrice(
  order: any,
  input: { finalPrice?: unknown; finalPriceConfirmed?: unknown },
  advanceStatus = order?.statusPayment || 'Pending verification',
) {
  if (order?.orderType !== CUSTOM_REFERENCE_ORDER_TYPE || typeof input.finalPriceConfirmed !== 'boolean') return null;
  if (!input.finalPriceConfirmed) {
    return { ...order, total: order.estimatedTotal, finalPrice: null, finalPriceConfirmed: false, remainingBalance: null, advanceStatus };
  }
  const finalPrice = input.finalPrice;
  if (typeof finalPrice !== 'number' || !Number.isFinite(finalPrice) || finalPrice < CUSTOM_REFERENCE_ADVANCE || finalPrice > 1_000_000 || Math.round(finalPrice * 100) !== finalPrice * 100) return null;
  return {
    ...order,
    total: finalPrice,
    finalPrice,
    finalPriceConfirmed: true,
    advanceStatus,
    remainingBalance: advanceStatus === 'Paid' ? Math.round((finalPrice - CUSTOM_REFERENCE_ADVANCE) * 100) / 100 : null,
  };
}
