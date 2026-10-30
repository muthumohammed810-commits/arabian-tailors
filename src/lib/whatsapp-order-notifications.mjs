const E164 = /^\+[1-9]\d{7,14}$/;
const TEMPLATE_NAME = /^[a-z0-9_]{1,512}$/;
const TEMPLATE_LANGUAGE = /^[a-z]{2,3}(?:_[A-Z]{2})?$/;
const API_VERSION = /^v\d+\.\d+$/;
const PHONE_NUMBER_ID = /^\d{5,30}$/;

export const WHATSAPP_NOTIFICATION_CHANNELS = ['customer', 'owner'];
export const WHATSAPP_NOTIFICATION_STATES = ['pending', 'sending', 'sent', 'failed', 'unknown', 'skipped', 'not_configured'];

export function isE164Phone(value) {
  return typeof value === 'string' && E164.test(value);
}

function readTemplateConfig(env, prefix) {
  const name = env[`${prefix}_TEMPLATE_NAME`];
  const language = env[`${prefix}_TEMPLATE_LANGUAGE`];
  return typeof name === 'string' && TEMPLATE_NAME.test(name)
    && typeof language === 'string' && TEMPLATE_LANGUAGE.test(language)
    ? { name, language }
    : null;
}

export function getWhatsAppConfiguration(env = process.env, channel) {
  if (!WHATSAPP_NOTIFICATION_CHANNELS.includes(channel)) return null;
  const templatePrefix = channel === 'customer' ? 'WHATSAPP_CUSTOMER' : 'WHATSAPP_OWNER';
  const recipient = channel === 'owner' ? env.WHATSAPP_OWNER_PHONE_NUMBER : undefined;
  const template = readTemplateConfig(env, templatePrefix);
  if (typeof env.WHATSAPP_ACCESS_TOKEN !== 'string' || !env.WHATSAPP_ACCESS_TOKEN
    || typeof env.WHATSAPP_API_VERSION !== 'string' || !API_VERSION.test(env.WHATSAPP_API_VERSION)
    || typeof env.WHATSAPP_PHONE_NUMBER_ID !== 'string' || !PHONE_NUMBER_ID.test(env.WHATSAPP_PHONE_NUMBER_ID)
    || !template || (channel === 'owner' && !isE164Phone(recipient))) return null;
  return {
    accessToken: env.WHATSAPP_ACCESS_TOKEN,
    apiVersion: env.WHATSAPP_API_VERSION,
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
    template,
    ...(channel === 'owner' ? { recipient } : {}),
  };
}

function compact(value, limit = 1024) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, limit) || 'Not provided';
}

function orderItems(order) {
  const selected = Array.isArray(order.design?.customization)
    ? order.design.customization.map((item) => item?.option).filter((value) => typeof value === 'string' && value.trim())
    : [];
  const model = order.design?.selectedModel?.name || order.design?.styleName;
  const label = order.orderType === 'custom_reference_photo' ? 'CUSTOM REFERENCE PHOTO ORDER' : '';
  return compact([label, order.productName || order.product, model, ...selected].filter(Boolean).join(' · '));
}

function deliverySummary(order) {
  const delivery = order.delivery || {};
  return compact([delivery.address, delivery.city, delivery.postal].filter(Boolean).join(', '));
}

export function templateParametersForOrder(order, channel, adminLink) {
  const isCustomReferenceOrder = order.orderType === 'custom_reference_photo';
  const total = isCustomReferenceOrder
    ? `INR 500 advance due; estimate INR ${Number(order.estimatedTotal ?? order.total).toLocaleString('en-IN')}; final price pending review`
    : `INR ${Number(order.total).toLocaleString('en-IN')}`;
  const paymentStatus = isCustomReferenceOrder
    ? `Custom design: INR 500 advance ${order.advanceStatus || 'Pending verification'}; payment is not confirmed until reviewed. We will review the reference photo and contact the customer on WhatsApp to confirm final price and remaining balance.`
    : order.statusPayment || 'Pending verification';
  const itemSummary = orderItems(order);
  if (channel === 'customer') {
    return [order.id, order.customer || 'Customer', itemSummary, total, deliverySummary(order), `${order.status || 'New'} / ${paymentStatus}`];
  }
  return [order.id, order.customer || 'Customer', order.delivery?.phone || 'Not provided', order.delivery?.email || 'Not provided', itemSummary, total, paymentStatus, order.status || 'New', deliverySummary(order), adminLink];
}

export function createTemplateMessagePayload({ recipient, template, parameters }) {
  if (!isE164Phone(recipient) || !template || !TEMPLATE_NAME.test(template.name || '') || !TEMPLATE_LANGUAGE.test(template.language || '') || !Array.isArray(parameters) || parameters.some((value) => typeof value !== 'string' || value.length > 1024)) {
    throw new TypeError('Invalid WhatsApp template message parameters.');
  }
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    // Cloud API examples use the country-code number without the E.164 leading plus.
    to: recipient.slice(1),
    type: 'template',
    template: {
      name: template.name,
      language: { code: template.language },
      components: [{ type: 'body', parameters: parameters.map((text) => ({ type: 'text', text })) }],
    },
  };
}

/** Send one approved template. Network/5xx outcomes are unknown and must not be auto-retried. */
export async function sendWhatsAppTemplate({ config, recipient, parameters, fetchImpl = fetch, timeoutMs = 12_000 }) {
  if (!config) return { status: 'not_configured', errorCode: 'missing_configuration' };
  let payload;
  try { payload = createTemplateMessagePayload({ recipient, template: config.template, parameters }); }
  catch { return { status: 'failed', errorCode: 'invalid_message' }; }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
      cache: 'no-store',
    });
    let body;
    try { body = await response.json(); } catch { body = null; }
    if (!response.ok) {
      const code = Number(body?.error?.code);
      return {
        status: response.status >= 500 ? 'unknown' : 'failed',
        httpStatus: response.status,
        ...(Number.isSafeInteger(code) && code > 0 ? { errorCode: `meta_${code}` } : { errorCode: `http_${response.status}` }),
      };
    }
    const messageId = body?.messages?.[0]?.id;
    return typeof messageId === 'string' && messageId.length <= 200
      ? { status: 'sent', messageId }
      : { status: 'unknown', httpStatus: response.status, errorCode: 'provider_acceptance_unconfirmed' };
  } catch (error) {
    return { status: 'unknown', errorCode: controller.signal.aborted ? 'request_timeout' : 'network_outcome_unknown' };
  } finally {
    clearTimeout(timer);
  }
}

function notificationRecord(order, channel) {
  return order.whatsappNotifications?.[channel] || { status: 'pending', attempts: 0 };
}

/** Persist a claim before contacting Meta; only explicit retries may resend failed/not-configured records. */
/** @param {{order:any,channel:'customer'|'owner',recipient?:string|null,config:any,parameters:string[],saveOrder:(order:any)=>Promise<void>,loadOrder?:(id:string)=>Promise<any>,acquireClaim?:(id:string,channel:string)=>Promise<boolean>,releaseClaim?:(id:string,channel:string)=>Promise<void>,send:(request:any)=>Promise<any>,explicitRetry?:boolean,now?:()=>string}} options */
export async function dispatchWhatsAppNotification(options) {
  const { order, channel, recipient, config, parameters, saveOrder, loadOrder = async () => order, acquireClaim = async () => true, releaseClaim = async () => {}, send, explicitRetry = false, now = () => new Date().toISOString() } = options;
  if (!WHATSAPP_NOTIFICATION_CHANNELS.includes(channel)) throw new TypeError('Invalid WhatsApp notification channel.');
  let currentOrder = order;
  let current = notificationRecord(currentOrder, channel);
  let retryable = current.status === 'pending' || (explicitRetry && ['failed', 'not_configured'].includes(current.status));
  if (!retryable) return { order: currentOrder, skipped: true };
  if (channel === 'customer' && (!recipient || !isE164Phone(recipient))) {
    const skippedOrder = { ...order, whatsappNotifications: { ...order.whatsappNotifications, [channel]: { ...current, status: 'skipped', errorCode: 'recipient_unavailable', updatedAt: now() } } };
    await saveOrder(skippedOrder);
    return { order: skippedOrder, skipped: true };
  }
  if (!config) {
    const unconfiguredOrder = { ...currentOrder, whatsappNotifications: { ...currentOrder.whatsappNotifications, [channel]: { ...current, status: 'not_configured', errorCode: 'missing_configuration', updatedAt: now() } } };
    await saveOrder(unconfiguredOrder);
    return { order: unconfiguredOrder, skipped: true };
  }
  if (!isE164Phone(recipient)) {
    const skippedOrder = { ...currentOrder, whatsappNotifications: { ...currentOrder.whatsappNotifications, [channel]: { ...current, status: 'skipped', errorCode: 'recipient_unavailable', updatedAt: now() } } };
    await saveOrder(skippedOrder);
    return { order: skippedOrder, skipped: true };
  }
  const claim = await acquireClaim(currentOrder.id, channel);
  if (!claim) return { order: currentOrder, skipped: true, locked: true };
  let releaseAllowed = true;
  let sendStarted = false;
  try {
    currentOrder = await loadOrder(currentOrder.id) || currentOrder;
    current = notificationRecord(currentOrder, channel);
    retryable = current.status === 'pending' || (explicitRetry && ['failed', 'not_configured'].includes(current.status));
    if (!retryable) return { order: currentOrder, skipped: true };
  const claimed = {
    ...currentOrder,
    whatsappNotifications: {
      ...currentOrder.whatsappNotifications,
      [channel]: { status: 'sending', attempts: (Number(current.attempts) || 0) + 1, lastAttemptAt: now() },
    },
  };
  await saveOrder(claimed);
  let result;
  try { sendStarted = true; result = await send({ config, recipient, parameters }); }
  catch { result = { status: 'unknown', errorCode: 'delivery_outcome_unknown' }; }
  if (!['sent', 'failed', 'unknown', 'not_configured'].includes(result?.status)) result = { status: 'unknown', errorCode: 'delivery_outcome_unknown' };
  const finalRecord = {
    status: result.status,
    attempts: claimed.whatsappNotifications[channel].attempts,
    lastAttemptAt: claimed.whatsappNotifications[channel].lastAttemptAt,
    updatedAt: now(),
    ...(result.status === 'sent' ? { sentAt: now() } : {}),
    ...(typeof result.messageId === 'string' ? { messageId: result.messageId } : {}),
    ...(Number.isSafeInteger(result.httpStatus) ? { httpStatus: result.httpStatus } : {}),
    ...(typeof result.errorCode === 'string' && /^[a-z0-9_.-]{1,80}$/i.test(result.errorCode) ? { errorCode: result.errorCode } : {}),
  };
  const savedOrder = { ...claimed, whatsappNotifications: { ...claimed.whatsappNotifications, [channel]: finalRecord } };
  await saveOrder(savedOrder);
  return { order: savedOrder, skipped: false };
  } catch (error) {
    // Before the provider call there is no duplicate-send risk, so release a claim
    // after storage/read errors. Once the call begins, keep the claim if final state
    // persistence fails because Meta may already have accepted the message.
    releaseAllowed = !sendStarted;
    throw error;
  } finally {
    if (releaseAllowed) await releaseClaim(currentOrder.id, channel).catch(() => {});
  }
}

/** Order persistence is the commit point. A notification exception never rolls it back. */
export async function persistOrderThenNotify(order, { persist, notify }) {
  await persist(order);
  try { await notify(order); } catch { /* Order remains durably saved; Admin can inspect/retry. */ }
}

export function createWhatsAppNotificationStates() {
  return {
    customer: { status: 'pending', attempts: 0 },
    owner: { status: 'pending', attempts: 0 },
  };
}
