/**
 * BSDK Clubs — In-App SMS OTP Dispatcher
 * Instant, 100% free local OTP verification without third-party SMS gateways.
 */

export function getSmsProviderStatus() {
  return { provider: 'in-app', isReal: false, label: 'In-App SMS Dispatcher (Free Instant OTP)' };
}

/**
 * Dispatch SMS OTP (in-app console & automated detection)
 * @param {Object} opts
 * @param {string} opts.phone Full phone with country code (e.g. +919876543210)
 * @param {string} opts.countryCode (e.g. +91)
 * @param {string} opts.otp 6-digit verification code
 * @returns {Promise<{ success: boolean, provider: string, message: string }>}
 */
export async function sendSmsOtp({ phone, countryCode = '+91', otp }) {
  const tenDigit = phone.replace(/^\+91/, '').replace(/^0+/, '').replace(/\D/g, '');
  const international = `+91${tenDigit}`;

  console.log(`\n==================================================`);
  console.log(`📩 [SMS DISPATCHER] To: ${international}`);
  console.log(`   Your BSDK Clubs verification code is: ${otp}`);
  console.log(`   Valid for 5 minutes.`);
  console.log(`==================================================\n`);

  return {
    success: true,
    provider: 'in-app',
    isReal: false,
    message: `Verification code generated for ${international}`
  };
}
