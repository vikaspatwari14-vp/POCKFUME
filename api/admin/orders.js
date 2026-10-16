const { Pool } = require("pg");

const connectionString =
  process.env.DATABASE_URL ||
  process.env.STORAGE_URL ||
  process.env.POSTGRES_URL;

const pool = connectionString
  ? new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      max: 3
    })
  : null;

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
      error: "Admin authentication required"
    });
  }

  if (!pool) {
    return res.status(500).json({
      error: "Database connection is not configured"
    });
  }

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
    console.error("POCKFUME orders query failed:", error.message);

    return res.status(500).json({
      error: "Unable to load orders. Check database configuration and table."
    });
  }
};
