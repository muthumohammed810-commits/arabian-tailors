/** Public storefront configuration must not contain bank account details. */
export function publicStoreSettings(settings) {
  const {
    accountName: _accountName,
    accountNumber: _accountNumber,
    bankName: _bankName,
    ifsc: _ifsc,
    ...publicSettings
  } = settings || {};
  return publicSettings;
}
