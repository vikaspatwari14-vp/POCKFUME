const https = require("https");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  const appId = process.env.CASHFREE_APP_ID;
  const secretKey = process.env.CASHFREE_SECRET_KEY;

  if (!appId || !secretKey) {
    return res.status(500).json({
      error: "Cashfree credentials are not configured"
    });
  }

  const {
    amount,
    customerName,
    customerEmail,
    customerPhone
  } = req.body || {};

  const orderAmount = Number(amount);
  const phone = String(customerPhone || "").replace(/\D/g, "");

  if (
    !Number.isFinite(orderAmount) ||
    orderAmount <= 0 ||
    orderAmount > 1000000 ||
    !customerName ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(customerEmail || "")) ||
    !/^[6-9]\d{9}$/.test(phone)
  ) {
    return res.status(400).json({
      error: "Please enter valid name, email, phone and amount"
    });
  }

  const orderId = "pockfume_" + Date.now();

  const payload = JSON.stringify({
    order_id: orderId,
    order_amount: Number(orderAmount.toFixed(2)),
    order_currency: "INR",
    customer_details: {
      customer_id: "customer_" + Date.now(),
      customer_name: String(customerName).trim().slice(0, 100),
      customer_email: String(customerEmail).trim(),
      customer_phone: phone
    },
    order_meta: {
