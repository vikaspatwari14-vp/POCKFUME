// POCKFUME Admin Orders API
// File: api/admin/orders.js

const { createClient } = require("@supabase/supabase-js");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  // Require an authenticated admin session.
  // This must be implemented before enabling access.
  const adminToken = process.env.ADMIN_API_TOKEN;

  if (
    !adminToken ||
    req.headers.authorization !== `Bearer ${adminToken}`
  ) {
    return res.status(401).json({
      error: "Admin authentication required"
    });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return res.status(503).json({
      error: "Order database is not configured yet"
    });
  }

  try {
    const supabase = createClient(
      supabaseUrl,
      supabaseKey,
      {
        auth: {
          persistSession: false
        }
      }
    );

    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) {
      console.error("Admin orders query failed:", error.message);

      return res.status(500).json({
        error: "Unable to load orders"
      });
    }

    return res.status(200).json({
      orders: data || []
    });
  } catch (error) {
    console.error("Admin orders API failed");

    return res.status(500).json({
      error: "Internal server error"
    });
  }
};
