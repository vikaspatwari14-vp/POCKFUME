// POCKFUME — Cashfree LIVE Order Creation API

const PRODUCT_PRICES = {
  "Night Volt": 249,
  "Velvet Ember": 249,
  "Golden Haze": 249,
  "Pacific Ocean Pearl": 249,
  "British Tea Rose": 249
};

const COMBO_PRICES = {
  "Pick Any 2 Combo": { price: 349, count: 2 },
  "Pick Any 4 Combo": { price: 599, count: 4 }
};

function clean(value, maxLength = 100) {
  return String(value || "")
    .trim()
    .replace(/[<>\u0000-\u001F]/g, "")
    .slice(0, maxLength);
}

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      error: "Method not allowed."
    });
  }

  const appId = process.env.CASHFREE_APP_ID;
  const secretKey = process.env.CASHFREE_SECRET_KEY;

  if (!appId || !secretKey) {
    return res.status(500).json({
      error: "Payment service is not configured."
    });
  }

  try {
    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body || {};

    // CUSTOMER DETAILS
    const customerName = clean(body.customerName, 100);
    const customerEmail = clean(body.customerEmail, 150);
    const customerPhone = clean(body.customerPhone, 10);

    // DELIVERY ADDRESS
    const address = body.address || {};

    const address1 = clean(address.line1, 100);
    const address2 = clean(address.line2, 100);
    const landmark = clean(address.landmark, 80);
    const city = clean(address.city, 60);
    const state = clean(address.state, 60);
    const pincode = clean(address.pincode, 6);

    if (
      !customerName ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail) ||
      !/^[6-9]\d{9}$/.test(customerPhone)
    ) {
      return res.status(400).json({
        error:
          "Please enter a valid name, email and 10-digit Indian mobile number."
      });
    }

    if (
      !address1 ||
      !address2 ||
      !city ||
      !state ||
      !/^\d{6}$/.test(pincode)
    ) {
      return res.status(400).json({
        error:
          "Please enter your complete delivery address and a valid 6-digit PIN code."
      });
    }

    // VALIDATE CART
    const items = Array.isArray(body.items) ? body.items : [];

    if (!items.length || items.length > 20) {
      return res.status(400).json({
        error: "Your cart is empty or contains too many items."
      });
    }

    let total = 0;
    const orderLines = [];
    const choicesForTags = [];

    for (const item of items) {
      const name = clean(item.name, 60);
      const qty = Number(item.qty);

      if (!Number.isInteger(qty) || qty < 1 || qty > 99) {
        return res.status(400).json({
          error: "Invalid product quantity."
        });
      }

      // INDIVIDUAL PERFUMES
      if (
        Object.prototype.hasOwnProperty.call(
          PRODUCT_PRICES,
          name
        )
      ) {
        total += PRODUCT_PRICES[name] * qty;
        orderLines.push(`${name} x${qty}`);
        continue;
      }

      // COMBO OFFERS
      if (
        Object.prototype.hasOwnProperty.call(
          COMBO_PRICES,
          name
        )
      ) {
        const combo = COMBO_PRICES[name];

        const choices = Array.isArray(item.choices)
          ? item.choices.map(x => clean(x, 60))
          : [];

        const uniqueChoices = [...new Set(choices)];

        if (
          uniqueChoices.length !== combo.count ||
          uniqueChoices.some(
            x =>
              !Object.prototype.hasOwnProperty.call(
                PRODUCT_PRICES,
                x
              )
          )
        ) {
          return res.status(400).json({
            error:
              `Please choose exactly ${combo.count} different fragrances for ${name}.`
          });
        }

        total += combo.price * qty;

        orderLines.push(
          `${name} (${uniqueChoices.join(", ")}) x${qty}`
        );

        choicesForTags.push(
          `${name}: ${uniqueChoices.join(", ")}`
        );

        continue;
      }

      return res.status(400).json({
        error:
          `We could not validate product "${name}". Please refresh your cart and try again.`
      });
    }

    if (
      !Number.isFinite(total) ||
      total < 1 ||
      total > 100000
    ) {
      return res.status(400).json({
        error: "Invalid order total."
      });
    }

    // CREATE UNIQUE ORDER ID
    const orderId =
      `pockfume_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 9)}`;

    const orderNote = orderLines.join("; ").slice(0, 240);

    // ADDRESS AND ITEM DETAILS
    const tags = {
      addr1: address1,
      addr2: address2,
      landmark: landmark || "Not provided",
      city: city,
      state: state,
      pincode: pincode,
      items: [...orderLines, ...choicesForTags]
        .join("; ")
        .slice(0, 250)
    };

    // CREATE CASHFREE LIVE PAYMENT ORDER
    const cashfreeResponse = await fetch(
      "https://api.cashfree.com/pg/orders",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "x-client-id": appId,
          "x-client-secret": secretKey,
          "x-api-version": "2025-01-01"
        },
        body: JSON.stringify({
          order_id: orderId,
          order_amount: Number(total.toFixed(2)),
          order_currency: "INR",

          customer_details: {
            customer_id: `pockfume_${customerPhone}`,
            customer_name: customerName,
            customer_email: customerEmail,
            customer_phone: customerPhone
          },

          order_meta: {
            return_url:
              "https://pockfume.com/payment-status.html?order_id={order_id}"
          },

          order_note: orderNote,
          order_tags: tags
        })
      }
    );

    const data = await cashfreeResponse
      .json()
      .catch(() => ({}));

    if (!cashfreeResponse.ok || !data.payment_session_id) {
      console.error(
        "Cashfree create-order error:",
        cashfreeResponse.status,
        data.type || data.code || "unknown"
      );

      return res.status(502).json({
        error:
          "Cashfree could not create the payment. Please try again."
      });
    }

    return res.status(200).json({
      orderId: data.order_id,
      paymentSessionId: data.payment_session_id,
      amount: total
    });

  } catch (error) {
    console.error(
      "POCKFUME create-order error:",
      error && error.message
        ? error.message
        : "unknown"
    );

    return res.status(500).json({
      error:
        "Something went wrong while preparing your payment. Please try again."
    });
  }
};
