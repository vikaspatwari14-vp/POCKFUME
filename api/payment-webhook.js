const crypto = require("crypto");
const { Pool } = require("pg");

// Disable automatic body parsing so Cashfree's signature
// can be verified against the original request body.
module.exports.config = {
  api: {
    bodyParser: false
  }
};

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    process.env.STORAGE_URL ||
    process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false },
  max: 3
});

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    req.on("data", chunk => {
      chunks.push(Buffer.from(chunk));
    });

    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });

    req.on("error", reject);
  });
}

function verifySignature(secret, timestamp, rawBody, signature) {
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(timestamp + rawBody)
    .digest("base64");

  const received = Buffer.from(signature, "utf8");
  const expected = Buffer.from(expectedSignature, "utf8");

  return (
    received.length === expected.length &&
    crypto.timingSafeEqual(received, expected)
  );
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");

    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  const secret = process.env.CASHFREE_SECRET_KEY;

  const databaseUrl =
    process.env.DATABASE_URL ||
    process.env.STORAGE_URL ||
    process.env.POSTGRES_URL;

  if (!secret || !databaseUrl) {
    console.error("Cashfree webhook configuration is missing");

    return res.status(500).json({
      error: "Server configuration missing"
    });
  }

  try {
    // 1. Read the original, unparsed request body.
    const rawBody = await readRawBody(req);

    if (!rawBody) {
      return res.status(400).json({
        error: "Empty webhook body"
      });
    }

    // 2. Obtain Cashfree's signature headers.
    const signature = req.headers["x-webhook-signature"];
    const timestamp = req.headers["x-webhook-timestamp"];

    if (
      typeof signature !== "string" ||
      typeof timestamp !== "string"
    ) {
      return res.status(400).json({
        error: "Missing Cashfree signature headers"
      });
    }

    // 3. Verify authenticity before processing the event.
    if (
      !verifySignature(
        secret,
        timestamp,
        rawBody,
        signature
      )
    ) {
      console.error("Invalid Cashfree webhook signature");

      return res.status(401).json({
        error: "Invalid webhook signature"
      });
    }

    // 4. Parse the verified event.
    let event;

    try {
      event = JSON.parse(rawBody);
    } catch {
      return res.status(400).json({
        error: "Invalid webhook JSON"
      });
    }

    // Ignore other event types.
    if (event.type !== "PAYMENT_SUCCESS_WEBHOOK") {
      return res.status(200).json({
        received: true,
        message: "Event acknowledged"
      });
    }

    const orderId = event.data?.order?.order_id;
    const paymentStatus =
      event.data?.payment?.payment_status;

    const paymentAmount =
      event.data?.payment?.payment_amount;

    // 5. Validate the order and payment details.
    if (
      typeof orderId !== "string" ||
      !/^pockfume_[A-Za-z0-9_]+$/.test(orderId)
    ) {
      return res.status(400).json({
        error: "Invalid order ID"
      });
    }

    if (paymentStatus !== "SUCCESS") {
      return res.status(200).json({
        received: true,
        message: "Payment is not successful"
      });
    }

    const receivedAmount = Number(paymentAmount);

    if (
      paymentAmount === undefined ||
      paymentAmount === null ||
      !Number.isFinite(receivedAmount) ||
      receivedAmount <= 0
    ) {
      console.error(
        "Invalid payment amount for order:",
        orderId
      );

      return res.status(400).json({
        error: "Invalid payment amount"
      });
    }

    // 6. Check the stored order amount and update its status.
    // Amounts are compared in rupees, allowing for minor
    // decimal precision differences.
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const orderResult = await client.query(
        `SELECT id, order_id, amount, payment_status
         FROM orders
         WHERE order_id = $1
         FOR UPDATE`,
        [orderId]
      );

      if (orderResult.rowCount === 0) {
        await client.query("ROLLBACK");

        console.error(
          "Order not found in database:",
          orderId
        );

        // Return an error so Cashfree can retry delivery.
        return res.status(500).json({
          error: "Order not found; retry webhook later"
        });
      }

      const order = orderResult.rows[0];
      const storedAmount = Number(order.amount);

      if (
        !Number.isFinite(storedAmount) ||
        Math.abs(storedAmount - receivedAmount) > 0.01
      ) {
        await client.query("ROLLBACK");

        console.error("Payment amount mismatch:", {
          orderId,
          expectedAmount: storedAmount,
          receivedAmount
        });

        return res.status(400).json({
          error: "Payment amount mismatch"
        });
      }

      // Repeated success webhooks are safe to process.
      // An already-paid order remains paid.
      if (order.payment_status === "PAID") {
        await client.query("COMMIT");

        return res.status(200).json({
          received: true,
          orderId,
          paymentStatus: "PAID",
          message: "Order was already marked paid"
        });
      }

      const updateResult = await client.query(
        `UPDATE orders
         SET payment_status = 'PAID'
         WHERE order_id = $1
         RETURNING id, order_id, payment_status`,
        [orderId]
      );

      await client.query("COMMIT");

      console.log("Payment verified and order updated:", {
        orderId: updateResult.rows[0].order_id,
        paymentStatus: updateResult.rows[0].payment_status
      });

      return res.status(200).json({
        received: true,
        order: updateResult.rows[0]
      });

    } catch (dbError) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error(
          "Database rollback failed:",
          rollbackError.message
        );
      }

      throw dbError;

    } finally {
      client.release();
    }

  } catch (error) {
    console.error(
      "Cashfree webhook processing error:",
      error.message
    );

    return res.status(500).json({
      error: "Webhook processing failed"
    });
  }
};
