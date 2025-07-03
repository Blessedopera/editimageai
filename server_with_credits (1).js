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
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
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
    fileSize: 10 * 1024 * 1024
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

    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      user_metadata: { full_name: fullName || '' },
      email_confirm: false
    });

    if (authError) {
      console.error('Signup error:', authError);
      return res.status(400).json({ error: authError.message });
    }

    const token = jwt.sign(
      { userId: authData.user.id, email: authData.user.email },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: false,
      maxAge: 24 * 60 * 60 * 1000
    });

    res.json({
      success: true,
      message: 'Account created successfully!',
      user: {
        id: authData.user.id,
        email: authData.user.email,
        fullName: fullName || ''
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

    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (authError) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', authData.user.id)
      .single();

    if (profileError) {
      console.error('Profile fetch error:', profileError);
    }

    const token = jwt.sign(
      { userId: authData.user.id, email: authData.user.email },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: false,
      maxAge: 24 * 60 * 60 * 1000
    });

    res.json({
      success: true,
      message: 'Login successful!',
      user: {
        id: authData.user.id,
        email: authData.user.email,
        fullName: profile?.full_name || '',
        credits: profile?.credits || 0
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

// Credit purchase routes
app.post('/api/credits/purchase', authenticateUser, async (req, res) => {
  try {
    const { package: creditPackage } = req.body;

    // Define credit packages
    const packages = {
      'starter': { credits: 25, price: 9.99, name: 'Starter Pack' },
      'professional': { credits: 100, price: 29.99, name: 'Professional Pack' },
      'business': { credits: 500, price: 99.99, name: 'Business Pack' }
    };

    if (!packages[creditPackage]) {
      return res.status(400).json({ error: 'Invalid credit package' });
    }

    const selectedPackage = packages[creditPackage];

    // In a real app, you would integrate with Stripe here
    // For now, we'll simulate a successful payment

    // Update user credits using the database function
    const { data, error } = await supabase.rpc('update_user_credits', {
      user_uuid: req.user.id,
      credit_change: selectedPackage.credits,
      transaction_type: 'purchase',
      description: `Purchased ${selectedPackage.name} - ${selectedPackage.credits} credits`
    });

    if (error || !data) {
      console.error('Credit update error:', error);
      return res.status(500).json({ error: 'Failed to update credits' });
    }

    // Update total credits purchased
    const { error: updateError } = await supabase
      .from('user_profiles')
      .update({ 
        total_credits_purchased: req.user.total_credits_purchased + selectedPackage.credits 
      })
      .eq('id', req.user.id);

    if (updateError) {
      console.error('Total credits update error:', updateError);
    }

    // Get updated user profile
    const { data: updatedProfile, error: profileError } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', req.user.id)
      .single();

    if (profileError) {
      console.error('Updated profile fetch error:', profileError);
    }

    res.json({
      success: true,
      message: `Successfully purchased ${selectedPackage.credits} credits!`,
      user: {
        credits: updatedProfile?.credits || req.user.credits + selectedPackage.credits,
        totalCreditsPurchased: updatedProfile?.total_credits_purchased || req.user.total_credits_purchased + selectedPackage.credits
      },
      transaction: {
        credits: selectedPackage.credits,
        package: selectedPackage.name,
        price: selectedPackage.price
      }
    });

  } catch (error) {
    console.error('Credit purchase error:', error);
    res.status(500).json({ error: 'Failed to purchase credits' });
  }
});

// Get credit packages
app.get('/api/credits/packages', (req, res) => {
  const packages = {
    'starter': { 
      id: 'starter',
      credits: 25, 
      price: 9.99, 
      name: 'Starter Pack',
      description: 'Perfect for trying out the service',
      popular: false
    },
    'professional': { 
      id: 'professional',
      credits: 100, 
      price: 29.99, 
      name: 'Professional Pack',
      description: 'Great for regular users',
      popular: true
    },
    'business': { 
      id: 'business',
      credits: 500, 
      price: 99.99, 
      name: 'Business Pack',
      description: 'Best value for teams',
      popular: false
    }
  };

  res.json({
    success: true,
    packages: Object.values(packages)
  });
});

// Get user transaction history
app.get('/api/user/transactions', authenticateUser, async (req, res) => {
  try {
    const { data: transactions, error } = await supabase
      .from('credit_transactions')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error('Transaction fetch error:', error);
      return res.status(500).json({ error: 'Failed to fetch transactions' });
    }

    res.json({
      success: true,
      transactions: transactions || []
    });

  } catch (error) {
    console.error('Transaction history error:', error);
    res.status(500).json({ error: 'Failed to fetch transaction history' });
  }
});

// Headshot generation with credit deduction
app.post('/generate-headshot', authenticateUser, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file uploaded' });
    }

    // Check if user has enough credits
    if (req.user.credits < 1) {
      return res.status(402).json({ 
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

    if (seed && seed.trim() !== '') {
      input.seed = parseInt(seed);
    }

    console.log('Sending request to Replicate...');

    // Run the model
    const output = await replicate.run("flux-kontext-apps/professional-headshot", { input });

    // Deduct credit from user
    const { data: creditUpdateResult, error: creditError } = await supabase.rpc('update_user_credits', {
      user_uuid: req.user.id,
      credit_change: -1,
      transaction_type: 'usage',
      description: 'Generated professional headshot'
    });

    if (creditError || !creditUpdateResult) {
      console.error('Credit deduction error:', creditError);
      // Still return the image but log the error
    }

    // Record the generation
    const { error: recordError } = await supabase
      .from('headshot_generations')
      .insert({
        user_id: req.user.id,
        image_url: output,
        parameters: { gender, background, aspectRatio, seed },
        credits_used: 1,
        status: 'completed'
      });

    if (recordError) {
      console.error('Generation record error:', recordError);
    }

    // Get updated user credits
    const { data: updatedProfile, error: profileError } = await supabase
      .from('user_profiles')
      .select('credits')
      .eq('id', req.user.id)
      .single();

    // Clean up uploaded file
    fs.unlinkSync(req.file.path);

    console.log('Headshot generated successfully');
    res.json({ 
      success: true, 
      imageUrl: output,
      message: 'Professional headshot generated successfully!',
      creditsRemaining: updatedProfile?.credits || req.user.credits - 1
    });

  } catch (error) {
    console.error('Error generating headshot:', error);

    // Clean up uploaded file if it exists
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
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
  console.log('Make sure to set your REPLICATE_API_TOKEN in the .env file');
});
