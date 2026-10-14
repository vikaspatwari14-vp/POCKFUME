const https = require("https");

const PRODUCTS = {
  "Night Volt": 249,
  "Velvet Ember": 249,
  "Golden Haze": 249,
  "Pacific Ocean Pearl": 249,
  "British Tea Rose": 249
};

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

  const body = req.body || {};

  const name = String(body.customerName || "").trim();
  const email = String(body.customerEmail || "").trim();
  const phone = String(body.customerPhone || "").replace(/\D/g, "");
  const items = Array.isArray(body.items) ? body.items : [];

  if (
    !name ||
    name.length > 100 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    !/^[6-9]\d{9}$/.test(phone) ||
    items.length < 1 ||
    items.length > 20
  ) {
    return res.status(400).json({
      error: "Please enter valid customer details and cart items"
    });
  }

  let amount = 0;
  const orderLines = [];

  for (const item of items) {
    const productName = String(item.name || "");
    const qty = Number(item.qty);

    if (
      !Object.prototype.hasOwnProperty.call(PRODUCTS, productName) ||
      !Number.isInteger(qty) ||
      qty < 1 ||
      qty > 99
    ) {
      return res.status(400).json({
        error: "Invalid product or quantity in cart"
      });
    }

    amount += PRODUCTS[productName] * qty;
    orderLines.push(productName + " x" + qty);
  }

  if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000) {
    return res.status(400).json({
      error: "Invalid order total"
    });
  }

  const orderId =
    "pockfume_" +
    Date.now() +
    "_" +
    Math.random().toString(36).slice(2, 8);

  const payload = JSON.stringify({
    order_id: orderId,
    order_amount: Number(amount.toFixed(2)),
    order_currency: "INR",

    customer_details: {
      customer_id: "customer_" + Date.now(),
      customer_name: name,
      customer_email: email,
      customer_phone: phone
    },

    order_note: "POCKFUME: " + orderLines.join(", "),

    order_meta: {
      return_url:
        "https://pockfume.com/payment-status.html?order_id={order_id}"
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
      const request = https.request(options, response => {
        let data = "";

        response.on("data", chunk => {
          data += chunk;
        });

        response.on("end", () => {
          let parsed;

          try {
            parsed = JSON.parse(data);
          } catch {
            return reject(
              new Error("Invalid response from Cashfree")
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
                "Cashfree rejected request: HTTP " +
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
      return res.status(502).json({
        error: "Cashfree did not return a payment session"
      });
    }

    return res.status(200).json({
      orderId: result.order_id,
      paymentSessionId: result.payment_session_id,
      amount: Number(amount.toFixed(2))
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
