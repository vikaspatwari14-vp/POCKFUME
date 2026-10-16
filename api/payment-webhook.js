const crypto = require("crypto");
const { Pool } = require("pg");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const secret = process.env.CASHFREE_SECRET_KEY;
  const databaseUrl =
    process.env.DATABASE_URL ||
    process.env.STORAGE_URL ||
    process.env.POSTGRES_URL;

  if (!secret || !databaseUrl) {
    return res.status(500).json({
      error: "Server configuration missing"
    });
  }

  let pool;

  try {
    // Read the original request body for signature verification.
    let rawBody = "";

    if (typeof req.body === "string") {
      rawBody = req.body;
    } else if (Buffer.isBuffer(req.body)) {
      rawBody = req.body.toString("utf8");
    } else if (req.body && typeof req.body === "object") {
      return res.status(400).json({
        error: "Raw webhook body is required for signature verification"
      });
    } else {
      const chunks = [];

      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk));
      }

      rawBody = Buffer.concat(chunks).toString("utf8");
    }

    const signature = req.headers["x-webhook-signature"];
    const timestamp = req.headers["x-webhook-timestamp"];

    if (!signature || !timestamp) {
      return res.status(400).json({
        error: "Missing Cashfree signature headers"
      });
    }

    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(timestamp + rawBody)
      .digest("base64");

    const received = Buffer.from(signature);
    const expected = Buffer.from(expectedSignature);

    if (
      received.length !== expected.length ||
      !crypto.timingSafeEqual(received, expected)
    ) {
      return res.status(401).json({
        error: "Invalid webhook signature"
      });
    }

    const event = JSON.parse(rawBody);

    // Only process successful payment events.
    if (event.type !== "PAYMENT_SUCCESS_WEBHOOK") {
      return res.status(200).json({
        received: true,
        message: "Event acknowledged; no update required"
      });
    }

    const orderId = event.data?.order?.order_id;
    const paymentStatus = event.data?.payment?.payment_status;

    if (!orderId || paymentStatus !== "SUCCESS") {
      return res.status(400).json({
        error: "Missing order ID or successful payment status"
      });
    }

    pool = new Pool({
      connectionString: databaseUrl,
      ssl: { rejectUnauthorized: false }
    });

    // Update only the matching order.
    const result = await pool.query(
      `UPDATE orders
       SET payment_status = 'PAID'
       WHERE order_id = $1
       RETURNING id, order_id, payment_status`,
      [orderId]
    );

    if (result.rowCount === 0) {
      console.error("No matching order found:", orderId);

      return res.status(404).json({
        error: "Order not found in database"
      });
    }

    console.log("Payment marked PAID:", result.rows[0].order_id);

    return res.status(200).json({
      received: true,
      order: result.rows[0]
    });
  } catch (error) {
    console.error("Payment webhook error:", error.message);

    return res.status(500).json({
      error: "Webhook processing failed"
    });
  } finally {
    if (pool) {
      await pool.end();
    }
  }
};
