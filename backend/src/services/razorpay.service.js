const Razorpay = require('razorpay');
const crypto = require('crypto');

let razorpayInstance = null;

function getRazorpayInstance() {
  if (!razorpayInstance) {
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      throw new Error("Razorpay credentials not configured in environment.");
    }
    razorpayInstance = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
  }
  return razorpayInstance;
}

/**
 * Creates a Razorpay order.
 * @param {number} amountPaise - The amount in paise.
 * @param {string} receipt - A unique receipt id (e.g., wallet_topup_123).
 * @param {string} currency - Default INR.
 * @returns {Promise<Object>} The razorpay order object.
 */
async function createOrder(amountPaise, receipt, currency = 'INR') {
  const rzp = getRazorpayInstance();
  const options = {
    amount: amountPaise,
    currency,
    receipt,
  };
  return await rzp.orders.create(options);
}

/**
 * Validates the Razorpay checkout signature.
 * @param {string} orderId 
 * @param {string} paymentId 
 * @param {string} signature 
 * @returns {boolean}
 */
function verifyCheckoutSignature(orderId, paymentId, signature) {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) throw new Error("Razorpay secret not configured.");

  const generatedSignature = crypto
    .createHmac('sha256', secret)
    .update(orderId + "|" + paymentId)
    .digest('hex');

  return generatedSignature === signature;
}

/**
 * Validates the Razorpay webhook signature.
 * @param {string|Buffer} rawBody - The raw request body from express.
 * @param {string} signature - The X-Razorpay-Signature header.
 * @returns {boolean}
 */
function verifyWebhookSignature(rawBody, signature) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) throw new Error("Razorpay webhook secret not configured.");

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  return expectedSignature === signature;
}

/**
 * Fetches the payment details.
 * @param {string} paymentId 
 * @returns {Promise<Object>}
 */
async function getPayment(paymentId) {
  const rzp = getRazorpayInstance();
  return await rzp.payments.fetch(paymentId);
}

module.exports = {
  createOrder,
  verifyCheckoutSignature,
  verifyWebhookSignature,
  getPayment,
};
