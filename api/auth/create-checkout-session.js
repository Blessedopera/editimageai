import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const PLANS = {
  starter: { priceId: 'price_1Rgk1nC5gE6T33JWRicQl74o', credits: 25 },
  popular: { priceId: 'price_1Rgk3HC5gE6T33JWYFZVxoxi', credits: 60 },
  professional: { priceId: 'price_1Rgk4bC5gE6T33JW48SDYiOb', credits: 150 },
  business: { priceId: 'price_1Rgk65C5gE6T33JW65ZYnuu5', credits: 300 },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { plan, quantity = 1, email } = req.body;
  if (!PLANS[plan] || !quantity || quantity < 1) {
    return res.status(400).json({ error: 'Invalid plan or quantity' });
  }
  try {
    const session = await stripe.checkout.sessions.create({
      ui_mode: 'embedded',
      line_items: [
        {
          price: PLANS[plan].priceId,
          quantity,
        },
      ],
      mode: 'payment',
      return_url: `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/return.html?session_id={CHECKOUT_SESSION_ID}`,
      customer_email: email || undefined,
      metadata: {
        plan,
        credits: PLANS[plan].credits,
        quantity,
      },
    });
    res.status(200).json({ clientSecret: session.client_secret });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
} 