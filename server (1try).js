import express from 'express';
import multer from 'multer';
import Replicate from 'replicate';
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

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
    process.env.SUPABASE_ANON_KEY
);

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Configure multer for file uploads
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
    },
});

// JWT middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid token' });
        }
        req.user = user;
        next();
    });
};

// Auth Routes
app.post('/api/signup', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }

        // Check if user already exists
        const { data: existingUser } = await supabase
            .from('profiles')
            .select('id')
            .eq('email', email)
            .single();

        if (existingUser) {
            return res.status(400).json({ error: 'User already exists' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create user profile
        const { data: profile, error } = await supabase
            .from('profiles')
            .insert([
                {
                    email,
                    password_hash: hashedPassword,
                    credits: 5 // Give 5 free credits to new users
                }
            ])
            .select()
            .single();

        if (error) {
            console.error('Signup error:', error);
            return res.status(500).json({ error: 'Failed to create user' });
        }

        // Generate JWT token
        const token = jwt.sign(
            { userId: profile.id, email: profile.email },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            message: 'User created successfully',
            token,
            user: {
                id: profile.id,
                email: profile.email,
                credits: profile.credits
            }
        });

    } catch (error) {
        console.error('Signup error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }

        // Get user from database
        const { data: profile, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('email', email)
            .single();

        if (error || !profile) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Verify password
        const validPassword = await bcrypt.compare(password, profile.password_hash);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Generate JWT token
        const token = jwt.sign(
            { userId: profile.id, email: profile.email },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            message: 'Login successful',
            token,
            user: {
                id: profile.id,
                email: profile.email,
                credits: profile.credits
            }
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Profile Routes
app.get('/api/profile', authenticateToken, async (req, res) => {
    try {
        const { data: profile, error } = await supabase
            .from('profiles')
            .select('id, email, credits, created_at')
            .eq('id', req.user.userId)
            .single();

        if (error) {
            return res.status(404).json({ error: 'Profile not found' });
        }

        res.json(profile);
    } catch (error) {
        console.error('Profile fetch error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Credit Routes
app.get('/api/credit-packages', async (req, res) => {
    try {
        const { data: packages, error } = await supabase
            .from('credit_packages')
            .select('*')
            .order('price', { ascending: true });

        if (error) {
            console.error('Error fetching credit packages:', error);
            return res.status(500).json({ error: 'Failed to fetch credit packages' });
        }

        res.json(packages);
    } catch (error) {
        console.error('Credit packages error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/purchase-credits', authenticateToken, async (req, res) => {
    try {
        const { packageId } = req.body;

        if (!packageId) {
            return res.status(400).json({ error: 'Package ID required' });
        }

        // Get package details
        const { data: packageData, error: packageError } = await supabase
            .from('credit_packages')
            .select('*')
            .eq('id', packageId)
            .single();

        if (packageError || !packageData) {
            return res.status(404).json({ error: 'Package not found' });
        }

        // Simulate payment processing (replace with real Stripe integration later)
        const paymentSuccessful = true; // Mock payment success

        if (!paymentSuccessful) {
            return res.status(400).json({ error: 'Payment failed' });
        }

        // Update user credits
        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('credits')
            .eq('id', req.user.userId)
            .single();

        if (profileError) {
            return res.status(404).json({ error: 'User not found' });
        }

        const newCredits = profile.credits + packageData.credits;

        const { error: updateError } = await supabase
            .from('profiles')
            .update({ credits: newCredits })
            .eq('id', req.user.userId);

        if (updateError) {
            console.error('Error updating credits:', updateError);
            return res.status(500).json({ error: 'Failed to update credits' });
        }

        // Record transaction
        const { error: transactionError } = await supabase
            .from('credit_transactions')
            .insert([
                {
                    user_id: req.user.userId,
                    type: 'purchase',
                    credits: packageData.credits,
                    amount: packageData.price,
                    description: `Purchased ${packageData.name}`
                }
            ]);

        if (transactionError) {
            console.error('Error recording transaction:', transactionError);
        }

        res.json({
            message: 'Credits purchased successfully',
            credits: newCredits,
            purchased: packageData.credits
        });

    } catch (error) {
        console.error('Purchase credits error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/transactions', authenticateToken, async (req, res) => {
    try {
        const { data: transactions, error } = await supabase
            .from('credit_transactions')
            .select('*')
            .eq('user_id', req.user.userId)
            .order('created_at', { ascending: false })
            .limit(50);

        if (error) {
            console.error('Error fetching transactions:', error);
            return res.status(500).json({ error: 'Failed to fetch transactions' });
        }

        res.json(transactions);
    } catch (error) {
        console.error('Transactions error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Headshot generation endpoint
app.post('/api/generate-headshot', authenticateToken, upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No image file provided' });
        }

        // Check if user has enough credits
        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('credits')
            .eq('id', req.user.userId)
            .single();

        if (profileError || !profile) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (profile.credits < 1) {
            return res.status(400).json({ error: 'Insufficient credits' });
        }

        // Convert buffer to base64
        const base64Image = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;

        console.log('Starting headshot generation...');

        // Generate headshot using Replicate
        const output = await replicate.run(
            "flux-kontext-apps/professional-headshot:b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8",
            {
                input: {
                    input_image: base64Image,
                    style: req.body.style || "professional",
                    background: req.body.background || "office",
                    lighting: req.body.lighting || "natural"
                }
            }
        );

        console.log('Headshot generation completed:', output);

        // Deduct credit from user
        const newCredits = profile.credits - 1;
        const { error: updateError } = await supabase
            .from('profiles')
            .update({ credits: newCredits })
            .eq('id', req.user.userId);

        if (updateError) {
            console.error('Error updating credits:', updateError);
        }

        // Record transaction
        const { error: transactionError } = await supabase
            .from('credit_transactions')
            .insert([
                {
                    user_id: req.user.userId,
                    type: 'usage',
                    credits: -1,
                    description: 'Generated professional headshot'
                }
            ]);

        if (transactionError) {
            console.error('Error recording transaction:', transactionError);
        }

        res.json({
            success: true,
            output: output,
            creditsRemaining: newCredits
        });

    } catch (error) {
        console.error('Error generating headshot:', error);
        res.status(500).json({
            error: 'Failed to generate headshot',
            details: error.message
        });
    }
});

// Serve the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});