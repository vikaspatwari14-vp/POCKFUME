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
      return_url:
        "https://pockfume.com/payment-status?order_id={order_id}"
    }
  });

  const options = {
    hostname: "sandbox.cashfree.com",
    path: "/pg/orders",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "x-api-version": "2025-01-01",
      "x-client-id": appId,
      "x-client-secret": secretKey,
      "x-idempotency-key": orderId
    }
  };

  try {
    const result = await new Promise((resolve, reject) => {
      const request = https.request(options, (response) => {
        let data = "";

        response.on("data", (chunk) => {
          data += chunk;
        });

        response.on("end", () => {
          let parsed;

          try {
            parsed = JSON.parse(data);
          } catch {
            return reject(
              new Error("Invalid response received from Cashfree")
            );
          }

          if (response.statusCode < 200 ||
              response.statusCode >= 300) {
            console.error(
              "Cashfree error:",
              response.statusCode,
              JSON.stringify(parsed)
            );

            return reject(
              new Error("Cashfree rejected the order request")
            );
          }

          resolve(parsed);
        });
      });

      request.on("error", reject);
      request.write(payload);
      request.end();
    });

    if (!result.payment_session_id) {
      return res.status(502).json({
        error: "Cashfree did not return a payment session"
      });
    }

    return res.status(200).json({
      orderId: result.order_id,
      paymentSessionId: result.payment_session_id
    });

  } catch (error) {
    console.error("Cashfree order creation failed:", error.message);

    return res.status(502).json({
      error: "Unable to create payment. Please try again."
    });
  }
};
