const https = require("https");

function cashfreeRequest(path) {
  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        hostname: "api.cashfree.com",
        path,
        method: "GET",
        headers: {
          "Accept": "application/json",
          "x-api-version": "2025-01-01",
          "x-client-id": process.env.CASHFREE_APP_ID,
          "x-client-secret": process.env.CASHFREE_SECRET_KEY
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
            console.error("Cashfree verification error:", response.statusCode);
            return reject(new Error("Unable to verify payment"));
          }

          resolve(result);
        });
      }
    );

    request.setTimeout(15000, () => {
      request.destroy(new Error("Cashfree request timed out"));
    });

    request.on("error", reject);
    request.end();
  });
}

module.exports = async (req, res) => {
  if (req.method !== "GET") {
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

  const orderId = String(req.query.order_id || "");

  if (!/^pockfume_[A-Za-z0-9_]+$/.test(orderId)) {
    return res.status(400).json({
      error: "Invalid order ID"
    });
  }

  try {
    const result = await cashfreeRequest(
      "/pg/orders/" + encodeURIComponent(orderId)
    );

    return res.status(200).json({
      orderId: result.order_id,
      orderStatus: result.order_status,
      paid: result.order_status === "PAID"
    });

  } catch (error) {
    console.error("Payment verification failed:", error.message);

    return res.status(502).json({
      error: "Unable to verify payment. Please try again."
    });
  }
};
