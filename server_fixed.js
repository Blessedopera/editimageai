import express from 'express';
import multer from 'multer';
import Replicate from 'replicate';
import dotenv from 'dotenv';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

// Initialize Replicate
const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

// Middleware
app.use(cors());
app.use(express.json());
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

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/generate-headshot', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file uploaded' });
    }

    const { gender = 'none', background = 'neutral', aspectRatio = '1:1', seed } = req.body;

    console.log('Processing headshot generation...');
    console.log('File:', req.file.filename);
    console.log('Parameters:', { gender, background, aspectRatio, seed });

    // Convert uploaded file to data URI
    const imageBuffer = fs.readFileSync(req.file.path);
    const imageDataUri = `data:${req.file.mimetype};base64,${imageBuffer.toString('base64')}`;

    // Prepare input for the model - FIXED: using correct parameter names
    const input = {
      input_image: imageDataUri,  // Changed from 'image' to 'input_image'
      gender: gender,
      background: background,
      aspect_ratio: aspectRatio
    };

    // Add seed if provided
    if (seed && seed.trim() !== '') {
      input.seed = parseInt(seed);
    }

    console.log('Sending request to Replicate with input keys:', Object.keys(input));

    // Run the model
    const output = await replicate.run("flux-kontext-apps/professional-headshot", { input });

    // Clean up uploaded file
    fs.unlinkSync(req.file.path);

    console.log('Headshot generated successfully');
    res.json({ 
      success: true, 
      imageUrl: output,
      message: 'Professional headshot generated successfully!'
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
