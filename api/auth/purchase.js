import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const token = req.cookies?.auth_token || (req.headers.cookie || '').split('; ').find(row => row.startsWith('auth_token='))?.split('=')[1];
    if (!token) {
      return res.status(401).json({ error: 'No authentication token provided' });
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const { amount, plan } = req.body;
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid credit amount' });
    }
    const { data, error } = await supabase.rpc('update_user_credits', {
      user_uuid: decoded.userId,
      credit_change: amount,
      transaction_type: 'purchase',
      description: `Purchased ${amount} credits - ${plan} plan`
    });
    if (error || !data) {
      return res.status(500).json({ error: 'Failed to purchase credits' });
    }
    await supabase
      .from('user_profiles')
      .update({
        total_credits_purchased: data.total_credits_purchased
      })
      .eq('id', decoded.userId);
    res.status(200).json({
      success: true,
      message: `Successfully purchased ${amount} credits!`,
      newBalance: data.credits
    });
  } catch (error) {
    console.error('Credit purchase error:', error);
    res.status(500).json({ error: 'Failed to purchase credits' });
  }
} 