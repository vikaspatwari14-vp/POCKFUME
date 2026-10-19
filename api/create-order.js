// POCKFUME — Cashfree + Neon Order Creation
// Supports individual products and all 3 combo offers.
// Signature Duo is a fixed combo: no fragrance selection required.

const { Pool } = require("pg");

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    process.env.STORAGE_URL ||
    process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false }
});

// Individual products
const PRODUCTS = {
  "Night Volt": 249,
  "Velvet Ember": 249,
  "Golden Haze": 249,
  "Pacific Ocean Pearl": 249,
  "British Tea Rose": 249
};

// Combo offers
const COMBOS = {
  "Signature Duo": {
    price: 399,
    count: 0,
    allowSameFragrance: true,
    fixed: true,
    description: "For Her + For Him"
  },

  "Pick Any 2 Combo": {
    price: 349,
    count: 2,
    allowSameFragrance: false,
    fixed: false
  },

  "Pick Any 4 Combo": {
    price: 599,
    count: 4,
    allowSameFragrance: false,
    fixed: false
  }
};

// Sanitize customer-supplied text
const clean = (value, max = 150) =>
  String(value || "")
    .trim()
    .replace(/[<>\u0000-\u001F]/g, "")
    .slice(0, max);

// Normalize product names sent by the website
const normalizeProductName = (name) => {
  const value = clean(name, 60);

  const aliases = {
    "Couple Combo": "Signature Duo",
    "For Her + For Him": "Signature Duo",
    "For Her + For Him Combo": "Signature Duo",
    "Her + Him Combo": "Signature Duo",
    "Signature Duo Combo": "Signature Duo",

    "Pick Any 2": "Pick Any 2 Combo",
    "Pick Any 4": "Pick Any 4 Combo"
  };

  return aliases[value] || value;
};

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");

    return res.status(405).json({
      error: "Method not allowed."
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
      error: "Payment or database configuration is missing."
    });
  }

  try {
    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body || {};

    // ------------------------------------------
    // 1. CUSTOMER DETAILS
    // ------------------------------------------

    const name = clean(body.customerName);
    const email = clean(body.customerEmail);
    const phone = clean(body.customerPhone, 10);

    const address = body.address || {};

    const line1 = clean(address.line1);
    const line2 = clean(address.line2);
    const landmark = clean(address.landmark);
    const city = clean(address.city);
    const state = clean(address.state);
    const pincode = clean(address.pincode, 6);

    if (
      !name ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      !/^[6-9]\d{9}$/.test(phone)
    ) {
      return res.status(400).json({
        error: "Enter a valid name, email and mobile number."
      });
    }

    if (
      !line1 ||
      !line2 ||
      !city ||
      !state ||
      !/^\d{6}$/.test(pincode)
    ) {
      return res.status(400).json({
        error: "Enter your complete delivery address and PIN code."
      });
    }

    // ------------------------------------------
    // 2. VALIDATE CART
    // ------------------------------------------

    if (
      !Array.isArray(body.items) ||
      body.items.length < 1 ||
      body.items.length > 20
    ) {
      return res.status(400).json({
        error: "Your cart is empty or invalid."
      });
    }

    let total = 0;
    let totalQty = 0;

    const descriptions = [];

    for (const item of body.items) {
      const product = normalizeProductName(item.name);
      const qty = Number(item.qty);

      if (
        !Number.isInteger(qty) ||
        qty < 1 ||
        qty > 99
      ) {
        return res.status(400).json({
          error: "Invalid product quantity."
        });
      }

      totalQty += qty;

      // ----------------------------------------
      // INDIVIDUAL PRODUCT
      // ----------------------------------------

      if (PRODUCTS[product] !== undefined) {
        total += PRODUCTS[product] * qty;

        descriptions.push(`${product} x${qty}`);

        continue;
      }

      // ----------------------------------------
      // COMBO PRODUCT
      // ----------------------------------------

      const combo = COMBOS[product];

      if (combo) {
        // Signature Duo is fixed.
        // It does not require fragrance choices.
        if (combo.fixed) {
          total += combo.price * qty;

          descriptions.push(
            `${product} (${combo.description}) x${qty}`
          );

          continue;
        }

        // Pick Any combos require fragrance choices.
        const choices = Array.isArray(item.choices)
          ? item.choices.map(choice => clean(choice, 60))
          : [];

        if (
          choices.length !== combo.count ||
          choices.some(choice => PRODUCTS[choice] === undefined)
        ) {
          return res.status(400).json({
            error:
              `Choose ${combo.count} valid fragrances for ${product}.`
          });
        }

        if (
          !combo.allowSameFragrance &&
          new Set(choices).size !== combo.count
        ) {
          return res.status(400).json({
            error:
              `Choose ${combo.count} different fragrances for ${product}.`
          });
        }

        total += combo.price * qty;

        descriptions.push(
          `${product} (${choices.join(", ")}) x${qty}`
        );

        continue;
      }

      return res.status(400).json({
        error: `Invalid product in your cart: ${product}`
      });
    }

    if (total <= 0 || total > 100000) {
      return res.status(400).json({
        error: "Invalid order total."
      });
    }

    // ------------------------------------------
    // 3. GENERATE UNIQUE ORDER ID
    // ------------------------------------------

    const orderId =
      "pockfume_" +
      Date.now() +
      "_" +
      Math.random().toString(36).slice(2, 8);

    const productText = descriptions.join("; ").slice(0, 250);

    const fullAddress = [
      line1,
      line2,
      landmark
    ].filter(Boolean).join(", ");

    // ------------------------------------------
    // 4. CREATE CASHFREE PAYMENT ORDER
    // ------------------------------------------

    const paymentResponse = await fetch(
      "https://api.cashfree.com/pg/orders",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "x-client-id": appId,
          "x-client-secret": secret,
          "x-api-version": "2025-01-01"
        },

        body: JSON.stringify({
          order_id: orderId,
          order_amount: Number(total.toFixed(2)),
          order_currency: "INR",

          customer_details: {
            customer_id: "pf_" + phone,
            customer_name: name,
            customer_email: email,
            customer_phone: phone
          },

          order_meta: {
            return_url:
              "https://pockfume.com/payment-status.html?order_id={order_id}"
          },

          order_note: productText
        })
      }
    );

    const payment = await paymentResponse
      .json()
      .catch(() => ({}));

    if (
      !paymentResponse.ok ||
      !payment.payment_session_id
    ) {
      console.error(
        "Cashfree order creation failed:",
        paymentResponse.status,
        payment.type || "",
        payment.code || ""
      );

      return res.status(502).json({
        error: "Unable to create payment. Please try again."
      });
    }

    // ------------------------------------------
    // 5. SAVE ORDER IN NEON AS PENDING
    // ------------------------------------------

    await pool.query(
      `INSERT INTO orders (
        order_id,
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
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
        'PENDING',
        'PROCESSING'
      )`,
      [
        orderId,
        name,
        phone,
        email,
        fullAddress,
        city,
        state,
        pincode,
        productText,
        totalQty,
        total
      ]
    );

    // ------------------------------------------
    // 6. RETURN CASHFREE PAYMENT SESSION
    // ------------------------------------------

    return res.status(200).json({
      success: true,
      orderId,
      paymentSessionId: payment.payment_session_id,
      amount: total,
      currency: "INR"
    });

  } catch (error) {
    console.error(
      "POCKFUME order creation error:",
      error.message
    );

    return res.status(500).json({
      error: "Unable to prepare your order. Please try again."
    });
  }
};
