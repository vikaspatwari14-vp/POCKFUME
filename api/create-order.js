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

  if (
    !Number.isFinite(Number(amount)) ||
    Number(amount) <= 0 ||
    !customerName ||
    !customerEmail ||
    !/^[6-9]\d{9}$/.test(String(customerPhone || ""))
  ) {
    return res.status(400).json({
      error: "Invalid order details"
    });
  }

  const orderId = "pockfume_" + Date.now();

  const payload = JSON.stringify({
    order_id: orderId,
    order_amount: Number(Number(amount).toFixed(2)),
    order_currency: "INR",
    customer_details: {
      customer_id: "customer_" + Date.now(),
      customer_name: String(customerName).slice(0, 100),
      customer_email: String(customerEmail),
      customer_phone: String(customerPhone)
    },
    order_meta: {
      return_url:
        "https://pockfume.com/payment-status?order_id={order_id}"
    }
  });

  const options = {
    hostname: "api.cashfree.com",
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
    const responseData = await new Promise((resolve, reject) => {
      const request = https.request(options, (response) => {
        let data = "";

        response.on("data", (chunk) => {
          data += chunk;
        });

        response.on("end", () => {
          let result;

          try {
            result = JSON.parse(data);
          } catch {
            return reject(
              new Error("Invalid response from Cashfree")
            );
          }

          if (
            response.statusCode < 200 ||
            response.statusCode >= 300
          ) {
            return reject(
              new Error(
                "Cashfree order creation failed: " +
                response.statusCode
              )
            );
          }

          resolve(result);
        });
      });

      request.on("error", reject);
      request.write(payload);
      request.end();
    });

    if (!responseData.payment_session_id) {
      return res.status(502).json({
        error: "Cashfree did not return a payment session"
      });
    }

    return res.status(200).json({
      orderId: responseData.order_id,
      paymentSessionId: responseData.payment_session_id
    });

  } catch (error) {
    console.error("Cashfree order creation error:", error.message);

    return res.status(502).json({
      error: "Unable to create payment. Please try again."
    });
  }
};
