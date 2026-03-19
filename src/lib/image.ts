/**
 * Compresses a base64 image to fit within Firestore's 1MB limit.
 * Resizes the image to a maximum dimension and uses JPEG compression.
 */
export async function compressImage(base64: string, maxWidth = 1024, quality = 0.7): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;

      // Calculate new dimensions
      if (width > height) {
        if (width > maxWidth) {
          height *= maxWidth / width;
          width = maxWidth;
        }
      } else {
        if (height > maxWidth) {
          width *= maxWidth / height;
          height = maxWidth;
        }
      }

      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Could not get canvas context'));
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);

      // Convert to JPEG with specified quality
      const compressedBase64 = canvas.toDataURL('image/jpeg', quality);
      resolve(compressedBase64);
    };

    img.onerror = (err) => reject(err);
    img.src = base64;
  });
}

/**
 * Combines multiple SAM 2 segmentation masks (white = detected object) into a
 * single garden mask (white = editable garden area, black = excluded).
 * Combines all excluded masks via screen blend then inverts.
 */
export async function buildGardenMask(maskSrcs: string[], refImageSrc: string): Promise<string> {
  return new Promise((resolve) => {
    const ref = new Image();
    ref.onload = async () => {
      const w = ref.naturalWidth;
      const h = ref.naturalHeight;

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;

      // Start with black (nothing excluded yet)
      ctx.fillStyle = 'black';
      ctx.fillRect(0, 0, w, h);

      // OR all excluded-object masks together using screen blend
      ctx.globalCompositeOperation = 'screen';
      for (const src of maskSrcs) {
        await new Promise<void>((res) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => { ctx.drawImage(img, 0, 0, w, h); res(); };
          img.onerror = () => res();
          img.src = src;
        });
      }

      // Invert: excluded objects (white) → black; garden (black) → white
      ctx.globalCompositeOperation = 'source-over';
      const id = ctx.getImageData(0, 0, w, h);
      for (let i = 0; i < id.data.length; i += 4) {
        id.data[i]     = 255 - id.data[i];
        id.data[i + 1] = 255 - id.data[i + 1];
        id.data[i + 2] = 255 - id.data[i + 2];
      }
      ctx.putImageData(id, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    ref.onerror = () => resolve('');
    ref.src = refImageSrc;
  });
}

/**
 * Composites two images using a mask.
 * White areas in the mask will show the 'after' image.
 * Black areas in the mask will show the 'before' image.
 */
export async function compositeImages(before: string, after: string, mask: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const beforeImg = new Image();
    const afterImg = new Image();
    const maskImg = new Image();

    let loadedCount = 0;
    const onLoaded = () => {
      loadedCount++;
      if (loadedCount === 3) {
        const canvas = document.createElement('canvas');
        canvas.width = beforeImg.width;
        canvas.height = beforeImg.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Could not get canvas context'));
          return;
        }

        // 1. Draw the 'before' image (the base)
        ctx.drawImage(beforeImg, 0, 0);

        // 2. Create a temporary canvas for the masked 'after' image
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = canvas.width;
        tempCanvas.height = canvas.height;
        const tempCtx = tempCanvas.getContext('2d');
        if (!tempCtx) {
          reject(new Error('Could not get temp canvas context'));
          return;
        }

        // 3. Draw the mask on the temp canvas
        tempCtx.drawImage(maskImg, 0, 0, tempCanvas.width, tempCanvas.height);

        // 4. Use the mask to clip the 'after' image
        tempCtx.globalCompositeOperation = 'source-in';
        tempCtx.drawImage(afterImg, 0, 0, tempCanvas.width, tempCanvas.height);

        // 5. Draw the masked 'after' image onto the main canvas
        ctx.drawImage(tempCanvas, 0, 0);

        resolve(canvas.toDataURL('image/jpeg', 0.8));
      }
    };

    beforeImg.onload = onLoaded;
    afterImg.onload = onLoaded;
    maskImg.onload = onLoaded;

    beforeImg.onerror = reject;
    afterImg.onerror = reject;
    maskImg.onerror = reject;

    beforeImg.src = before;
    afterImg.src = after;
    maskImg.src = mask;
  });
}
