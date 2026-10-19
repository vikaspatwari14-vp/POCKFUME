// POCKFUME — Cashfree Payment Verification + Neon Status Update

const https = require("https");
const { Pool } = require("pg");

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    process.env.STORAGE_URL ||
    process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false }
});

function cashfreeRequest(path) {
  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        hostname: "api.cashfree.com",
        path,
        method: "GET",
        headers: {
          Accept: "application/json",
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
            return reject(
              new Error("Invalid Cashfree response")
            );
          }

          if (
            response.statusCode < 200 ||
            response.statusCode >= 300
          ) {
            console.error(
              "Cashfree verification error:",
              response.statusCode
            );

            return reject(
              new Error("Unable to verify payment")
            );
          }

          resolve(result);
        });
      }
    );

    request.setTimeout(15000, () => {
      request.destroy(
        new Error("Cashfree request timed out")
      );
    });

    request.on("error", reject);
    request.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");

    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  const appId = process.env.CASHFREE_APP_ID;
  const secret = process.env.CASHFREE_SECRET_KEY;

  const databaseUrl =
    process.env.DATABASE_URL ||
    process.env.STORAGE_URL ||
    process.env.POSTGRES_URL;

  if (!appId || !secret || !databaseUrl) {
    return res.status(500).json({
      error: "Payment or database configuration is missing"
    });
  }

  const orderId = String(
    req.query?.order_id || ""
  ).trim();

  if (!/^pockfume_[A-Za-z0-9_]+$/.test(orderId)) {
    return res.status(400).json({
      error: "Invalid order ID"
    });
  }

  try {
    // 1. Fetch the order directly from Cashfree.
    const result = await cashfreeRequest(
      "/pg/orders/" + encodeURIComponent(orderId)
    );

    if (result.order_id !== orderId) {
      return res.status(502).json({
        error: "Payment order could not be verified"
      });
    }

    const orderStatus = String(
      result.order_status || "UNKNOWN"
    ).toUpperCase();

    const paid = orderStatus === "PAID";

    // 2. Update Neon only when Cashfree confirms payment.
    if (paid) {
      const updateResult = await pool.query(
        `UPDATE orders
         SET payment_status = 'PAID'
         WHERE order_id = $1
           AND payment_status IS DISTINCT FROM 'PAID'
         RETURNING order_id`,
        [orderId]
      );

      // Do not report success if the order wasn't recorded in Neon.
      if (updateResult.rowCount === 0) {
        const existingOrder = await pool.query(
          `SELECT order_id, payment_status
           FROM orders
           WHERE order_id = $1
           LIMIT 1`,
          [orderId]
        );

        if (
          existingOrder.rowCount === 0 ||
          existingOrder.rows[0].payment_status !== "PAID"
        ) {
          return res.status(404).json({
            error: "Order not found in the order database"
          });
        }
      }
    }

    // 3. Return the verified Cashfree status.
    return res.status(200).json({
      orderId: result.order_id,
      orderStatus,
      paid
    });

  } catch (error) {
    console.error(
      "Payment verification failed:",
      error.message
    );

    return res.status(502).json({
      error: "Unable to verify payment. Please try again."
    });
  }
};
