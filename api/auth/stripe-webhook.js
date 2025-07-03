import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  let event;
  try {
    const sig = req.headers['stripe-signature'];
    const buf = await new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => { data += chunk; });
      req.on('end', () => resolve(Buffer.from(data)));
      req.on('error', reject);
    });
    event = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed.', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const email = session.customer_details?.email;
    const plan = session.metadata?.plan;
    const credits = parseInt(session.metadata?.credits || '0', 10);
    const quantity = parseInt(session.metadata?.quantity || '1', 10);
    if (email && credits && quantity) {
      try {
        const { data: user, error } = await supabase
          .from('user_profiles')
          .select('id, credits')
          .eq('email', email)
          .single();
        if (!user) throw new Error('User not found');
        const newCredits = (user.credits || 0) + credits * quantity;
        await supabase
          .from('user_profiles')
          .update({ credits: newCredits })
          .eq('id', user.id);
      } catch (err) {
        console.error('Failed to update credits:', err.message);
      }
    }
  }
  res.status(200).end();
} 