const https = require("https");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const appId = process.env.CASHFREE_APP_ID;
  const secretKey = process.env.CASHFREE_SECRET_KEY;

  if (!appId || !secretKey) {
    return res.status(500).json({
      error: "Cashfree credentials are not configured"
    });
  }

  const { amount, customerName, customerEmail, customerPhone } = req.body || {};

  if (
    !Number.isFinite(amount) ||
    amount <= 0 ||
    !customerName ||
    !customerEmail ||
    !/^[6-9]\d{9}$/.test(String(customerPhone || ""))
  ) {
    return res.status(400).json({ error: "Invalid order details" });
  }

  const orderId = "pockfume_" + Date.now();

  const payload = JSON.stringify({
    order_id: orderId,
    order_amount: Number(amount),
    order_currency: "INR",
    customer_details: {
      customer_id: "customer_" + Date.now(),
      customer_name: String(customerName).slice(0, 100),
      customer_email: String(customerEmail),
      customer_phone: String(customerPhone)
    },
    order_meta: {
      return_url: "https://pockfume.com/payment-status?order_id={order_id}"
    }
  });

  const options = {
    hostname: "api.cashfree.com",
    path: "/pg/orders",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-version": "2025-01-01",
      "x-client-id": appId,
      "x-client-secret": secretKey,
      "x-idempotency-key": orderId
    }
  };

  try {
    const response = await new Promise((resolve, reject) => {
      const request = https.request(options, (response) => {
        let data = "";
        response.on("data", chunk => data += chunk);
        response.on("end", () => {
          let result;
          try {
            result = JSON.parse(data);
          } catch {
            return reject(new Error("Invalid Cashfree response"));
          }

          if (response.statusCode < 200 || response.statusCode >= 300) {
            return reject(new Error("Cashfree order creation failed"));
          }

          resolve(result);
        });
      });

      request.on("error", reject);
      request.write(payload);
      request.end();
    });

    return res.status(200).json({
      orderId: response.order_id,
      paymentSessionId: response.payment_session_id
    });
  } catch {
    return res.status(502).json({
      error: "Unable to create payment
