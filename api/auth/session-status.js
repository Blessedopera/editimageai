import Stripe from 'stripe';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { session_id } = req.query;
  if (!session_id) return res.status(400).json({ error: 'Missing session_id' });
  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);
    res.status(200).json({
      status: session.status,
      customer_email: session.customer_details?.email,
      plan: session.metadata?.plan,
      credits: session.metadata?.credits,
      quantity: session.metadata?.quantity,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
} 