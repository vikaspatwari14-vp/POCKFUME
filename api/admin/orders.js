const { Pool } = require("pg");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  const token = process.env.ADMIN_API_TOKEN;

  if (!token || req.headers.authorization !== `Bearer ${token}`) {
    return res.status(401).json({
      error: "Admin authentication failed"
    });
  }

  const connectionString =
    process.env.DATABASE_URL ||
    process.env.STORAGE_URL ||
    process.env.POSTGRES_URL;

  if (!connectionString) {
    return res.status(500).json({
      error: "Database connection variable is missing"
    });
  }

  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    const result = await pool.query(`
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
    `);

    return res.status(200).json({
      orders: result.rows
    });
  } catch (error) {
    console.error("Admin order query failed:", error.message);

    return res.status(500).json({
      error: "Unable to load orders. Check the database table and columns."
    });
  } finally {
    await pool.end();
  }
};
