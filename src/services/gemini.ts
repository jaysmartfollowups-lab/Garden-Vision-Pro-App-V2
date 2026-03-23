import { GoogleGenAI } from "@google/genai";

// ─── Retry Helper with Exponential Backoff ───────────────────────────────────
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 2000; // 2s, 4s, 8s

function isRetryableError(error: any): boolean {
  const message = (error?.message || '').toLowerCase();
  const status = error?.status || error?.code || error?.httpCode;
  
  if (status === 503 || status === 429) return true;
  if (message.includes('503') || message.includes('unavailable')) return true;
  if (message.includes('429') || message.includes('resource_exhausted')) return true;
  if (message.includes('high demand') || message.includes('overloaded')) return true;
  if (message.includes('rate limit') || message.includes('quota')) return true;
  if (message.includes('internal') && message.includes('error')) return true;
  
  return false;
}

function getUserFriendlyError(error: any): string {
  const message = (error?.message || '').toLowerCase();
  
  if (message.includes('503') || message.includes('unavailable') || message.includes('high demand')) {
    return '🔄 The AI model is experiencing high demand right now. This is temporary — please try again in a moment.';
  }
  if (message.includes('429') || message.includes('rate limit') || message.includes('quota') || message.includes('resource_exhausted')) {
    return '⏳ You\'ve hit the API rate limit. Please wait a minute before trying again.';
  }
  if (message.includes('api key') || message.includes('authentication') || message.includes('permission')) {
    return '🔑 API key issue — please check that your API key is valid and has the correct permissions.';
  }
  if (message.includes('safety') || message.includes('blocked') || message.includes('filter')) {
    return '🛡️ The AI safety filter blocked this request. Try rephrasing your transformation description.';
  }
  if (message.includes('timeout') || message.includes('deadline')) {
    return '⏱️ The request timed out. The image may be too large or the prompt too complex. Try again with a simpler description.';
  }
  
  return error?.message || 'An unexpected error occurred during AI generation. Please try again.';
}

async function retryableGenerate<T>(
  fn: () => Promise<T>,
  context: string = 'API call'
): Promise<T> {
  let lastError: any;
  
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      
      if (attempt < MAX_RETRIES && isRetryableError(error)) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        console.warn(
          `⚠️ ${context} failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}): ${error.message}. Retrying in ${delay / 1000}s...`
        );
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        break;
      }
    }
  }
  
  throw new Error(getUserFriendlyError(lastError));
}


// ═══════════════════════════════════════════════════════════════════════════════
// DUAL-ENGINE ARCHITECTURE
// ═══════════════════════════════════════════════════════════════════════════════
//
// Engine 1: FLUX Pro Fill (fal.ai) — Used when a MASK is present
//   → True inpainting model that architecturally understands masks
//   → ONLY regenerates pixels in the white (masked) region
//   → Preserves ALL original pixels in the black (unmasked) region
//   → This is the same technology used by production design tools
//
// Engine 2: Gemini (Google) — Used for FULL garden transformations (no mask)
//   → Excellent at generating complete garden redesigns
//   → Cannot do pixel-level inpainting (it regenerates the entire image)
//
// ═══════════════════════════════════════════════════════════════════════════════


// ─── Engine 1: FLUX Inpainting (for masked edits) ────────────────────────────

// Compress image client-side before uploading to keep request payload tiny.
// For inpainting, 512px is plenty — FLUX generates at its own resolution.
function compressForUpload(base64: string, maxDim: number = 512, quality: number = 0.6): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let w = img.width, h = img.height;

      // Resize to fit within maxDim
      if (w > h) {
        if (w > maxDim) { h *= maxDim / w; w = maxDim; }
      } else {
        if (h > maxDim) { w *= maxDim / h; h = maxDim; }
      }

      canvas.width = Math.round(w);
      canvas.height = Math.round(h);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => reject(new Error('Failed to compress image'));
    img.src = base64;
  });
}

// Compress mask — keep it as PNG (black/white compresses well in PNG)
function compressMask(base64: string, maxDim: number = 512): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let w = img.width, h = img.height;

      if (w > h) {
        if (w > maxDim) { h *= maxDim / w; w = maxDim; }
      } else {
        if (h > maxDim) { w *= maxDim / h; h = maxDim; }
      }

      canvas.width = Math.round(w);
      canvas.height = Math.round(h);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('Failed to compress mask'));
    img.src = base64;
  });
}

// Helper: Upload a single compressed image to fal.ai storage via our server
async function uploadImageToFal(base64: string, filename: string): Promise<string> {
  const res = await fetch('/api/fal-upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base64, filename })
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Image upload failed (${res.status})`);
  }

  const data = await res.json();
  if (!data.url) {
    throw new Error('Upload returned no URL');
  }
  return data.url;
}

async function inpaintWithFlux(
  base64Image: string,
  maskBase64: string,
  prompt: string
): Promise<{ imageUrl: string }> {
  console.log("🎯 MASK DETECTED → Using FLUX Pro Fill for true inpainting");

  // Step 1: Compress images client-side (1024px, JPEG 0.88 = good quality for FLUX)
  console.log("🗜️ Compressing images for upload...");
  const [compressedImage, compressedMask] = await Promise.all([
    compressForUpload(base64Image, 1024, 0.88),
    compressMask(maskBase64, 1024),
  ]);

  // Step 2: Upload both images to fal.ai CDN separately (avoids 413 errors)
  console.log("📤 Uploading compressed images to fal.ai storage...");
  const [imageUrl, maskUrl] = await Promise.all([
    uploadImageToFal(compressedImage, 'garden-image.jpg'),
    uploadImageToFal(compressedMask, 'garden-mask.png'),
  ]);
  console.log("✅ Images uploaded to CDN");

  // Step 2: Call inpainting with just URLs + prompt (tiny payload)
  const response = await retryableGenerate(
    async () => {
      const res = await fetch('/api/inpaint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrl,
          maskUrl,
          prompt
        })
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        const errorMsg = errorData.error || `Inpainting API returned ${res.status}`;
        const error: any = new Error(errorMsg);
        error.status = res.status;
        throw error;
      }

      return res.json();
    },
    'FLUX inpainting'
  );

  // fal.ai returns { images: [{ url: "..." }] }
  const resultImageUrl = response.images?.[0]?.url;

  if (!resultImageUrl) {
    throw new Error("The inpainting model did not return an image. Please try again.");
  }

  // Fetch the image from fal.ai's CDN and convert to base64 data URI
  const imageResponse = await fetch(resultImageUrl);
  const imageBlob = await imageResponse.blob();
  const imageBase64Result = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(imageBlob);
  });

  return { imageUrl: imageBase64Result };
}


// ─── Engine 2: Gemini (for full transformations, no mask) ────────────────────

async function transformWithGemini(
  base64Image: string,
  prompt: string,
  siteIntelligence?: {
    weather?: {
      sunshineHoursPerDay: number;
      weeklyRainfallMm: number;
      avgWindSpeedKmh: number;
      avgUvIndex: number;
    };
    address?: string;
  }
): Promise<{ imageUrl: string; plantLegend: string }> {
  console.log("🌿 NO MASK → Using Gemini for full garden transformation");

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("🔑 Gemini API Key is missing. Please ensure it is set in your environment variables.");
  }

  const ai = new GoogleGenAI({ apiKey });

  // Step 1: Vision pre-pass — spatial constraint analysis
  let spatialAnalysis = 'Spatial analysis not available.';
  try {
    const visionResponse = await retryableGenerate(
      () => ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: {
          parts: [
            {
              inlineData: {
                data: base64Image.includes(',') ? base64Image.split(',')[1] : base64Image,
                mimeType: "image/jpeg",
              }
            },
            {
              text: `You are a spatial analysis AI for garden design. Analyze this garden photo and output ONLY a valid JSON object with these fields:
{
  "access_points": ["list each door/gate/garage with position e.g. 'back door bottom-left'"],
  "boundaries": ["fences, walls, hedges with positions"],
  "existing_features": ["trees, paths, patios, structures worth preserving"],
  "light_analysis": "brief assessment of sun/shade from shadows visible",
  "no_build_zones": ["areas that must stay clear e.g. 'drain cover centre-right'"],
  "garden_area": "description of the main open ground available for design"
}
Output ONLY the JSON. No markdown fences, no explanation.`
            }
          ]
        }
      }),
      'Vision pre-pass'
    );
    const json = visionResponse.text?.trim() || '{}';
    const c = JSON.parse(json);
    spatialAnalysis = [
      `Access points: ${c.access_points?.join('; ') || 'none detected'}`,
      `Boundaries: ${c.boundaries?.join('; ') || 'none detected'}`,
      `Existing features: ${c.existing_features?.join('; ') || 'none'}`,
      `Light: ${c.light_analysis || 'unknown'}`,
      `No-build zones: ${c.no_build_zones?.join('; ') || 'none'}`,
      `Garden area: ${c.garden_area || 'full ground area'}`,
    ].join('\n      ');
  } catch {
    console.warn('Vision pre-pass skipped (non-critical)');
  }

  const w = siteIntelligence?.weather;
  const weatherInfo = w
    ? `Live Weather Data (Open-Meteo):
      - Avg daily sunshine: ${w.sunshineHoursPerDay} hrs/day (${w.sunshineHoursPerDay >= 5 ? 'Good sun exposure' : w.sunshineHoursPerDay >= 3 ? 'Moderate sun exposure' : 'Low light / shaded site'})
      - Weekly rainfall: ${w.weeklyRainfallMm} mm (${w.weeklyRainfallMm > 30 ? 'Wet — drainage planning important' : 'Normal UK conditions'})
      - Avg wind speed: ${w.avgWindSpeedKmh} km/h (${w.avgWindSpeedKmh > 30 ? 'Exposed — windbreak planting recommended' : 'Sheltered to moderate'})
      - UV Index: ${w.avgUvIndex}`
    : "Weather data not available — use UK general climate assumptions.";

  const parts: any[] = [
    {
      inlineData: {
        data: base64Image.includes(',') ? base64Image.split(',')[1] : base64Image,
        mimeType: "image/png",
      },
    },
  ];

  parts.push({
    text: `You are a Senior Professional Garden Designer with expertise in spatial planning and landscape architecture. Transform this garden based on this description: "${prompt}".

      SPATIAL ANALYSIS (Vision Pre-pass):
      ${spatialAnalysis}

      ENVIRONMENTAL CONTEXT:
      Address: ${siteIntelligence?.address || 'Unknown'}
      ${weatherInfo}

      CRITICAL DESIGN & SPATIAL PRINCIPLES:
      1. ENVIRONMENTAL ADAPTATION: Use the real weather data above. If sunshine is high (≥5 hrs), prioritise sun-loving plants (Lavender, Salvia, Roses). If moderate (3-5 hrs), use Hydrangeas, Astilbe, Geraniums. If low (<3 hrs), use shade-tolerant varieties (Hostas, Ferns, Hellebores). If windy, include windbreak hedging (Hornbeam, Holly). If wet, avoid waterlogging with raised beds or gravel paths.
      2. FUNCTIONAL ZONING: Divide the garden into logical zones (e.g., Dining, Relaxation, Utility, Transit). Place features where they make functional sense (e.g., dining near the house, relaxation in sunny/quiet spots).
      3. SPATIAL AWARENESS & CLEARANCE: Identify all access points (garage doors, garden gates, back doors, paths). You MUST maintain a minimum 1-meter clear "No-Build Zone" in front of these to ensure the garden remains usable. NEVER block an entrance or a primary thoroughfare.
      4. CIRCULATION & FLOW: Design for human movement. Ensure there is a clear, logical path from the house to all key areas of the garden. Seating areas should be "Destination Zones," not placed in the middle of a transit path or blocking a flower bed.
      5. PROPORTIONAL SCALE: Ensure all furniture, planters, and features are scaled appropriately to the size of the garden. Do not overcrowd small spaces with oversized furniture.
      6. USAGE-FIRST LOGIC: Prioritize how people will actually move and live in the garden. A design must be as functional as it is beautiful.
      7. REMOVE CLUTTER: Automatically identify and remove unsightly objects (bins, trash, tools) and replace them with intentional design elements.
      8. ITERATIVE DESIGN: Build ON TOP of the provided image. Transform the whole garden as described.
      9. UK CONTEXT: Use plants and materials suitable for the UK climate (e.g., Lavender, Hydrangeas, York stone).

      CLIENT-READY OUTPUT: The final image must be a photorealistic, professional design proposal that demonstrates both aesthetic beauty and practical common sense.`,
  });

  // Step 2: Main image generation
  const response = await retryableGenerate(
    () => ai.models.generateContent({
      model: "gemini-2.5-flash-image",
      contents: { parts },
    }),
    'Garden image generation'
  );

  if (!response.candidates || response.candidates.length === 0) {
    throw new Error("🛡️ The AI model returned no candidates. This might be due to safety filters — try rephrasing your prompt.");
  }

  let imageUrl = "";
  for (const part of response.candidates[0].content.parts) {
    if (part.inlineData) {
      imageUrl = `data:image/png;base64,${part.inlineData.data}`;
    }
  }

  if (!imageUrl) {
    throw new Error("The AI model did not generate an image. Please try a different prompt.");
  }

  // Step 3: Plant legend (non-critical)
  let plantLegend = "No plant legend generated.";
  try {
    const legendResponse = await retryableGenerate(
      () => ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: `Based on this garden transformation description: "${prompt}", and the following real weather data for this UK property:
        ${weatherInfo}

        List the specific plants (common and Latin names) best suited to these exact conditions. Prioritise plants that match the sun exposure and rainfall levels above.
        Format as a clean markdown list with brief care tips for each.`,
      }),
      'Plant legend generation'
    );
    plantLegend = legendResponse.text || plantLegend;
  } catch (legendErr: any) {
    console.warn('Plant legend generation failed (non-critical):', legendErr.message);
  }

  return { imageUrl, plantLegend };
}


// ─── Public API: Route to the correct engine ─────────────────────────────────

export async function transformGarden(
  base64Image: string,
  prompt: string,
  maskImage?: string,
  siteIntelligence?: {
    weather?: {
      sunshineHoursPerDay: number;
      weeklyRainfallMm: number;
      avgWindSpeedKmh: number;
      avgUvIndex: number;
    };
    address?: string;
  }
): Promise<{ imageUrl: string; plantLegend: string }> {

  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║  ROUTING DECISION                                                    ║
  // ║  Mask present?  → FLUX Pro Fill (true inpainting, pixel-perfect)    ║
  // ║  No mask?       → Gemini (full garden transformation)               ║
  // ╚══════════════════════════════════════════════════════════════════════╝

  if (maskImage) {
    // FLUX inpainting handles the image generation
    const result = await inpaintWithFlux(base64Image, maskImage, prompt);

    // Generate plant legend via Gemini (it's just text, fast & cheap)
    let plantLegend = "No plant legend generated.";
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (apiKey) {
        const ai = new GoogleGenAI({ apiKey });
        const legendResponse = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: `Based on this garden transformation description: "${prompt}", list specific plants (common and Latin names) suitable for a UK garden. Format as a clean markdown list with brief care tips for each.`,
        });
        plantLegend = legendResponse.text || plantLegend;
      }
    } catch {
      // Plant legend is non-critical
    }

    return { imageUrl: result.imageUrl, plantLegend };
  }

  // No mask — use Gemini for full transformation
  return transformWithGemini(base64Image, prompt, siteIntelligence);
}
