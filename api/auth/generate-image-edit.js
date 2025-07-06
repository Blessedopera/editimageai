import { createClient } from '@supabase/supabase-js';
import Replicate from 'replicate';
import jwt from 'jsonwebtoken';
import formidable from 'formidable';
import fs from 'fs';

export const config = {
  api: {
    bodyParser: false,
  },
};

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    // Parse form data
    const form = new formidable.IncomingForm();
    form.parse(req, async (err, fields, files) => {
      if (err) {
        return res.status(400).json({ error: 'Error parsing form data' });
      }
      // Auth
      const token = req.cookies?.auth_token || (req.headers.cookie || '').split('; ').find(row => row.startsWith('auth_token='))?.split('=')[1];
      if (!token) {
        return res.status(401).json({ error: 'No authentication token provided' });
      }
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      // Get user profile
      const { data: user, error: userError } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('id', decoded.userId)
        .single();
      if (userError || !user) {
        return res.status(401).json({ error: 'Invalid authentication token' });
      }
      if (user.credits < 1) {
        return res.status(400).json({ error: 'Insufficient credits', message: 'You need at least 1 credit to edit an image. Please purchase more credits.' });
      }
      // Get file
      const file = files.image;
      if (!file) {
        return res.status(400).json({ error: 'No image file uploaded' });
      }
      // Check for prompt
      if (!fields.prompt || fields.prompt.trim() === '') {
        return res.status(400).json({ error: 'Prompt is required for image editing' });
      }
      const imageBuffer = fs.readFileSync(file.filepath);
      const imageDataUri = `data:${file.mimetype};base64,${imageBuffer.toString('base64')}`;
      // Prepare input for the Flux Kontext Pro model
      const input = {
        prompt: fields.prompt.trim(),
        input_image: imageDataUri,
        output_format: fields.outputFormat || 'jpg'
      };
      // Run the model
      const output = await replicate.run('black-forest-labs/flux-kontext-pro', { input });
      // Deduct credit from user
      await supabase.rpc('update_user_credits', {
        user_uuid: user.id,
        credit_change: -1,
        transaction_type: 'usage',
        description: 'Generated image edit'
      });
      // Log the generation
      await supabase
        .from('image_edits')
        .insert({
          user_id: user.id,
          image_url: output,
          parameters: { prompt: fields.prompt, outputFormat: fields.outputFormat },
          credits_used: 1,
          status: 'completed'
        });
      res.status(200).json({
        success: true,
        imageUrl: output,
        message: 'Image edited successfully!',
        creditsRemaining: user.credits - 1
      });
    });
  } catch (error) {
    console.error('Error generating image edit:', error);
    res.status(500).json({ error: 'Failed to edit image', details: error.message });
  }
} 