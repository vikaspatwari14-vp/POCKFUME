const https = require("https");

const PRODUCTS = {
  "Night Volt": 249,
  "Velvet Ember": 249,
  "Golden Haze": 249,
  "Pacific Ocean Pearl": 249,
  "British Tea Rose": 249
};

function cashfreeRequest(path, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);

    const request = https.request(
      {
        hostname: "api.cashfree.com",
        path,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "x-api-version": "2025-01-01",
          "x-client-id": process.env.CASHFREE_APP_ID,
          "x-client-secret": process.env.CASHFREE_SECRET_KEY,
          "Content-Length": Buffer.byteLength(body)
        }
      },
      response => {
        let data = "";

        response.on("data", chunk => {
          data += chunk;
        });

        response.on("end", () => {
          let result;

          try {
            result = JSON.parse(data);
          } catch {
            return reject(new Error("Invalid Cashfree response"));
          }

          if (response.statusCode < 200 || response.statusCode >= 300) {
            console.error("Cashfree error:", response.statusCode, result);
            return reject(new Error("Cashfree order creation failed"));
          }

          resolve(result);
        });
      }
    );

    request.setTimeout(15000, () => {
      request.destroy(new Error("Cashfree request timed out"));
    });

    request.on("error", reject);
    request.write(body);
    request.end();
  });
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  if (
    !process.env.CASHFREE_APP_ID ||
    !process.env.CASHFREE_SECRET_KEY
  ) {
    return res.status(500).json({
      error: "Cashfree credentials are missing"
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
    items.length === 0 ||
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
        error: "Invalid product or quantity"
      });
    }

    amount += PRODUCTS[productName] * qty;
    orderLines.push(productName + " x" + qty);
  }

  if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000) {
    return res.status(400).json({
      error: "Invalid order amount"
    });
  }

  const orderId =
    "pockfume_" +
    Date.now() +
    "_" +
    Math.random().toString(36).slice(2, 8);

  const payload = {
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
  };

  try {
    const result = await cashfreeRequest("/pg/orders", payload);

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
    console.error("Create order failed:", error.message);

    return res.status(502).json({
      error: "Unable to create payment. Please try again."
    });
  }
};
