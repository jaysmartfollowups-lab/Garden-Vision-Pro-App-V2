import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3002;

  app.use(express.json({ limit: '50mb' }));

  // API Routes
  
  // Geocoding Proxy
  app.get("/api/google/geocode", async (req, res) => {
    const { address } = req.query;
    const apiKey = process.env.GOOGLE_MAPS_PLATFORM_KEY;
    if (!apiKey) return res.status(500).json({ error: "Maps API Key not configured" });
    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address as string)}&key=${apiKey}`;
      const response = await fetch(url);
      const data = await response.json();
      if (data.results?.[0]?.geometry?.location) {
        res.json(data.results[0].geometry.location); // { lat, lng }
      } else {
        res.status(404).json({ error: "Address not found" });
      }
    } catch (error) {
      res.status(500).json({ error: "Geocoding failed" });
    }
  });

  // Solar API Proxy
  app.get("/api/google/solar", async (req, res) => {
    const { lat, lng } = req.query;
    const apiKey = process.env.GOOGLE_MAPS_PLATFORM_KEY;

    if (!apiKey) {
      return res.status(500).json({ error: "Google Maps API Key not configured on server" });
    }

    try {
      // Fetch building insights (closest to coordinates)
      const url = `https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=${lat}&location.longitude=${lng}&key=${apiKey}`;
      const response = await fetch(url);
      const data = await response.json();
      res.json(data);
    } catch (error) {
      console.error("Solar API Error:", error);
      res.status(500).json({ error: "Failed to fetch solar data" });
    }
  });

  // Aerial View API Proxy
  app.get("/api/google/aerial-view", async (req, res) => {
    const { address } = req.query;
    const apiKey = process.env.GOOGLE_MAPS_PLATFORM_KEY;

    if (!apiKey) {
      return res.status(500).json({ error: "Google Maps API Key not configured on server" });
    }

    try {
      // First, check if video exists or needs to be rendered
      const url = `https://aerialview.googleapis.com/v1/videos:renderVideo?address=${encodeURIComponent(address as string)}&key=${apiKey}`;
      const response = await fetch(url, { method: 'POST' });
      const data = await response.json();
      res.json(data);
    } catch (error) {
      console.error("Aerial View API Error:", error);
      res.status(500).json({ error: "Failed to fetch aerial view" });
    }
  });

  // SAM 2 Auto-segmentation Proxy (fal.ai — Grounded SAM 2)
  app.post("/api/segment", async (req, res) => {
    const { imageBase64 } = req.body;
    const falKey = process.env.FAL_KEY;

    if (!falKey || falKey === 'your_fal_key_here') {
      return res.status(503).json({ error: "FAL_KEY not configured — add your fal.ai key to .env" });
    }

    try {
      const response = await fetch("https://fal.run/fal-ai/grounded-sam-2", {
        method: "POST",
        headers: {
          "Authorization": `Key ${falKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          image_url: imageBase64,
          text_prompt: "house. building. brick wall. fence. sky. roof. window. door. pathway. driveway. car. shed. wall."
        })
      });
      const data = await response.json();
      res.json(data);
    } catch (error) {
      console.error("SAM 2 Error:", error);
      res.status(500).json({ error: "Segmentation failed" });
    }
  });

  // ─── FLUX Inpainting Proxy (fal.ai — True pixel-level mask inpainting) ───
  // This uses a dedicated inpainting model that architecturally understands masks.
  // Unlike Gemini (which regenerates the entire image), FLUX Fill ONLY modifies
  // pixels in the masked (white) region and preserves everything else exactly.
  app.post("/api/inpaint", async (req, res) => {
    const { imageBase64, maskBase64, prompt } = req.body;
    const falKey = process.env.FAL_KEY;

    if (!falKey || falKey === 'your_fal_key_here') {
      return res.status(503).json({ error: "FAL_KEY not configured — add your fal.ai key to .env for mask editing" });
    }

    if (!imageBase64 || !maskBase64 || !prompt) {
      return res.status(400).json({ error: "imageBase64, maskBase64, and prompt are required" });
    }

    // Helper: Upload a base64 data URI to fal.ai storage and get a CDN URL back.
    // This avoids 413 errors from sending huge base64 payloads in the API call.
    async function uploadToFalStorage(base64DataUri: string, filename: string): Promise<string> {
      // Strip the data URI prefix to get raw base64
      const base64Data = base64DataUri.includes(',') ? base64DataUri.split(',')[1] : base64DataUri;
      const mimeMatch = base64DataUri.match(/data:([^;]+);/);
      const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
      
      // Convert base64 to Buffer
      const buffer = Buffer.from(base64Data, 'base64');

      // Upload to fal.ai storage
      const uploadResponse = await fetch(`https://fal.ai/api/storage/upload/${filename}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Key ${falKey}`,
          'Content-Type': mimeType,
        },
        body: buffer,
      });

      if (!uploadResponse.ok) {
        // Try the REST API endpoint as fallback
        const restResponse = await fetch('https://rest.alpha.fal.ai/storage/upload', {
          method: 'POST',
          headers: {
            'Authorization': `Key ${falKey}`,
            'Content-Type': mimeType,
            'X-Fal-File-Name': filename,
          },
          body: buffer,
        });

        if (!restResponse.ok) {
          throw new Error(`Failed to upload ${filename} to fal.ai storage (${restResponse.status})`);
        }

        const restData = await restResponse.json();
        return restData.url || restData.file_url;
      }

      const data = await uploadResponse.json();
      return data.url || data.file_url;
    }

    try {
      console.log("🎨 Starting FLUX inpainting with mask...");
      console.log("📤 Uploading images to fal.ai storage...");

      // Upload both images to fal.ai CDN (parallel for speed)
      const [imageUrl, maskUrl] = await Promise.all([
        uploadToFalStorage(imageBase64, 'garden-image.png'),
        uploadToFalStorage(maskBase64, 'garden-mask.png'),
      ]);

      console.log("✅ Images uploaded. Calling FLUX Pro Fill...");

      // Now call the inpainting API with lightweight CDN URLs (not base64)
      const response = await fetch("https://fal.run/fal-ai/flux-pro/v1/fill", {
        method: "POST",
        headers: {
          "Authorization": `Key ${falKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          prompt: prompt,
          image_url: imageUrl,
          mask_url: maskUrl,
          num_images: 1,
          output_format: "png",
          sync_mode: true,
          safety_tolerance: "5"
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error("FLUX Fill API Error:", response.status, errorData);
        
        // Fallback to flux-general/inpainting if Pro isn't available
        console.log("⚠️ Pro Fill unavailable, trying flux-general/inpainting...");
        const fallbackResponse = await fetch("https://fal.run/fal-ai/flux-general/inpainting", {
          method: "POST",
          headers: {
            "Authorization": `Key ${falKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            prompt: prompt,
            image_url: imageUrl,
            mask_url: maskUrl,
            num_images: 1,
            output_format: "png",
            sync_mode: true,
            num_inference_steps: 28,
            guidance_scale: 3.5
          })
        });

        if (!fallbackResponse.ok) {
          const fbError = await fallbackResponse.json().catch(() => ({}));
          throw new Error(`Inpainting failed: ${JSON.stringify(fbError)}`);
        }

        const fallbackData = await fallbackResponse.json();
        console.log("✅ FLUX General inpainting completed successfully");
        return res.json(fallbackData);
      }

      const data = await response.json();
      console.log("✅ FLUX Pro Fill inpainting completed successfully");
      res.json(data);
    } catch (error: any) {
      console.error("Inpainting Error:", error);
      res.status(500).json({ error: error.message || "Inpainting failed" });
    }
  });

  // Open-Meteo Weather Proxy (free, no API key required)
  app.get("/api/weather", async (req, res) => {
    const { lat, lng } = req.query;
    if (!lat || !lng) return res.status(400).json({ error: "lat and lng required" });

    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=sunshine_duration,precipitation_sum,wind_speed_10m_max,uv_index_max&timezone=Europe%2FLondon&forecast_days=7`;
      const response = await fetch(url);
      const data = await response.json();

      const daily = data.daily;
      const avg = (arr: number[]) => arr.reduce((a: number, b: number) => a + b, 0) / arr.length;

      res.json({
        sunshineHoursPerDay: parseFloat((avg(daily.sunshine_duration) / 3600).toFixed(1)),
        weeklyRainfallMm: parseFloat(daily.precipitation_sum.reduce((a: number, b: number) => a + b, 0).toFixed(1)),
        avgWindSpeedKmh: parseFloat(avg(daily.wind_speed_10m_max).toFixed(1)),
        avgUvIndex: parseFloat(avg(daily.uv_index_max).toFixed(1)),
      });
    } catch (error) {
      console.error("Weather API Error:", error);
      res.status(500).json({ error: "Failed to fetch weather data" });
    }
  });

  // Air Quality API Proxy
  app.get("/api/google/air-quality", async (req, res) => {
    const { lat, lng } = req.query;
    const apiKey = process.env.GOOGLE_MAPS_PLATFORM_KEY;

    if (!apiKey) {
      return res.status(500).json({ error: "Google Maps API Key not configured on server" });
    }

    try {
      const url = `https://airquality.googleapis.com/v1/currentConditions:get?key=${apiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          location: { latitude: lat, longitude: lng },
          extraComputations: ["HEALTH_ADVISORIES", "POLLUTANT_ADDITIONAL_INFO"]
        })
      });
      const data = await response.json();
      res.json(data);
    } catch (error) {
      console.error("Air Quality API Error:", error);
      res.status(500).json({ error: "Failed to fetch air quality data" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
