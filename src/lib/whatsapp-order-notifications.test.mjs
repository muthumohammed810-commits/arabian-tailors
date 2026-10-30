import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createTemplateMessagePayload,
  createWhatsAppNotificationStates,
  dispatchWhatsAppNotification,
  getWhatsAppConfiguration,
  isE164Phone,
  persistOrderThenNotify,
  sendWhatsAppTemplate,
  templateParametersForOrder,
} from './whatsapp-order-notifications.mjs';

const env = {
  WHATSAPP_ACCESS_TOKEN: 'test-only-token',
  WHATSAPP_API_VERSION: 'v23.0',
  WHATSAPP_PHONE_NUMBER_ID: '123456789012345',
  WHATSAPP_CUSTOMER_TEMPLATE_NAME: 'order_confirmation',
  WHATSAPP_CUSTOMER_TEMPLATE_LANGUAGE: 'en_US',
  WHATSAPP_OWNER_TEMPLATE_NAME: 'new_order_alert',
  WHATSAPP_OWNER_TEMPLATE_LANGUAGE: 'en_US',
  WHATSAPP_OWNER_PHONE_NUMBER: '+919876543210',
};

function order(overrides = {}) {
  return {
    id: 'AT-123456', customer: 'Test Customer', product: 'Saudi Kandura · Ivory', productName: 'Signature Kandura',
    total: 3690, status: 'New', statusPayment: 'Pending verification',
    delivery: { phone: '+919876543210', email: 'customer@example.test', address: '10 Market Road', city: 'Malappuram', postal: '676303' },
    design: { selectedModel: { name: 'Saudi Kandura' }, customization: [{ option: 'Ivory' }, { option: 'Cotton' }] },
    whatsappConsent: { customerUpdates: true }, whatsappNotifications: createWhatsAppNotificationStates(), ...overrides,
  };
}

test('validates E.164 contacts and requires both approved customer and owner template configuration', () => {
  assert.equal(isE164Phone('+919876543210'), true);
  assert.equal(isE164Phone('9876543210'), false);
  assert.ok(getWhatsAppConfiguration(env, 'customer'));
  assert.ok(getWhatsAppConfiguration(env, 'owner'));
  assert.equal(getWhatsAppConfiguration({ ...env, WHATSAPP_OWNER_TEMPLATE_NAME: '' }, 'owner'), null);
  assert.equal(getWhatsAppConfiguration({ ...env, WHATSAPP_API_VERSION: 'latest' }, 'customer'), null);
});

test('builds only approved template payloads and includes pending payment status, total and address summary', () => {
  const current = order();
  const customerParams = templateParametersForOrder(current, 'customer');
  assert.match(customerParams.join(' '), /Pending verification/);
  assert.match(customerParams.join(' '), /INR 3,690/);
  assert.match(customerParams.join(' '), /Malappuram/);
  const payload = createTemplateMessagePayload({ recipient: '+919876543210', template: { name: 'order_confirmation', language: 'en_US' }, parameters: customerParams });
  assert.equal(payload.type, 'template');
  assert.equal(payload.to, '919876543210');
  assert.equal(payload.template.components[0].parameters.length, 6);
  assert.throws(() => createTemplateMessagePayload({ recipient: '9876543210', template: { name: 'order_confirmation', language: 'en_US' }, parameters: customerParams }));
});

test('persists the order before attempting customer and owner notifications; notification errors do not lose the order', async () => {
  const events = [];
  await persistOrderThenNotify(order(), {
    persist: async () => events.push('saved'),
    notify: async () => { events.push('notified'); throw new Error('provider unavailable'); },
  });
  assert.deepEqual(events, ['saved', 'notified']);
});

test('does not invoke notifications when the durable order write fails', async () => {
  let notified = false;
  await assert.rejects(persistOrderThenNotify(order(), {
    persist: async () => { throw new Error('storage failed'); },
    notify: async () => { notified = true; },
  }));
  assert.equal(notified, false);
});

test('owner template gets contact, payment state and an authenticated Admin URL parameter', () => {
  const current = order();
  const link = 'https://arabian-tailors.vercel.app/admin?orderId=AT-123456';
  const parameters = templateParametersForOrder(current, 'owner', link);
  assert.equal(parameters.length, 10);
  assert.equal(parameters[0], current.id);
  assert.equal(parameters[2], current.delivery.phone);
  assert.equal(parameters[6], 'Pending verification');
  assert.equal(parameters[9], link);
});

test('custom reference order templates clearly request only the pending INR 500 advance and explain review', () => {
  const current = order({ orderType: 'custom_reference_photo', total: 3690, estimatedTotal: 3690, advanceAmount: 500, advanceStatus: 'Pending verification' });
  const customerParams = templateParametersForOrder(current, 'customer');
  const ownerParams = templateParametersForOrder(current, 'owner', 'https://arabian-tailors.vercel.app/admin?orderId=AT-123456');
  assert.match(customerParams[2], /CUSTOM REFERENCE PHOTO ORDER/);
  assert.match(customerParams[3], /INR 500 advance due/);
  assert.match(customerParams[5], /Pending verification/);
  assert.match(customerParams[5], /review the reference photo/);
  assert.match(customerParams[5], /final price and remaining balance/);
  assert.match(ownerParams[4], /CUSTOM REFERENCE PHOTO ORDER/);
  assert.match(ownerParams[6], /INR 500 advance/);
  assert.match(ownerParams[6], /final price and remaining balance/);
});

test('customer opt-in and owner alert each claim, send and persist a sent status', async () => {
  for (const channel of ['customer', 'owner']) {
    let stored = order();
    const sends = [];
    const config = getWhatsAppConfiguration(env, channel);
    const recipient = channel === 'customer' ? stored.delivery.phone : config.recipient;
    const parameters = templateParametersForOrder(stored, channel, 'https://arabian-tailors.vercel.app/admin?orderId=AT-123456');
    const result = await dispatchWhatsAppNotification({
      order: stored, channel, recipient, config, parameters,
      loadOrder: async () => stored,
      saveOrder: async (next) => { stored = next; },
      send: async (request) => { sends.push(request); return { status: 'sent', messageId: 'wamid.test' }; },
      now: () => '2026-10-29T00:00:00.000Z',
    });
    assert.equal(result.order.whatsappNotifications[channel].status, 'sent');
    assert.equal(result.order.whatsappNotifications[channel].attempts, 1);
    assert.equal(sends.length, 1);
  }
});

test('does not notify a customer who did not opt in or has a non-E.164 number', async () => {
  let stored = order({ delivery: { ...order().delivery, phone: '9876543210' }, whatsappConsent: { customerUpdates: false } });
  let sendCount = 0;
  const result = await dispatchWhatsAppNotification({
    order: stored, channel: 'customer', recipient: null, config: getWhatsAppConfiguration(env, 'customer'), parameters: [],
    saveOrder: async (next) => { stored = next; }, send: async () => { sendCount++; return { status: 'sent' }; },
  });
  assert.equal(result.order.whatsappNotifications.customer.status, 'skipped');
  assert.equal(sendCount, 0);
});

test('missing configuration is recorded for later Admin retry without contacting Meta', async () => {
  let stored = order();
  let sendCount = 0;
  const result = await dispatchWhatsAppNotification({
    order: stored, channel: 'owner', recipient: env.WHATSAPP_OWNER_PHONE_NUMBER, config: null, parameters: [],
    saveOrder: async (next) => { stored = next; }, send: async () => { sendCount++; return { status: 'sent' }; },
  });
  assert.equal(result.order.whatsappNotifications.owner.status, 'not_configured');
  assert.equal(sendCount, 0);
});

test('provider HTTP errors are failed, network/timeout outcomes are unknown, and credentials never enter the payload', async () => {
  const config = getWhatsAppConfiguration(env, 'customer');
  let captured;
  const ok = await sendWhatsAppTemplate({ config, recipient: '+919876543210', parameters: ['a'], fetchImpl: async (url, init) => { captured = { url, init, body: JSON.parse(init.body) }; return new Response(JSON.stringify({ messages: [{ id: 'wamid.1' }] }), { status: 200 }); } });
  assert.equal(ok.status, 'sent');
  assert.equal(captured.url, 'https://graph.facebook.com/v23.0/123456789012345/messages');
  assert.equal(captured.body.type, 'template');
  assert.equal(JSON.stringify(captured.body).includes(env.WHATSAPP_ACCESS_TOKEN), false);
  const failed = await sendWhatsAppTemplate({ config, recipient: '+919876543210', parameters: ['a'], fetchImpl: async () => new Response(JSON.stringify({ error: { code: 131026, message: 'private detail' } }), { status: 400 }) });
  assert.deepEqual({ status: failed.status, httpStatus: failed.httpStatus, errorCode: failed.errorCode }, { status: 'failed', httpStatus: 400, errorCode: 'meta_131026' });
  const unknown = await sendWhatsAppTemplate({ config, recipient: '+919876543210', parameters: ['a'], timeoutMs: 5, fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })) });
  assert.equal(unknown.status, 'unknown');
  assert.equal(unknown.errorCode, 'request_timeout');
});

test('failed sends can be retried explicitly, while sent, sending and unknown states cannot duplicate', async () => {
  let stored = order();
  let attempts = 0;
  const args = {
    channel: 'customer', recipient: '+919876543210', config: getWhatsAppConfiguration(env, 'customer'), parameters: ['a'],
    loadOrder: async () => stored,
    saveOrder: async (next) => { stored = next; },
    send: async () => { attempts++; return attempts === 1 ? { status: 'failed', httpStatus: 400, errorCode: 'meta_131026' } : { status: 'sent', messageId: 'wamid.retry' }; },
  };
  await dispatchWhatsAppNotification({ ...args, order: stored });
  assert.equal(stored.whatsappNotifications.customer.status, 'failed');
  await dispatchWhatsAppNotification({ ...args, order: stored });
  assert.equal(attempts, 1);
  await dispatchWhatsAppNotification({ ...args, order: stored, explicitRetry: true });
  assert.equal(attempts, 2);
  assert.equal(stored.whatsappNotifications.customer.status, 'sent');
  const noDuplicate = await dispatchWhatsAppNotification({ ...args, order: stored, explicitRetry: true });
  assert.equal(noDuplicate.skipped, true);
  assert.equal(attempts, 2);
});

test('unknown delivery outcome is never automatically retried', async () => {
  let stored = order();
  let attempts = 0;
  const args = {
    channel: 'customer', recipient: '+919876543210', config: getWhatsAppConfiguration(env, 'customer'), parameters: ['a'],
    saveOrder: async (next) => { stored = next; },
    send: async () => { attempts++; return { status: 'unknown', errorCode: 'network_outcome_unknown' }; },
  };
  await dispatchWhatsAppNotification({ ...args, order: stored });
  await dispatchWhatsAppNotification({ ...args, order: stored, explicitRetry: true });
  assert.equal(stored.whatsappNotifications.customer.status, 'unknown');
  assert.equal(attempts, 1);
});

test('claim plus fresh order read prevents a concurrent retry from sending twice', async () => {
  let stored = order({ whatsappNotifications: { ...createWhatsAppNotificationStates(), owner: { status: 'failed', attempts: 1 } } });
  let lock = false;
  let sends = 0;
  const acquireClaim = async () => { if (lock) return false; lock = true; return true; };
  const releaseClaim = async () => { lock = false; };
  const args = {
    channel: 'owner', recipient: '+919876543210', config: getWhatsAppConfiguration(env, 'owner'), parameters: ['a'], explicitRetry: true,
    loadOrder: async () => stored, saveOrder: async (next) => { stored = next; }, acquireClaim, releaseClaim,
    send: async () => { sends++; return { status: 'sent', messageId: 'wamid.owner' }; },
  };
  const first = await dispatchWhatsAppNotification({ ...args, order: stored });
  assert.equal(first.order.whatsappNotifications.owner.status, 'sent');
  const staleSecond = await dispatchWhatsAppNotification({ ...args, order: order({ whatsappNotifications: { ...createWhatsAppNotificationStates(), owner: { status: 'failed', attempts: 1 } } }) });
  assert.equal(staleSecond.skipped, true);
  assert.equal(sends, 1);
});
