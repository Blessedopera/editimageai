import express from 'express';
import multer from 'multer';
import Replicate from 'replicate';
import dotenv from 'dotenv';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import Stripe from 'stripe';

dotenv.config();

// Validate required environment variables
const requiredEnvVars = [
  'REPLICATE_API_TOKEN',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_KEY',
  'SUPABASE_ANON_KEY',
  'JWT_SECRET'
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
  console.error('❌ Missing required environment variables:', missingVars.join(', '));
  console.error('Please set these variables in your Vercel dashboard or .env file');
  process.exit(1);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

// Initialize Replicate
const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Initialize Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const PLANS = {
  starter: { priceId: 'price_1Rgk1nC5gE6T33JWRicQl74o', credits: 25 },
  popular: { priceId: 'price_1Rgk3HC5gE6T33JWYFZVxoxi', credits: 60 },
  professional: { priceId: 'price_1Rgk4bC5gE6T33JW48SDYiOb', credits: 150 },
  business: { priceId: 'price_1Rgk65C5gE6T33JW65ZYnuu5', credits: 300 },
};

// Add anon key client for Auth
const supabaseAnon = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Middleware
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://editimageai.vercel.app', 'https://editimageai-git-main-blessedopera.vercel.app']
    : true,
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback-secret-for-development',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production', 
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));
app.use(express.static('public'));

// Configure multer for file uploads
console.log("Multer storage config:", multer.memoryStorage ? "memoryStorage" : "diskStorage");
const upload = multer({ 
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, WebP, and GIF are allowed.'));
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// Authentication middleware
const authenticateUser = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies.auth_token;

    if (!token) {
    return res.status(401).json({ error: 'No authentication token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-jwt-secret-for-development');

    // Get user from Supabase
    const { data: user, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('id', decoded.userId)
    .single();

    if (error || !user) {
    return res.status(401).json({ error: 'Invalid authentication token' });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(401).json({ error: 'Invalid authentication token' });
  }
};

// Routes

// Serve main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Authentication routes
app.post('/api/auth/signup', async (req, res) => {
  try {
    console.log('Signup attempt:', { email: req.body.email, hasPassword: !!req.body.password });
    
    const { email, password, fullName } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Create user in Supabase Auth (regular signup, not admin, use anon client)
    console.log('Attempting Supabase signup...');
    const { data: authData, error: authError } = await supabaseAnon.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName || '' }
      }
    });

    if (authError) {
      console.error('Supabase signup error:', authError);
      return res.status(400).json({ error: authError.message });
    }
    
    console.log('Supabase signup successful:', authData.user?.id);

    // Force email verification using admin API
    if (authData.user && !authData.user.email_confirmed_at) {
      const { error: confirmError } = await supabase.auth.admin.updateUserById(authData.user.id, { email_confirm: true });
      if (confirmError) {
        console.error('Email confirm error:', confirmError);
        // Not fatal, continue
      }
    }

    // Wait for user_profiles row to exist (handle Supabase trigger timing)
    let profile = null;
    let tries = 0;
    const maxTries = 7;
    const delay = ms => new Promise(res => setTimeout(res, ms));
    while (tries < maxTries) {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('id', authData.user.id)
        .single();
      if (data && !error) {
        profile = data;
        break;
      }
      await delay(300); // wait 300ms before retry
      tries++;
    }

    // If profile still not found, insert it manually
    if (!profile) {
      const { error: insertError } = await supabase
        .from('user_profiles')
        .insert({
          id: authData.user.id,
          email: authData.user.email,
          full_name: fullName || '',
          credits: 10,
          total_credits_purchased: 0
        });
      if (insertError) {
        console.error('Manual profile insert error:', insertError);
        return res.status(500).json({ error: 'Failed to create user profile. Please try again.' });
      }
      // Fetch the newly inserted profile
      const { data: newProfile, error: fetchError } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('id', authData.user.id)
        .single();
      if (newProfile && !fetchError) {
        profile = newProfile;
      } else {
        return res.status(500).json({ error: 'Failed to create user profile. Please try again.' });
      }
    }

    // Create JWT token
    const token = jwt.sign(
      { userId: authData.user.id, email: authData.user.email },
      process.env.JWT_SECRET || 'fallback-jwt-secret-for-development',
      { expiresIn: '24h' }
    );

    // Set cookie
    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: false, // Set to true in production with HTTPS
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });

    res.json({
      success: true,
      message: 'Account created successfully!',
      user: {
        id: profile.id,
        email: profile.email,
        fullName: profile.full_name,
        credits: profile.credits,
        totalCreditsPurchased: profile.total_credits_purchased,
        createdAt: profile.created_at
      },
      token
    });

  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ 
      error: 'Failed to create account',
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Sign in with Supabase Auth (use anon client)
    const { data: authData, error: authError } = await supabaseAnon.auth.signInWithPassword({
      email,
      password
    });

    if (authError) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Get user profile
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', authData.user.id)
      .single();

    if (profileError) {
      console.error('Profile fetch error:', profileError);
    }

    // Create JWT token
    const token = jwt.sign(
      { userId: authData.user.id, email: authData.user.email },
      process.env.JWT_SECRET || 'fallback-jwt-secret-for-development',
      { expiresIn: '24h' }
    );

    // Set cookie
    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: false, // Set to true in production with HTTPS
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });

    res.json({
      success: true,
      message: 'Login successful!',
      user: {
        id: authData.user.id,
        email: authData.user.email,
        fullName: profile?.full_name || '',
        credits: profile?.credits || 0,
      },
      token
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Failed to login' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('auth_token');
  res.json({ success: true, message: 'Logged out successfully' });
});

// User profile routes
app.get('/api/auth/profile', authenticateUser, async (req, res) => {
  try {
    const { data: profile, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('id', req.user.id)
    .single();

    if (error) {
    return res.status(500).json({ error: 'Failed to fetch profile' });
    }

    res.json({
    success: true,
    user: {
    id: profile.id,
    email: profile.email,
    fullName: profile.full_name,
    credits: profile.credits,
    totalCreditsPurchased: profile.total_credits_purchased,
    createdAt: profile.created_at
    }
    });
  } catch (error) {
    console.error('Profile fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// Credit management routes - Direct purchase (no Stripe)
app.post('/api/auth/purchase', authenticateUser, async (req, res) => {
  try {
    const { amount, plan } = req.body;

    if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'Invalid credit amount' });
    }

    // Update user credits using the database function
    const { data, error } = await supabase.rpc('update_user_credits', {
    user_uuid: req.user.id,
    credit_change: amount,
    transaction_type: 'purchase',
    description: `Purchased ${amount} credits - ${plan} plan (TEST MODE)`
    });

    if (error || !data) {
    console.error('Credit purchase error:', error);
    return res.status(500).json({ error: 'Failed to purchase credits' });
    }

    // Update total credits purchased
    await supabase
    .from('user_profiles')
    .update({ 
    total_credits_purchased: req.user.total_credits_purchased + amount 
    })
    .eq('id', req.user.id);

    // Get updated user profile
    const { data: updatedUser, error: userError } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('id', req.user.id)
    .single();

    if (userError) {
    console.error('User fetch error:', userError);
    }

    res.json({
    success: true,
    message: `Successfully purchased ${amount} credits! (TEST MODE - No payment required)`,
    newBalance: updatedUser?.credits || req.user.credits + amount,
    user: updatedUser
    });

  } catch (error) {
    console.error('Credit purchase error:', error);
    res.status(500).json({ error: 'Failed to purchase credits' });
  }
});

app.get('/api/auth/history', authenticateUser, async (req, res) => {
  try {
    const { data: edits, error } = await supabase
    .from('image_edits')
    .select('*')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false })
    .limit(20);

    if (error) {
    return res.status(500).json({ error: 'Failed to fetch history' });
    }

    res.json({
    success: true,
    history: edits
    });
  } catch (error) {
    console.error('History fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

// Stripe checkout session route
app.post('/api/auth/create-checkout-session', async (req, res) => {
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
    console.error('Stripe checkout error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Stripe webhook route
app.post('/api/auth/stripe-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
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
          
        console.log(`Credits updated for user ${email}: +${credits * quantity}`);
      } catch (err) {
        console.error('Failed to update credits:', err.message);
      }
    }
  }
  
  res.status(200).end();
});

// Stripe session status route
app.get('/api/auth/session-status', async (req, res) => {
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
    console.error('Session status error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Image editing generation route (protected)
app.post('/api/auth/generate-image-edit', authenticateUser, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
    return res.status(400).json({ error: 'No image file uploaded' });
    }

    // Check if user has enough credits
    if (req.user.credits < 1) {
    return res.status(400).json({ 
    error: 'Insufficient credits', 
    message: 'You need at least 1 credit to edit an image. Please purchase more credits.' 
    });
    }

    const { prompt, outputFormat = 'jpg' } = req.body;

    if (!prompt || prompt.trim() === '') {
    return res.status(400).json({ error: 'Prompt is required for image editing' });
    }

    console.log('Processing image editing for user:', req.user.email);
    console.log('File:', req.file.originalname);
    console.log('Parameters:', { prompt, outputFormat });

    // Convert uploaded file to data URI (from memory buffer)
    const imageDataUri = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;

    // Prepare input for the Flux Kontext Pro model
    const input = {
    prompt: prompt.trim(),
    input_image: imageDataUri,
    output_format: outputFormat
    };

    console.log('Sending request to Replicate...');

    // Run the Flux Kontext Pro model
    const output = await replicate.run("black-forest-labs/flux-kontext-pro", { input });

    // Deduct credit from user
    const { data: creditUpdate, error: creditError } = await supabase.rpc('update_user_credits', {
    user_uuid: req.user.id,
    credit_change: -1,
    transaction_type: 'usage',
    description: 'Generated image edit'
    });

    if (creditError) {
    console.error('Credit deduction error:', creditError);
    }

    // Log the generation
    await supabase
    .from('image_edits')
    .insert({
    user_id: req.user.id,
    image_url: output,
    parameters: { prompt, outputFormat },
    credits_used: 1,
    status: 'completed'
    });

    console.log('Image edit generated successfully');
    res.json({ 
    success: true, 
    imageUrl: output,
    message: 'Image edited successfully!',
    creditsRemaining: req.user.credits - 1
    });

  } catch (error) {
    console.error('Error generating image edit:', error);

    // Log failed generation
    if (req.user) {
    await supabase
    .from('image_edits')
    .insert({
    user_id: req.user.id,
    parameters: req.body,
    credits_used: 0,
    status: 'failed'
    });
    }

    res.status(500).json({ 
    error: 'Failed to edit image', 
    details: error.message 
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  const envStatus = {
    REPLICATE_API_TOKEN: !!process.env.REPLICATE_API_TOKEN,
    SUPABASE_URL: !!process.env.SUPABASE_URL,
    SUPABASE_SERVICE_KEY: !!process.env.SUPABASE_SERVICE_KEY,
    SUPABASE_ANON_KEY: !!process.env.SUPABASE_ANON_KEY,
    JWT_SECRET: !!process.env.JWT_SECRET,
    SESSION_SECRET: !!process.env.SESSION_SECRET,
    NODE_ENV: process.env.NODE_ENV
  };
  
  res.json({ 
    status: 'OK', 
    message: 'AI Image Editor API is running',
    environment: envStatus,
    timestamp: new Date().toISOString()
  });
});

// Test endpoint for debugging
app.get('/test', async (req, res) => {
  try {
    // Test Supabase connection
    const { data, error } = await supabase.from('user_profiles').select('count').limit(1);
    
    res.json({
      message: 'Test endpoint working',
      supabase: error ? { error: error.message } : { connected: true, data },
      env: {
        hasSupabaseUrl: !!process.env.SUPABASE_URL,
        hasSupabaseKey: !!process.env.SUPABASE_SERVICE_KEY,
        hasAnonKey: !!process.env.SUPABASE_ANON_KEY
      }
    });
  } catch (err) {
    res.status(500).json({
      error: 'Test failed',
      message: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
});

app.listen(port, () => {
  console.log(`AI Image Editor App running at http://localhost:${port}`);
  console.log('Make sure to set your REPLICATE_API_TOKEN and Supabase credentials in the .env file');
  console.log("NODE_ENV:", process.env.NODE_ENV);
  console.log("Running on Vercel:", !!process.env.VERCEL);
});
/ /   r a n d o m   c h a n g e   t o   t r i g g e r   r e d e p l o y  
 