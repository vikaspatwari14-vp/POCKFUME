const { sql } = require("@vercel/postgres");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  // Do not expose customer data without authentication.
  const adminToken = process.env.ADMIN_API_TOKEN;

  if (
    !adminToken ||
    req.headers.authorization !== `Bearer ${adminToken}`
  ) {
    return res.status(401).json({
      error: "Admin authentication required"
    });
  }

  try {
    const result = await sql`
      SELECT
        order_id,
        created_at,
        customer_name,
        customer_phone,
        customer_email,
        address,
        city,
        state,
        pincode,
        product,
        quantity,
        amount,
        payment_status,
        delivery_status
      FROM orders
      ORDER BY created_at DESC
      LIMIT 500
    `;

    return res.status(200).json({
      orders: result.rows
    });
  } catch (error) {
    console.error("Order query failed");

    return res.status(500).json({
      error: "Unable to load orders"
    });
  }
};
