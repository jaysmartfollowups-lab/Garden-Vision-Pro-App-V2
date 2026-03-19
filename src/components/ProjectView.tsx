import React, { useState, useEffect, useRef } from 'react';
import { 
  collection, 
  query, 
  orderBy, 
  onSnapshot, 
  addDoc, 
  serverTimestamp, 
  doc, 
  updateDoc,
  getDocs,
  deleteDoc
} from 'firebase/firestore';
import { db, auth } from '../firebase';
import { Project, GardenVersion } from '../types';
import { transformGarden } from '../services/gemini';
import { handleFirestoreError, OperationType } from '../lib/firebase-errors';
import { MaskCanvas } from './MaskCanvas';
import { VoiceInput } from './VoiceInput';
import { ImageSlider } from './ImageSlider';
import { compressImage, compositeImages, buildGardenMask, featherMask } from '../lib/image';
import { 
  Plus, 
  History, 
  Share2, 
  ChevronLeft, 
  Camera, 
  Upload, 
  Sparkles, 
  Leaf, 
  ArrowRight,
  Download,
  Trash2,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertCircle,
  Sun,
  Map as MapIcon,
  Maximize2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Map, AdvancedMarker, Pin, useMap, useMapsLibrary } from '@vis.gl/react-google-maps';
import ReactMarkdown from 'react-markdown';
import confetti from 'canvas-confetti';
import { cn } from '../lib/utils';

interface ProjectViewProps {
  project: Project;
  onBack: () => void;
}

export function ProjectView({ project, onBack }: ProjectViewProps) {
  const [versions, setVersions] = useState<GardenVersion[]>([]);
  const [currentVersion, setCurrentVersion] = useState<GardenVersion | null>(null);
  const [isTransforming, setIsTransforming] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [maskBase64, setMaskBase64] = useState<string | null>(null);
  const [isMasking, setIsMasking] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showShareToast, setShowShareToast] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transformStep, setTransformStep] = useState<number>(0);
  const [activeTab, setActiveTab] = useState<'design' | 'site'>('design');
  const [weatherData, setWeatherData] = useState<any>(null);
  const [aerialView, setAerialView] = useState<any>(null);
  const [isFetchingSiteData, setIsFetchingSiteData] = useState(false);
  const [autoMask, setAutoMask] = useState<string | null>(null);
  const [isSegmenting, setIsSegmenting] = useState(false);
  const [resolvedLat, setResolvedLat] = useState<number | null>(project.lat ?? null);
  const [resolvedLng, setResolvedLng] = useState<number | null>(project.lng ?? null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const transformSteps = [
    "Analyzing garden layout...",
    "Generating your new vision...",
    "Refining textures & lighting...",
    "Finalizing design..."
  ];

  useEffect(() => {
    const q = query(
      collection(db, 'projects', project.id, 'versions'),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const versionsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as GardenVersion[];
      setVersions(versionsData);
      if (versionsData.length > 0 && !currentVersion) {
        setCurrentVersion(versionsData[0]);
      }
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, `projects/${project.id}/versions`);
    });

    return () => unsubscribe();
  }, [project.id]);

  useEffect(() => {
    if (!project.lat && !project.lng && project.address) {
      fetch(`/api/google/geocode?address=${encodeURIComponent(project.address)}`)
        .then(r => r.json())
        .then(data => {
          if (data.lat && data.lng) {
            setResolvedLat(data.lat);
            setResolvedLng(data.lng);
          }
        })
        .catch(() => {});
    }
  }, [project.address]);

  useEffect(() => {
    if (activeTab === 'site' && resolvedLat && resolvedLng && !weatherData) {
      fetchSiteIntelligence();
    }
  }, [activeTab, resolvedLat, resolvedLng]);

  const fetchSiteIntelligence = async () => {
    setIsFetchingSiteData(true);
    try {
      const [weatherRes, aerialRes] = await Promise.all([
        fetch(`/api/weather?lat=${resolvedLat}&lng=${resolvedLng}`),
        fetch(`/api/google/aerial-view?address=${encodeURIComponent(project.address || '')}`)
      ]);

      if (weatherRes.ok) setWeatherData(await weatherRes.json());
      if (aerialRes.ok) setAerialView(await aerialRes.json());
    } catch (err) {
      console.error("Error fetching site intelligence:", err);
    } finally {
      setIsFetchingSiteData(false);
    }
  };

  const autoSegmentGarden = async (compressedBase64: string) => {
    setIsSegmenting(true);
    try {
      const res = await fetch('/api/segment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: compressedBase64 })
      });
      if (!res.ok) return; // SAM 2 not configured — silently skip
      const data = await res.json();

      // Extract mask URLs/data from response (fal.ai grounded-sam-2 format)
      const masks: string[] = [];
      if (Array.isArray(data.masks)) {
        for (const m of data.masks) {
          const src = m.mask?.url || m.mask_url || m.mask;
          if (src) masks.push(src);
        }
      }
      if (masks.length === 0) return;

      const gardenMask = await buildGardenMask(masks, compressedBase64);
      if (gardenMask) setAutoMask(gardenMask);
    } catch {
      // SAM 2 optional — fail silently
    } finally {
      setIsSegmenting(false);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64 = event.target?.result as string;
      
      try {
        // Compress image before saving to Firestore
        const compressedBase64 = await compressImage(base64);
        
        // Create initial version
        const versionData = {
          projectId: project.id,
          imageUrl: compressedBase64,
          prompt: 'Original photo',
          createdAt: new Date().toISOString(),
        };

        const docRef = await addDoc(collection(db, 'projects', project.id, 'versions'), versionData);
        setCurrentVersion({ id: docRef.id, ...versionData });

        // Step 3: SAM 2 auto-segment the garden area in the background
        autoSegmentGarden(compressedBase64);
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `projects/${project.id}/versions`);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleTransform = async () => {
    if (!currentVersion) {
      console.error("No current version found to transform");
      return;
    }
    
    if (!prompt) {
      setError('Please describe the transformation you want to see.');
      return;
    }

    // Check for API key
    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey || geminiKey === 'MY_GEMINI_API_KEY') {
      setError('Gemini API Key is missing or invalid. Please add GEMINI_API_KEY to your Secrets in Settings.');
      return;
    }

    setIsTransforming(true);
    setTransformStep(0);
    setError(null);

    // Simulate progress steps
    const stepInterval = setInterval(() => {
      setTransformStep(prev => Math.min(prev + 1, transformSteps.length - 1));
    }, 3000);

    try {
      console.log("Starting garden transformation with prompt:", prompt);
      
      const result = await transformGarden(
        currentVersion.imageUrl,
        prompt,
        maskBase64 || undefined,
        {
          weather: weatherData,
          address: project.address
        }
      );

      clearInterval(stepInterval);
      setTransformStep(transformSteps.length - 1);

      if (!result.imageUrl) {
        throw new Error('AI failed to generate an image. Please try a different prompt.');
      }

      console.log("Transformation successful, processing image...");

      // FLUX inpainting (when manual mask is used) already produces a pixel-perfect
      // result — no client-side compositing needed. Only apply compositing for
      // auto-mask (SAM 2) which goes through Gemini and needs blending.
      let finalImageUrl = result.imageUrl;
      if (!maskBase64 && autoMask) {
        // Auto-mask path: Gemini generated a full new image, blend with original
        const featheredMask = await featherMask(autoMask, 20);
        finalImageUrl = await compositeImages(currentVersion.imageUrl, result.imageUrl, featheredMask);
      }

      // Compress final image before saving
      const compressedImageUrl = await compressImage(finalImageUrl);

      const newVersionData = {
        projectId: project.id,
        imageUrl: compressedImageUrl,
        originalImageUrl: currentVersion.imageUrl,
        maskUrl: maskBase64 || null,
        prompt: prompt,
        plantLegend: result.plantLegend,
        createdAt: new Date().toISOString(),
        parentVersionId: currentVersion.id,
      };

      console.log("Saving new version to Firestore...");
      const docRef = await addDoc(collection(db, 'projects', project.id, 'versions'), newVersionData);
      console.log("New version saved with ID:", docRef.id);
      
      setCurrentVersion({ id: docRef.id, ...newVersionData } as GardenVersion);
      setPrompt('');
      setMaskBase64(null);
      setIsMasking(false);
      
      confetti({
        particleCount: 150,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#10b981', '#34d399', '#6ee7b7']
      });
    } catch (err: any) {
      console.error("Error in handleTransform:", err);
      clearInterval(stepInterval);
      
      let errorMessage = 'An error occurred during generation. Please try again.';
      
      if (err.message) {
        if (err.message.includes('FAL_KEY') || err.message.includes('fal.ai')) {
          errorMessage = '🔑 Mask editing requires a fal.ai API key. Add FAL_KEY to your Secrets in Settings (get one free at fal.ai/dashboard/keys).';
        } else if (err.message.includes('Inpainting') || err.message.includes('inpainting')) {
          errorMessage = '🎨 Mask inpainting failed. ' + err.message;
        } else if (err.message.includes('authInfo')) {
          errorMessage = 'Database permission error. Please check your security rules.';
        } else {
          errorMessage = err.message;
        }
      }
      
      setError(errorMessage);
    } finally {
      setIsTransforming(false);
      setTransformStep(0);
    }
  };

  const handleShare = () => {
    if (!currentVersion) return;
    const shareUrl = `${window.location.origin}/share/${project.id}/${currentVersion.id}`;
    navigator.clipboard.writeText(shareUrl);
    setShowShareToast(true);
    setTimeout(() => setShowShareToast(false), 2000);
  };

  const handleDeleteVersion = async () => {
    if (!currentVersion) return;
    
    try {
      await deleteDoc(doc(db, 'projects', project.id, 'versions', currentVersion.id));
      
      // If there are other versions, select the most recent one
      const remainingVersions = versions.filter(v => v.id !== currentVersion.id);
      if (remainingVersions.length > 0) {
        setCurrentVersion(remainingVersions[0]);
      } else {
        setCurrentVersion(null);
      }
      setConfirmDelete(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `projects/${project.id}/versions/${currentVersion.id}`);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 flex flex-col">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-md border-b border-zinc-200 sticky top-0 z-50 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-2 hover:bg-zinc-100 rounded-full transition-colors">
            <ChevronLeft size={20} className="text-zinc-600" />
          </button>
          <div>
            <h1 className="text-sm font-bold text-zinc-900 leading-none">{project.name}</h1>
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium mt-1">{project.address || 'No address'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setShowHistory(!showHistory)}
            className={cn(
              "p-2 rounded-full transition-all",
              showHistory ? "bg-emerald-100 text-emerald-600" : "hover:bg-zinc-100 text-zinc-600"
            )}
          >
            <History size={20} />
          </button>
          <button 
            onClick={handleShare}
            className="p-2 hover:bg-zinc-100 rounded-full transition-colors text-zinc-600"
          >
            <Share2 size={20} />
          </button>
          {currentVersion && (
            <button 
              onClick={() => setConfirmDelete(true)}
              className="p-2 hover:bg-zinc-100 rounded-full transition-colors text-red-500"
              title="Delete this version"
            >
              <Trash2 size={20} />
            </button>
          )}
        </div>
      </header>

      {/* Share Toast */}
      <AnimatePresence>
        {showShareToast && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] bg-zinc-900 text-white px-6 py-3 rounded-2xl font-bold text-xs uppercase tracking-widest shadow-2xl flex items-center gap-2"
          >
            <CheckCircle2 size={16} className="text-emerald-400" />
            Link copied to clipboard
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {confirmDelete && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setConfirmDelete(false)}
              className="absolute inset-0 bg-zinc-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative w-full max-w-sm bg-white rounded-3xl shadow-2xl p-8 text-center"
            >
              <div className="w-16 h-16 bg-red-50 text-red-500 rounded-2xl flex items-center justify-center mx-auto mb-6">
                <Trash2 size={32} />
              </div>
              <h3 className="text-xl font-black text-zinc-900 tracking-tight mb-2">Delete Version?</h3>
              <p className="text-zinc-500 text-sm mb-8">This action cannot be undone. This specific design will be permanently removed.</p>
              <div className="flex gap-3">
                <button 
                  onClick={() => setConfirmDelete(false)}
                  className="flex-1 py-4 text-zinc-400 font-bold text-sm uppercase tracking-widest hover:text-zinc-600 transition-all"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleDeleteVersion}
                  className="flex-1 py-4 bg-red-500 text-white rounded-2xl font-bold text-sm uppercase tracking-widest shadow-lg shadow-red-200 hover:bg-red-600 transition-all"
                >
                  Delete
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <main className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* Main Editor Area */}
        <div className="flex-1 overflow-y-auto p-4 lg:p-8">
          <div className="max-w-4xl mx-auto space-y-6">
            {/* Tab Switcher */}
            <div className="flex bg-zinc-100 p-1 rounded-2xl w-fit mx-auto mb-6">
              <button 
                onClick={() => setActiveTab('design')}
                className={cn(
                  "px-6 py-2 rounded-xl font-bold text-xs uppercase tracking-widest transition-all flex items-center gap-2",
                  activeTab === 'design' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-400 hover:text-zinc-600"
                )}
              >
                <Sparkles size={14} />
                Design
              </button>
              <button 
                onClick={() => setActiveTab('site')}
                className={cn(
                  "px-6 py-2 rounded-xl font-bold text-xs uppercase tracking-widest transition-all flex items-center gap-2",
                  activeTab === 'site' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-400 hover:text-zinc-600"
                )}
              >
                <MapIcon size={14} />
                Site Intelligence
              </button>
            </div>

            {activeTab === 'design' ? (
              <>
                {/* Image Display */}
                <div className="relative aspect-[4/3] bg-zinc-200 rounded-3xl overflow-hidden shadow-2xl group">
                  {currentVersion ? (
                    <>
                      {isMasking ? (
                        <MaskCanvas 
                          imageUrl={currentVersion.imageUrl} 
                          onSaveMask={setMaskBase64}
                          className="w-full h-full"
                        />
                      ) : currentVersion.parentVersionId ? (
                        <ImageSlider 
                          before={versions.find(v => v.id === currentVersion.parentVersionId)?.imageUrl || currentVersion.imageUrl}
                          after={currentVersion.imageUrl}
                          className="w-full h-full"
                        />
                      ) : (
                        <img 
                          src={currentVersion.imageUrl} 
                          alt="Garden Design" 
                          className="w-full h-full object-cover"
                        />
                      )}
                      
                      {/* Overlay Controls */}
                      <div className="absolute top-4 right-4 flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button 
                          onClick={() => setIsMasking(!isMasking)}
                          className={cn(
                            "p-3 rounded-2xl shadow-xl backdrop-blur-md transition-all flex items-center gap-2 font-bold text-xs uppercase tracking-widest",
                            isMasking ? "bg-emerald-500 text-white" : "bg-white/90 text-zinc-800 hover:bg-white"
                          )}
                        >
                          <Sparkles size={16} />
                          {isMasking ? 'Stop Masking' : 'Mask Area'}
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-400 gap-4">
                      <Camera size={48} strokeWidth={1} />
                      <p className="text-sm font-medium">Take a photo of the garden to start</p>
                      <div className="flex gap-3">
                        <button 
                          onClick={() => fileInputRef.current?.click()}
                          className="px-6 py-3 bg-emerald-500 text-white rounded-2xl font-bold text-xs uppercase tracking-widest shadow-lg shadow-emerald-200 hover:bg-emerald-600 transition-all flex items-center gap-2"
                        >
                          <Upload size={16} />
                          Upload Photo
                        </button>
                        <input 
                          type="file" 
                          ref={fileInputRef} 
                          onChange={handleImageUpload} 
                          accept="image/*" 
                          className="hidden" 
                          capture="environment"
                        />
                      </div>
                    </div>
                  )}
                  
                  {isTransforming && (
                    <div className="absolute inset-0 bg-zinc-900/80 backdrop-blur-md flex flex-col items-center justify-center text-white gap-8 z-50 p-8">
                      <div className="relative">
                        <div className="w-24 h-24 border-4 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin" />
                        <Sparkles size={32} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-emerald-400 animate-pulse" />
                      </div>
                      
                      <div className="w-full max-w-xs space-y-4">
                        <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-emerald-400">
                          <span>{transformSteps[transformStep]}</span>
                          <span>{Math.round(((transformStep + 1) / transformSteps.length) * 100)}%</span>
                        </div>
                        <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
                          <motion.div 
                            className="h-full bg-emerald-500"
                            initial={{ width: 0 }}
                            animate={{ width: `${((transformStep + 1) / transformSteps.length) * 100}%` }}
                            transition={{ duration: 0.5 }}
                          />
                        </div>
                        <p className="text-center text-xs text-zinc-400 italic">
                          "Patience is the companion of wisdom."
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Controls */}
                {currentVersion && !isTransforming && (
                  <motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-4"
                  >
                    <div className="flex items-center justify-between">
                      <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-400 flex items-center gap-2">
                        <Sparkles size={14} className="text-emerald-500" />
                        Transformation Brief
                      </h2>
                      <div className="flex items-center gap-2">
                        {isSegmenting && (
                          <span className="text-[10px] font-bold uppercase tracking-widest text-blue-600 bg-blue-50 px-2 py-1 rounded-full flex items-center gap-1">
                            <Loader2 size={10} className="animate-spin" />
                            SAM 2 Analysing...
                          </span>
                        )}
                        {autoMask && !isSegmenting && !maskBase64 && (
                          <span className="text-[10px] font-bold uppercase tracking-widest text-blue-600 bg-blue-50 px-2 py-1 rounded-full flex items-center gap-1">
                            <CheckCircle2 size={10} />
                            Garden Auto-masked
                          </span>
                        )}
                        {maskBase64 && (
                          <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 bg-emerald-100 px-2 py-1 rounded-full flex items-center gap-1">
                            <CheckCircle2 size={10} />
                            Area Masked
                          </span>
                        )}
                      </div>
                    </div>
                    
                    <VoiceInput 
                      value={prompt}
                      onTranscript={setPrompt} 
                      placeholder={isMasking ? "Describe what you want in the masked area..." : "Describe the full transformation..."}
                    />

                    {error && (
                      <div className="p-4 bg-red-50 border border-red-100 rounded-2xl flex items-start gap-3 text-red-600 text-sm">
                        <AlertCircle size={18} className="shrink-0 mt-0.5" />
                        <p>{error}</p>
                      </div>
                    )}

                    <button 
                      onClick={handleTransform}
                      disabled={isTransforming}
                      className="w-full py-4 bg-zinc-900 text-white rounded-2xl font-bold text-sm uppercase tracking-widest shadow-xl hover:bg-black transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3 group"
                    >
                      Generate New Vision
                      <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                    </button>
                  </motion.div>
                )}
              </>
            ) : (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-6"
              >
                {/* Aerial Context Map */}
                <div className="aspect-[16/9] bg-zinc-200 rounded-3xl overflow-hidden shadow-2xl relative border-4 border-white">
                  {resolvedLat && resolvedLng ? (
                    <Map
                      defaultCenter={{ lat: resolvedLat, lng: resolvedLng }}
                      defaultZoom={19}
                      mapId="DEMO_MAP_ID"
                      mapTypeId="satellite"
                      tilt={45}
                      heading={0}
                      {...({ internalUsageAttributionIds: ['gmp_mcp_codeassist_v1_aistudio'] } as any)}
                      style={{ width: '100%', height: '100%' }}
                    >
                      <AdvancedMarker position={{ lat: resolvedLat, lng: resolvedLng }}>
                        <Pin background="#10b981" glyphColor="#fff" />
                      </AdvancedMarker>
                    </Map>
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-400 gap-4">
                      <MapIcon size={48} strokeWidth={1} />
                      <p className="text-sm font-medium">No location data available for this project</p>
                    </div>
                  )}
                  <div className="absolute top-4 left-4 bg-white/90 backdrop-blur-md px-4 py-2 rounded-xl shadow-xl border border-zinc-100">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Aerial Context</p>
                    <p className="text-xs font-black text-zinc-900">3D Photorealistic View</p>
                  </div>
                </div>

                {/* Site Data Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-white p-6 rounded-3xl shadow-sm border border-zinc-100">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 bg-amber-50 text-amber-500 rounded-xl flex items-center justify-center">
                        <Sun size={20} />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold uppercase tracking-widest text-zinc-400">Sun & UV</h4>
                        <p className="text-sm font-black text-zinc-900">7-Day Sunshine Data</p>
                      </div>
                    </div>
                    {isFetchingSiteData ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="animate-spin text-amber-500" />
                      </div>
                    ) : weatherData ? (
                      <div className="space-y-3">
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-zinc-500">Avg Daily Sunshine</span>
                          <span className="font-bold text-zinc-900">{weatherData.sunshineHoursPerDay} hrs/day</span>
                        </div>
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-zinc-500">Avg UV Index</span>
                          <span className="font-bold text-zinc-900">{weatherData.avgUvIndex}</span>
                        </div>
                        <div className="h-1.5 w-full bg-zinc-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-amber-400"
                            style={{ width: `${Math.min((weatherData.sunshineHoursPerDay / 10) * 100, 100)}%` }}
                          />
                        </div>
                        <p className="text-[10px] text-zinc-400 leading-relaxed italic">
                          {weatherData.sunshineHoursPerDay >= 5
                            ? "Good sun exposure — ideal for Lavender, Salvia, and Roses."
                            : weatherData.sunshineHoursPerDay >= 3
                            ? "Moderate sun — consider Hydrangeas, Hostas, and Astilbe."
                            : "Low light — shade-lovers like Ferns, Hellebores, and Ivy will thrive."}
                        </p>
                      </div>
                    ) : (
                      <p className="text-xs text-zinc-400 italic py-4">Add an address to load weather data.</p>
                    )}
                  </div>

                  <div className="bg-white p-6 rounded-3xl shadow-sm border border-zinc-100">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 bg-blue-50 text-blue-500 rounded-xl flex items-center justify-center">
                        <Leaf size={20} />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold uppercase tracking-widest text-zinc-400">Rain & Wind</h4>
                        <p className="text-sm font-black text-zinc-900">7-Day Climate Data</p>
                      </div>
                    </div>
                    {isFetchingSiteData ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="animate-spin text-blue-500" />
                      </div>
                    ) : weatherData ? (
                      <div className="space-y-3">
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-zinc-500">Weekly Rainfall</span>
                          <span className="font-bold text-zinc-900">{weatherData.weeklyRainfallMm} mm</span>
                        </div>
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-zinc-500">Avg Wind Speed</span>
                          <span className="font-bold text-zinc-900">{weatherData.avgWindSpeedKmh} km/h</span>
                        </div>
                        <div className="h-1.5 w-full bg-zinc-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-400"
                            style={{ width: `${Math.min((weatherData.weeklyRainfallMm / 50) * 100, 100)}%` }}
                          />
                        </div>
                        <p className="text-[10px] text-zinc-400 leading-relaxed italic">
                          {weatherData.avgWindSpeedKmh > 30
                            ? "High winds — recommend windbreak planting (Hornbeam, Holly)."
                            : weatherData.weeklyRainfallMm > 30
                            ? "Wet conditions — avoid waterlogging; consider raised beds."
                            : "Good growing conditions for most UK garden plants."}
                        </p>
                      </div>
                    ) : (
                      <p className="text-xs text-zinc-400 italic py-4">Add an address to load climate data.</p>
                    )}
                  </div>
                </div>

                {/* Aerial View Video (if available) */}
                {aerialView && (
                  <div className="bg-white p-6 rounded-3xl shadow-sm border border-zinc-100 overflow-hidden">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-blue-50 text-blue-500 rounded-xl flex items-center justify-center">
                          <Maximize2 size={20} />
                        </div>
                        <div>
                          <h4 className="text-xs font-bold uppercase tracking-widest text-zinc-400">Aerial View</h4>
                          <p className="text-sm font-black text-zinc-900">Cinematic Fly-around</p>
                        </div>
                      </div>
                      <span className={cn(
                        "text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full",
                        aerialView.state === 'ACTIVE' ? "bg-emerald-100 text-emerald-600" : "bg-amber-100 text-amber-600"
                      )}>
                        {aerialView.state}
                      </span>
                    </div>
                    
                    {aerialView.state === 'ACTIVE' ? (
                      <div className="aspect-video rounded-2xl overflow-hidden bg-zinc-900">
                        <video 
                          src={aerialView.uris?.MP4_MEDIUM} 
                          controls 
                          className="w-full h-full object-cover"
                          poster={aerialView.uris?.LANDSCAPE_THUMBNAIL}
                        />
                      </div>
                    ) : (
                      <div className="aspect-video rounded-2xl bg-zinc-100 flex flex-col items-center justify-center text-center p-8 gap-4">
                        <Loader2 className="animate-spin text-blue-500" size={32} />
                        <div>
                          <p className="text-sm font-bold text-zinc-900">Video is being rendered</p>
                          <p className="text-xs text-zinc-500 mt-1">Google is generating a cinematic 3D view of this property. This can take a few minutes.</p>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
            )}
          </div>
        </div>

        {/* Sidebar - Plant Legend & History */}
        <AnimatePresence>
          {(currentVersion?.plantLegend || showHistory) && (
            <motion.aside 
              initial={{ x: 400 }}
              animate={{ x: 0 }}
              exit={{ x: 400 }}
              className="w-full lg:w-96 bg-white border-l border-zinc-200 overflow-y-auto p-6"
            >
              {showHistory ? (
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <h3 className="font-bold text-zinc-900 flex items-center gap-2">
                      <History size={18} className="text-zinc-400" />
                      Version History
                    </h3>
                    <button onClick={() => setShowHistory(false)} className="text-xs font-bold text-zinc-400 hover:text-zinc-600">Close</button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {versions.map((v) => (
                      <button 
                        key={v.id}
                        onClick={() => {
                          setCurrentVersion(v);
                          setShowHistory(false);
                        }}
                        className={cn(
                          "aspect-square rounded-2xl overflow-hidden border-2 transition-all relative group",
                          currentVersion?.id === v.id ? "border-emerald-500 ring-2 ring-emerald-100" : "border-transparent hover:border-zinc-200"
                        )}
                      >
                        <img src={v.imageUrl} className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <p className="text-[10px] text-white font-bold uppercase tracking-widest">View</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="flex items-center gap-2">
                    <Leaf size={18} className="text-emerald-500" />
                    <h3 className="font-bold text-zinc-900">UK Plant Legend</h3>
                  </div>
                  <div className="prose prose-sm prose-emerald">
                    <ReactMarkdown>{currentVersion?.plantLegend || ''}</ReactMarkdown>
                  </div>
                  <div className="pt-6 border-t border-zinc-100">
                    <button className="w-full py-3 border-2 border-zinc-100 text-zinc-600 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-zinc-50 transition-all flex items-center justify-center gap-2">
                      <Download size={16} />
                      Export Shopping List
                    </button>
                  </div>
                </div>
              )}
            </motion.aside>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}


