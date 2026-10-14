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
    console.error("Cashfree credentials are missing");

    return res.status(500).json({
      error: "Payment configuration is incomplete"
    });
  }

  const {
    amount,
    customerName,
    customerEmail,
    customerPhone
  } = req.body || {};

  const orderAmount = Number(amount);
  const name = String(customerName || "").trim();
  const email = String(customerEmail || "").trim();
  const phone = String(customerPhone || "").replace(/\D/g, "");

  if (
    !Number.isFinite(orderAmount) ||
    orderAmount <= 0 ||
    orderAmount > 1000000 ||
    !name ||
    name.length > 100 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    !/^[6-9]\d{9}$/.test(phone)
  ) {
    return res.status(400).json({
      error: "Please enter valid customer details and amount"
    });
  }

  const orderId =
    "pockfume_" +
    Date.now() +
    "_" +
    Math.random().toString(36).slice(2, 8);

  const payload = JSON.stringify({
    order_id: orderId,
    order_amount: Number(orderAmount.toFixed(2)),
    order_currency: "INR",

    customer_details: {
      customer_id: "customer_" + Date.now(),
      customer_name: name,
      customer_email: email,
      customer_phone: phone
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

          if (
            response.statusCode < 200 ||
            response.statusCode >= 300
          ) {
            console.error(
              "Cashfree API error:",
              response.statusCode,
              JSON.stringify(parsed)
            );

            return reject(
              new Error(
                "Cashfree API rejected request: HTTP " +
                response.statusCode
              )
            );
          }

          resolve(parsed);
        });
      });

      request.setTimeout(15000, () => {
        request.destroy(
          new Error("Cashfree request timed out")
        );
      });

      request.on("error", reject);

      request.write(payload);
      request.end();
    });

    if (!result.payment_session_id) {
      console.error("Cashfree returned no payment session");

      return res.status(502).json({
        error: "Unable to initialize payment"
      });
    }

    return res.status(200).json({
      orderId: result.order_id,
      paymentSessionId: result.payment_session_id
    });

  } catch (error) {
    console.error(
      "Cashfree order creation failed:",
      error.message
    );

    return res.status(502).json({
      error: "Unable to create payment. Please try again."
    });
  }
};
