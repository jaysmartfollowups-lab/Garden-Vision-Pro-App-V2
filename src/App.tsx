import React, { useState, useEffect } from 'react';
import { onAuthStateChanged, signInAnonymously, User } from 'firebase/auth';
import { auth } from './firebase';
import { Login } from './components/Login';
import { ProjectList } from './components/ProjectList';
import { ProjectView } from './components/ProjectView';
import { Project } from './types';
import { Loader2, Trees, MapPin, Sparkles, Key, RefreshCw, CheckCircle2, AlertCircle as AlertIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { APIProvider } from '@vis.gl/react-google-maps';
import { GoogleGenAI } from "@google/genai";
import { cn } from './lib/utils';

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_PLATFORM_KEY || '';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

const hasValidMapsKey = Boolean(GOOGLE_MAPS_API_KEY) && GOOGLE_MAPS_API_KEY !== '';
const hasValidGeminiKey = Boolean(GEMINI_API_KEY) && GEMINI_API_KEY !== '' && GEMINI_API_KEY !== 'MY_GEMINI_API_KEY';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyStatus, setVerifyStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [verifyMessage, setVerifyMessage] = useState<string | null>(null);

  useEffect(() => {
    console.log("Diagnostic - Maps Key Length:", GOOGLE_MAPS_API_KEY?.length || 0);
    console.log("Diagnostic - Gemini Key Length:", GEMINI_API_KEY?.length || 0);
    console.log("Diagnostic - Gemini Key Placeholder:", GEMINI_API_KEY === 'MY_GEMINI_API_KEY');

    // Sign in anonymously on localhost for local development
    if (window.location.hostname === 'localhost') {
      signInAnonymously(auth).catch(console.error);
    }

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleVerifyKeys = async () => {
    setIsVerifying(true);
    setVerifyStatus('idle');
    setVerifyMessage(null);

    try {
      if (!GEMINI_API_KEY || GEMINI_API_KEY === 'MY_GEMINI_API_KEY') {
        throw new Error("Gemini API Key is missing or still set to placeholder.");
      }

      const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
      await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: "ping",
      });

      setVerifyStatus('success');
      setVerifyMessage("Gemini API Key verified successfully!");
      
      // Small delay to show success before reload
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (err: any) {
      console.error("Verification failed:", err);
      setVerifyStatus('error');
      setVerifyMessage(err.message || "Verification failed. Please check your key.");
    } finally {
      setIsVerifying(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-900 flex flex-col items-center justify-center gap-6">
        <div className="relative">
          <div className="w-20 h-20 bg-emerald-500 rounded-3xl flex items-center justify-center shadow-2xl shadow-emerald-500/20 animate-pulse">
            <Trees className="text-white" size={40} />
          </div>
          <div className="absolute -bottom-2 -right-2 w-8 h-8 bg-white rounded-full flex items-center justify-center shadow-lg">
            <Loader2 className="text-emerald-500 animate-spin" size={16} />
          </div>
        </div>
        <div className="text-center space-y-1">
          <p className="text-white font-black text-xl tracking-tight">GardenVision Pro</p>
          <p className="text-zinc-500 text-[10px] uppercase tracking-widest font-bold">Initializing AI Engine</p>
        </div>
      </div>
    );
  }

  if (!hasValidMapsKey || !hasValidGeminiKey) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-6 font-sans">
        <div className="max-w-md w-full bg-white rounded-3xl shadow-2xl p-8 text-center">
          <div className="w-16 h-16 bg-emerald-50 text-emerald-500 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <MapPin size={32} />
          </div>
          <h2 className="text-2xl font-black text-zinc-900 tracking-tight mb-4">API Keys Required</h2>
          <p className="text-zinc-500 text-sm mb-8 leading-relaxed">
            To enable professional garden design, site intelligence, and AI-powered transformations, please add your API keys.
          </p>
          
          <div className="space-y-6 text-left mb-8">
            {!hasValidMapsKey && (
              <div className="p-4 bg-zinc-50 rounded-2xl border border-zinc-100">
                <h3 className="text-xs font-bold text-zinc-900 uppercase tracking-wider mb-2">Google Maps Platform Key</h3>
                <p className="text-xs text-zinc-500 mb-2">Required for address lookup, solar analysis, and aerial views.</p>
                <div className="flex items-center justify-between">
                  <a href="https://console.cloud.google.com/google/maps-apis/credentials" target="_blank" rel="noopener" className="text-[10px] text-emerald-600 font-bold hover:underline">Get Maps Key →</a>
                  <span className="text-[10px] font-mono text-zinc-400">Status: {GOOGLE_MAPS_API_KEY ? 'Detected' : 'Missing'}</span>
                </div>
              </div>
            )}

            {!hasValidGeminiKey && (
              <div className="p-4 bg-zinc-50 rounded-2xl border border-zinc-100">
                <h3 className="text-xs font-bold text-zinc-900 uppercase tracking-wider mb-2">Gemini AI API Key</h3>
                <p className="text-xs text-zinc-500 mb-2">Required for garden transformations and plant recommendations.</p>
                <div className="flex items-center justify-between">
                  <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener" className="text-[10px] text-emerald-600 font-bold hover:underline">Get Gemini Key →</a>
                  <span className="text-[10px] font-mono text-zinc-400">Status: {GEMINI_API_KEY ? (GEMINI_API_KEY === 'MY_GEMINI_API_KEY' ? 'Placeholder' : 'Detected') : 'Missing'}</span>
                </div>
              </div>
            )}

            <div className="bg-emerald-50 p-4 rounded-2xl border border-emerald-100">
              <p className="text-[10px] text-emerald-800 font-bold mb-2 uppercase tracking-widest">How to add keys:</p>
              <ol className="text-xs text-emerald-700 space-y-2 list-decimal ml-4">
                <li>Open <strong>Settings</strong> (⚙️ gear icon, top-right corner)</li>
                <li>Select <strong>Secrets</strong></li>
                <li>Add <code>GOOGLE_MAPS_PLATFORM_KEY</code> and/or <code>GEMINI_API_KEY</code></li>
                <li>Paste your key(s) and press <strong>Enter</strong></li>
              </ol>
            </div>
          </div>

          <div className="space-y-3">
            <button 
              onClick={handleVerifyKeys}
              disabled={isVerifying}
              className="w-full py-4 bg-zinc-900 text-white rounded-2xl font-bold text-sm uppercase tracking-widest shadow-xl hover:bg-black transition-all flex items-center justify-center gap-3 disabled:opacity-50"
            >
              {isVerifying ? <Loader2 size={18} className="animate-spin" /> : <RefreshCw size={18} />}
              Verify Keys Now
            </button>

            {verifyStatus !== 'idle' && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn(
                  "p-4 rounded-xl text-xs font-bold flex items-center gap-3",
                  verifyStatus === 'success' ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                )}
              >
                {verifyStatus === 'success' ? <CheckCircle2 size={16} /> : <AlertIcon size={16} />}
                {verifyMessage}
              </motion.div>
            )}
            <button 
              onClick={() => window.location.reload()}
              className="w-full py-3 text-zinc-400 hover:text-zinc-600 font-bold text-[10px] uppercase tracking-widest transition-all"
            >
              Bypass & Start App
            </button>
          </div>

          <p className="text-[10px] text-zinc-400 font-medium italic mt-6">The app rebuilds automatically after you add the secrets.</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  return (
    <ErrorBoundary>
      <APIProvider apiKey={GOOGLE_MAPS_API_KEY} version="weekly">
        <div className="min-h-screen bg-white font-sans text-zinc-900 selection:bg-emerald-100 selection:text-emerald-900">
          <AnimatePresence mode="wait">
            {selectedProject ? (
              <motion.div
                key="project-view"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="h-screen"
              >
                <ProjectView 
                  project={selectedProject} 
                  onBack={() => setSelectedProject(null)} 
                />
              </motion.div>
            ) : (
              <motion.div
                key="project-list"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
              >
                <ProjectList onSelectProject={setSelectedProject} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </APIProvider>
    </ErrorBoundary>
  );
}
