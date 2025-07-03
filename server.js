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

dotenv.config();

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

// Add anon key client for Auth
const supabaseAnon = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Middleware
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));
app.use(express.static('public'));

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/';
    if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ 
  storage: storage,
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

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

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
app.post('/auth/signup', async (req, res) => {
  try {
    const { email, password, fullName } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Create user in Supabase Auth (regular signup, not admin, use anon client)
    const { data: authData, error: authError } = await supabaseAnon.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName || '' }
      }
    });

    if (authError) {
      console.error('Signup error:', authError);
      return res.status(400).json({ error: authError.message });
    }

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
      process.env.JWT_SECRET,
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
    res.status(500).json({ error: 'Failed to create account' });
  }
});

app.post('/auth/login', async (req, res) => {
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
      process.env.JWT_SECRET,
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

app.post('/auth/logout', (req, res) => {
  res.clearCookie('auth_token');
  res.json({ success: true, message: 'Logged out successfully' });
});

// User profile routes
app.get('/api/user/profile', authenticateUser, async (req, res) => {
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

// Credit management routes
app.post('/api/credits/purchase', authenticateUser, async (req, res) => {
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
    description: `Purchased ${amount} credits - ${plan} plan`
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

    res.json({
    success: true,
    message: `Successfully purchased ${amount} credits!`,
    newBalance: req.user.credits + amount
    });

  } catch (error) {
    console.error('Credit purchase error:', error);
    res.status(500).json({ error: 'Failed to purchase credits' });
  }
});

app.get('/api/user/history', authenticateUser, async (req, res) => {
  try {
    const { data: generations, error } = await supabase
    .from('headshot_generations')
    .select('*')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false })
    .limit(20);

    if (error) {
    return res.status(500).json({ error: 'Failed to fetch history' });
    }

    res.json({
    success: true,
    history: generations
    });
  } catch (error) {
    console.error('History fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

// Headshot generation route (protected)
app.post('/generate-headshot', authenticateUser, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
    return res.status(400).json({ error: 'No image file uploaded' });
    }

    // Check if user has enough credits
    if (req.user.credits < 1) {
    // Clean up uploaded file
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ 
    error: 'Insufficient credits', 
    message: 'You need at least 1 credit to generate a headshot. Please purchase more credits.' 
    });
    }

    const { gender = 'none', background = 'neutral', aspectRatio = '1:1', seed } = req.body;

    console.log('Processing headshot generation for user:', req.user.email);
    console.log('File:', req.file.filename);
    console.log('Parameters:', { gender, background, aspectRatio, seed });

    // Convert uploaded file to data URI
    const imageBuffer = fs.readFileSync(req.file.path);
    const imageDataUri = `data:${req.file.mimetype};base64,${imageBuffer.toString('base64')}`;

    // Prepare input for the model
    const input = {
    input_image: imageDataUri,
    gender: gender,
    background: background,
    aspect_ratio: aspectRatio
    };

    // Add seed if provided
    if (seed && seed.trim() !== '') {
    input.seed = parseInt(seed);
    }

    console.log('Sending request to Replicate...');

    // Run the model
    const output = await replicate.run("flux-kontext-apps/professional-headshot", { input });

    // Deduct credit from user
    const { data: creditUpdate, error: creditError } = await supabase.rpc('update_user_credits', {
    user_uuid: req.user.id,
    credit_change: -1,
    transaction_type: 'usage',
    description: 'Generated professional headshot'
    });

    if (creditError) {
    console.error('Credit deduction error:', creditError);
    }

    // Log the generation
    await supabase
    .from('headshot_generations')
    .insert({
    user_id: req.user.id,
    image_url: output,
    parameters: { gender, background, aspectRatio, seed },
    credits_used: 1,
    status: 'completed'
    });

    // Clean up uploaded file
    fs.unlinkSync(req.file.path);

    console.log('Headshot generated successfully');
    res.json({ 
    success: true, 
    imageUrl: output,
    message: 'Professional headshot generated successfully!',
    creditsRemaining: req.user.credits - 1
    });

  } catch (error) {
    console.error('Error generating headshot:', error);

    // Clean up uploaded file if it exists
    if (req.file && fs.existsSync(req.file.path)) {
    fs.unlinkSync(req.file.path);
    }

    // Log failed generation
    if (req.user) {
    await supabase
    .from('headshot_generations')
    .insert({
    user_id: req.user.id,
    parameters: req.body,
    credits_used: 0,
    status: 'failed'
    });
    }

    res.status(500).json({ 
    error: 'Failed to generate headshot', 
    details: error.message 
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'Professional Headshot API is running' });
});

app.listen(port, () => {
  console.log(`Professional Headshot App running at http://localhost:${port}`);
  console.log('Make sure to set your REPLICATE_API_TOKEN and Supabase credentials in the .env file');
});
